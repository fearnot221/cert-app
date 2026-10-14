# 實作與驗證狀態

更新：2026-10-15（Asia/Taipei）。本輪目標是 Phase 1 完整垂直流程，非全部產品正式上線。

## 初始檢查

工作目錄起初無專案程式、README、AGENTS.md 或 DESIGN.md；已採指定 pnpm workspace 技術棧建立新 repository。沒有既有產品資料需要遷移。

## 已實作範圍

| 範圍 | 本輪交付目標 | 狀態 |
| --- | --- | --- |
| 帳號／組織 | Argon2id、8 小時 server session、HttpOnly signed cookie、CSRF、登入限流、一次性啟用、啟用重發、忘記／重設密碼與全 session 撤銷；5 種角色、組織切換 | 已實作，API integration 通過 |
| 模板 | PNG/JPG/WebP 背景解析重編碼；固定／動態文字、拖曳、精確 mm／pt／角度、鍵盤微調、畫布 zoom／fit、A4／自訂紙張 | 已實作，完整瀏覽器流程通過 |
| 儲存／發布 | 手動存檔、revision 衝突 409、不可變 TemplateVersion、固定背景／字型 manifest | 已實作，integration 通過 |
| PDF | 共用 React/HTML/CSS、Noto Sans TC／芫荽 Iansui hash／缺字檢查、等待字型／圖片、換行縮字／溢位阻擋、伺服器樣張、授權單張下載 | 已實作，真實 Chromium renderer 測試與 Docker sandbox smoke 通過 |
| 小批次 | <=100 列 Excel／CSV／手動名單、日期型別與原始列號 dry run、逐列 server PDF 預覽、明確生成、DB 唯一鍵、outbox、BullMQ、只重試失敗列、全部／勾選 ZIP、失敗 CSV 報告 | 已實作；真實 worker SIGKILL／重啟與寫檔失敗重試演練通過 |
| 郵件／收件 | 明確 Mailpit 通知、組織 SenderIdentity、accepted／unknown、啟用與登入、本人 PDF 下載 | 已實作，Mailpit 瀏覽器 E2E 通過 |
| 文件 | PRD、架構、權限、郵件、字型、驗收、設計、部署及備份手冊 | 已建立，區分實作與後續目標 |
| 部署／測試 | migration、開發 seed、Compose、production 準備 overlay、GitHub Actions | 本地鏡像與配置驗證通過；未在遠端 CI／production 執行 |

## 實際驗證紀錄

| 驗證 | 實際結果 |
| --- | --- |
| 官方參考 | 2026-10-15 已開啟查核，來源列在各文件 |
| `pnpm lint` | 通過 |
| `pnpm typecheck` | 通過 |
| `pnpm build` | 通過，Vite production bundle 與 TypeScript |
| `RENDERER_INTEGRATION=1 pnpm test` | 23/23 通過（5.54 秒）；新增 Excel 多工作表、日期、公式／格式拒絕、解壓縮限制與 CSV 報告安全測試，並保留原本：繁中 PDF、Unicode map、紙張、長字串、溢位及日期驗證 |
| `_test` DB 的 `pnpm test:integration` | 32/32 通過（77.51 秒，含活動生命週期、不可變稽核、真實 worker 故障演練、XLSX／ZIP／報告與同 IP 多 session 限流）；涵蓋跨組織、RBAC、本人下載、原子啟用、既有帳號、Mailpit、重複 PDF 工作、完成後重啟狀態恢復及發布 manifest 防竄改 |
| `docker compose config --quiet` | 通過 |
| production overlay config（提供測試用必要環境值） | 通過；缺少正式 origin／必要設定時會拒絕 |
| `docker build --target runtime` | 通過；image 內 Node 為 24.21.0 |
| `docker build --target web`／`nginx -t` | 通過 |
| 非 root Docker Chromium smoke | 在唯讀 rootfs、tmpfs、cap_drop ALL、no-new-privileges、network none 下產出 77,187 bytes 繁中 PDF |
| 獨立 `cert-app-smoke` 全 Compose | migration／tooling seed 成功，nginx／API／DB／Redis／Mailpit healthy，worker 正常。經 nginx 建立 CSV、server 樣張與 worker PDF（92,572 bytes）、授權下載、明確通知 accepted、Mailpit 1.31.5 實際收信、啟用／登出／重登入／收件人私人 PDF 均通過。測試後清除該獨立 project，不動本機開發資料 |
| `npx --yes node@24 node_modules/@playwright/test/cli.js test` | 2/2 通過（31.3 秒，含活動編輯／取消、撤銷／補發、版本／操作紀錄，以及 Excel 工作表／欄位對應、失敗報告、全批／勾選 ZIP、搜尋／顯示方式、手動名單與手機版）；上傳背景、拖曳、儲存發布、2 列 CSV、server 樣張、worker PDF、Mailpit 通知、手機啟用／重新登入／私人下載與 viewport |
| worker 故障恢復 | 獨立 queue prefix：真實 active job SIGKILL，重啟後 stalled recovery 成功；寫檔失敗後並行兩次 retry 僅一份工作，成功 PDF bytes／hash 保持一致 |
| 1,000 筆 benchmark | 腳本已提供，未執行；無虛構耗時／記憶體數據 |
| GitHub Actions／Coolify／production | 尚未執行或部署 |

