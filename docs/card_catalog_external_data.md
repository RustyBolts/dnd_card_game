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

本機可選擇保留 CSV 作為測試或上傳 Google Spreadsheet 的暫存資料：

- `data/cards.csv`
- `data/starter_deck.csv`
- `data/transform_rules.csv`（可選）
- `data/races.csv`（可選）

`data/` 已加入 `.gitignore`，不納入 git，也不是 Cloudflare runtime 的必要資料來源。Cloudflare Worker 實際讀取的是 `wrangler.toml` / Worker variables 中設定的 Google Spreadsheet CSV URL。

Google Spreadsheet 建議建立四個工作表：

- `cards`
- `starter_deck`
- `transform_rules`（可選）
- `races`（可選）

### `cards` 欄位

```txt
cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,consumable,enabled
```

- `cardId`：穩定唯一 ID，牌組和遊戲狀態都用這個 ID。
- `name`：顯示名稱。
- `cost`：整數，必須 >= 0。
- `type`：`ATTACK`、`SKILL`、`ITEM` 或 `STATUS`。
- `description`：顯示文字。
- `effectType`：`NONE`、`DAMAGE`、`HEAL` 或 `DRAW`。`NONE` 適合只用來觸發外部規則、自己沒有直接效果的卡。
- `effectValue`：`DAMAGE`、`HEAL` 使用的數值。
- `effectCount`：`DRAW` 使用的抽牌張數。
- `targetSelection`：`NONE`、`SINGLE` 或 `GROUP`。
- `targetScope`：`SELF`、`ALLY`、`ENEMY` 或 `ANY`。
- `targetRequired`：`SINGLE` 目標使用；`true` 表示 command 必須帶目標，`false` 表示玩家不需要手動指定目標。`GROUP` 目標會依 `targetScope` 自動解析全體目標，程式會將 `targetRequired` 視為 `false`。
- `consumable`：可選。`true` 表示卡牌打出後進入消耗牌堆，不會從暫存牌堆重洗回牌庫。空白或未提供欄位時視為普通牌。
- `enabled`：除了 `false`、`0`、`no` 以外都視為啟用。

目標欄位的建議用法：

- 自己：`targetSelection=NONE`、`targetScope=SELF`、`targetRequired=false`。
- 敵人單體：`targetSelection=SINGLE`、`targetScope=ENEMY`、`targetRequired=true`。
- 可指定任意單體，包含自己：`targetSelection=SINGLE`、`targetScope=ANY`、`targetRequired=true`。
- 隊友單體：`targetSelection=SINGLE`、`targetScope=ALLY`、`targetRequired=true`。目前對戰狀態尚未提供隊伍設定，之後加入 `teamId` 後才會有可選隊友。
- 隊友群體：`targetSelection=GROUP`、`targetScope=ALLY`、`targetRequired=false`。
- 敵人群體：`targetSelection=GROUP`、`targetScope=ENEMY`、`targetRequired=false`。施放時不需要傳 `targetId`，Host/Worker 會依目前陣營自動套用到所有敵方玩家。

目前尚未提供手動選陣營流程；玩家加入時會依加入順序分到預設兩陣營：第 1、3、5 位玩家在 `team_1`，第 2、4、6 位玩家在 `team_2`。之後若需要自建陣營，可以擴充 join/lobby command，讓玩家在遊戲開始前選擇 `teamId`。

為了讓既有 Google Spreadsheet / KV catalog 有遷移時間，程式仍接受沒有目標欄位或沒有 `consumable` 欄位的舊 `cards` CSV：`DAMAGE` 會推導成敵人單體必填，`HEAL` 與 `DRAW` 會推導成作用於自己且不需指定目標；未提供 `consumable` 時會視為普通牌。

### `starter_deck` 欄位

```txt
cardId,count
```

- `cardId` 必須存在於啟用中的 `cards`。
- `count` 會展開成 starter deck 中的卡片張數。

### `transform_rules` 欄位

```txt
ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming
```

- `ruleId`：穩定唯一 ID，用於事件、測試與除錯。
- `triggerCardId`：打出哪張卡時觸發規則。
- `sourceCardId`：被轉換前的卡牌 ID。
- `targetCardId`：轉換後的卡牌 ID，必須與 `sourceCardId` 不同。
- `scope`：目前支援 `hand` 或 `OWNER_HAND`，代表觸發者自己的手牌。
- `reversible`：`true` 表示此轉換會依 `revertTiming` 還原；`false` 表示不會自動還原。
- `revertTiming`：目前支援 `turn_end` 或 `NEVER`。`reversible=false` 時必須是 `NEVER` 或空白。

玩家打出 `triggerCardId` 後，Host/Worker 會掃描規則 scope 中符合 `sourceCardId` 的 card instance，保留同一個 `instanceId` 並把 `cardId` 改成 `targetCardId`。若 `reversible=true` 且 `revertTiming=turn_end`，該 instance 在觸發者回合結束時仍在手牌中才會還原成 `sourceCardId`；若已經被打出或丟棄，則不再還原。

