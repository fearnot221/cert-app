# 開發與接手

先讀 [交接入口](docs/HANDOFF.md)、[已知問題](docs/KNOWN_ISSUES.md) 與 [改善計畫](docs/ROADMAP.md)。狀態與實測以 [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) 為準。

- 以 `codex/` 或團隊核准的功能分支開發，變更以 PR 交付。
- 保留租戶隔離、不可變 PDF／快照、稽核與 row lock 規則。
- migration 必須增量新增，不修改已套用 migration；不要在共享資料庫 reset。
- 提交前跑適合變更的測試，權限／生命週期／worker 變更需 integration；使用獨立 `_test` DB。
- 寫清楚問題、行為變更、測試結果與未驗證項目，並同步文件。
- 不提交環境密鑰、私人檔案、測試名單或個資。需要測試資料時用 example.test 與唯一 fixture。
