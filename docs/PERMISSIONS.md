# 權限與多組織隔離

此矩陣定義完整產品的預設角色；Phase 1 的端點和測試覆蓋以程式與 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) 為準。定義 permission 不代表已提供該操作畫面。

## 角色矩陣

✓ 表示本組織預設授權；— 表示預設拒絕。Platform Admin 屬平台控制平面，不能因此自動讀取所有組織的名單或 PDF。

| Permission | Owner | Admin | Designer | Issuer | Auditor |
| --- | :---: | :---: | :---: | :---: | :---: |
| members.manage | ✓ | ✓ | — | — | — |
| roles.manage | ✓ | ✓ | — | — | — |
| templates.read | ✓ | ✓ | ✓ | ✓ | ✓ |
| templates.write | ✓ | ✓ | ✓ | — | — |
| templates.publish | ✓ | ✓ | ✓ | — | — |
| recipients.import | ✓ | ✓ | — | ✓ | — |
| recipients.export | ✓ | ✓ | — | — | — |
| certificates.generate | ✓ | ✓ | — | ✓ | — |
| certificates.issue | ✓ | ✓ | — | ✓ | — |
| certificates.revoke | ✓ | ✓ | — | — | — |
| certificates.download | ✓ | ✓ | — | ✓ | — |
| mail.send | ✓ | ✓ | — | ✓ | — |
| mail.settings.manage | ✓ | ✓ | — | — | — |
| audit.read | ✓ | ✓ | — | — | ✓ |

Owner 額外可移轉所有權；移轉與移除流程必須在 transaction 中保護最後一位有效 Owner。Designer 可產生設計樣張，但不能透過預覽取得名單匯出、正式發證或收件人 PDF。Auditor 的唯讀權不等於 recipients.export 或 certificates.download。

Recipient 不在上表，沒有組織後台 permission。其讀取／下載依據是 Certificate → Recipient → 已驗證 User 的擁有關係，不能以電子郵件字串或任意 organizationId 當授權。

## 後端決策順序

1. 以 HttpOnly session cookie 驗證登入、到期及撤銷狀態。
2. 將 path 中的 organizationId 視為選擇器，查驗啟用的 Organization 及有效 Membership。
3. 由伺服器的角色與 permission 定義決定能力，不信任前端附帶的角色。
4. 以 organizationId 與 resourceId 共同查詢資源；缺少或不屬於本組織的資源不洩露內容。
5. 寫入時再次檢查關聯資源同屬此組織；資料庫複合外鍵補強應用層檢查。
6. 下載另檢查工作人員 certificates.download 或收件人擁有關係，再由授權串流送檔。
7. worker 執行延遲工作前重新查驗組織和寄件身分；建立工作時的授權不能永久生效。

tenant context 必須取自伺服器確認的身分；queue、storage、cache 也需要帶入此範圍。不可猜測 ID 是降低枚舉的措施，不能代替授權。[OWASP 多租戶安全](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)

## 全域與共用資料例外

User、Session 是全域帳號資料；內建 Permission、受授權的共用 EmailConnection 和平台管理資料可為全域。Recipient、Asset、Template、Batch、Certificate、Delivery、Audit 等租戶資料必須帶 organizationId。共用寄件網域不能永久唯一綁到單一組織，透過 ConnectionGrant 與 SenderIdentity 的明確地址授權分配能力。

Platform Admin 建立／停用組織或配置共用寄件資源，需要獨立 permission。需要跨組織敏感存取時，未來採具有理由、期限及稽核紀錄的管理流程；不能提供通用萬能 bypass。

## 自訂角色（Phase 3）

組織角色可配置的權限集合排除所有 platform-level 權限。角色編輯者只能授予自己被允許委派的能力；不能藉由修改自身 Role、Membership 或權限繼承取得原本沒有的管理權。保護內建 Owner、最後一位 Owner 以及敏感權限的委派界線。

## 必測負面案例

- A 管理員以 B 的 ID 直接讀／寫模板、背景、批次、PDF 或發送通知，必須失敗。
- Designer 直接呼叫 import / generate / mail API 必須被拒絕；Issuer 不可改角色或 SMTP 憑證。
- 收件人把自己的 certificateId 改成另一人的 ID 必須無法下載。
- A 的模板引用 B 的背景、版本或字型必須在寫入和執行兩處被拒絕。
- 沒有 Membership 的 Recipient 可登入領取，但後台列表不得出現該組織。
- 組織停用、Membership 或 SenderIdentity 撤銷後，尚未開始的工作不得繼續寄送。

## 已實作生命週期權限

產製前活動編輯使用 recipients.import；活動取消與證書撤銷使用 certificates.revoke；補發另需 certificates.issue。活動內操作紀錄使用 certificates.generate，僅查詢該活動；全組織稽核維持 audit.read。補發不授予 membership，且不自動寄送。
