# 已知問題與限制

更新：2026-10-15。以下區分確認問題、待改善能力及尚未驗證事項；沒有列出的功能不表示已完成全面安全／負載驗收。

## 已知未修復問題

| ID／優先度 | 現象與重現／證據 | 影響、暫行方式 | 修復方向與驗收 |
| --- | --- | --- | --- |
| BUG-003／P3 | 本機測試 log 出現 pg concurrent query deprecation。以 `--trace-deprecation` 定位：來源是 `@prisma/adapter-pg` 7.10 的 `PgTransaction.queryRaw`，Prisma query interpreter 在互動式 transaction 內並行送出查詢，非本專案程式直接呼叫。Fastify `disableRequestLogging` 警告已於 2026-10-14 改用 `logController` 修正。 | 現行測試通過；升級 pg 9 前須確認 Prisma adapter 已改為序列化查詢。固定 lockfile。 | 追蹤 Prisma adapter-pg 上游修正後升版；升版前跑完整 integration 與 worker 演練。 |

## 已修復、需保留回歸測試

- BUG-001（2026-10-14 修正）：batch preview 渲染後因 revision 改變的 409 原本被外層 catch 改成 422。現在只有渲染失敗映射 422，業務衝突保留 409。整合測試以未提交的 revision 更新持有列鎖，確定性重現「渲染中活動被修改」並驗證回 409、不寫入 previewedAt。
- BUG-002（2026-10-14 修正）：發送通知原本命中舊的 failed／cancelled EmailDelivery 時不會重新排隊卻仍回 ok。現在 `send` 回傳 `{ queued, skipped, message }`，從不重置既有通知，零排隊時說明原因（傳送中、已交付、結果不確定、失敗／取消、證書無效）。新增 `POST /batches/:id/deliveries/retry`（需 mail.send + certificates.issue 與理由）：只重排目前有效證書的 failed／cancelled 通知，保留 attempts 歷程、新 outbox、audit 記錄理由與前後狀態；unknown 一律拒絕並要求人工核對 Message-ID；在活動鎖內執行，雙擊只排一次。後台 UI 尚未接上重試按鈕（前端改版另案處理）。

- 多視窗重新取得 CSRF token 原本會旋轉 cookie，讓既有視窗快取的 token 失效。現在重用有效 signed cookie token；整合測試確認穩定與偽造請求仍被拒絕。
- 序號一律從 1 開始，不再顯示來源列號。
- 取消／補發後舊 worker 可能回寫狀態：現在認領與提交使用活動鎖重新檢查。
- 補發後歷史通知失敗報告原本可能指到新版編號：現在依 delivery 所屬 certificate 輸出。

## 現有限制（不是已實作 feature）

- 公開驗證是連結分享模式，不是搜尋公開名單，不提供私人 PDF、完整姓名或 Email。
- 已產製的舊 PDF 若印有 QR，不會被重寫；掃描後顯示「QR Code 驗證已停用」。補發不支援改模板版本。
- 公開頁每 30 秒更新；工作人員與收件人頁的狀態可能需按重新整理，API 仍即時拒絕過期下載。
- 到期後延長期限不會重寫原 PDF，亦不自動發續期通知。尚無到期提醒排程、批次續期與到期儀表板。
- Excel 最多 100 筆，ZIP 目前記憶體封裝上限 50 MB；不是大型背景匯出。
- 單一寄件網域的正式 SMTP 已支援（`MAIL_MODE=smtp`）；多組織各自寄件網域、實際投遞追蹤、PKI 簽章、S3、MFA、成員管理與完整編輯器仍見 ROADMAP。

## 尚未驗證

production 部署／還原、外部網域與 HTTPS 手機掃描、正式 SMTP 斷線與 DNS、1,000 筆負載、多瀏覽器及輔助科技完整驗收。
- migration 009 之前建立、尚未產製的活動沒有流水號；產製會被擋下，請先「編輯活動」補上流水號。
- 下載密碼只在通知信中提供；收件人遺失信件時需由管理員重寄通知（會換新密碼）。
