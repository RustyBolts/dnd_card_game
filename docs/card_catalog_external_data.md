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
cardId,name,cost,type,description,effectType,effectValue,effectCount,effectCardId,targetSelection,targetScope,targetRequired,consumable,consumeCardCount,hpCost,actionTags,enabled
```

- `cardId`：穩定唯一 ID，牌組和遊戲狀態都用這個 ID。
- `name`：顯示名稱。
- `cost`：整數，必須 >= 0。
- `type`：`ATTACK`、`SKILL`、`MAGE`、`ITEM` 或 `STATUS`。
- `description`：顯示文字。
- `effectType`：`NONE`、`DAMAGE`、`HEAL`、`DRAW`、`LOSE_HP`、`LOSE_ENERGY` 或 `ADD_CARD_TO_HAND`。`NONE` 適合只用來觸發外部規則、自己沒有直接效果的卡。`LOSE_HP` 也接受 `HP_LOSS` 等別名；`LOSE_ENERGY` 也接受 `ENERGY_LOSS` 等別名；`ADD_CARD_TO_HAND` 也接受 `ADD_TO_HAND`。
- `effectValue`：`DAMAGE`、`HEAL`、`LOSE_HP`、`LOSE_ENERGY` 使用的數值。
- `effectCount`：`DAMAGE` 使用的攻擊次數、`DRAW` 使用的抽牌張數，或 `ADD_CARD_TO_HAND` 對每名效果目標加入的張數，必須至少為 1。`DAMAGE` 留空時視為攻擊 1 次。
- `effectCardId`：`ADD_CARD_TO_HAND` 必填，指定要建立並加入手牌的卡牌 ID；必須存在於同一版本啟用中的 `cards`。
- `targetSelection`：`NONE`、`SINGLE` 或 `GROUP`。
- `targetScope`：`SELF`、`ALLY`、`ENEMY` 或 `ANY`。
- `targetRequired`：`SINGLE` 目標使用；`true` 表示 command 必須帶目標，`false` 表示玩家不需要手動指定目標。`GROUP` 目標會依 `targetScope` 自動解析全體目標，程式會將 `targetRequired` 視為 `false`。
- `consumable`：可選。`true` 表示卡牌打出後進入消耗牌堆，不會從暫存牌堆重洗回牌庫。空白或未提供欄位時視為普通牌。
- `consumeCardCount`：可選。出牌時需要額外指定並消耗的非 `STATUS` 手牌張數；狀態牌不能作為這類額外資源。被消耗的普通牌進消耗牌堆，被消耗的 `READY_ACTION` / `準備動作` 牌進準備牌堆。若被消耗的準備動作 `targetRequired=true`，出牌 command 需以 `resourceTargets[被消耗卡instanceId]` 指定預定目標；只有一名合法目標時可自動指定。
- `hpCost`：可選。出牌時額外支付的 HP；Host/Worker 會拒絕讓玩家支付後 HP 變成 0 或以下。
- `actionTags`：可選。用 `|`、`;` 或 `、` 分隔多個標籤；目前支援 `BONUS_ACTION` / `附贈動作`、`REACTION_ACTION` / `反應動作`、`COUNTER_ACTION` / `反制動作`、`READY_ACTION` / `準備動作`、`END_TURN_STATUS` / `回合結束時觸發其他狀態`。
- `enabled`：除了 `false`、`0`、`no` 以外都視為啟用。

目標欄位的建議用法：

- 自己：`targetSelection=NONE`、`targetScope=SELF`、`targetRequired=false`。
- 敵人單體：`targetSelection=SINGLE`、`targetScope=ENEMY`、`targetRequired=true`。
- 可指定任意單體，包含自己：`targetSelection=SINGLE`、`targetScope=ANY`、`targetRequired=true`。
- 隊友單體：`targetSelection=SINGLE`、`targetScope=ALLY`、`targetRequired=true`。目前對戰狀態尚未提供隊伍設定，之後加入 `teamId` 後才會有可選隊友。
- 隊友群體：`targetSelection=GROUP`、`targetScope=ALLY`、`targetRequired=false`。
- 敵人群體：`targetSelection=GROUP`、`targetScope=ENEMY`、`targetRequired=false`。施放時不需要傳 `targetId`，Host/Worker 會依目前陣營自動套用到所有敵方玩家。

目前尚未提供手動選陣營流程；玩家加入時會依加入順序分到預設兩陣營：第 1、3、5 位玩家在 `team_1`，第 2、4、6 位玩家在 `team_2`。之後若需要自建陣營，可以擴充 join/lobby command，讓玩家在遊戲開始前選擇 `teamId`。

`ADD_CARD_TO_HAND` 不會從牌庫抽牌，而是由 Host/Worker 為每張牌建立新的 instance 並直接加入效果目標的手牌。`targetSelection=SINGLE,targetScope=ENEMY` 可讓偷襲向指定敵人加入出血；`targetSelection=NONE,targetScope=SELF` 可讓隱匿向自己加入躲藏。新增牌的 `cardId` 只會透過私有事件提供給手牌持有者。

`END_TURN_STATUS` / `回合結束時觸發其他狀態` 不能和其他動作標籤並存，只能用在 `STATUS` 卡，且必須搭配作用於自己的 `ADD_CARD_TO_HAND`；`effectCardId` 也必須指向另一張 `STATUS` 卡。玩家完成回合末棄牌後，Host/Worker 會掃描仍在該玩家手牌中的這類卡，逐張觸發新增狀態牌效果，再結束回合。掃描開始後才新增的牌不會在同一回合末再次觸發。帶此標籤的卡直接出牌或被棄牌時不執行 `ADD_CARD_TO_HAND`，只依牌面 `consumable` 決定進暫存或消耗牌堆。觸發事件與來源 instance 關聯不會公開給其他玩家。

`BONUS_ACTION` / `附贈動作` 表示這張卡可直接出牌，也可以在棄牌動作發生時作為附贈動作觸發。附贈動作觸發時，Host/Worker 會先驗證目標，再將卡牌標記為結算中，發出 `CARD_DISCARDED` 與 `CARD_ACTION_TRIGGERED`，並以 0 能量消耗解析該卡原本的 `effect`。結算區是 Host/Worker 解析期間的內部暫存，不會出現在 `GAME_STATE_SYNC` 的牌堆資料中。效果與變化檢查完成後會發出 `CARD_RESOLVED`，目前附贈棄牌觸發後會移入暫存牌堆。若該卡需要指定目標，`DISCARD_CARD` command 必須帶 `targetId`。沒有觸發附贈動作的普通棄牌會直接移入暫存牌堆，不進入結算流程。目前前端只在點擊 `End Turn` 後的棄牌階段顯示 `Discard` 按鈕，讓玩家逐張棄牌並選目標；主階段不顯示常駐棄牌按鈕，之後可由卡牌或規則打開特定棄牌動作窗口。

`STATUS` / 狀態牌與一般牌一樣可以出牌或被變化，但不能被指定為其他卡牌 `consumeCardCount` 的額外資源；通常會用高費用讓玩家不容易主動打出。狀態牌被棄牌時會自動進入結算流程，發出 `CARD_DISCARDED.destinationZone = "RESOLVING"`，套用卡面 `effect` 後再發出 `CARD_RESOLVED`。沒有 `consumable=true` 的狀態牌結算後進暫存牌堆；有 `consumable=true` 的狀態牌結算後進消耗牌堆。例如：出血可設為 `effectType=LOSE_HP,effectValue=1`；笨拙可設為 `effectType=LOSE_ENERGY,effectValue=1,consumable=true`；黏液可設為 `effectType=DRAW,effectCount=1,consumable=true`。

回合結束保留手牌時，狀態牌會先占用 `max(0, 智力調整值)` 的基礎額度，非狀態牌只能使用扣除目前狀態牌數後的餘額。`max(0, 體質調整值)` 只會額外提高狀態牌上限，不會增加非狀態牌可保留數。Host/Worker 會先要求棄完超額非狀態牌，再開放棄超出狀態牌上限的狀態牌；狀態牌棄牌效果完成後會重新計算需求。

`REACTION_ACTION` / `反應動作`、`COUNTER_ACTION` / `反制動作` 會在打出後先移入準備牌堆，不立即解析效果。其他玩家的每次 `DAMAGE` 命中前，目標準備牌堆中最前面的一張反應動作會先結算並抵抗該次傷害，產生 `DAMAGE_PREVENTED`；同一張傷害牌的後續攻擊次數會再次檢查準備牌堆。因此一張躲藏只抵抗一次任意數值的傷害，後續攻擊若沒有另一張反應動作就會正常扣除 HP。需要指定目標的反應動作會以攻擊者為預設目標；不需指定且作用於自己的反應動作則對持有者自己結算。反制動作在其他玩家以 `SKILL` 或 `MAGE` 指定自己時觸發，施放者會成為預設目標。`READY_ACTION` / `準備動作` 卡牌可直接出牌並正常解析；只有當它被作為額外資源消耗，或這張牌本身同時有 `consumable=true` 而出牌等同被消耗時，才會移入準備牌堆。若該準備動作 `targetRequired=true`，進入準備牌堆前會指定預定目標；多名合法目標時由玩家選擇，只有一名合法目標時可自動指定。若一張手牌因變化規則暫時變成帶有 `READY_ACTION` 的牌面，並在此狀態下被作為額外資源消耗，Host/Worker 會保留當下的變化後牌面並移入準備牌堆，不會先還原成原本 cardId。準備牌堆中的卡觸發時會先標記為結算中，Host/Worker 會重新驗證預定目標仍可指定；若目標已死亡或不合法，會取消效果並移入消耗牌堆。效果與變化檢查完成後才移到最終區域；`consumable=true` 的卡移入消耗牌堆，其他卡移入暫存牌堆。

範例：

```txt
cardId,name,cost,type,description,effectType,effectValue,effectCount,effectCardId,targetSelection,targetScope,targetRequired,consumable,consumeCardCount,hpCost,actionTags,enabled
quick_shot,快速射擊,2,ATTACK,對一名目標造成 2 點傷害。,DAMAGE,2,,,SINGLE,ENEMY,true,,,,附贈動作,true
combo,連擊,2,ATTACK,對一名目標造成 2 次 3 點傷害。,DAMAGE,3,2,,SINGLE,ENEMY,true,,,,,true
riposte,反擊刺擊,1,ATTACK,抵抗該次傷害並對攻擊者造成 1 點傷害。,DAMAGE,1,,,SINGLE,ENEMY,true,true,,,反應動作,true
counter_jab,反制打擊,1,SKILL,受到技能或魔法指定時對施放者造成 2 點傷害。,DAMAGE,2,,,SINGLE,ENEMY,true,,,,反制動作,true
guarded_recovery,戒備恢復,1,SKILL,直接恢復 3 點 HP；被消耗時改為下回合開始恢復。,HEAL,3,,,NONE,SELF,false,,,,準備動作,true
blood_rite,血祭儀式,0,SKILL,支付 3 HP 並消耗 2 張手牌。,DRAW,,1,,NONE,SELF,false,,2,3,,true
sneak_attack,偷襲,1,ATTACK,指定目標獲得 2 張出血。,ADD_CARD_TO_HAND,,2,bleeding,SINGLE,ENEMY,true,,,,,true
stealth,隱匿,1,SKILL,自己獲得 1 張躲藏。,ADD_CARD_TO_HAND,,1,hide,NONE,SELF,false,,,,,true
hide,躲藏,1,SKILL,抵抗一次任意數值的傷害。,NONE,,,,NONE,SELF,false,true,,,反應動作,true
ignited,點燃,2,STATUS,回合結束時若仍在手牌則加入 3 張灼傷。,ADD_CARD_TO_HAND,,3,burn,NONE,SELF,false,true,,,回合結束時觸發其他狀態,true
burn,灼傷,1,STATUS,結算時失去 1 HP。,LOSE_HP,1,,,NONE,SELF,false,true,,,,true
bleeding,出血,9,STATUS,結算時失去 1 HP。,LOSE_HP,1,,,NONE,SELF,false,,,,,true
clumsy,笨拙,4,STATUS,結算時若有剩餘能量則失去 1 點能量。,LOSE_ENERGY,1,,,NONE,SELF,false,true,,,,true
slime,黏液,1,STATUS,結算時抽 1 張牌。,DRAW,,1,,NONE,SELF,false,true,,,,true
```

為了讓既有 Google Spreadsheet / KV catalog 有遷移時間，程式仍接受沒有 `effectCardId`、沒有目標欄位、沒有 `consumable` 欄位、沒有 `consumeCardCount` / `hpCost` 欄位或沒有 `actionTags` 欄位的舊 `cards` CSV：`DAMAGE` 會推導成敵人單體必填，`HEAL`、`DRAW`、`LOSE_HP`、`LOSE_ENERGY` 與 `ADD_CARD_TO_HAND` 會推導成作用於自己且不需指定目標；只有使用 `ADD_CARD_TO_HAND` 時才必須提供 `effectCardId`。未提供 `consumable` 時會視為普通牌，未提供資源代價時只消耗能量，未提供 `actionTags` 時代表沒有微操作標籤。

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
- `triggerCardId`：哪張卡生效時觸發規則。一般直接出牌、附贈棄牌觸發、準備牌堆觸發都會在效果解析後檢查；準備牌堆中的卡不會在單純移入準備牌堆時檢查。
- `sourceCardId`：被轉換前的卡牌 ID。
- `targetCardId`：轉換後的卡牌 ID，必須與 `sourceCardId` 不同。
- `scope`：目前支援 `hand` 或 `OWNER_HAND`，代表觸發者自己的手牌。
- `reversible`：`true` 表示此轉換會依 `revertTiming` 還原；`false` 表示不會自動還原。
- `revertTiming`：目前支援 `turn_end` 或 `NEVER`。`reversible=false` 時必須是 `NEVER` 或空白。

`triggerCardId` 生效後，Host/Worker 會掃描規則 scope 中符合 `sourceCardId` 的 card instance，保留同一個 `instanceId` 並把 `cardId` 改成 `targetCardId`。若 `reversible=true` 且 `revertTiming=turn_end`，該 instance 在觸發者回合結束時仍在手牌中才會還原成 `sourceCardId`；若已經被打出或丟棄，則不再還原。

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
