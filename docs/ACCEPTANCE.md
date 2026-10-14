# 驗收與測試計畫

這份文件定義驗收方式，**不是測試通過報告**。已執行指令、結果與未驗證項目列在 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。測試一律使用獨立資料庫及 Mailpit，不用 production 名單。

## Phase 1 垂直驗收

1. 執行 migration 與 development seed，以管理帳號登入。登出後 cookie 失效；錯誤密碼顯示一般錯誤且有 rate limit。
2. 在兩個 seed 組織間切換，模板／批次列表分離；無 Membership 的使用者不出現後台組織。
3. 上傳合法 PNG/JPG/WebP 背景。偽造副檔名、無效 bytes、超過上限與跨組織 asset id 應被拒絕。
4. 放入姓名、課程和固定文字；拖動與精確座標修改後儲存並重開，位置保持。衝突版本存檔應得到明確 409。
5. 發布模板，匯入小 CSV；缺欄、錯誤 Email、重複列及超限顯示原始列號和原因，未修正不得產製。
6. 用伺服器樣張確認紙張、繁中、長文字、圖片與字型。正式生成後能下載 PDF；修改 draft 後舊證書 PDF hash 不變。
7. 匯入及產製不能自動寄信。明確選擇開發寄件身分後，Mailpit 收到各自的啟用信；UI 只顯示 SMTP accepted。
8. 開啟啟用 GET 不消耗 token；明確 POST 設定密碼後，重用 token 應失敗。既有使用者再次收到證書，原密碼仍有效。
9. 收件人登入看到自己的證書，直接修改 certificateId 不能下載另一人的 PDF。沒有後台 Membership。
10. 以相同批次再次產製不新增第二張證書；worker 中斷恢復需以實際故障演練確認，不只讀程式判定。

## 必要測試清單

| ID | 場景 | 預期結果 | 階段 |
| --- | --- | --- | --- |
| SEC-01 | A 人員讀寫 B 模板／背景／批次 | API 拒絕且無 B 資料 | 1 |
| SEC-02 | Designer 直接呼叫 import／generate／mail | 403，不靠 UI 隱藏 | 1 |
| SEC-03 | 收件人修改 PDF id | 403／404，無檔案 bytes | 1 |
| VER-01 | 發證後修改模板及姓名 | 舊 version／snapshot／PDF 不變 | 1 |
| PDF-01 | 繁中、英文、長姓名、多行 | 可選文字、正確字形及邊界 | 1 |
| PDF-02 | 字型／圖片載入失敗、缺字 | 明確阻擋產製 | 1 |
| PDF-03 | 編輯器與 server PDF raster 比對 | 同字型與元素位置在容許誤差內 | 2／4 |
| JOB-01 | 重複提交與重啟 | DB 業務唯一鍵不重複發證 | 1／2 |
| JOB-02 | 部分生成失敗、只重試失敗列 | 成功列不重畫、不改舊 hash | 2 |
| ACC-01 | token 過期、重用、重發 | 原子拒絕；舊 token 失效 | 1 |
| ACC-02 | 跨組織發給既有 User | 密碼與其他 Membership 不變 | 1 |
| MAIL-01 | 未授權 From／停用 sender | 排入及執行均拒絕 | 1／3 |
| MAIL-02 | SMTP accepted | 不記 delivered | 1 |
| MAIL-03 | 送出後寫 DB 前崩潰 | unknown，人工查核而非自動重寄 | 3／4 |
| MAIL-04 | Mailpit 啟用／既有通知 | 一人一封、正確組織／連結／文案 | 1 |
| E2E-01 | 背景到收件人下載 | 真實 DB／Chromium／SMTP 全程 | 1 |
| LOAD-01 | 1,000 列與中斷恢復 | 實測耗時、峰值記憶體、失敗率、重複數 | 4 |

## 測試分層

- Unit：permission、schema、CSV 解析、模板字串安全、長度／缺字、storage key。
- Integration：獨立 PostgreSQL migration、Fastify injection、session／CSRF、複合外鍵、snapshot／idempotency。
- Browser E2E：真實 web + API + worker + PostgreSQL + Redis + Mailpit + Chromium；涵蓋上傳、發布、匯入、樣張、產製、寄送、啟用及下載。
- 視覺回歸：固定 Chromium、renderer 和字型 hash，以相同資料保存瀏覽器及 PDF 頁面影像；變動需人工審查。
- 故障演練：中止 worker、Redis 斷線、檔案寫入失敗、SMTP acceptance 後斷線、授權撤銷；保存命令及可重現結果。

## 負載紀錄格式

