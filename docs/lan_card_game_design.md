# Wi-Fi LAN 回合制卡牌桌遊設計文件

## 1. 專案目標

建立一款可在同一 Wi-Fi 區域網路內遊玩的回合制卡牌桌遊。

一名玩家作為 Host，負責主持遊戲與保存權威狀態。其他玩家作為 Client 加入房間，透過 WebSocket 與 Host 溝通。

---

## 2. 系統拓樸

```txt
Client A ── Command ──▶
Client B ── Command ──▶ Host Server ── Event / Snapshot ──▶ All Clients
Client C ── Command ──▶
```

Host 是唯一可以改變 GameState 的端點。

---

## 3. 通訊協定

## 3.1 MVP 使用 WebSocket

原因：

- 回合制遊戲不需要 UDP 的極低延遲。
- WebSocket 雙向通訊簡單。
- 容易除錯。
- 適合 JSON 訊息。
- 能快速建立原型。

## 3.2 HTTP 可選

HTTP 可用於：

- 建立房間。
- 查詢房間資訊。
- 下載卡牌定義。
- 讀取玩家設定。

但 MVP 可以先省略 HTTP，直接用 WebSocket 完成所有流程。

---

## 4. 訊息格式

所有訊息建議使用統一格式：

```ts
type NetworkMessage = {
  type: string
  requestId?: string
  seq?: number
  playerId?: string
  roomId?: string
  payload?: unknown
  error?: {
    code: string
    message: string
  }
}
```

---

## 5. Command 設計

Command 是 Client 傳給 Host 的玩家意圖。

### JOIN_ROOM

```json
{
  "type": "JOIN_ROOM",
  "requestId": "req_001",
  "payload": {
    "playerName": "Player A",
    "clientSessionId": "browser-session-uuid"
  }
}
```

### SET_CHARACTER

```json
{
  "type": "SET_CHARACTER",
  "requestId": "req_002",
  "payload": {
    "character": {
      "raceId": "human",
      "abilityScores": {
        "strength": 14,
        "dexterity": 12,
        "intelligence": 12,
        "wisdom": 12,
        "charisma": 12,
        "constitution": 10
      }
    }
  }
}
```

### PLAYER_READY

```json
{
  "type": "PLAYER_READY",
  "requestId": "req_003"
}
```

### CANCEL_READY

```json
{
  "type": "CANCEL_READY",
  "requestId": "req_004"
}
```

### DRAW_CARD

```json
{
  "type": "DRAW_CARD",
  "requestId": "req_003"
}
```

### PLAY_CARD

```json
{
  "type": "PLAY_CARD",
  "requestId": "req_004",
  "payload": {
    "cardInstanceId": "card_inst_001",
    "targetId": "p2",
    "resourceCardInstanceIds": ["card_inst_010", "card_inst_011"],
    "resourceTargets": {
      "card_inst_010": "p2"
    }
  }
}
```

`resourceCardInstanceIds` 是可選欄位；只有卡牌定義有額外消耗手牌代價時才需要提供。被指定的卡牌必須是非 `STATUS` 手牌，狀態牌不能支付 `consumeCardCount`。`resourceTargets` 是可選 map，key 是被消耗的卡牌 instance id，value 是預定目標 player id；只有被消耗卡當下牌面帶有 `READY_ACTION` 且 `targetRequired=true` 時才需要。若只有一名合法目標，Host 可自動指定。Host 會先驗證指定張數、卡牌仍在手牌中且不是正在打出的牌、當前牌面不是狀態牌、預定目標合法，全部通過後才會移動任何牌或扣 HP。前端確認視窗只列出符合條件的非狀態牌，Host/Worker 仍會拒絕繞過 UI 的指令。

### DISCARD_CARD

```json
{
  "type": "DISCARD_CARD",
  "requestId": "req_005",
  "payload": {
    "cardInstanceId": "card_inst_001",
    "targetId": "p2"
  }
}
```

`targetId` 是可選欄位；只有棄牌觸發卡牌微操作且該效果需要指定目標時才需要提供。

回合結束的棄牌順序由 Host/Worker 驗證。若仍需棄非狀態牌，狀態牌不可先棄；非狀態牌處理完成後，只有超出狀態牌上限的狀態牌可繼續棄。Client 停用按鈕只是介面提示，不能取代權威端驗證。

### END_TURN

