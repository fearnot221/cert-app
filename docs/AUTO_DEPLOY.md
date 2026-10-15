# main 自動部署

正式主機：`fearnot@140.115.154.89`，checkout：`/home/fearnot/cert-app`，固定 Compose project：`cert-app-production`。`main` 是 GitHub 預設分支；PR merge 與直接 push 都會觸發 CI。CI 全部通過後，GitHub `workflow_run` webhook 通知 `https://cert.fearnot.tw/_deploy/github`，伺服器更新到該版本。CI 失敗、其他分支、其他 workflow、fork 與 PR 測試結果均不部署。

## 行為與檔案

- 既有 Caddy 代理到 Unix socket；不公開額外 TCP port，不新增 Docker Compose 檔或 webhook container。
- Python 標準函式庫 receiver 是 `fearnot` 的 systemd user service，啟用 linger 後開機啟動。服務透過 `sg docker` 取得已有的 Docker 群組權限，即使 user manager 早於群組設定啟動也可執行。
- 使用 GitHub HMAC-SHA256 原始 body 簽章；secret 在 `~/.config/cert-app-deploy.env`，權限 600，與應用 `.env` 分開。
- 單一 `.runtime/deploy/state.json` 原子覆寫，持久記錄待部署版本、最後成功 SHA、CI run number 與最近錯誤。只有固定名稱的 lock、socket 與短暫 `state.tmp`，不產生每次部署副本、stash 或備份。
- 單一 worker 與 `flock` 防止併行；重複通知及較舊 CI 結果會略過。服務重啟後繼續未完成工作；失敗每 60 秒重試，錯誤寫入 journal。
- fetch `origin/main`，只部署仍為 main HEAD 的已通過 CI SHA；建置完再檢查一次，若有更新則等待新版本自己的 CI。
- checkout 有本地改動就停止並記錄錯誤，不強制覆寫。`.env`、`deploy/certs/`、`.runtime/` 都已忽略，持續保留。
- runtime 共用 `cert-app-production-runtime:latest`，web 使用 `cert-app-production-web:latest`。每次只建置這兩個目標；沿用原專案的容器、網路與資料 volumes。
- 建置成功後以 `run --rm` 執行 migration，再更新 API／worker／web，檢查 health、Caddy reload 與真實 PDF 產生。migration 無自動資料回滾，故障時查看 journal。
- 成功後移除舊的停止 migration 容器、已無容器引用的本專案舊應用 images；以專屬 label 清理本應用中斷建置留下的 dangling images，並以 `docker builder prune --keep-storage 1GB` 限制閒置 build cache。此 cache 清理作用於專用主機的預設 builder；不 prune volumes、不刪 DB／Redis／storage，不建立備份。

## 安裝／修復

主機需要 Python 3.10+、Git、Bash、flock、Docker Compose（支援 `--wait`）與讀取 GitHub repository 的權限。目前 public repository 不需要額外 Git deploy key。

```bash
cd ~/cert-app
mkdir -p ~/.config/systemd/user .runtime/deploy
chmod 755 .runtime .runtime/deploy
install -m 644 deploy/cert-app-deploy.service ~/.config/systemd/user/cert-app-deploy.service
loginctl enable-linger
```

只在尚未建立時產生 secret；重新安裝不可覆蓋它，以免與 GitHub 設定不一致：

```bash
python3 - <<'PY'
import os, secrets
from pathlib import Path
p = Path.home() / '.config/cert-app-deploy.env'
if not p.exists():
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('DEPLOY_REPO=/home/fearnot/cert-app\n')
        f.write('DEPLOY_PROJECT=cert-app-production\n')
        f.write('GITHUB_REPOSITORY=fearnot221/cert-app\n')
        f.write('GITHUB_WEBHOOK_SECRET=' + secrets.token_hex(32) + '\n')
PY
systemctl --user daemon-reload
systemctl --user enable --now cert-app-deploy
docker compose -p cert-app-production -f compose.production.yaml up -d --no-deps caddy
```

GitHub repository Settings → Webhooks 使用上述 HTTPS URL、`application/json`、同一 secret、啟用 SSL verification，只訂閱 **Workflow runs**。安裝時先列出已有 hook，更新相同 URL 的 hook，避免重複建立。receiver 接受符合 `.github/workflows/ci.yml` 的成功 push run，無需把 GitHub API token 放進主機。

若部署服務本身的 Python 程式有變更，部署完成後執行 `systemctl --user restart cert-app-deploy` 載入新程式；持久 queue 可恢復中斷工作。

## 查驗與暫停

```bash
systemctl --user status cert-app-deploy
journalctl --user -u cert-app-deploy -n 100 --no-pager
cat ~/cert-app/.runtime/deploy/state.json
git -C ~/cert-app rev-parse HEAD
docker compose -p cert-app-production -f ~/cert-app/compose.production.yaml ps
```

GitHub webhook Recent Deliveries 可重送相同的成功 run；已成功版本會回應 200 並略過。故障請依 journal 修正，待部署工作會自動重試。暫停接收與部署：`systemctl --user stop cert-app-deploy`；`start` 恢復。
