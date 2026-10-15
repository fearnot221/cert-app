# 本地與 Coolify 部署

本輪提供可執行的本地部署配置及正式環境準備文件。尚未部署到 production；Phase 1 不包含正式 SMTP、管理員 MFA、S3 和完整營運驗證，因此不能把 Docker 建置成功等同已可正式對外上線。

## 本機開發

需要 Node.js 24.21.0（`.nvmrc`／`.node-version`）、pnpm 11.25.0、Docker Compose。早期 Node 24.1.0 在本輪 Playwright runner 遇到 loader 相容問題，不建議使用；固定鏡像已確認執行 v24.21.0。完整指令也見 repository README。

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait postgres redis mailpit
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm exec playwright install chromium
pnpm dev
```

本機入口 http://localhost:5173，API 經 Vite `/api` proxy 同源。Mailpit UI http://localhost:58025；PostgreSQL localhost:55432、Redis localhost:56379、Mailpit SMTP localhost:51025，只綁 localhost。seed 僅用開發資料；不得在正式資料庫執行。

`.env` 不進版控。`SESSION_SECRET` 使用至少 32 字元的隨機值；正式環境由 secret store 注入。設定 `SEED_ADMIN_PASSWORD` 後再執行 seed，測試資料不能沿用到 production。

## 全部容器啟動

本機開發與全部容器是兩種獨立模式。前者把資產寫到 host `.runtime/storage`，後者寫到 Docker `certificate-storage` volume；不能讓同一 DB 的 metadata 指向另一份空 storage。建議全部容器使用獨立 project `cert-app-container`，取得獨立 DB、Redis 與 storage volumes。

如果先前已啟動本機模式，先停止 `pnpm dev` 及原 project 的服務（`docker compose stop`，不刪除 volumes），釋放 localhost ports。再執行：

```bash
docker compose -p cert-app-container up --build -d
docker compose -p cert-app-container run --rm seed
```

容器入口 http://localhost:8080。web 為 nginx 靜態站，`/api` 代理內部 api:3001。migrate 一次性服務成功後 api／worker 才啟動。api 與 worker 透過共用私有 volume `/data/storage` 讀寫背景與 PDF。

切回本機模式前先 `docker compose -p cert-app-container stop`，再啟動原 `cert-app` project。若要保留同一份資料遷移模式，按備份還原程序一起搬移 PostgreSQL dump 與對應 storage；單純改 API 入口或只掛同一 DB 會造成找不到 PDF，不可視為成功遷移。

容器 seed 透過 tooling profile 專用服務讀取 `.env` 的 `SEED_ADMIN_PASSWORD`；空值會拒絕執行。一般 API／worker 不接收種子密碼。production 不提供 seed 服務，seed 也會在 NODE_ENV=production 時拒絕執行。不在鏡像內複製 `.env`，也不將 secret 編進 web bundle。

`Dockerfile` 使用 Node 24 Debian image 的已解析 digest；Chromium 由 lockfile 的 Playwright 版本安裝，避免瀏覽器／套件不相容。更新 image digest 或 Playwright 時重跑 PDF 測試。容器採非 root 的 Node 使用者、唯讀根目錄、tmpfs、process／CPU／RAM 限制。開發 backend 使用一般 bridge 以支援本機測試 ports；`compose.production.yaml` 改為 internal network 阻止外部出口（只有 worker 另接 egress 寄信）。應用層另阻擋 renderer 外部請求；正式環境仍需驗證 sandbox 與 host 安全邊界。[Playwright 容器指引](https://playwright.dev/docs/docker)

本輪 runtime 保留 tsx 和必要 workspace 原始碼執行，沒有宣稱已作最小化 production image；後續可在不破壞 renderer 字型路徑的情況移到獨立編譯與裁切依賴。

## Healthcheck 與診斷

```bash
curl --fail http://localhost:8080/api/health
docker compose ps
docker compose logs --tail=100 api worker
```

API healthcheck 查 PostgreSQL；Redis 另有 ping，worker 啟動訊息及 outbox 完成時間用於診斷。API 健康不代表 worker／SMTP 或 PDF 均正常，正式監控要加上 queue age、未完成 outbox、unknown delivery、磁碟空間與錯誤率。

如果使用上面的全部容器模式，診斷指令也加上 `-p cert-app-container`；不要把不同 project 的 health／logs 混在一起。

## 正式上線（cert.fearnot.tw，Cloudflare 橘雲）

正式環境只用一份 `compose.production.yaml`，不必和 `compose.yaml`（本機開發用）疊加。流量路徑：Cloudflare（橘雲、SSL Full (strict)）→ `caddy`（主機 80／443，Cloudflare Origin Certificate）→ `web`（nginx）→ `api`／`worker`。DB、Redis、api 只在內部網路；worker 另接 `egress` 網路以連到 SMTP。

### 1. Cloudflare

1. DNS：A 記錄 `cert` 指向主機 IP，Proxy status 設為 **Proxied**。
2. SSL/TLS → Overview：加密模式設為 **Full (strict)**。
3. SSL/TLS → Origin Server → Create Certificate：主機名稱填 `cert.fearnot.tw`，在主機上把憑證存成 `deploy/certs/origin.pem`、私鑰存成 `deploy/certs/origin.key`（`chmod 600`；此目錄已列入 .gitignore，勿提交）。
4. 建議主機防火牆的 80／443 只開放 [Cloudflare IP 段](https://www.cloudflare.com/ips/)，避免繞過 Cloudflare 直連。

### 2. 設定檔

在主機的 repository 目錄：

```bash
cp .env.production.example .env   # 再填入網域、密碼與寄信設定
```

`.env.example` 只用於本機 `pnpm dev`，與正式設定不通用。`POSTGRES_PASSWORD` 會放進連線字串，請用 `openssl rand -hex 32` 這類只含英數字的值。寄信設定見 [EMAIL_SETUP.md](EMAIL_SETUP.md#正式寄信smtp)；`MAIL_MODE=disabled` 時收件人拿不到下載密碼。`.env` 不進版控，也不會被複製進鏡像。

### 3. 啟動與建立管理員

```bash
docker compose -f compose.production.yaml up --build -d
docker compose -f compose.production.yaml ps
```

首次建立組織與擁有者帳號（seed 在 production 會拒絕執行）：

```bash
docker compose -f compose.production.yaml run --rm \
  -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='<12 字元以上>' \
  -e ADMIN_ORG_NAME='組織名稱' -e ADMIN_ORG_SLUG=sta create-admin
