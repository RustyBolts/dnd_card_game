---
skill_id: lan_turn_based_card_game_architect
name: LAN Turn-Based Card Game Architect
version: 1.0.0
project_type: Wi-Fi LAN turn-based card/board game
author_role: Game System Architect
language: zh-TW
target_usage: Codex / AI coding agent
---

# LAN Turn-Based Card Game Architect

## 目的

本 Skill 用於協助建立一款「透過 Wi-Fi 區域網路連線、由一名玩家作為 Host 主持伺服器、其他玩家作為 Client 加入」的回合制卡牌桌遊。

設計目標是快速建立可運作原型，優先滿足：

1. Host 開房。
2. Client 加入房間。
3. 玩家輪流進行。
4. 玩家可以抽卡、出牌、棄牌、結束回合。
5. Host 作為權威端驗證所有操作。
6. Client 只負責送出指令與顯示狀態。
7. 支援未來擴充卡牌效果、斷線重連、自動搜尋房間。

---

# 核心架構原則

## 1. Host Authoritative / 主機權威制

Host 是唯一可信任的遊戲裁判。

Client 不可直接修改遊戲狀態，只能送出 Command，例如：

- DRAW_CARD
- PLAY_CARD
- DISCARD_CARD
- END_TURN

Host 收到 Command 後必須驗證：

- 是否為目前玩家的回合。
- 玩家是否擁有該卡牌實例。
- 卡牌是否在正確區域，例如 HAND。
- 卡牌費用是否足夠。
- 目標是否合法。
- 當前階段是否允許此操作。

Host 驗證通過後更新 GameState，並廣播 Event 給所有 Client。

---

## 2. Command / Event 模式

Client 送 Command。

Host 廣播 Event。

不要讓 Client 直接送出結果，例如「我造成了 5 點傷害」。  
Client 只能送出意圖，例如「我想使用 card_inst_001 攻擊 target_002」。

### Command 範例

```json
{
  "type": "PLAY_CARD",
  "requestId": "req_001",
  "playerId": "p1",
  "payload": {
    "cardInstanceId": "card_inst_001",
    "targetId": "p2"
  }
}
```

### Event 範例

```json
{
  "type": "CARD_PLAYED",
  "seq": 18,
  "payload": {
    "playerId": "p1",
    "cardInstanceId": "card_inst_001",
    "cardId": "fireball",
    "targetId": "p2"
  }
}
```

---

## 3. Event Sync 為主，Snapshot Sync 為輔

一般遊戲流程以事件同步：

- CARD_DRAWN
- CARD_PLAYED
- CARD_DISCARDED
- DAMAGE_APPLIED
- TURN_STARTED
- TURN_ENDED

但當 Client 加入、重連或同步異常時，Host 發送完整 Snapshot。

```json
{
  "type": "GAME_STATE_SYNC",
  "seq": 30,
  "payload": {
    "state": {}
  }
}
```

---

# 必要模組

## Host 端

```txt
HostServer
 ├─ RoomManager
 ├─ ConnectionManager
 ├─ PlayerManager
 ├─ TurnManager
 ├─ DeckManager
 ├─ HandManager
 ├─ CardEffectResolver
 ├─ GameStateStore
 ├─ CommandValidator
 ├─ EventBus
 └─ SnapshotService
```

## Client 端

```txt
GameClient
 ├─ RoomConnector
 ├─ CommandSender
 ├─ EventReceiver
 ├─ LocalStateStore
 ├─ CardUIController
 ├─ TurnUIController
 └─ ReconnectHandler
```

---

# 優先實作策略

## MVP 第一階段

先不要做 UDP、自動搜尋房間、複雜動畫、AI 對手、完整牌組編輯。

第一版只做：

1. Host 開房。
2. Client 用 IP + Port 加入。
3. WebSocket 連線。
4. Host 建立牌堆。
5. Host 發初始手牌。
6. 回合輪替。
7. 抽卡。
8. 出牌。
9. 棄牌。
10. 結束回合。
11. Host 廣播事件。
12. Client 顯示同步後狀態。

---

# 實作守則

## 不要把 Card Definition 和 Card Instance 混在一起

Card Definition 是卡牌模板。

```json
{
  "cardId": "fireball",
  "name": "火球術",
  "cost": 2,
  "effectType": "DAMAGE",
  "value": 3
}
```

Card Instance 是對戰中實際存在的一張牌。

```json
{
  "instanceId": "card_inst_001",
  "cardId": "fireball",
  "ownerId": "p1",
  "zone": "HAND"
}
```

同一場遊戲可能有多張 fireball，因此操作時必須使用 instanceId。

---

## 所有隨機結果由 Host 產生

例如：

- 洗牌
- 抽牌
- 隨機棄牌
- 隨機目標
- 隨機卡牌效果

Client 不可自行產生影響遊戲結果的隨機值。

---

## 所有狀態變化都應該由事件描述

例如不要只修改 HP，應產生：

```json
{
  "type": "DAMAGE_APPLIED",
  "payload": {
    "sourceId": "card_inst_001",
    "targetId": "p2",
    "amount": 3,
    "hpAfter": 17
  }
}
```

---

# Codex 工作方式

當使用者要求開發功能時，請依照以下流程：

1. 先確認該功能屬於 Host、Client、Shared 還是 UI。
2. 若涉及遊戲狀態，必須先更新 Shared Types。
3. 若涉及玩家操作，必須建立 Command。
4. 若涉及遊戲結果，必須建立 Event。
5. Host 必須驗證 Command。
6. Client 不得直接信任本地推測結果。
7. 每次完成後補上最小測試案例。

---

# 建議第一版技術選型

若使用 TypeScript：

- Runtime：Node.js
- 通訊：WebSocket
- 前端：任意 UI，可用 Vue 3 / Cocos Creator / HTML Canvas
- Shared：共用 types、schemas、game rules
- 測試：Vitest

若使用 Cocos Creator：

- 遊戲畫面由 Cocos 負責。
- WebSocket Client 由 Cocos 腳本連接 Host。
- Host 可先用 Node.js 獨立執行，或在 Host 玩家端啟動本地服務。

---

# 最終原則

先讓遊戲真的能兩台裝置在同一 Wi-Fi 下連起來玩。  
不要第一天就試圖做成爐石傳說。  
網路同步是泥沼，踩得太優雅也還是泥沼。