```json
{
  "type": "END_TURN",
  "requestId": "req_006"
}
```

---

## 6. Event 設計

Event 是 Host 廣播給所有 Client 的遊戲事實。

### PLAYER_JOINED

```json
{
  "type": "PLAYER_JOINED",
  "seq": 1,
  "payload": {
    "playerId": "p1",
    "playerName": "Player A"
  }
}
```

### GAME_STARTED

```json
{
  "type": "GAME_STARTED",
  "seq": 2,
  "payload": {
    "firstPlayerId": "p1"
  }
}
```

### CARD_DRAWN

注意：對其他玩家不應公開抽到的卡牌內容。

```json
{
  "type": "CARD_DRAWN",
  "seq": 3,
  "payload": {
    "playerId": "p1",
    "cardInstanceId": "card_inst_001",
    "privateCardData": {
      "cardId": "fireball"
    }
  }
}
```

實作時可對不同玩家送不同 payload：

- 抽牌者收到 cardId。
- 其他玩家只收到手牌數增加。

### CARD_ADDED_TO_HAND

```json
{
  "type": "CARD_ADDED_TO_HAND",
  "seq": 4,
  "payload": {
    "playerId": "p2",
    "sourceId": "card_inst_001",
    "cardInstanceId": "card_inst_020",
    "privateCardData": {
      "cardId": "bleeding"
    }
  }
}
```

`CARD_ADDED_TO_HAND` 表示卡牌效果建立了新的 card instance 並直接加入指定玩家手牌，不會移除牌庫卡牌，也不會觸發牌庫回收。只有手牌持有者收到 `sourceId` 與 `privateCardData.cardId`；其他玩家只收到玩家與新增 instance ID，用於更新公開手牌數，不能從事件關聯反推出仍留在私有手牌中的來源卡。

### CARD_PLAYED

```json
{
  "type": "CARD_PLAYED",
  "seq": 4,
  "payload": {
    "playerId": "p1",
    "cardInstanceId": "card_inst_001",
    "cardId": "fireball",
    "destinationZone": "RESOLVING",
    "targetId": "p2"
  }
}
```

### DISCARD_PHASE_STARTED

```json
{
  "type": "DISCARD_PHASE_STARTED",
  "seq": 4,
  "payload": {
    "playerId": "p1",
    "retainCount": 2,
    "statusRetainCount": 3,
    "discardCount": 2
  }
}
```

`retainCount` 是 `max(0, 智力調整值)`，代表所有手牌共用的基礎保留額度。`statusRetainCount` 是 `retainCount + max(0, 體質調整值)`，只限制最多可保留幾張狀態牌；正體質不會增加非狀態牌額度，負體質也不會降低狀態牌額度。`discardCount` 是進入棄牌階段當下，依兩種額度計算出的總待棄張數。

`discardCount` 會受私有手牌中的狀態牌數影響，因此 `DISCARD_PHASE_STARTED` 只送給該名玩家。其他玩家只會從 `GAME_STATE_SYNC` 看到公開的 `turnPhase = "DISCARD"`，不會收到可用來反推手牌組成的待棄數量。

### CARD_ACTION_TRIGGERED

```json
{
  "type": "CARD_ACTION_TRIGGERED",
  "seq": 5,
  "payload": {
    "playerId": "p1",
    "cardInstanceId": "card_inst_001",
    "cardId": "quick_shot",
    "actionTag": "BONUS_ACTION",
    "trigger": "DISCARD",
    "destinationZone": "RESOLVING",
    "targetId": "p2",
    "targetIds": ["p2"]
  }
}
```

`CARD_PLAYED.destinationZone = "RESOLVING"` 表示 Host/Worker 已將卡牌標記為結算中，效果尚在解析中。`RESOLVING` 是權威端內部暫存狀態，不是 `GAME_STATE_SYNC` 中可查詢的牌堆；客戶端若需要結算動畫，應以 `CARD_PLAYED` / `CARD_ACTION_TRIGGERED` 到 `CARD_RESOLVED` 的事件區間推導。若 `REACTION_ACTION`、`COUNTER_ACTION` 或 `consumable=true` 的 `READY_ACTION` 被直接打出準備，則 `CARD_PLAYED.destinationZone = "PREPARED"`，不會立即解析效果。

