# dnd_card_game

Wi-Fi LAN 回合制卡牌桌遊原型。專案依照附件規格建立，採用 Host authoritative 架構：Host 是唯一可修改遊戲狀態的端點，Client 只能送出玩家意圖 command。

## 功能範圍

- Host 使用 WebSocket 開房。
- Client 用 `ws://host-ip:port` 加入。
- 支援 `JOIN_ROOM`、`SET_CHARACTER`、`PLAYER_READY`、`CANCEL_READY`、`DRAW_CARD`、`PLAY_CARD`、`DISCARD_CARD`、`END_TURN`。
- Host 驗證目前回合、手牌歸屬、卡牌 zone 與能量費用。
- 玩家先加入房間，再於等待室完成角色設定：單選種族，分配 24 點到力量、敏捷、智力、感知、魅力、體質，Host 會驗證下限、種族創角上限與點數總額；ready 後與對戰開始後會鎖定角色設定。
- 種族資料可由外部 catalog 讀入，包含創角上限、升級上限、基礎 HP、天生護甲類型與護甲值。
- Cloudflare Worker 提供 lobby API，可建立公開房、建立私有房、列出公開房，私有房不列在公開清單，需用房間代碼與密碼取得短效 join token 後才能連 WebSocket。
- 支援無直接效果、傷害、治療、抽牌與外部規則觸發的手牌卡牌轉換。
- 卡片定義包含施放目標規則，可區分自己、敵人單體、任意單體、隊友單體與未來群體目標。
- 玩家加入時預設依順序分成兩個陣營，供 `ALLY`、`ENEMY` 與 `GROUP` 目標判定使用。
- Host 針對每個玩家送出可見 snapshot，避免洩漏對手手牌內容。
- Console client 可在同 Wi-Fi 的不同裝置上連線測試。

## 安裝

```bash
npm install
```

## 啟動 Host

```bash
npm run dev:host -- --port 7777
```

Host 啟動後，同一 Wi-Fi 的其他裝置可以用主機 IP 連線，例如：

```txt
ws://192.168.1.23:7777
```

## 啟動 Client

另開終端機：

```bash
npm run dev:client -- --url ws://localhost:7777 --name Alice
```

第二位玩家：

```bash
npm run dev:client -- --url ws://localhost:7777 --name Bob
```

Client 連線後會自動送出預設角色設定。Client 指令：

```txt
ready
cancel-ready
draw
hand
play <cardInstanceId> [targetPlayerId]
discard <cardInstanceId>
end
state
players
quit
```

兩位玩家都完成角色設定並輸入 `ready` 後，Host 會建立牌堆、發初始手牌並開始第一回合。

## 開發指令

```bash
npm run typecheck
npm test
npm run build
```

## 卡片資料來源

卡片資料已外部化為 card catalog。Cloudflare Worker 會從 Google Spreadsheet 發布出的 CSV URL 同步到 KV，遊戲房間再從 KV 讀取 active catalog。

Node host 可選擇讀取本機 CSV：

```txt
data/cards.csv
data/starter_deck.csv
data/transform_rules.csv
data/races.csv
```

這些 CSV 只是本機測試或上傳 Google Spreadsheet 時的暫存資料，`data/` 已加入 `.gitignore`，不是正式 runtime 依賴。若本機沒有 `cards.csv` 與 `starter_deck.csv`，Node host 會 fallback 到程式內建的 default catalog。`transform_rules.csv` 可省略。
`races.csv` 可省略；省略時會使用程式內建的人類、地侏、獸人預設種族。

詳細流程請看：

```txt
docs/card_catalog_external_data.md
```

## Agent / 開發流程

專案根目錄的 `AGENTS.md` 定義了後續 agent 與開發者應遵守的工作流程、Cloudflare CI/CD 驗證、Vue 3 前端方向、互動效果套件建議與 TypeScript 架構規範。進行功能開發前請先閱讀該文件。

## Cloudflare Worker CI/CD

Cloudflare Worker 後端使用 Durable Object 保存房間 lobby 與各遊戲房間的權威狀態與 WebSocket 連線。`RoomLobby` 管公開房清單、私有房密碼驗證與短效 join token；`GameRoom` 管單一房間的遊戲狀態。

