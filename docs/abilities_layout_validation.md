# Abilities 排版驗證紀錄

## 2026-11-27（Asia/Taipei）

分支：`codex/loadout-source-cards`。驗證對象為 `02f66ef` 之後的 Abilities 排版修正；修正與本紀錄一同提交。

### 問題與修正

桌面等待室的 Abilities 原本位於角色設定網格的窄欄內，再分為兩欄，造成加減按鈕與數值框跨出能力列並與相鄰欄位重疊。

`web/index.html` 加入 `ability-section`，搭配 `web/src/styles.css` 讓 Abilities 橫跨角色設定區完整寬度。能力欄位在桌面採三欄，980px 以下採兩欄，560px 以下維持單欄。

### 瀏覽器驗證

使用 Chrome、本機 Vite（`http://127.0.0.1:15173`）與隔離的本機 Worker/KV（`http://127.0.0.1:18787`），建立新房 `ui-abilities-1127`。透過瀏覽器 UI 操作，搭配畫面及唯讀 DOM 尺寸檢查；手機結果為瀏覽器 viewport 模擬，未進行實體手機觸控測試。

| 項目 | 1280 × 900 桌面 | 390 × 844 手機 |
| --- | --- | --- |
| 六項能力配置 | 三欄兩列 | 單欄六列 |
| 每列寬度 | 404px | 362px |
| 列內溢出 | 無（scrollWidth / clientWidth 均為 402px） | 無（scrollWidth / clientWidth 均為 360px） |
| 頁面水平溢出 | 無（頁面寬度 1280px） | 無（頁面寬度 390px） |
| 按鈕與數值框 | 無重疊，標籤可讀 | 無重疊，標籤可讀 |
| 加減操作 | 力量 12 → 11 → 12 | 體質 12 → 11 → 12 |

瀏覽器未捕捉到 error 等級的 console 訊息。驗證完成後已重設 viewport、關閉測試頁面與本次本機服務。

### 建置與範圍

- `npm run build:pages`：通過（Vite 5.4.21）。
- `git diff --check`：通過。
- 本次僅調整 HTML/CSS，未修改遊戲規則、Worker 或 catalog parser。
- 前一輪雙人配裝、繳械與重新裝備 UI 驗證已通過；本次針對該輪發現的 Abilities 重疊問題複驗，未重新執行整套雙人流程。
- 原始本機報告 `data/loadout_review/ui_validation_report.json` 的對應問題已更新為修正並複驗；該檔屬 Git 忽略的本機資料，本文件提供可隨提交保存的紀錄。
- 未同步正式 KV、合併、推送或部署。
