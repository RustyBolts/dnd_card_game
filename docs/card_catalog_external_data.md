# 卡片資料外部化流程

本專案現在將卡片資料視為外部 card catalog。Worker/Host 仍然是遊戲權威端：Client 只送 command，不直接套用卡片效果或修改遊戲結果。

## 執行流程

```txt
Google Spreadsheet
  -> 發布成 CSV URL
  -> POST /api/admin/card-catalog/sync
  -> Worker 驗證 CSV
  -> Worker 將 active catalog JSON 寫入 Cloudflare KV
  -> 新的 Durable Object 房間從 KV 載入 active catalog
  -> GAME_STATE_SYNC 帶出 cardDefinitions 與 cardCatalogVersion
```

已經開始或已經初始化的房間不會即時重載卡表。房間會鎖定初始化當下的 catalog version，避免一場遊戲打到一半時因為 Google Sheet 被修改而改變卡片規則。

## CSV 檔案

本機可選擇保留兩個 CSV 作為測試或上傳 Google Spreadsheet 的暫存資料：

- `data/cards.csv`
- `data/starter_deck.csv`

`data/` 已加入 `.gitignore`，不納入 git，也不是 Cloudflare runtime 的必要資料來源。Cloudflare Worker 實際讀取的是 `wrangler.toml` / Worker variables 中設定的 Google Spreadsheet CSV URL。

Google Spreadsheet 建議建立兩個工作表：

- `cards`
- `starter_deck`

### `cards` 欄位

```txt
cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled
```

- `cardId`：穩定唯一 ID，牌組和遊戲狀態都用這個 ID。
- `name`：顯示名稱。
- `cost`：整數，必須 >= 0。
- `type`：`ATTACK`、`SKILL`、`ITEM` 或 `STATUS`。
- `description`：顯示文字。
- `effectType`：`DAMAGE`、`HEAL` 或 `DRAW`。
- `effectValue`：`DAMAGE`、`HEAL` 使用的數值。
- `effectCount`：`DRAW` 使用的抽牌張數。
- `targetSelection`：`NONE`、`SINGLE` 或 `GROUP`。
- `targetScope`：`SELF`、`ALLY`、`ENEMY` 或 `ANY`。
- `targetRequired`：`true` 表示 command 必須帶目標；`false` 表示玩家不需要也不能手動指定目標。
- `enabled`：除了 `false`、`0`、`no` 以外都視為啟用。

目標欄位的建議用法：

- 自己：`targetSelection=NONE`、`targetScope=SELF`、`targetRequired=false`。
- 敵人單體：`targetSelection=SINGLE`、`targetScope=ENEMY`、`targetRequired=true`。
- 可指定任意單體，包含自己：`targetSelection=SINGLE`、`targetScope=ANY`、`targetRequired=true`。
- 隊友單體：`targetSelection=SINGLE`、`targetScope=ALLY`、`targetRequired=true`。目前對戰狀態尚未提供隊伍設定，之後加入 `teamId` 後才會有可選隊友。
- 隊友群體：`targetSelection=GROUP`、`targetScope=ALLY`、`targetRequired=false`。
- 敵人群體：`targetSelection=GROUP`、`targetScope=ENEMY`、`targetRequired=true`。目前 command protocol 尚未提供群體目標 ID，因此這類牌可以先建資料，但不能實際施放。

為了讓既有 Google Spreadsheet / KV catalog 有遷移時間，程式仍接受沒有目標欄位的舊 `cards` CSV：`DAMAGE` 會推導成敵人單體必填，`HEAL` 與 `DRAW` 會推導成作用於自己且不需指定目標。

### `starter_deck` 欄位

```txt
cardId,count
```

- `cardId` 必須存在於啟用中的 `cards`。
- `count` 會展開成 starter deck 中的卡片張數。

## 本機 Node Host

`npm run dev:host` 預設讀取 seed CSV：

```bash
npm run dev:host -- --port 7777
```

測試其他 CSV 匯出檔時可以指定路徑：

```bash
npm run dev:host -- --cards-csv /path/to/cards.csv --starter-deck-csv /path/to/starter_deck.csv
```

如果兩個 CSV 都不存在，Host 會 fallback 到程式內建的 default catalog。若只存在其中一個 CSV，啟動會失敗，因為 card catalog 不完整。

## Cloudflare Worker 設定

建立一個 Cloudflare KV namespace，用來存 active catalog，並將 Worker binding 命名為：

```txt
CARD_CATALOG_KV
```

設定 Worker variables：

```txt
CARD_CARDS_CSV_URL=<published cards CSV URL>
CARD_STARTER_DECK_CSV_URL=<published starter_deck CSV URL>
CARD_CATALOG_KEY=card-catalog:active
```

`CARD_CATALOG_KEY` 可省略；未設定時程式會使用 `card-catalog:active`。

如果 CSV URL variables 是在 Cloudflare Dashboard 設定，使用 Wrangler 部署時請加上 `--keep-vars`，避免部署時清掉 Dashboard variables：

```bash
npx wrangler deploy --keep-vars
```

設定 Worker secret：

```bash
npx wrangler secret put CARD_CATALOG_ADMIN_TOKEN
```

同步 endpoint 需要：

```txt
Authorization: Bearer <CARD_CATALOG_ADMIN_TOKEN>
```

## 同步指令

Google Spreadsheet 修改後，執行：

```bash
curl -X POST \
  -H "Authorization: Bearer <CARD_CATALOG_ADMIN_TOKEN>" \
  https://<worker-domain>/api/admin/card-catalog/sync
```

確認目前 active catalog：

```bash
curl https://<worker-domain>/api/card-catalog
```

如果 CSV 驗證失敗，KV 不會被更新，既有遊戲也會繼續使用已載入的 catalog。

同一個房間如果已經開始遊戲，會繼續使用開始時的 catalog。若房間還在等待且沒有連線，下一次進房會重新讀取 KV 中最新的 catalog。

## 後續私有 Spreadsheet 方案

第一階段使用 published CSV URL，因為最適合原型快速迭代，也已經達成「修改 Sheet 後同步到 KV，不需要重新 deploy」的目標。

若之後不希望 Sheet 公開，可以把「抓 CSV」這一步替換成 Google Sheets API + service account，保留同一套 CSV/schema 驗證與 KV 寫入流程。
