# dnd_card_game

Wi-Fi LAN 回合制卡牌桌遊原型。專案依照附件規格建立，採用 Host authoritative 架構：Host 是唯一可修改遊戲狀態的端點，Client 只能送出玩家意圖 command。

## 功能範圍

- Host 使用 WebSocket 開房。
- Client 用 `ws://host-ip:port` 加入。
- 支援 `JOIN_ROOM`、`PLAYER_READY`、`DRAW_CARD`、`PLAY_CARD`、`DISCARD_CARD`、`END_TURN`。
- Host 驗證目前回合、手牌歸屬、卡牌 zone 與能量費用。
- 支援傷害、治療、抽牌三種卡牌效果。
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

Client 指令：

```txt
ready
draw
hand
play <cardInstanceId> [targetPlayerId]
discard <cardInstanceId>
end
state
players
quit
```

兩位玩家都輸入 `ready` 後，Host 會建立牌堆、發初始手牌並開始第一回合。

## 開發指令

```bash
npm run typecheck
npm test
npm run build
```

## 專案結構

```txt
src/
  shared/
    constants/
    rules/
    types/
  host/
  client/
tests/
docs/
```

## 設計重點

- `CardDefinition` 是卡牌模板。
- `CardInstance` 是對戰中實際存在的一張卡，所有操作都使用 `instanceId`。
- 隨機結果由 Host 產生，例如洗牌與抽牌。
- Client 不直接推測結果，只接受 Host event / snapshot。