開發環境原 Node 24.1.0 執行新 Playwright runner 出現 loader 相容錯誤；`.node-version`／`.nvmrc`／CI 已固定使用實際可取得的 24.21.0。Docker smoke 是渲染隔離檢查，不代表完整 production 安全驗收或瀏覽器視覺回歸。

API OpenAPI JSON 已於 `/api/openapi.json` 驗證輸出 39 個路徑，含請求 schema 與 cookie／CSRF 說明。伺服器 PDF 預覽同時最多 2 個；worker 預設 2 個 PDF 工作。CSV 提供有效 issue_date 時保留該日期，未提供時採 Asia/Taipei 當天。Redis URL 的資料庫編號與 TLS 協定會被保留。

## 明確尚未完成

- Phase 2 完整編輯器：圖片元素／圖形、滑鼠手柄縮放旋轉、對齊吸附、圖層排序／鎖定／隱藏、Undo／Redo、自動儲存、自訂欄位管理 UI、完整字型管理。
- Phase 2 資料與批次：活動獨立模型；活動編輯／取消及證書撤銷／取代鏈已實作。
- Phase 3：正式 SMTP／Google Relay、DNS challenge 精靈、加密連線憑證與共用網域授權、自訂角色、MFA、臨時密碼、郵件模板、配額／退信／webhook。
- Phase 4：完整視覺回歸、正式 SMTP 中斷與 unknown 演練、1,000 筆實測、production hardening、還原演練。
- S3-compatible driver、Canva API 整合與 PKI 數位簽章。
- 登入中的修改密碼、成員管理與最後 Owner 保護的管理 API 尚未實作；不能由固定 permission 列表推論已可操作。
- API 與前端列表已有 take／skip 上一頁／下一頁；收件人篩選限本頁並明確標示，跨頁搜尋尚待擴充。

## 外部依賴／未驗證

沒有取得真實 SMTP 憑證、Google Admin 權限、寄件網域 DNS 管理權、Canva OAuth app／付費方案或 production 主機密鑰。所有外部正式寄送、實際投遞、DNS／DKIM／DMARC、Canva 能力及正式部署都未驗證。

## 下一個最小交付

Phase 1 的主要完整流程已以真實服務通過。啟用重發／密碼重設、芫荽內建與批次失敗恢復演練已完成；Excel／欄位對應、手動名單、批次 ZIP 與失敗報告亦已完成；下一步可擴充編輯器與組織字型上傳。尚未通過驗收的能力不得被下一階段文件掩蓋。

## 本輪收尾

依使用者要求，開發 demo 保持執行於 http://localhost:5173，API／worker 與 PostgreSQL／Redis／Mailpit 運作中。故障演練只強制終止獨立測試 worker，使用 `_test` DB 與獨立 queue prefix，沒有終止 demo。獨立 Compose smoke 專案已清除。沒有建立遠端 PR、推送 repository 或正式部署。


## 發證活動第二輪擴充（2026-10-15）

