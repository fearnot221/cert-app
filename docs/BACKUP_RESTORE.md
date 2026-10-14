# 備份、還原與資料保留

這是操作程序，尚未完成 production 還原演練。正式啟用前應記錄操作者、備份 ID、時間、檔案雜湊、恢復資料量及實際 RPO／RTO；未量測前不承諾數字。

## 一致備份

證書是 DB metadata 加私有資產，兩者必須配對。備份前停止新的寫入／生成／寄送，等待已開始工作結束，記錄未完成 outbox 與 unknown mail，再進行以下操作。示例假定使用本 repository 的 Compose project；正式請補上正確 env-file／overlay，且輸出目錄僅管理者可讀。

```bash
mkdir -m 700 -p backup
docker compose stop web api worker
docker compose exec -T postgres pg_dump -U cert -d cert_app -Fc > backup/database.dump
docker compose run --rm --no-deps --entrypoint tar api -C /data/storage -cf - . > backup/storage.tar
```

再以 SHA-256 記錄兩個備份檔的 hash，保存 migration version、image digest、rendererVersion、字型 hash 與備份時間。加密後複製到獨立故障域，驗證可讀後恢復 web／api／worker。這種停寫方式會造成維護時間；後續要降低停機需設計一致快照策略。

session secret、SMTP 加密金鑰、bucket credentials 與 TLS 資訊由獨立 secret store 備份，不放在 DB 備份旁或 repository。Redis 不作唯一事實來源；仍可保留 Redis 快照輔助診斷，還原應以 DB outbox／業務狀態重新對帳。

## 隔離還原演練

1. 建立與正式分離的 project、DB 與 storage volume，限制網路，強制 `MAIL_MODE=disabled`，不啟動 worker。
2. 檢查備份 hash。以 DB admin 將 dump 還原到空白測試庫；禁止在未確認的正式資料庫執行 clean／drop。
3. 將 storage.tar 解壓到隔離 volume，保留 api／worker 使用者的讀寫權限。
4. 使用相容版本 app 啟動 API，核對資料筆數、migration、每張抽樣 PDF／背景 SHA-256、字型版本與授權邊界。
5. 所有 sending／unknown delivery 保持待人工查驗，不能因還原就重新寄出。已 accepted 的通知不重寄；未完成 outbox 依業務狀態恢復。
6. 完成收件人存取負測試與 PDF 抽樣後才規劃正式切換；留下核對清單與回退路徑。

隔離 DB 的具體還原例（先自行建立 `cert_restore_test`）：

```bash
docker compose exec -T postgres pg_restore -U cert -d cert_restore_test --no-owner < backup/database.dump
```

不得把演練資料的信件寄給真實收件人，也不可將整庫備份暴露給單一組織。組織級還原需辨認全域 User 和其他租戶關聯，不能直接用整庫替換一個組織。

## 資料保留目標（需組織政策確認）

| 資料 | 建議處理規則 | 目前 |
| --- | --- | --- |
| 已發證書／版本／PDF／必要素材 | 依組織的發證保存期限，不因模板刪除而移除 | 沒有自動清理工作 |
| 批次原始名單 | 完成核對後依核准期限清理，快照保留最少必要欄位 | 尚需政策與清理任務 |
| 啟用／重設 token hash | 過期／消耗後依短期診斷政策刪除 | 驗證拒絕過期，清理另行實作 |
| Session | 過期即不可使用，定期清理 | 自動清理待補 |
| Delivery／Audit | 保留必要 actor、時間、狀態、message ID；不保存 secret | 保留期限待核准 |
| 備份 | 加密、存取控管、到期刪除及定期還原演練 | 尚未排程 |

此表是工程預設提案，不宣稱法律保存期限。組織停用／退出時需處理下載政策、資料匯出與刪除授權、共用帳號關聯及備份滾動過期。

## 日誌與敏感資料

access log 不記 token query／fragment，API 不回傳密碼 hash、SMTP secret 或 session secret；錯誤追蹤亦需遮罩 cookie、Authorization、token、個資及郵件 payload。稽核紀錄保存必要操作，不把完整 CSV 或明文 token 當 metadata。上線前需以測試 secret 搜尋實際 API、proxy、worker、analytics logs，確認遮罩有效。
