# 工程交接入口

更新：2026-10-15。此文件應與實作、測試一起更新，不把 roadmap 視為已完成。

## 目前能做什麼

多組織角色與私有證書、模板設計／發布不可變版本、芫荽／Noto 字型、Excel／CSV／手動名單（100 筆）、逐人 PDF、ZIP／失敗報告、Mailpit 通知、帳號啟用／重發／重設密碼、故障恢復、活動編輯／取消、證書撤銷／補發、不可修改稽核、公開驗證／QR／到期管理。

正式 SMTP、production 部署、MFA、S3、PKI 簽章並未完成。詳見 [待辦與改善計畫](ROADMAP.md)、[已知問題](KNOWN_ISSUES.md)、[驗證說明](PUBLIC_VERIFICATION.md)。

## 新接手者啟動

```sh
# 使用 .node-version 指定的 Node 24.21.0
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
cp .env.example .env
# 僅供本機開發；正式環境必須替換密鑰與密碼。
docker compose up -d --wait postgres redis mailpit
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm exec playwright install chromium
pnpm dev
```

Web http://localhost:5173、API http://localhost:3001、Mailpit http://localhost:58025。種子帳號由 .env 的 SEED_ADMIN_EMAIL／SEED_ADMIN_PASSWORD 決定，預設值僅用於本機。現有資料庫重跑 seed 不會替已有模板自動新增 QR，請在編輯器另存發布版本。

不要提交 `.env`、`.runtime`、資料庫備份、私人 PDF、使用者名單或測試截圖。repo 不含 demo 的資料庫與已產製檔案；其他人需 seed 新環境。

## 程式入口與責任邊界

| 位置 | 責任 |
| --- | --- |
| apps/web/src/pages/TemplateEditor.tsx | 設計器與 QR 位置控制 |
| apps/web/src/pages/CreateBatch.tsx、Batches.tsx、Lifecycle.tsx | 名單、產製／通知、活動／證書操作 |
| apps/web/src/pages/Verification.tsx | 匿名驗證頁與分享 QR |
| apps/api/src/auth.ts | session／CSRF、啟用與密碼恢復 |
| apps/api/src/routes.ts | 模板／匯入／產製／下載 API |
| apps/api/src/lifecycle.ts、verification.ts | 撤銷／補發／取消／期限與公開欄位白名單 |
| packages/contracts | 文件 schema、動態欄位與版面限制 |
| packages/renderer | 共用 React 渲染、字型與 Chromium PDF |
| packages/domain/src/jobs.ts | PDF／郵件工作、advisory lock、狀態提交 |
| packages/domain/src/verification.ts | 效期計算與驗證 URL |
| apps/worker | BullMQ、outbox dispatcher、重啟恢復 |
| prisma/schema.prisma、migrations | 租戶複合 FK、不可變 trigger、資料模型 |

## 必須保留的不變條件

- 所有工作人員資源同時檢查 organizationId、membership、permission；知道 UUID 不代表有權限。
- PDF／模板版本／快照／證書血緣不可原地改寫；補發必須新證書、新編號、新 publicId。
- 修改生命週期先鎖活動，再寫資料與 audit；不要反向鎖定造成 deadlock。
- PDF 渲染在 transaction 外，提交前重新檢查證書／活動狀態。禁止取消後的舊工作復活。
- 發送與啟用是不同狀態；SMTP accepted 不等於送達；sending 中斷要 unknown，不能盲目重寄。
- 有效性請用 certificateStatus，不要只看資料庫 status === valid。到期不需要 cron 改寫狀態。
- QR 中的 URL 使用設定的 APP_ORIGIN 與系統 publicId，不接受收件人匯入值覆蓋。
- 公開驗證只回傳明列欄位；禁止 spread Certificate、dataSnapshot 或 Recipient 直接公開。
- AuditLog 無更新／刪除 API，資料庫 trigger 禁止覆寫；測試清理只允許隔離 _test DB。

## 驗證與除錯

```sh
pnpm lint
pnpm typecheck
pnpm build
# 需先安裝 Poppler 的 pdftoppm
RENDERER_INTEGRATION=1 pnpm test

docker compose exec -T postgres createdb -U cert cert_app_test
# 若測試 DB 已存在，不必再次 createdb
NODE_ENV=test DATABASE_URL=postgresql://cert:cert_local_only@localhost:55432/cert_app_test pnpm db:migrate
NODE_ENV=test DATABASE_URL=postgresql://cert:cert_local_only@localhost:55432/cert_app_test pnpm test:integration
pnpm test:e2e
```

整合測試會驗證 DB 名稱以 `_test` 結尾；不要改掉保護。worker 故障演練會啟動隔離 queue prefix、SIGKILL 該測試子程序，通常約 80 秒。瀏覽器測試使用本機 demo 並新增帶唯一名稱的資料，不清空整個 DB。測試進行時避免修改被 watch 的 API／worker 原始碼。

若主機仍為 Node 24.1.0，Playwright runner 有 loader 相容問題；先切換至 24.21.0，或暫用 `npx --yes node@24 node_modules/@playwright/test/cli.js test`。

- 工作卡住：查 BatchRow／Certificate、OutboxEvent、BullMQ 與 worker log，不先刪 outbox。
- 公開狀態異常：核對 publicId、generationStatus、status、expiresAt、org.active 與伺服器時鐘。
- PDF 字體異常：查 renderer manifest 與 font SHA，不從 Canva 快取抽字型。
- 本機遷移：已提供 001–006。不要對保有資料的 DB 執行 reset；沒有承諾自動 downgrade。

## 發佈前與後續工作

每次變更記錄測試結果與未驗證項目；更新 OpenAPI、狀態文件及風險說明。對外上線先完成 ROADMAP 的 P0（網域、TLS、設定、備份還原、限流策略、正式寄送）。部署與備份程序見 DEPLOYMENT.md、BACKUP_RESTORE.md。GitHub repo 存放原始碼不等於已部署網站。