目前 `BONUS_ACTION` 會在棄牌動作發生時觸發，並以 0 能量消耗解析該卡效果。觸發時 `CARD_DISCARDED.destinationZone` 與 `CARD_ACTION_TRIGGERED.destinationZone` 會是 `RESOLVING`；效果完成後再由 `CARD_RESOLVED` 指出最終區域。前端只在點擊 `End Turn` 後的棄牌階段顯示 `Discard` 按鈕，讓玩家逐張整理手牌；主階段不顯示常駐棄牌按鈕，之後可由卡牌或規則打開特定棄牌動作窗口。

`STATUS` 狀態牌被棄牌時不需要額外 `BONUS_ACTION` 標籤，也會進入同一個結算流程。觸發時 `CARD_DISCARDED.destinationZone = "RESOLVING"`；效果完成後，未帶 `consumable=true` 的狀態牌進 `TEMPORARY`，帶 `consumable=true` 的狀態牌進 `EXHAUST`。

帶有 `END_TURN_STATUS` / `回合結束時觸發其他狀態` 的狀態牌是例外：其 `ADD_CARD_TO_HAND` 效果只會在完成回合末棄牌後、來源卡仍留在手牌時觸發。直接出牌或棄掉來源卡都不會執行新增狀態牌效果；來源卡在回合末觸發後仍留在手牌，可在之後回合再次觸發。Host/Worker 會以觸發前的手牌快照進行掃描，避免同一時點新增的牌立即連鎖觸發。對應的 `CARD_ACTION_TRIGGERED` 只送給手牌持有者，避免向對手公開來源卡內容。

回合結束時，狀態牌優先占用智力提供的基礎保留額度，體質只提供超出基礎額度後的狀態牌專用空間：

```txt
基礎保留額度 = max(0, 智力調整值)
狀態牌上限 = 基礎保留額度 + max(0, 體質調整值)
非狀態牌可保留數 = max(0, 基礎保留額度 - 目前狀態牌數)
```

Host/Worker 先要求非狀態牌降到「非狀態牌可保留數」，此時狀態牌棄牌按鈕鎖定；之後若狀態牌數仍高於「狀態牌上限」，才解除狀態牌棄牌並要求降到上限。每次棄牌效果完成後都重新計算，例如狀態牌結算抽牌時，新增手牌仍會納入同一回合的棄牌需求。

`REACTION_ACTION`、`COUNTER_ACTION` 會先以 `CARD_PLAYED.destinationZone = "PREPARED"` 進入準備牌堆。其他玩家的每次 `DAMAGE` 命中前，目標準備牌堆中最前面的一張反應動作會先結算並抵抗該次傷害；需要指定目標的反應動作以攻擊者為預設目標，不需指定且作用於自己的反應動作則對持有者結算。每張反應牌只抵抗一次傷害，多次攻擊會逐次重新檢查準備牌堆。反制動作在其他玩家用 `SKILL` 或 `MAGE` 指定自己時觸發，預設目標是施放者。`READY_ACTION` 可直接出牌並解析效果；只有被作為資源消耗，或同時有 `consumable=true` 導致出牌等同被消耗時，才會進入準備牌堆。若該準備動作 `targetRequired=true`，進入準備牌堆前必須指定預定目標；只有一名合法目標時可自動指定。準備牌堆觸發時 `CARD_ACTION_TRIGGERED.destinationZone = "RESOLVING"`；Host 會重新驗證預定目標仍可指定，若目標已死亡或不合法則取消效果並以 `CARD_RESOLVED.cancelled=true` 移入 `EXHAUST`。效果與變化檢查完成後再由 `CARD_RESOLVED.destinationZone` 指出卡牌移入 `TEMPORARY` 或 `EXHAUST`。

### CARD_RESOLVED

```json
{
  "type": "CARD_RESOLVED",
  "seq": 6,
  "payload": {
    "playerId": "p1",
    "cardInstanceId": "card_inst_001",
    "cardId": "fireball",
    "destinationZone": "TEMPORARY"
  }
}
```

`CARD_RESOLVED` 表示來源卡的效果、連鎖觸發與變化檢查已結束，並從內部結算狀態移入最終區域。普通直接出牌通常進 `TEMPORARY`；有 `consumable=true` 的直接出牌、狀態牌棄牌結算或準備牌堆觸發會進 `EXHAUST`。若準備牌堆觸發時預定目標已不可指定，`cancelled=true`、`cancelReason="INVALID_TARGET"`，且不會套用效果。普通棄牌若不是 `STATUS` 且沒有觸發 `BONUS_ACTION`，仍直接進 `TEMPORARY`，不會產生 `CARD_RESOLVED`。