```

指令只會新建組織與其寄件身分（寄件地址取 `.env` 的 `MAIL_FROM`）；同名組織已存在或網址代稱被占用時拒絕，既有帳號的密碼不會被覆寫。之後的 logs、更新、停止都用同一個 `-f compose.production.yaml`。

### 訪客 IP 與限流

`deploy/Caddyfile` 只信任 Cloudflare 公布的 IP 段送來的 X-Forwarded-For，API 以 `TRUST_PROXY=loopback,uniquelocal,cloudflare` 沿 Cloudflare → Caddy → nginx 取得訪客真實 IP，限流因此按訪客計算，訪客自行偽造的位址被忽略。Cloudflare 更新 IP 段時，同步更新 `packages/config/src/cloudflare.ts` 與 Caddyfile（單元測試會檢查兩者一致）。

不經 Cloudflare 代理（灰雲）時，把 Caddyfile 的 `tls /certs/...` 一行刪除即可由 Caddy 自動向 Let's Encrypt 申請憑證。改放 Coolify 等外部反代時，移除 `caddy` 服務並把 web 接到該反代的網路。首次正式管理帳號建立流程及 MFA 完成前不能開放公開註冊。

## CI 與 PR Preview

GitHub Actions 執行 lint、typecheck、unit、獨立 `_test` DB integration、build 和 Playwright E2E。E2E 使用一次性 CI 資料庫和 Mailpit；不讀正式 secrets。檔案存在不表示遠端 CI 已跑過。

PR Preview 以每 PR 獨立 Compose project name、DB、Redis 與 storage volume 建立；不要掛 production volume，不提供 production SMTP 憑證。新 preview 使用 Mailpit 或 disabled，公開 preview 需存取控制；關閉 PR 後再清除該 preview 的資源，避免跨 PR 使用同名 volume。

## 遷移與回滾

部署前備份資料庫及資產。先在隔離環境套用 `pnpm db:migrate`，驗證，再在維護窗口執行正式 migration。`prisma migrate deploy` 只套用已提交的 migration，不在 production 使用 `db push` 或自動重建 schema。

程式可回到前一鏡像，但資料庫 schema rollback 不保證相容。破壞性變更採 expand／migrate／contract；需要回復資料時依 [BACKUP_RESTORE.md](BACKUP_RESTORE.md) 還原已核對的 DB 與資產組，不只退回 Git。
