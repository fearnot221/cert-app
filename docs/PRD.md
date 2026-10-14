# 多組織證書製作與發放系統 PRD

文件日期：2026-10-15（Asia/Taipei）。本文件描述產品目標；實際完成與驗證範圍以 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) 為準。

## 產品與使用者

讓具授權的工作人員使用背景圖和動態文字製作證書，將名單轉成私有 PDF，再另外確認寄出領取通知。收件人啟用帳號後登入，只能取得自己的證書。

User 是全域帳號；Membership 是組織工作人員身分；Recipient 是組織收件人資料。發證與啟用帳號不建立 Membership。同一 User 可在不同組織具有不同角色，且同時是其他組織的收件人。

## 不可妥協的行為

1. 每個組織資料操作都檢查有效 session、組織狀態、permission、資源歸屬；前端 organizationId 僅選擇範圍。
2. 儲存模板、發布版本、產製證書、發送通知是各自明確的動作。匯入不觸發寄信。
3. 已發布版本與證書資料快照不可原地覆寫；之後修改模板或 Recipient 不改變舊 PDF。
4. 正式產製前驗證必填欄位、格式、缺字、字型載入與版面溢位。失敗要能指出列號、欄位和原因。
5. 郵件僅使用目前組織被授權且啟用的 SenderIdentity。SMTP accepted 不等於 delivered。
6. PDF 預設私有；知道證書 ID、檔名或公開驗證網址不構成下載權限。
7. 外部帳號、DNS、SMTP、授權與正式部署均以實際證據確認；沒有證據就標示未驗證。

## Phase 1：本輪垂直流程

管理者登入 → 選擇組織 → 上傳 PNG/JPG/WebP 背景 → 新增及移動固定／動態文字 → 儲存並發布模板版本 → 建立小批次 CSV → 驗證名單 → 產出並檢查 PDF → 明確發送 Mailpit 通知 → 收件人從啟用信設定密碼 → 登入並下載自己的 PDF。

Phase 1 以開發／驗證環境為交付目標。帳號、資料庫、PDF、郵件必須走真實 provider；Mailpit 是明確標示的本地 SMTP 收件匣。完成條件是這條流程實際執行且基本負面授權案例通過，不以畫面數量計算完成。

## 後續範圍

| 階段 | 交付能力 | 關卡 |
| --- | --- | --- |
| Phase 2 | 完整圖層／對齊／縮放／旋轉／Undo；字型上傳與版本；XLSX／貼上／欄位對應；逐人預覽；進度／取消／重試／串流 ZIP；撤銷／取代／公開驗證 | 視覺一致性、缺字阻擋、批次恢復與不可變快照驗證 |
| Phase 3 | 真實 SMTP／Google Relay、DNS challenge、寄件授權精靈、共用連線、郵件品牌／配額／退信、自訂角色、MFA、完整稽核、臨時密碼模式 | 外部設定證據、授權撤銷即時生效、寄送結果不確定流程 |
| Phase 4 | 全流程 E2E／視覺回歸／安全負測試、1,000 筆量測、故障復原、正式部署與備份還原演練 | 可重現報告、營運手冊與 production 管理員 MFA |

## 模板與資料規格

模板 JSON 必須有 schemaVersion、rendererVersion、頁面寬高、背景資產、元素與動態欄位。位置與尺寸採 mm，字級採 pt；畫布縮放不寫回版面座標。字型及圖片使用確定版本的本地資產，不接受任意 URL、HTML、JavaScript 或 CSS 程式碼。

保留欄位為 recipient_name、recipient_email、organization_name、event_name、course_name、issue_date、start_date、end_date、hours、certificate_number、custom_field；自訂欄位遵循有型別、長度與必填限制的 schema。Phase 1 實際支援欄位見 contracts 與進度表。

長文字先換行，指定時在最小字級以上縮小；仍溢位則禁止正式產製。不能裁掉姓名、默默換字型或把所有文字點陣化。背景不宣稱能還原 Canva 圖片內既有的文字。

## 完整產品狀態模型

| 對象 | 狀態（完整目標） |
| --- | --- |
| 模板 | draft / published / archived；發布建立不可變版本 |
| 批次 | 草稿 → 驗證 → 預覽 → 確認產製 → 背景生成 → 檢查結果 → 發送 |
| 產製 | 尚未產生 / 產製中 / 成功 / 失敗；可追蹤取消與重試 |
| 證書業務 | 有效 / 撤銷 / 被取代 / 到期 |
| 郵件 | queued / sending / accepted / delivered / bounced / failed / unknown |

實際程式的狀態名稱可不同，但不得混合產製、業務和郵件狀態。

## 介面與合理預設

- 繁體中文，日期時間以 Asia/Taipei 顯示，資料庫保留 UTC instant；單純發證日期是 date，不任意轉換時區。
- 後台以桌面為主；編輯器採左元素／圖層、中間畫布、右屬性。收件人入口支援手機。
- 組織名稱與目前範圍持續可見；重大提交再次列出組織、模板版本、數量和寄件者。
- 初版採固定預設角色，逐 API 強制 permission；自訂角色須額外防止自我提權。
- Preview 與本地環境使用隔離資料及 Mailpit；不預設連線真實 SMTP。
- 本地 storage 採 filesystem，正式 S3 driver 需後續實作與部署驗證。

## 非目標與限制

第一輪不完成所有完整產品要求。Canva 官方 API 整合、PKI 數位簽章、production 寄件認證和法律效力承諾均不在 Phase 1。QR Code 與 SHA-256 可協助比對內容，不能稱為憑證式數位簽章。
