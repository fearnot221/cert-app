# 改善計畫、Enhancements 與待實作功能

更新：2026-10-15。優先度 P0 是對外上線前必要項目；P1 是下一輪產品改善；P2 是後續擴充。這是建議順序，不代表已承諾時程。每項工作先開 issue，寫驗收條件與資料遷移影響，再實作。

## 建議接手順序

1. 依 HANDOFF.md 建立乾淨環境，確認 seed、38 項 integration（含 worker 演練）、24 項 unit／renderer 與 3 條 browser flow。
2. ~~修復 KNOWN_ISSUES 的 BUG-001、BUG-002~~（2026-10-14 已完成 API 與回歸測試；後台 UI 仍需接上「重試失敗通知」與顯示 send 回傳的排隊／略過數）。
3. 完成 P0 部署前工作，取得真實網域／SMTP／備份環境，才進入對外試營運。
4. 優先交付到期儀表板／提醒與名單維護，再擴充編輯器和大型批次。

## P0：對外上線前

| 工作 | 主責角色／依賴 | 完成驗收 |
| --- | --- | --- |
| HTTPS 與穩定驗證網域 | DevOps；DNS／主機權限 | APP_ORIGIN 指向正式 HTTPS；外部手機掃新 PDF QR 正常；舊網址有長期保留策略；非 localhost |
| Production 設定與私密資料 | DevOps／後端 | 移除預設帳密；secret manager、DB／Redis 網路隔離、最小 DB 權限、私有檔案、cookie secure、CSP／代理設定驗收 |
| 備份／還原演練 | DevOps／DBA | 在隔離環境還原 DB + PDF + 字型／素材，驗證 SHA 與關聯；記錄實測 RPO／RTO；不要假定 migration 可回滾 |
| 正式寄件 provider | 後端／網域管理員 | 加密憑證、verified sender、TLS、DNS SPF／DKIM／DMARC、配額；真實接受／拒絕／中斷演練，不盲重寄 unknown |
| 公開端點流量與濫用 | 後端／DevOps | 明確 trusted proxy，IP 限流在反向代理後正確；跨副本共享限流；錯誤率／延遲監控；無批次公開枚舉 |
| CI 與依賴維護 | 維護者 | 必要 checks 作為合併條件；固定版本與 action SHA；依賴漏洞審查；測試產物保留但不暴露個資／token |

## P1：下一輪可交付的增強

| 工作 | 類型 | 驗收條件 |
| --- | --- | --- |
| 失敗通知重試與真實提交數 | Bug fix + enhancement | API 已完成（見 KNOWN_ISSUES BUG-002）；剩後台 UI：重試按鈕與理由輸入、顯示 queued／skipped、逐封原因與重試歷程 |
| 效期儀表板與批次續期 | Enhancement | 跨頁查詢已到期／7、30、90 天內到期；選取批次修改，逐張 revision 衝突報告與理由，權限／audit 完整 |
| 到期提醒排程 | 新 feature | opt-in、時區、提醒天數、收件人偏好、去重與退訂；排程延遲／重啟不重複寄送 |
| 活動名單維護 | Enhancement | 產製前新增／移除收件人、重新匯入差異預覽、欄位錯誤定位；生成後不得改既有快照 |
| 模板版本升級補發 | 新 feature | 操作者明確選新模板、重新預覽；新舊版關聯／理由完整，舊 PDF 不改寫；支援替舊證書補上新 QR 版面 |
| 公開驗證體驗 | Enhancement | 狀態變更與查詢過期提示、到期精確倒數、無障礙讀屏／鍵盤測試；選擇性持有人完整姓名授權，預設仍遮罩 |
| QR 版面檢查 | Enhancement | 和文字／紙張邊界碰撞提示、足夠 quiet zone；印表機／手機掃描矩陣；長網域低解析輸出仍可掃 |
| 稽核閱讀體驗 | Enhancement | 將 raw JSON before／after 改成欄位差異、關聯跳轉、操作者快照、時間／操作篩選與分頁；保留資料庫 append-only |
| 多瀏覽器與可及性 | 品質改善 | Chromium／Firefox／WebKit、390px、200% zoom、鍵盤焦點／錯誤關聯／讀屏；真實列印視覺比對 |

## P2：尚未加上的功能

- 完整模板編輯器：圖片／圖形、拖曳縮放與旋轉手柄、圖層排序／鎖定／隱藏、對齊吸附、Undo／Redo、自動儲存、可管理的自訂欄位。已有文字與固定驗證 QR，不代表一般圖形／任意 QR 已支援。
- 組織字型上傳：授權聲明、格式限制、掃描、版本/hash、嵌入權限與缺字預檢。已有芫荽與 Noto；無 Canva OAuth／素材或字型匯入。
- 成員／角色管理 UI + API、邀請、最後 Owner 保護、移轉所有權、自訂角色、管理員 MFA、登入中的改密碼、session 管理。
- 大型作業：超過 100 筆匯入、串流解析、背景 ZIP、進度／取消／下載保存期限、S3 私有 bucket 與短效簽名、多副本 worker／配額。
- 發證活動獨立模型：跨多個 batch 的事件、業務唯一鍵、重複發證政策；目前 IssuanceBatch 即操作活動。
- 郵件品牌模板、退信／webhook／投遞狀態、帳號郵件管理畫面、DNS challenge 精靈與共用寄件網域授權。
- 驗證增強：PKI PDF 簽章、PDF 檔案 hash 上傳比對、簽發單位身分認證、驗證分享權限／撤回策略。現在僅驗證系統發證紀錄。
- 營運：OpenTelemetry／metrics、告警、操作追蹤 ID、孤立 PDF／outbox／token 清理政策（不得破壞歷史及稽核）、資料保留／刪除與個資治理程序。
- 國際化、跨頁收件人搜尋、CSV／XLSX 大量錯誤逐欄修正、多組織操作切換體驗。

## 技術債改善順序

1. 保留現有整合測試，逐步將 routes.ts 的業務 transaction 拆成可測的 domain services；不要在重構時改授權邊界。
2. 導入格式化與 PR 模板、資料庫 migration review checklist；統一共用生命週期型別與 API 回應 schema，避免前後端 status 分歧。
3. 將實作策略字串化的 status 收斂為共享型別／允許轉移矩陣；保留舊資料遷移路徑，避免直接硬改 PostgreSQL enum。
4. 補 cursor pagination 與狀態查詢索引；先做 EXPLAIN／量測，再擴大負載。
5. 在專用環境執行 1,000 筆 benchmark，記錄 PDF p50/p95、RAM、queue latency、失敗率；依數據設計串流及併發。

## 每項 issue 應包含

問題／使用情境、現在行為、目標行為、權限／租戶影響、資料遷移與 rollback／備份策略、競態／失敗路徑、驗收測試、部署依賴。對已知問題使用 KNOWN_ISSUES 的 ID；修好後記錄實際版本／測試，勿直接刪掉歷史背景。