### CARD_CONSUMED

```json
{
  "type": "CARD_CONSUMED",
  "seq": 7,
  "payload": {
    "playerId": "p1",
    "cardInstanceId": "card_inst_010",
    "cardId": "guarded_recovery",
    "sourceCardInstanceId": "card_inst_001",
    "destinationZone": "PREPARED",
    "targetId": "p2",
    "targetIds": ["p2"]
  }
}
```

額外資源消耗的普通卡會移入 `EXHAUST`；當下牌面帶有 `READY_ACTION` 的卡被消耗時會移入 `PREPARED`。若這張準備動作需要目標，`targetId` / `targetIds` 會記錄進準備牌堆的預定目標。若手牌因變化規則暫時變成 `READY_ACTION` 牌面，消耗時會保留變化後的 `cardId` 進準備牌堆，不會先還原成原本牌面。

### HP_PAID

```json
{
  "type": "HP_PAID",
  "seq": 8,
  "payload": {
    "playerId": "p1",
    "sourceCardInstanceId": "card_inst_001",
    "amount": 3,
    "hpAfter": 12
  }
}
```

HP 代價支付後必須仍大於 0，Host 會拒絕會讓玩家自殺的出牌。

### HP_LOST

```json
{
  "type": "HP_LOST",
  "seq": 8,
  "payload": {
    "sourceId": "card_inst_020",
    "targetId": "p1",
    "amount": 1,
    "hpAfter": 11
  }
}
```

`HP_LOST` 表示效果讓目標失去 HP，不等同於支付出牌代價。若 HP 降到 0，Host 會結束遊戲。

### ENERGY_LOST

```json
{
  "type": "ENERGY_LOST",
  "seq": 8,
  "payload": {
    "sourceId": "card_inst_021",
    "targetId": "p1",
    "amount": 1,
    "energyAfter": 0
  }
}
```

`ENERGY_LOST` 表示效果消耗目標目前剩餘能量。能量已經是 0 時不會再產生事件。

### DAMAGE_APPLIED

```json
{
  "type": "DAMAGE_APPLIED",
  "seq": 8,
  "payload": {
    "sourceId": "card_inst_001",
    "targetId": "p2",
    "amount": 3,
    "hpAfter": 17
  }
}
```

`DAMAGE` 的 `count` 代表攻擊次數，每次未被抵抗的命中各產生一筆 `DAMAGE_APPLIED` 並立即更新 HP。未設定 `count` 時預設為 1。

### DAMAGE_PREVENTED

```json
{
  "type": "DAMAGE_PREVENTED",
  "seq": 8,
  "payload": {
    "sourceId": "card_inst_001",
    "targetId": "p2",
    "amount": 3,
    "preventedByCardInstanceId": "card_inst_020"
  }
}
```

`DAMAGE_PREVENTED` 表示一張已準備的 `REACTION_ACTION` 抵抗該次命中，該次不再產生 `DAMAGE_APPLIED`。

### TURN_STARTED

```json
{
  "type": "TURN_STARTED",
  "seq": 9,
  "payload": {
    "playerId": "p2",
    "turn": 2
  }
}
```

### GAME_STATE_SYNC

```json
{
  "type": "GAME_STATE_SYNC",
  "seq": 8,
  "payload": {
    "state": {}
  }
}
```

---

## 7. GameState 設計

```ts
type GameState = {
  roomId: string
  status: 'WAITING' | 'PLAYING' | 'ENDED'
  turn: number
  currentPlayerId: string | null
  players: Record<string, PlayerState>
  zones: {
    deck: Record<string, CardInstance[]>
    hand: Record<string, CardInstance[]>
    prepared: Record<string, CardInstance[]>
    temporary: Record<string, CardInstance[]>
    exhaust: Record<string, CardInstance[]>
    board: CardInstance[]
    graveyard: CardInstance[]
    exile: CardInstance[]
  }
  eventSeq: number
}
```

---

## 8. PlayerState

```ts
type PlayerState = {
  playerId: string
  name: string
  hp: number
  energy: number
  maxEnergy: number
  connected: boolean
  ready: boolean
}
```

---

## 9. Card Definition

