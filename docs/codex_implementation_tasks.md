# Codex 實作任務拆解：Wi-Fi LAN 回合制卡牌桌遊

## 階段 0：建立專案骨架

### 目標

建立 TypeScript 專案，拆分 shared、host、client。

### 建議目錄

```txt
lan-card-game/
 ├─ package.json
 ├─ tsconfig.json
 ├─ README.md
 ├─ src/
 │   ├─ shared/
 │   │   ├─ types/
 │   │   │   ├─ network.ts
 │   │   │   ├─ game.ts
 │   │   │   └─ card.ts
 │   │   ├─ constants/
 │   │   │   └─ messageTypes.ts
 │   │   └─ rules/
 │   │       └─ cardEffects.ts
 │   ├─ host/
 │   │   ├─ HostServer.ts
 │   │   ├─ RoomManager.ts
 │   │   ├─ GameStateStore.ts
 │   │   ├─ CommandRouter.ts
 │   │   ├─ CommandValidator.ts
 │   │   ├─ TurnManager.ts
 │   │   ├─ DeckManager.ts
 │   │   └─ EventBroadcaster.ts
 │   └─ client/
 │       ├─ GameClient.ts
 │       ├─ CommandSender.ts
 │       ├─ EventReceiver.ts
 │       └─ LocalStateStore.ts
 └─ tests/
     ├─ cardEffects.test.ts
     ├─ turnManager.test.ts
     └─ commandValidator.test.ts
```

---

## 階段 1：Shared Types

請先建立以下型別：

- NetworkMessage
- PlayerState
- GameState
- CardDefinition
- CardInstance
- GameCommand
- GameEvent

完成標準：

- TypeScript 可以通過編譯。
- 所有 Host / Client 都從 shared 引入型別。
- 不重複定義型別。

---

## 階段 2：Host WebSocket Server

建立 HostServer。

需求：

1. 使用 WebSocket 監聽指定 port。
2. Client 連線後可以送 JOIN_ROOM。
3. Host 分配 playerId。
4. Host 廣播 PLAYER_JOINED。
5. Host 保存連線與玩家狀態。

建議套件：

```txt
ws
```

完成標準：

- 可以啟動 Host。
- 兩個 Client 可以連進來。
- Host Console 能看到玩家加入。

---

## 階段 3：Client 連線模組

建立 GameClient。

需求：

1. 連線到 ws://host-ip:port。
2. 成功後送 JOIN_ROOM。
3. 接收 Event。
4. 保存 LocalState。
5. 可以送 Command。

完成標準：

- Client 可連線。
- Client 可收到 PLAYER_JOINED。
- Client 可送 PLAYER_READY。

---

## 階段 4：遊戲開始流程

建立 PLAYER_READY 與 GAME_STARTED。

需求：

1. 玩家送 PLAYER_READY。
2. Host 標記 ready。
3. 所有玩家 ready 後 Host 可開始遊戲。
4. Host 建立牌堆。
5. Host 發初始手牌。
6. Host 指定第一位玩家。
7. Host 廣播 GAME_STARTED 與 GAME_STATE_SYNC。

完成標準：

- 兩位玩家 ready 後進入 PLAYING。
- 每位玩家有初始手牌。
- 第一位玩家回合開始。

---

## 階段 5：牌堆與抽牌

建立 DeckManager。

需求：

1. 從 CardDefinition 建立牌組。
2. 產生 CardInstance。
3. 洗牌。
4. 抽牌。
5. 移動卡牌 zone：DECK → HAND。
6. 發送 CARD_DRAWN。

注意：

- 抽牌玩家可看到 cardId。
- 其他玩家只看到手牌數變化。

完成標準：

- 玩家可抽牌。
- 牌庫數量減少。
- 手牌數量增加。

---

## 階段 6：出牌與效果

建立 PLAY_CARD 流程。

需求：

1. 驗證目前是否為該玩家回合。
2. 驗證卡牌是否在玩家手牌。
3. 驗證費用。
4. 執行卡牌效果。
5. 移動卡牌至 GRAVEYARD。
6. 廣播 CARD_PLAYED。
7. 廣播效果事件，例如 DAMAGE_APPLIED。

第一版支援：

- DAMAGE
- HEAL
- DRAW

完成標準：

- 火球術可以造成傷害。
- 治療卡可以恢復 HP。
- 抽牌卡可以抽牌。
- 非當前玩家不能出牌。

---

## 階段 7：結束回合

建立 END_TURN。

需求：

1. 驗證是否為當前玩家。
2. 廣播 TURN_ENDED。
3. 切換 currentPlayerId。
4. turn + 1。
5. 廣播 TURN_STARTED。
6. 回合開始時恢復能量並抽牌。

完成標準：

- 玩家可結束回合。
- 下一位玩家可操作。
- 上一位玩家不能再出牌。

---

## 階段 8：Snapshot 同步

建立 SnapshotService。

需求：

1. Client 加入時收到自己的可見狀態。
2. Client 重連時可重新同步。
3. Host 可手動廣播 GAME_STATE_SYNC。

完成標準：

- Client 畫面狀態能被完整修正。
- 不會洩漏對手手牌內容。

---

## 階段 9：簡易 UI 或 Console Demo

若先做 Console Demo：

- 顯示玩家列表。
- 顯示目前回合。
- 顯示自己的手牌。
- 可輸入 draw / play / discard / end。

若接 Cocos Creator 或 Vue：

- UI 層不得直接改 GameState。
- 所有操作都透過 CommandSender。

完成標準：

- 兩台同 Wi-Fi 裝置可遊玩一場最小對局。

---

## 階段 10：後續擴充

可在 MVP 後加入：

1. UDP Broadcast 房間搜尋。
2. 斷線重連 token。
3. 觀戰者模式。
4. 卡牌連鎖效果。
5. 狀態效果。
6. 場上單位。
7. AI 玩家。
8. 對戰紀錄 Replay。
9. 卡牌資料 JSON 外部化。
10. 房主移轉。

---

# 給 Codex 的起始 Prompt

請根據 `lan_turn_based_card_game_architect.md`、`lan_card_game_design.md` 與 `codex_implementation_tasks.md` 建立一個 TypeScript 專案。

第一階段目標：

1. 建立 shared / host / client 目錄。
2. 建立 NetworkMessage、GameState、PlayerState、CardDefinition、CardInstance 型別。
3. 使用 ws 建立 Host WebSocket Server。
4. 建立可連線的 GameClient。
5. 支援 JOIN_ROOM 與 PLAYER_JOINED。
6. 補上最小 README 與執行指令。
7. 不要先實作複雜 UI。
8. 不要加入 UDP。
9. 所有遊戲狀態只能由 Host 修改。
10. 請補上基本測試或至少保留 tests 目錄與測試規劃。
