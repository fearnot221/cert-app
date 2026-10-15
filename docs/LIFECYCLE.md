# 活動與證書生命週期

## 操作方式

活動明細的「編輯活動」可修改尚未產製的活動名稱與收件人欄位。保存需填寫原因，會清除舊樣張確認，必須重新預覽。已開始產製的活動不能修改原始名單，改用收件人列的「重新發放」。目前編輯介面不提供更換模板、增加或刪除收件人。

「撤銷」讓該證書立即失效；正式 PDF 下載及 ZIP 都會拒絕它。收件人仍能看到已產製證書的失效狀態。系統保留原 PDF、快照、編號與操作原因，不刪除歷史。

「重新發放」可更正該收件人的欄位（包含姓名或 Email），建立新編號、新 PDF 及新版本。舊有效證書變為 superseded；已撤銷的證書保留 revoked。舊證書不恢復有效。新 PDF 完成後需在通知分頁明確寄信，補發不會自動寄送。更換 Email 會授予新收件帳號新版證書，舊帳號不會取得新版。

「取消活動」不可恢復，會撤銷活動中所有有效證書、取消未完成的 PDF 工作及尚未開始寄送的通知，保留活動與全部紀錄。已開始 SMTP 寄送的通知無法收回，維持 accepted／unknown／failed 等真實結果。取消後拒絕預覽、產製、重試、通知及補發。

收件人表格的「序號」是名單中的第幾位收件人，從 1 開始，空白列不計入。篩選後仍保留原序號，方便查找。

## 權限與紀錄

- 編輯：recipients.import，限 validated 且尚無證書的活動。
- 取消、撤銷：certificates.revoke；預設 Owner／Admin。
- 重新發放：certificates.revoke + certificates.issue。
- 活動操作紀錄：certificates.generate，僅該組織／活動；全組織稽核仍需 audit.read。
- 所有變更需登入、CSRF、有效組織與角色；直接 API 也會驗證。

活動「操作紀錄」提供原因、操作者、時間及可展開的 before／after、新舊證書 ID／編號、取消排隊通知數及已開始寄送數。舊紀錄沒有 Email 快照時顯示 actorId。全組織稽核畫面也可展開詳細資料。

## 資料與並行控制

Migration 004 增加 IssuanceBatch.revision／cancelReason／cancelledAt；BatchRow 對 Certificate 改為一對多，使用 (rowId, edition) 唯一鍵及 previousCertificateId 唯一鍵、跨組織複合外鍵。新舊證書共用同一個邏輯收件人列，不增加收件人數。資料庫禁止更新證書血緣、既有快照或已完成 PDF。

Migration 005 使 AuditLog 僅能新增，UPDATE／DELETE 都由資料庫 trigger 拒絕。重要生命週期變更與紀錄在同一 transaction 寫入；沒有刪除活動或證書 API。

編輯使用 revision 防止覆蓋其他人的修改。生命週期變更、產製／寄送工作認領及 PDF 提交使用同一活動 row lock；耗時渲染在鎖外執行，提交前再次檢查活動與證書有效性。取消期間產出的未掛接檔案留在私有儲存區，不會取得下載權限。PDF 工作仍保留 advisory lock 防止同一證書重複渲染。

並行重發同一舊證書僅一個成功，另一個得到 409，要求重新載入。取消與撤銷重複提交不重複新增紀錄。郵件從 queued 認領為 sending 是取消邊界，認領後不承諾能收回。過去已下載至使用者裝置的 PDF 無法遠端刪除；公開驗證頁已實作（見 PUBLIC_VERIFICATION.md），數位簽章尚未實作。
