# 公開驗證、QR Code 與期限

## 使用流程

1. 模板編輯器 →「公開驗證 QR Code」，開關並設定 X、Y 與尺寸（20–80 mm）。新模板預設開啟；舊模板可在草稿啟用後發布新版本。預覽樣張使用 `/verify/preview`，不能作為有效證書。
2. 建立活動可設定「證書到期日」，留空為無到期日。日期以 Asia/Taipei 當日 23:59:59.999 為截止點。
3. 正式產製使用每張證書自己的 publicId 與驗證網址；背景工作、樣張與網頁使用同一 SVG QR 元件。QR 有 4 modules 白邊與 M 錯誤修正。請在紙本檢查對比、尺寸與遮擋。
4. 活動收件人列與「我的證書」可開啟公開驗證、複製連結、下載 QR SVG。舊 PDF 不會被修改，未嵌 QR 的舊證書仍可使用獨立驗證連結／SVG。
5. 管理員可「管理期限」，填寫原因後設定、縮短、延長或移除期限；補發時也可設定新版期限。到期判定依伺服器時間即時計算，不依賴午夜排程。PDF 不會因期限變動而重寫，驗證頁為最新期限來源。

已發放證書仍引用其原模板版本。要把未含 QR 的舊模板改成含 QR 的版面，需發布新模板版本並建立新活動；目前補發不提供更換模板版本。

## 公開資料與狀態

`GET /api/public/certificates/:publicId` 不需登入；每 IP 每分鐘 60 次。沒有公開名單、Email 搜尋或公開 PDF 下載。

只提供證書編號、組織／活動、遮罩姓名、發證時間／日期、期限、版本、狀態、是否已有後繼版本及查詢時間。後繼版本的驗證 token 不公開；更換收件人時不會透過舊連結暴露新人的連結。完整姓名及 Email 不公開。

- valid：有效且成功產製，未過期。
- expired：資料庫業務狀態仍為 valid，但目前時間已達期限。
- revoked：撤銷；即使日期未到或已有後繼版本也不恢復有效。
- superseded：原本有效的證書已被補發版本取代。
- unavailable：組織停用，無法確認有效性。
- 未產製成功／不明 publicId：404，不推論為有效。

公開結果與 API 回應為 `no-store`，使用 noindex／nofollow／noarchive 與 no-referrer；頁面每 30 秒更新，也可手動重新驗證。短暫斷線時明確標示上次查詢結果。這些指令不保證第三方不保存已分享的資料。

## 權限與資料

Migration 006 新增活動預設 expiresAt、證書 expiresAt／revision、期限索引與 publicId 不可變 trigger。到期日不是 PDF 的可變快照欄位。

`POST /api/organizations/:org/certificates/:id/expiry` 需要 certificates.issue + certificates.revoke、CSRF、revision、reason。與取消／補發共用活動 row lock，變更與完整 before／after audit 同 transaction。撤銷／被取代／取消活動不能透過續期解除失效。

到期後單張 PDF、ZIP、通知 API 都拒絕使用；worker 寄送前再檢查。已開始 SMTP 的郵件無法收回，已下載的 PDF 也無法遠端刪除。成功產製的過期 PDF 保留私有檔案供稽核。

## 部署注意

目前 demo 為 `http://localhost:5173`。這是可在本機測試的公開路由，尚未部署到 Internet；手機掃 localhost 會指向手機自己。

正式產製前將 APP_ORIGIN 設為穩定 HTTPS 網域，設定 TLS／反向代理並驗證手機掃描。驗證網址固定在 PDF 快照中，換網域時必須保留舊域名與路徑相容性。不能透過重寫舊 PDF 遷移網址。狀態頁不是 PKI 數位簽章或對外第三方認證。

## 驗證方法

測試包含實際 Chromium PDF → Poppler PNG → jsQR 解碼，確認掃出的 URL 與預期完全相同；不是只檢查 SVG 存在。需要系統安裝 `pdftoppm`（macOS：Poppler；Ubuntu：poppler-utils）。另涵蓋匿名存取、最小公開欄位、到期邊界、續期並行衝突、下載／寄送拒絕、舊連結被取代及公開頁手機版。

QR 實作參考：[node-qrcode 官方文件](https://github.com/soldair/node-qrcode)。