在 Cloudflare 建立 Worker 時使用：

```txt
Project name: dnd-card-game-api
Production branch: main
Root directory: /
Build command: npm run build
Deploy command: npx wrangler deploy
```

注意：Worker 名稱請使用 `dnd-card-game-api`，不要使用 `dnd_card_game`，因為 Wrangler/Workers 名稱不建議使用底線。

本機驗證：

```bash
npm run build:worker
npx wrangler deploy --dry-run
```

Worker `wrangler.toml` 需要 Durable Object bindings：

```txt
GAME_ROOMS -> GameRoom
ROOM_LOBBY -> RoomLobby
```

若啟用外部卡片資料，Worker 需要額外設定：

```txt
KV binding: CARD_CATALOG_KV
Variables:
  CARD_CARDS_CSV_URL=<published cards CSV URL>
  CARD_STARTER_DECK_CSV_URL=<published starter_deck CSV URL>
  CARD_TRANSFORM_RULES_CSV_URL=<published transform_rules CSV URL>
  CARD_RACES_CSV_URL=<published races CSV URL>
  CARD_CATALOG_KEY=card-catalog:active
Secret:
  CARD_CATALOG_ADMIN_TOKEN
```

`CARD_TRANSFORM_RULES_CSV_URL`、`CARD_RACES_CSV_URL` 與 `CARD_CATALOG_KEY` 可省略；沒有 transform rules URL 時代表沒有外部卡牌轉換規則，沒有 races URL 時使用內建種族，沒有 catalog key 時會使用 `card-catalog:active`。如果 CSV URL variables 是在 Cloudflare Dashboard 設定，使用 Wrangler 部署時請加上 `--keep-vars`，避免部署時清掉 Dashboard variables：

```bash
npx wrangler deploy --keep-vars
```

本機 `wrangler dev` 的 admin token 需放在 `.dev.vars`，這個檔案不提交到 git。可先複製範例：

```bash
cp .dev.vars.example .dev.vars
```

然後把 `.dev.vars` 改成：

```txt
CARD_CATALOG_ADMIN_TOKEN=<local-dev-token>
```

修改後重啟 `npm run dev:worker -- --port 8787`，本機 sync API 才會讀到 token。

同步卡表：

```bash
curl -X POST \
  -H "Authorization: Bearer <CARD_CATALOG_ADMIN_TOKEN>" \
  https://<worker-domain>/api/admin/card-catalog/sync
```

本機 Worker dev 範例：

```bash
curl -X POST \
  -H "Authorization: Bearer <local-dev-token>" \
  http://127.0.0.1:8787/api/admin/card-catalog/sync
```

## Cloudflare Pages CI/CD

Cloudflare Pages 前端位於 `web/`，部署時連到同一個 GitHub repo。

Pages 設定：

```txt
Project name: dnd-card-game
Production branch: main
Root directory: /
Build command: npm run build:pages
Build output directory: web/dist
```

建議在 Pages 環境變數加入 Worker WebSocket URL：

```txt
VITE_WORKER_WS_URL=wss://<your-worker-domain>/ws
```

若未設定，前端會預設使用同網域 `/ws`，也可以在畫面上的 Worker WS 欄位手動貼上 Worker URL。

## 專案結構

```txt
src/
  shared/
    constants/
    rules/
    types/
  host/
  client/
worker/
web/
tests/
docs/
```

## 設計重點

- `CardDefinition` 是卡牌模板，包含 `effect` 與 `targeting`。目前 `targeting` 由 Host/Worker 驗證，前端只用它顯示可選目標。
- `CardInstance` 是對戰中實際存在的一張卡，所有操作都使用 `instanceId`。
- 隨機結果由 Host 產生，例如洗牌與抽牌。
- Client 不直接推測結果，只接受 Host event / snapshot。

## 更新
- 2026/06/05 完成首次網頁部署
- 2026/06/08 資料讀入改用 cloudflare kv 暫存
- 2026/06/10 加入卡牌變化功能
