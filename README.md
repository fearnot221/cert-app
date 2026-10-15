# Certfolio 多組織證書工作室

以 React / Vite、Fastify、PostgreSQL / Prisma、Redis / BullMQ 與 Chromium 實作的 modular monolith。此交付聚焦 Phase 1：真實登入、組織權限、圖片背景與文字模板、Excel／CSV／手動名單小批次、PDF 產製、Mailpit 啟用通知，以及收件人私人下載。另已提供啟用信重發、忘記／重設密碼、芫荽 Iansui 字型、批次 ZIP 與失敗報告。

此版本不是 production ready；正式 SMTP、MFA、自訂角色、字型上傳、XLSX 與完整批次維運能力請見 [進度文件](docs/IMPLEMENTATION_STATUS.md)。

## 本機啟動

需求：Node 24.21.0 以上的 24 LTS（可執行 `nvm use`）、pnpm 11.25.0、Docker Compose。安裝及鎖檔已固定相容套件版本。

```sh
# 若使用 nvm：先執行 nvm install（讀取 .nvmrc 的 Node 24.21.0）
cp .env.example .env
# 修改 .env 的 SESSION_SECRET 與 SEED_ADMIN_PASSWORD
pnpm install --frozen-lockfile
docker compose up -d postgres redis mailpit
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm exec playwright install chromium
pnpm dev
```

開啟 http://localhost:5173 。預設本機種子帳號 `admin@example.test`，密碼採 `.env` 的 `SEED_ADMIN_PASSWORD`（範例值 `Local-Cert-Only-2026!`，僅本機測試）。Seed 重跑不會覆蓋既有密碼，且 production 禁用。

Mailpit：http://localhost:58025 。本機通知只會進入 Mailpit，不會送到真實收件匣。資料庫、Redis 與 Mailpit 僅綁定 loopback。背景 worker 必須與 API 同時啟動，`pnpm dev` 會一併執行。

## 驗證流程

1. 登入並選擇組織；開啟／建立模板，上傳 PNG、JPG 或 WebP 背景。
2. 拖動文字，儲存，發布不可變版本。
3. 建立發證活動，選模板版本，貼上或匯入範例 CSV，檢查錯誤列。
4. 建立批次並開啟伺服器 PDF 樣張；確認後產製，等候每列成功。
5. 選擇組織授權的「本機測試」寄件身分，明確確認通知。
6. 在 Mailpit 打開通知，使用啟用連結設定 12 字元以上密碼，再從「我的證書」下載。

每批上限 100 筆，全部資料須通過驗證；任何失敗列都會顯示。匯入、產製與通知不會自動串接執行。SMTP `accepted` 表示被 SMTP 接受，不代表已投遞或閱讀。

## 指令

```sh
pnpm lint
pnpm typecheck
pnpm test
RENDERER_INTEGRATION=1 pnpm test
pnpm build
# 使用獨立測試資料庫（先建立一次）
docker compose exec -T postgres createdb -U cert cert_app_test
DATABASE_URL=postgresql://cert:cert_local_only@localhost:55432/cert_app_test pnpm db:migrate
NODE_ENV=test DATABASE_URL=postgresql://cert:cert_local_only@localhost:55432/cert_app_test pnpm test:integration
pnpm test:e2e
```

API 文件： http://localhost:3001/api/docs 。API 所有變更請求需要 `/api/auth/csrf` 回傳的 token 與 cookie；長期登入憑證不會存於 localStorage。所有組織 API 都必須同時通過身分、Membership、permission 與資源歸屬檢查。

大量測試腳本：`ALLOW_BENCHMARK=yes pnpm exec tsx --env-file=.env scripts/benchmark.ts`。只在隔離資料庫執行；預設 1,000 筆分成 10 批，不寄信，結果寫入 `.runtime/benchmark-result.json`。請以 `docker stats` 另記 worker 記憶體，並測試中途重啟 worker。此腳本不代表已完成效能驗證，實際執行狀態見進度文件。