1,000 筆 benchmark 必須說明機器 CPU／RAM、作業系統、容器限制、Chromium／renderer／字型版本、concurrency、樣本語系及背景解析度。分開記錄總耗時、每列 p50/p95、峰值 RSS、成功／失敗／重複數、失敗原因、停止時間點與恢復後統計。

尚未執行的欄位填「未量測」，不得填推估數值。Phase 1 100 列上限不可偷偷放寬，後續負載腳本可分批測試但必須標明與單一大型批次不同。

## Production 關卡

正式上線前必須完成管理員 MFA、正式 SMTP 授權與外部實收證據、production secrets、HTTPS、worker 網路與資源限制、S3 或持久私有 volume、備份還原演練、資料保留政策，以及上述負面測試。Docker／CI 檔案存在只表示可供執行，不能表示已部署或已通過 CI。

## 2026-10-15 帳號恢復／芫荽／批次故障補充驗收

- 真實 Mailpit：重發啟用使舊 token 失效；存在／不存在 email 回應一致；並行重發受冷卻限制；啟用 token 不能重設密碼。
- 重設 token 30 分鐘且一次性；過期拒絕、兩次並行提交僅一次成功，全部既有 session 撤銷、舊密碼失效，新密碼可登入。
- Chromium browser E2E：選取芫荽並完成發布與發證、手機啟用重發、同分頁新連結、忘記密碼／新密碼登入及舊 session 401。
- 真實獨立 worker：PDF active job 被 SIGKILL（在 DB advisory gate 阻塞時）→ 重新啟動 → BullMQ stalled recovery → 完成一次。此 gate 不改動 production 程式、不加入測試故障開關。
- 同批另一列用目標位置目錄模擬 PDF 寫入失敗；移除障礙後並行兩次 API retry，只有失敗列得到一份重試工作。原成功列的 PDF bytes／SHA-256 不變，沒有多餘證書。
- SMTP ambiguity 已測 `sending` 中斷後轉 `unknown`、不重寄；這是狀態恢復測試，尚未用正式 SMTP 服務注入網路中斷。

執行：`NODE_ENV=test DATABASE_URL=postgresql://cert:cert_local_only@localhost:55432/cert_app_test pnpm test:integration`。需要本機 PostgreSQL、Redis、Mailpit 與 Chromium；必須使用 `_test` database。測試清理僅限本次 UUID 資料、資產與獨立 Redis prefix；不清空 demo DB／Redis。


## Excel／ZIP／活動操作驗收

- XLSX：中文 headers、多工作表、空白列後原始列號、文字前導零、1900／1904 日期；拒絕合併／公式／錯誤值、重複 headers、舊版格式、過大解壓縮及超過 100 人。
- API：multipart 匯入權限、跨組織拒絕、records 建立前再驗證、冪等建立、活動名稱與狀態搜尋。
- ZIP：真實 PDF bytes 一致、只含成功有效列、外部 ID／批次與無權限拒絕、hash 失敗阻擋、稽核事件。
- CSV 報告：正確原始列號與原因、多行／引號保留、公式 prefix 中和；無 export 權限拒絕。
- 瀏覽器：上傳 Excel、切換 worksheet／欄位對應、下載錯誤報告、修正後建立、產製、全部與選取 ZIP、活動搜尋／卡片與列表切換、手動建立。另保留芫荽／通知／重發啟用／密碼重設完整流程。
- 手機 390px：body 不溢出，工具列換行；寬表格僅在表格容器內水平捲動。

## 活動與證書生命週期驗收

- 單一收件人的明細顯示序號 1 與來源列號 2；補發兩版仍為一位收件人。
- 產製前修改名稱／名單需原因，寫入 before／after 與操作者；舊 preview 清除；並行同 revision 僅一次成功，另一個 409。
- 已產製活動禁止改名單；撤銷後管理員、收件人、ZIP 都不能取得失效 PDF。
- 並行補發同一版本僅建立一個後繼版本與 outbox。舊快照／PDF bytes 保持不變，有效舊證書轉 superseded，已撤銷版本保留 revoked。
- 取消停止 pending PDF 與 queued 通知；重播舊工作不會恢復活動。取消後 generate／retry／send／reissue 拒絕。
- sending 通知保留真實狀態與稽核 inFlight 數；中斷後轉 unknown 而不重寄。舊版通知失敗報告仍對應舊編號。
- 稽核資料庫 UPDATE／DELETE 被 trigger 拒絕。測試清理只在隔離 _test DB 的 transaction 內暫停 trigger 並立即復原。
- 瀏覽器流程實際操作修改、撤銷、補發、版本歷史、取消與 390px 行動版；不以 API 成功代替 UI 驗證。