`CARD_TRANSFORMED` event 只會送給該手牌的持有者。其他玩家不會收到這類事件，避免從事件數量或 ruleId 反推出對手手牌內容。

範例：

```txt
ruleId,triggerCardId,sourceCardId,targetCardId,scope,reversible,revertTiming
T001,stance_shift,wolf_form,bear_form,hand,true,turn_end
```

對應的觸發卡可以是沒有直接效果的 `NONE` 卡：

```txt
cardId,name,cost,type,description,effectType,effectValue,effectCount,targetSelection,targetScope,targetRequired,enabled
stance_shift,姿態轉換,0,SKILL,手牌中的狼形態暫時變成熊形態。,NONE,,,NONE,SELF,false,true
wolf_form,狼形態,1,ATTACK,對一名目標造成 1 點傷害。,DAMAGE,1,,SINGLE,ENEMY,true,true
bear_form,熊形態,2,ATTACK,對一名目標造成 2 點傷害。,DAMAGE,2,,SINGLE,ENEMY,true,true
```

### `races` 欄位

```txt
raceId,name,baseHp,naturalArmorType,naturalArmorValue,strengthCreationMax,dexterityCreationMax,intelligenceCreationMax,wisdomCreationMax,charismaCreationMax,constitutionCreationMax,strengthLevelMax,dexterityLevelMax,intelligenceLevelMax,wisdomLevelMax,charismaLevelMax,constitutionLevelMax,enabled
```

- `raceId`：穩定唯一 ID，角色設定和遊戲狀態都用這個 ID。
- `name`：顯示名稱。
- `baseHp`：種族基礎 HP，角色 HP 會以 `baseHp + 體質調整值` 計算。
- `naturalArmorType`：`NONE`、`FUR`、`SHELL` 或 `SKIN`。
- `naturalArmorValue`：天生護甲值，整數，必須 >= 0。
- `*CreationMax`：創建角色時該屬性的上限。Host 只在進入房間前的角色設定使用這組限制。
- `*LevelMax`：升級分配時該屬性的暫定上限，目前先進入 catalog 和 state，後續升級流程會使用。
- `enabled`：除了 `false`、`0`、`no` 以外都視為啟用。

玩家建立角色時六屬性最低值固定為 8，必須剛好分配 24 點，也就是六屬性總和必須是 72。屬性調整值公式是 `Math.floor((屬性值 - 10) / 2)`，Host 會在角色設定通過後暫存在 player state。

若沒有提供外部 `races.csv`，程式會使用內建預設：

```txt
raceId,name,baseHp,naturalArmorType,naturalArmorValue,strengthCreationMax,dexterityCreationMax,intelligenceCreationMax,wisdomCreationMax,charismaCreationMax,constitutionCreationMax,strengthLevelMax,dexterityLevelMax,intelligenceLevelMax,wisdomLevelMax,charismaLevelMax,constitutionLevelMax,enabled
human,人類,20,NONE,0,18,18,18,18,18,18,20,20,20,20,20,20,true
gnome,地侏,20,SKIN,0,15,18,20,20,18,15,20,20,20,20,20,20,true
orc,獸人,25,FUR,0,20,18,15,15,15,20,20,20,20,20,20,20,true
```

## 本機 Node Host

`npm run dev:host` 預設讀取 seed CSV：

```bash
npm run dev:host -- --port 7777
```

測試其他 CSV 匯出檔時可以指定路徑：

```bash
npm run dev:host -- --cards-csv /path/to/cards.csv --starter-deck-csv /path/to/starter_deck.csv --transform-rules-csv /path/to/transform_rules.csv --races-csv /path/to/races.csv
```

如果 `cards.csv` 與 `starter_deck.csv` 都不存在，Host 會 fallback 到程式內建的 default catalog。若只存在其中一個，或只有 `transform_rules.csv`，啟動會失敗，因為 card catalog 不完整。`transform_rules.csv` 可省略；省略時代表沒有外部轉換規則。
`races.csv` 可省略；省略時代表使用內建種族。

## Cloudflare Worker 設定

建立一個 Cloudflare KV namespace，用來存 active catalog，並將 Worker binding 命名為：

```txt
CARD_CATALOG_KV
```

設定 Worker variables：

```txt
CARD_CARDS_CSV_URL=<published cards CSV URL>
CARD_STARTER_DECK_CSV_URL=<published starter_deck CSV URL>
CARD_TRANSFORM_RULES_CSV_URL=<published transform_rules CSV URL>
CARD_RACES_CSV_URL=<published races CSV URL>
CARD_CATALOG_KEY=card-catalog:active
```

`CARD_TRANSFORM_RULES_CSV_URL`、`CARD_RACES_CSV_URL` 與 `CARD_CATALOG_KEY` 可省略；沒有 `CARD_TRANSFORM_RULES_CSV_URL` 時代表沒有外部轉換規則，沒有 `CARD_RACES_CSV_URL` 時使用內建種族，沒有 `CARD_CATALOG_KEY` 時程式會使用 `card-catalog:active`。

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