```ts
type CardDefinition = {
  cardId: string
  name: string
  cost: number
  type: 'ATTACK' | 'SKILL' | 'MAGE' | 'ITEM' | 'STATUS'
  effect: CardEffectDefinition
  consumable?: boolean
  resourceCosts?: {
    consumeCardCount?: number
    hp?: number
  }
}
```

---

## 10. Card Instance

```ts
type CardInstance = {
  instanceId: string
  cardId: string
  ownerId: string
  zone: 'DECK' | 'HAND' | 'BOARD' | 'PREPARED' | 'RESOLVING' | 'TEMPORARY' | 'EXHAUST' | 'GRAVEYARD' | 'EXILE'
}
```

`RESOLVING` 只會在 Host/Worker 解析事件時短暫標記來源卡，不會作為 `GameState.zones` 的公開牌堆同步。

---

## 11. 卡牌效果解析

目前支援以下基礎效果：

```ts
type CardEffectDefinition =
  | { type: 'NONE' }
  | { type: 'DAMAGE'; value: number; count?: number }
  | { type: 'HEAL'; value: number }
  | { type: 'DRAW'; count: number }
  | { type: 'LOSE_HP'; value: number }
  | { type: 'LOSE_ENERGY'; value: number }
  | { type: 'ADD_CARD_TO_HAND'; cardId: string; count: number }
```

解析流程：

```txt
PLAY_CARD Command
 → 驗證卡牌存在於手牌
 → 驗證費用
 → 將卡牌標記為內部結算狀態
 → 產生 CARD_PLAYED Event
 → 解析效果
 → DAMAGE 逐次檢查反應動作並產生 DAMAGE_PREVENTED 或 DAMAGE_APPLIED Event
 → 產生 HEAL_APPLIED / HP_LOST / ENERGY_LOST / CARD_DRAWN / CARD_ADDED_TO_HAND Event
 → 解析準備牌堆觸發與變化規則
 → 產生 CARD_RESOLVED Event，將卡牌移到暫存或消耗牌堆
```

`ADD_CARD_TO_HAND` 會對解析後的每名效果目標各加入 `count` 張 `cardId`。例如偷襲指定敵人時可加入 2 張出血；隱匿使用 `SELF` 目標時可向自己加入 1 張躲藏。新增牌保留其完整卡牌定義，因此躲藏後續被 `consumeCardCount` 消耗時，仍會依 `READY_ACTION` 規則進入準備牌堆。

---

## 12. 回合流程

```txt
TURN_STARTED
 → 恢復能量
 → 抽牌
 → 玩家操作階段
 → END_TURN
 → 依智力與體質額度處理非狀態牌、狀態牌棄牌
 → 觸發仍在手牌中的 END_TURN_STATUS
 → TURN_ENDED
 → 下一位玩家 TURN_STARTED
```

MVP 可簡化為：

```txt
回合開始自動抽 1 張
玩家可以出任意合法卡
玩家按結束回合
```

---

## 13. 隱私資料處理

卡牌遊戲需要注意「手牌、牌庫」是私有資訊。

Host 保存完整資料。

Client 只收到自己能看的資料。

例如：

- 自己的手牌：看得到 cardId。
- 對手手牌：只看得到數量。
- 牌庫：只看得到剩餘張數。
- 棄牌區：通常公開。

---

## 14. 斷線與重連

MVP 可先採用：

- 玩家斷線後標記 connected = false。
- Host 不立即移除玩家。
- 玩家重新連線時使用 playerId 或 reconnectToken。
- Host 發送 GAME_STATE_SYNC。

---

## 15. 房間發現

MVP：手動輸入 Host IP + Port。

第二階段：UDP Broadcast。

Host 每秒廣播：

```json
{
  "type": "ROOM_DISCOVERY",
  "roomName": "Local Card Room",
  "ip": "192.168.1.23",
  "port": 7777
}
```

Client 掃描後顯示房間列表。

---

## 16. MVP 完成標準

一版可玩原型需達成：

1. Host 可以啟動服務。
2. Client 可以透過 IP 加入。
3. 至少兩名玩家能看到彼此。
4. Host 可以開始遊戲。
5. 玩家有手牌。
6. 玩家能抽卡。
7. 玩家能出卡。
8. 出卡能造成效果。
9. 回合能輪替。
10. 所有 Client 顯示一致狀態。
