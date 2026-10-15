# 名單匯入與批次下載

更新日期：2026-10-15。

## 建立活動

活動頁提供三種名單來源：

- **上傳 Excel／CSV**：Excel 使用 `.xlsx`，最多 2 MB；CSV 為 UTF-8，最多 512 KB。第一列放欄位名稱。選取工作表後，將來源欄位對應到姓名、Email、證書流水號、（多模板時）模板、自訂欄位及發證日期。中文欄位可直接對應，不必重命名原始檔。
- **貼上 CSV**：適合從文字或既有流程貼入；欄位名稱使用 `recipient_name`、`recipient_email`、`certificate_number`、`template` 等 key。可下載範例 CSV。
- **手動新增**：逐人輸入、小量新增或刪除，表格依所選模板提供必要欄位；多模板時每人另選模板。

每批 1–100 人，最多 32 個來源欄位，單一值最多 500 字元。Excel 最多 20 個工作表；原始資料範圍最多 1,000 列，非空白資料最多 100 列。空白列不建立收件人。收件人序號依名單順序從 1 開始，不再使用試算表列號。文字型的編號保留前導零；若要保留 `00123`，請將 Excel 儲存格設為文字。真正的日期儲存格（含 Excel 1904 日期系統）轉為 `YYYY-MM-DD`；文字日期須使用相同格式。

## 證書流水號與多模板

- 「證書流水號」必填，組織內不可重複；名單內重複、與其他活動或既有證書重複都會逐列標出。輸入會正規化（NFKC、去空白、轉大寫）。可接受欄位名稱：流水號、證書流水號、證書編號、編號、serial。
- 建立活動時可勾選多個已發布模板（每個模板選一個版本）。選兩個以上時，名單需要「模板」欄，填入模板名稱（不分大小寫）；只選一個時可省略。各模板的必填自訂欄位只對使用該模板的收件人必填。

舊版 `.xls`、巨集檔與加密檔不支援，請先另存為 `.xlsx`。公式、錯誤值及合併儲存格會明確拒絕，請貼上為值或取消合併後再匯入。來源工作表皆須符合名單格式；封面、說明頁請先移除。解析前限制 ZIP entries 與實際解壓縮大小（20 MB），並拒絕外部連結、巨集及 XML entities。原始檔不持久保存，只有使用者選取／對應且通過驗證的資料寫入活動。

「檢查名單」會顯示每列的欄位內容與錯誤，可只看錯誤並下載檢查失敗 CSV。任何輸入變更會清除舊驗證結果；建立活動時伺服器再次驗證，不會默默跳過錯誤列。

## 發證活動介面

活動列表提供跨頁名稱搜尋、狀態篩選、卡片／列表切換，每頁最多 12 個活動。卡片顯示收件人數與活動狀態，可進入繼續產製、處理失敗或下載／通知。

活動內分成「收件人與產製」「通知收件人」工作區。產製／寄信進行時自動更新；姓名、Email、證書流水號、模板及狀態可篩選。預覽與正式 PDF 分別標示，生成仍須先完成伺服器樣張預覽。通知維持明確確認流程，不會因匯入或下載而寄出。

## ZIP 下載

使用「下載全部成功 ZIP」或勾選後「下載勾選 ZIP」。全選只選目前篩選結果中的成功有效證書；切換篩選會保留既有勾選，畫面顯示實際勾選數並提供清除。

- 僅包含本組織、本活動已成功產製且有效的 PDF，略過尚未完成／失敗／已撤銷項目。
- 指定 ID 若有任何一份不屬於此活動、尚未成功或無效，整個請求拒絕，不部分猜測處理。
- 下載既有檔案並核對 SHA-256，不重新產製。完整性不符時拒絕下載。
- ZIP 內檔名為「流水號-姓名.pdf」，流水號在組織內唯一，並移除路徑／控制字元。
- 單次 PDF 總量最多 50 MB；超出時請減少勾選數量。同一 API 程序同時最多一份 ZIP。
- 需要 `certificates.download`；成功下載寫入 `batch.zip_downloaded` 稽核事件，回應禁止快取。

## 失敗報告

匯入前的「下載檢查失敗報告」包含序號、證書流水號、姓名、Email、欄位及原因，來自本次伺服器驗證結果。

活動內的「下載失敗報告」包含 PDF 產製失敗，以及通知 `failed`／`unknown`，附序號、姓名、Email、階段、狀態、原因和證書編號。`unknown` 表示 SMTP 是否接受無法確定，不能視為可安全自動重寄。沒有錯誤時按鈕停用；直接呼叫 API 則回傳只有表頭的 CSV。

活動報告需要 `recipients.export`（預設 Owner／Admin 具備，其他角色按既有權限判斷）。報告為 Excel 可開啟的 UTF-8 BOM CSV，所有儲存格加引號並處理引號／換行，公式起始字元加單引號防止在試算表執行。成功下載記錄 `batch.failure_report_downloaded`。

## API

| 方法 | 路徑 | 權限與用途 |
| --- | --- | --- |
| POST | `/api/organizations/:org/imports/parse` | `recipients.import`；multipart 單檔，回工作表／欄位／資料列 |
| POST | `/api/organizations/:org/batches/validate` | `recipients.import`；`templateVersionIds`（1–10 個）加 `csv` 或 `records: [{rowNumber, templateVersionId?, data}]` 擇一 |
| POST | `/api/organizations/:org/batches` | 同上，另需 idempotencyKey；建立前再驗證 |
| GET | `/api/organizations/:org/batches?search=…&status=…` | `certificates.generate`；組織內搜尋與分頁 |
| POST | `/api/organizations/:org/batches/:id/zip` | `certificates.download`；可選 certificateIds |
| GET | `/api/organizations/:org/batches/:id/failures.csv` | `recipients.export`；活動失敗／待確認報告 |

所有 POST 仍需 signed CSRF cookie 與 `X-CSRF-Token`；組織狀態及 membership／permission 在伺服器檢查。完整契約見 `/api/docs`。

實作使用 ExcelJS 讀取工作簿、yauzl 限制解壓縮、fflate 封裝 ZIP；這些是應用程式執行時依賴，不是雲端試算表服務。流水號、多模板與序號調整需要 migration 009。