- Excel `.xlsx` 多工作表讀取、中文欄位對應、日期轉換及原始列號；保留 CSV 相容流程，增加手動名單。前後端均限制 100 人，建立前再次驗證。
- ZIP 打包既有成功且有效的 PDF，支持全批／選取、SHA-256 檢查、檔名防碰撞及 50 MB 上限；有獨立下載權限與稽核紀錄。
- 匯入驗證報告與活動產製／通知異常報告，UTF-8 BOM CSV、公式字元防護、保留換行及引號。活動報告需要 recipients.export。
- 活動列表的跨頁名稱搜尋／狀態篩選／卡片與列表；活動內搜尋、狀態篩選、選取、進度、正式 PDF 與樣張，以及獨立通知工作區。
- 一般工作區 API 依 signed session 計算限流，避免共用 NAT 的不同登入互相耗用；所有 auth 端點仍依 IP，沒有調高登入／恢復的限流額度。
- Excel／ZIP 增量當時不需要新增 migration；舊版 `.xls`、公式計算、巨集、ZIP 背景大型匯出仍未提供。完整限制見 IMPORT_EXPORT.md。

## 2026-10-15 生命週期增量

已新增產製前活動編輯、活動取消、證書撤銷與補發、版本鏈、操作原因與 before／after 稽核、不可修改的 AuditLog，以及收件人序號／來源列號區分。新 migration 004／005 已套用本機與測試資料庫。詳見 [LIFECYCLE.md](LIFECYCLE.md)。

本次實測：32/32 integration、23/23 unit／renderer、2/2 browser E2E 通過；typecheck、lint、build 通過。已查看桌面操作紀錄與 390px 手機截圖，頁面沒有水平溢出。API health 回傳 ok，既有 demo 保持運行。

## 2026-10-15 公開驗證與接手增量

公開驗證、可配置 PDF QR、獨立 QR SVG 分享、活動預設期限／單張期限管理、到期即時判定與下載／寄送阻擋已實作。Migration 006 已套用本機與測試 DB。接手入口為 HANDOFF.md，待修問題為 KNOWN_ISSUES.md，後續順序為 ROADMAP.md。

真實 PDF 經 Poppler rasterize 後由 jsQR 成功解碼專屬驗證網址；unit／renderer 24/24 通過（6.30 秒）。匿名驗證與效期瀏覽器流程 1/1 通過（9.4 秒），既有兩條流程亦通過；完整整合測試與遠端 CI 結果於下方記錄。

最終本機驗證：36/36 integration 通過（79.48 秒，含公開驗證／到期／續期／CSRF 多視窗回歸）；24/24 unit／renderer 通過。build、typecheck、lint 通過。OpenAPI 39 paths，公開驗證端點 security 為空（匿名可讀），私有端點保留授權。遠端 CI 與部署不以本機結果代替。

最後一輪完整 browser E2E：3/3 通過（38.7 秒），含 Excel／ZIP／生命週期、芫荽／帳號恢復，以及公開驗證／QR／期限管理。已檢查 390px 公開驗證頁截圖。Demo 與 API health 保持正常。

## 2026-10-14 交接待修項目

- BUG-001：預覽渲染期間活動被修改時回 409（原本被改成 422），只有渲染失敗映射 422。
- BUG-002：`send` 回傳 `{ queued, skipped, message }`，零排隊時說明原因；新增 `POST /api/organizations/:org/batches/:id/deliveries/retry`（需理由），只重排目前有效證書的 failed／cancelled 通知，保留 attempts、新 outbox、audit 前後狀態；unknown 拒絕；活動鎖內執行，雙擊只排一次。後台 UI 尚未接上。
- BUG-003：Fastify 改用 `logController`，deprecation 消失；pg 並行查詢警告來自 `@prisma/adapter-pg`，待上游。
- E2E：修正補發後輪詢的競態（舊狀態已是 generated，需等補發請求完成再輪詢）。

本機驗證（Node 24.21.0 跑 Playwright；API／worker／vitest 於 Node 22）：38/38 integration（新增 2 項回歸，且確認未修正前兩項皆失敗）、24/24 unit／renderer、3/3 browser E2E 通過；typecheck、lint 通過。Chromium 以非 root 使用者執行，避免 sandbox 啟動失敗。遠端 CI 未以本機結果代替。
