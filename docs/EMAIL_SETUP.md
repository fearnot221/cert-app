# 寄件設定與驗證

查核日期：2026-10-15。本機用 Mailpit；正式環境可用 `MAIL_MODE=smtp` 透過一個已驗證的寄件網域寄出（建議 Cloudflare Email Sending，見下節）。多組織各自網域、Google Relay 和設定精靈仍待 Phase 3。

## 正式寄信：Cloudflare Email Sending（SMTP）

網域在 Cloudflare 上時，用 [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) 的 [SMTP submission](https://developers.cloudflare.com/changelog/post/2026-06-08-smtp-submission/) 寄信，不需自架郵件伺服器。寄送任意收件人需要 Workers Paid 方案（每月含 3,000 封，之後每千封 USD 0.35，見[價格](https://developers.cloudflare.com/email-service/platform/pricing/)）；新帳號每日額度保守，會依信譽調升。

1. Cloudflare 後台 Email Service 加入寄件網域（例：fearnot.tw），照指示加入 SPF／DKIM 等 DNS 記錄，等狀態變為已驗證。
2. 建立具 **Email Sending: Edit** 權限的 API token。
3. 在 production env 檔設定：

```bash
MAIL_MODE=smtp
SMTP_HOST=smtp.mx.cloudflare.net
SMTP_PORT=465
SMTP_USER=api_token
SMTP_PASS=<上一步的 API token>
MAIL_FROM=cert@fearnot.tw
```

4. 重新啟動 api／worker，用自己的信箱跑一次發送，檢查原始標頭的 SPF、DKIM、DMARC 為 pass。

`MAIL_MODE=smtp` 一律走 TLS（465 隱含 TLS，其他 port 強制 STARTTLS）並驗證憑證；可見 From 固定為 `MAIL_FROM`，組織只能決定顯示名稱。worker 在 production overlay 多接一個可對外的 `egress` 網路以連到 SMTP；api、DB、Redis 仍在內部網路。

不建議自架郵件伺服器：多數主機商與家用網路封鎖對外 port 25，新 IP 沒有反解與信譽時 Gmail／Outlook 常直接拒收或進垃圾信。

## 本地實際郵件

依 `.env.example` 設定 `MAIL_MODE=mailpit`、`SMTP_HOST=127.0.0.1`、`SMTP_PORT=51025`。Docker 網路內改用 `SMTP_HOST=mailpit`、port `1025`。Mailpit 收件匣在 http://localhost:58025；郵件留在開發環境，不送達真實信箱。Compose 固定 [Mailpit 1.31.5](https://github.com/axllent/mailpit/releases/tag/v1.31.5)，不是浮動 latest。

產製完成後，管理者另外確認發送。新帳號應收到啟用連結，既有帳號只收到領取通知；啟用不授予後台權限，不重設既有密碼。用瀏覽器開啟連結時不消耗 token，設定密碼的 POST 才原子消耗。

`MAIL_MODE=disabled` 明確阻止寄信。production 只接受 `smtp` 或 `disabled`，不接受 Mailpit；不能把 Mailpit 的成功當成外部投遞驗證。

## 模型責任（完整目標）

| 對象 | 用途 | 不代表什麼 |
| --- | --- | --- |
| DomainVerification | DNS challenge 或平台管理者確認的網域授權及證據 | SPF／MX 存在不等於申請者有控制權 |
| EmailConnection | SMTP host、port、TLS、實際驗證方式、加密憑證、測試結果 | TCP／SMTP 連線成功不代表某 From 已被授權 |
| ConnectionGrant | 將共用 connection 能力授予指定組織 | 不能讀取共用憑證或取得整個網域地址權限 |
| SenderIdentity | 組織、顯示名稱、精確 From、Reply-To、connection、狀態 | 被授權一個地址不等於同網域的全部地址 |

同一 Domain 和 EmailConnection 可授權多個組織；每個 SenderIdentity 的可見 From 都需明確分配。客戶端只能傳 senderIdentityId，不能任意覆寫 From、envelope sender 或 SMTP 參數。

## 一般 SMTP 上線流程

1. 平台設定 SMTP host／port allowlist；公網主機驗證 DNS 解析後的 IP，阻止 loopback、link-local、metadata 與私有網路。內部 relay 需平台管理者明確允許。
2. 組織登錄網域，系統生成隨機 DNS TXT challenge。保存 token hash／證據、操作者及到期；控制權驗證與 DNS 健康檢查分開。
3. 登錄 EmailConnection，TLS 465 或 STARTTLS 587 依服務商設定；正式環境禁止忽略 TLS 憑證檢查。secret 加密，金鑰置於獨立 secret store，API 只回遮罩資訊。
4. 先測試連線，再用被授權的特定 SenderIdentity 寄到受限的測試收件地址；保存 message ID、時間與 SMTP 回覆。
5. 收件方檢查原始標頭的 Authentication-Results 與 From 對齊，再由管理者確認實收。達成全部條件後才啟用正式寄送。

狀態應各自呈現「網域授權」、「DNS 查詢」、「SMTP 連線」、「指定地址測試」、「實際收信」及最後檢查時間；任何單項成功不得改寫其他狀態。

## Google Workspace SMTP Relay（尚未實測）

部署前由 Workspace 管理者在 Gmail Routing 的 SMTP relay service 建立規則，設定允許寄件者、實際固定出口 IP 或受支援驗證方式，以及要求 TLS。本系統規劃使用 `smtp-relay.gmail.com:587` 和 STARTTLS。允許網域內地址的選項可包含未獨立建信箱的地址，但本系統仍只允許被明確分配的 SenderIdentity；不選任何地址皆可的寬鬆模式。[Google SMTP Relay 設定](https://knowledge.workspace.google.com/admin/gmail/advanced/route-outgoing-smtp-relay-messages-through-google)

需要特別確認：

- Coolify／NAT 的實際對外 IP 是否固定；多組織共用出口 IP 只證明此伺服器可連線，應用層仍須隔離 From 授權。
- SMTP envelope sender（MAIL FROM，用於退信與 SPF）與郵件可見 From（使用者看到，參與 DMARC 對齊）是兩個欄位，不能混為一談。
- 若不用 IP allowlist，需由 Workspace 管理者確認部署實際可用的 SMTP 驗證方式；不假定一般帳密或廣泛 Admin API scope 可用。
- 無 Admin API 的情況，Google Admin 設定一律標示「待管理者確認」並保存確認紀錄，不偽造自動驗證。

## SPF、DKIM、DMARC

DNS 查詢只提供診斷。SPF 的 Google include 要合併進既有政策，不能建立第二筆 SPF；DKIM public key 存在不證明信件已簽章；MX 存在不是發信必要條件或控制權證據。DMARC 通過需檢查真實訊息的驗證與對齊結果。

Gmail 的一般寄件要求含 TLS 與 SPF 或 DKIM；大量寄件另要求 SPF、DKIM、DMARC 與對齊。行銷／訂閱郵件的退訂要求不能因本系統可發通知而忽略。正式寄送前重新查核服務商當時規範及帳號配額，不把官方上限當本系統保證吞吐量。[Gmail 寄件者規範](https://support.google.com/mail/answer/81126)

## 寄送記錄與不確定結果

每封只含一位收件人，禁止用共用 To/CC 洩漏名單。記錄 EmailDelivery 與 DeliveryAttempt 的 organizationId、certificateId、senderIdentityId、message ID、attempt、時間及安全遮罩後的回覆。

| 狀態 | 對使用者的意義 | 處理 |
| --- | --- | --- |
| queued | 等待寄送 | 可取消未開始工作 |
| sending | 已開始嘗試 | 不可重複排入同一次通知 |
| accepted | 已交付 SMTP；最終投遞狀態未知 | 不能顯示已收到／已閱讀 |
| delivered | 可靠且驗簽去重的 provider 事件證實投遞 | 沒有事件來源不可自行設定 |
| bounced | 可靠退信事件 | 停寄／人工更正 |
| failed | 可確定未成功 | 暫時錯誤退避；永久錯誤停止 |
| unknown | 可能送出，無法確定結果 | 保留 message ID 人工查驗，不自動盲目補寄 |

每次實際寄送前重新檢查組織、connection grant、sender 啟用與驗證狀態；失敗時不得改用其他組織寄件者。寄送和產製分開，整批通過檢查才開放通知；若要只寄部分成功列，需明確確認並保存選取集合。

## 待完成的正式能力

DNS challenge API、Google 設定精靈、SMTP 憑證加密、connection／組織限速配額、暫時／永久錯誤完整分類、退信停寄、受限模板編輯、附件上限與 webhook 驗簽皆列入 Phase 3。Mailpit 不驗證以上外部能力。

## 帳號服務郵件（已實作，本機 Mailpit）

公開 POST `/api/auth/resend-activation` 與 `/api/auth/forgot-password` 接受 email；存在／不存在、不符合條件均回相同文案，仍需 CSRF。每 IP 每路徑 15 分鐘 5 次、每帳號／用途 60 秒冷卻，後者以 User row lock 與 AccountMail 記錄防止併發繞過。IP 限流目前是單 API process 記憶體，擴充多實例時需共用限流儲存。

AccountMail 是全域身分服務的 durable record，與組織發證郵件分離；worker 經獨立 BullMQ queue 寄出。開發寄件者固定 `accounts@example.test`，不得選用其他組織的 SenderIdentity。API 不接受寄件者或回呼網址；APP_ORIGIN 決定連結來源。

worker 寄送前生成隨機 token，DB 只存 SHA-256，Redis 只保存工作 ID。啟用有效 24 小時，重設有效 30 分鐘；寄出新版時同用途舊 token 失效。開啟連結不消耗 token，URL fragment 在頁面讀取後清除，亦支援同一分頁的新連結。POST 更新在 User row lock 下驗證用途、有效期、已使用狀態與帳號狀態，重設原子撤銷所有 sessions、未使用 token 與排隊恢復信。登入建立 session 前再次比較密碼 hash，避免舊密碼驗證與重設併發產生有效舊 session。

SMTP 中斷而無法確認接受狀態時標記 `unknown`，不自動重寄；使用者可在冷卻後重新申請新的連結。queued 超過一小時尚未寄出即取消，避免長時間停機後寄出過時請求。AccountMail 狀態可由維運查詢；尚無帳號郵件後台 UI。production 的 mail 仍維持 disabled。