## 目錄與部署

- `apps/web`：繁體中文工作台與收件人入口。
- `apps/api`：授權、Session、上傳、模板、批次與私人下載。
- `apps/worker`：從 durable outbox 恢復 PDF／郵件工作。
- `packages/contracts`：版本化模板 schema、變數與欄位規則。
- `packages/renderer`：前後端共用 React renderer、固定字型與 Playwright PDF。
- `packages/domain`：資料庫、StorageProvider、CSV 與背景工作。
- `prisma`：完整 Phase 1 migration 與本機 seed。
- `docs`：[架構](docs/ARCHITECTURE.md)、[權限](docs/PERMISSIONS.md)、[驗收](docs/ACCEPTANCE.md)、[郵件](docs/EMAIL_SETUP.md)、[字型授權](docs/FONT_LICENSING.md)。

Docker／Coolify 與備份還原步驟見 `docs/DEPLOYMENT.md`。未設定正式帳號、網域、SMTP 或部署憑證；沒有宣稱正式部署成功。

## 帳號恢復與芫荽

登入頁提供「重發啟用信」與「忘記密碼」。本機信件在 [Mailpit](http://localhost:58025) 查看；啟用連結有效 24 小時，重設連結有效 30 分鐘，只能使用一次。重設後所有既有登入失效，請使用新密碼登入。正式寄信 provider 尚未啟用。

模板編輯器選取文字 → 字型 →「芫荽 Iansui」。提供實際標準 400 字重；畫布與 PDF 使用相同官方 OFL 字型，詳見 [字型授權](docs/FONT_LICENSING.md)。

整合測試已包含真實 worker SIGKILL／重啟、故障列重試及成功 PDF 不變驗證。使用 `_test` 資料庫與獨立 Redis queue prefix；測試不會停止正在運作的 demo。


## 名單匯入與批次下載

發證活動支援 Excel `.xlsx` 工作表選擇與欄位對應、上傳／貼上 CSV、手動新增。每批最多 100 人；Excel 2 MB、CSV 512 KB。先檢查名單，再預覽與產製。

產製後可下載全部成功證書 ZIP，或篩選收件人後勾選下載；單次最多 50 MB。活動內的失敗報告涵蓋 PDF 產製與通知異常，需要 `recipients.export` 權限。名單驗證錯誤也可在建立前下載 CSV。

活動列表提供名稱搜尋、狀態篩選與卡片／列表；活動內分開顯示收件人產製與通知進度。詳見 [匯入與下載操作手冊](docs/IMPORT_EXPORT.md)。

### 活動修改、撤銷與補發

活動明細已提供產製前編輯、取消活動、逐張撤銷／重新發放、版本與操作紀錄。補發產生新編號，保留舊 PDF 與快照；取消／撤銷後停止下載及排隊通知。操作方式、權限與寄送邊界見 [生命週期說明](docs/LIFECYCLE.md)。本次需執行 `pnpm db:generate` 與 `pnpm db:migrate`（004、005）。

### 流水號、密碼下載與到期管理

證書流水號由名單提供，組織內不可重複；一個活動可同時使用多個模板，名單以「模板」欄指定。通知信附流水號與下載密碼，收件人在 `/download` 免登入下載 PDF；任何人可在首頁查詢流水號是否存在與目前狀態，不顯示持有人資料。QR Code 驗證已移除。需套用 migration 009。詳見 [流水號查詢與下載說明](docs/PUBLIC_VERIFICATION.md)。正式對外使用前必須部署 HTTPS 並設定穩定 APP_ORIGIN，本機 localhost 不是 Internet 服務。

### 接手與後續開發

- [工程交接與啟動／測試](docs/HANDOFF.md)
- [尚未修復的問題與現有限制](docs/KNOWN_ISSUES.md)
- [改善計畫、Enhancements 與未實作功能](docs/ROADMAP.md)
- [貢獻流程](CONTRIBUTING.md)
