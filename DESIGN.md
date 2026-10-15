# 介面設計規範

2026-10 前端改版後的設計決策，視覺方向取自 sta-tw.org（暖墨色、淡黃與淡綠色塊、襯線標題），並用 taste-skill 的 house rules 檢查。隨實作更新。

## 工作重心

使用者進來是要選擇正確組織、製作模板、檢查名單、生成證書和確認通知。畫面優先呈現目前工作、狀態、錯誤與下一個明確動作，不展示虛構統計或假成功活動。

登入後使用頂部導覽列：品牌、組織切換與角色、主要導覽（證書模板、發證活動、郵件紀錄、稽核紀錄，依權限顯示）、「我的證書」與登出。內容區最寬 1360px；模板編輯器使用全寬工作區。未實作能力顯示階段說明，不放能點擊卻沒有作用的控制項。

## 前端架構

- 路由：React Router data router（`apps/web/src/app/router.tsx`）。公開頁面為 `/`、`/login`、`/activate`、`/reset-password`、`/verify`、`/verify/:serial`、`/download`；登入後為 `/me` 與 `/:orgSlug/{templates,templates/:id,batches,batches/new,batches/:id,deliveries,audit,settings}`（例如 `/zhixing/templates`）。舊網址 `/o/:orgId/*`、`/workspace`、`/certificates`、`/my-certificates` 轉址。
- 伺服器狀態：TanStack Query，一個快取以 API path 為 key（`src/lib/hooks.ts`）。任何寫入動作完成後會讓非 session 的快取失效，避免列表顯示舊資料。
- 結構：`src/app`（session、外框、路由）、`src/features/<領域>`（auth、landing、templates、batches、records、recipient、verification）、`src/ui`（按鈕與回饋元件）、`src/lib`（API、格式化、型別）、`src/styles`（tokens 與各區樣式）。
- 模板編輯器離開前若有未儲存變更，以 `useBlocker` 與 `beforeunload` 確認。

## 基礎樣式

產品名稱為 certfolio／證書工作室。所有 token 定義在 `apps/web/src/styles/tokens.css` 的 Tailwind v4 `@theme`。

| Token | 值 | 用途 |
| --- | --- | --- |
| ground | #ffffff | 頁面底色 |
| surface／surface-strong | #f5f4f1／#ebe9e4 | 面板、次要按鈕、停用狀態 |
| ink | #363535 | 主要文字與主要按鈕 |
| muted | #6b6968 | 說明與 metadata |
| issue | #ffe184 | 發證印記、選取、焦點環 |
| verify／verify-strong | #d9edbf／#badaaf | 驗證印記、成功狀態 |
| danger | #b4372f | 錯誤與危險動作 |
| 圓角 | 14px／28px／999px | 欄位／面板／按鈕與標籤 |
| 字型 | Noto Serif TC 400／Noto Sans TC | 標題／內文（@fontsource 自帶，不連外部 CDN） |

視覺母題是兩枚重疊的圓形印記（黃色代表發證、綠色代表驗證，multiply 疊色），用在品牌、首頁、登入、驗證結果與空狀態。網站圖示（`apps/web/public/favicon.*`、`apple-touch-icon.png`、`icon-192/512.png`）是同一對印記放在墨色圓角方塊上，在淺色與深色分頁列都清楚；重疊處固定為 #d9d163，不依賴 blend mode。版面不使用陰影（對話框除外）、漸層、玻璃效果與裝飾分隔線；區塊以色塊、留白與字級區分。

## 下拉選單、穩定版面與流水號

- 下拉選單一律使用 `src/ui/Select.tsx`（WAI-ARIA select-only combobox），清單以站內樣式繪製：白底、18px 圓角、浮起時才有陰影，目前選項以黃色印記圓點標示，可用方向鍵、Home/End、字首搜尋與 Esc 操作；空間不足時向上展開。不再使用原生 `<select>`。
- 桌面寬度保留捲軸空間（`scrollbar-gutter: stable`），切換長短頁面時版面不左右位移；平滑捲動只用於首頁錨點。模板編輯器高度剛好填滿導覽列以下的空間，訊息浮在畫布上方而不推動三欄。
- 證書流水號由名單提供（組織內不可重複，NFKC＋大寫正規化）。查詢頁把流水號放在第一個、以襯線大字顯示，方便與紙本比對。「組織設定」只管理工作空間網址代稱。
- 模板動態欄位分兩組：內建欄位（姓名、Email、證書流水號、組織名稱、活動名稱、發證日期）永遠存在、不能刪除；自訂欄位可新增、改名與刪除（仍被文字使用時不能刪）。圖層以欄位名稱顯示，例如〔課程時數〕。
- 背景畫質：圖片背景以原尺寸無損（PNG）保存與嵌入證書，不縮圖、不再壓縮。PDF 背景取第 1 頁，以 `pdftocairo` 重繪成乾淨的單頁向量 PDF（去除腳本、表單與連結），產證時直接墊在證書底下，線條與文字放大仍清晰；編輯器與縮圖另用最高 300 DPI 的 PNG 預覽。
- 手機寬度的收件人表格改為一人一張卡片：姓名在前，其後是帶標籤的狀態與操作。

## 公開首頁

首頁 hero 即為真偽查詢：貼上驗證連結或代碼後導向 `/verify/:publicId`，不必登入。其後依序為「一張證書的四個時刻」（同一張證書在模板、名單、PDF、驗證四個色塊中）、功能要點、行內縮圖句、整條可點的登入色帶與頁尾大型印記。首頁圖片全部是本產品實際介面與證書輸出的截圖（`apps/web/public/landing`），不使用圖庫照片。進場動畫在 `prefers-reduced-motion` 下停用。

## 編輯器

左欄為元素／圖層，中間為紙張畫布，右欄為屬性。紙張比例依 mm 寬高，不依瀏覽器尺寸改版；畫布 zoom 不改變證書座標。選取框與拖曳手柄清楚，屬性欄可用鍵盤精確輸入位置、尺寸、文字、字級與對齊。

模板狀態區分草稿、已儲存、儲存中、儲存失敗、版本衝突及已發布。發布／正式生成需明確行為；自動儲存不能等同發布。伺服器 PDF 樣張入口靠近產製動作，提醒使用者以實際產出檢查。

## 表格與發證流程

輸入與驗證結果放在同一流程：保留原始列號、欄位和可操作錯誤。批次名稱、組織、模板版本及收件人數在確認產製／寄送時可見。產製進度與郵件進度分開，accepted 文案使用「已交付 SMTP，最終投遞狀態未知」。

數量使用 tabular numerals。顏色只輔助狀態，始終附文字或圖示；不能用單一綠點假稱成功。空資料應提供建立第一個模板／匯入名單的行動，不能放假樣本冒充正式資料。

## 文字、可及性與互動

預設繁體中文，功能名稱、日期格式及錯誤語氣一致。後台 UI 使用 Noto Sans TC，標題使用 Noto Serif TC；證書使用固定授權字型，用途分開。一般內容清楚緊湊，標題有層級，長識別碼允許換行。

按鈕、欄位、連結有可見焦點。icon-only 控制有 accessible name；表單有 label，錯誤和欄位關聯。鍵盤能完成登入、上傳、欄位輸入及提交。拖曳有數字欄位替代。對話框與錯誤提示不依賴 hover。

loading 防重複提交、success 反映伺服器結果、error 保留使用者輸入並提供 retry、disabled 解釋原因。危險動作的確認內容必須指出對象與影響，不使用模糊「確定嗎」。

## 手機收件人入口

登入、啟用、我的證書與下載在窄螢幕可用；表單欄位與主要按鈕可觸控，證書卡片顯示組織、活動、日期及業務狀態。頁面無橫向溢出，下載操作不依賴桌面 hover。後台編輯器可維持桌面工作區，但需提示螢幕空間需求。

## 視覺資產與界線

不使用未授權編輯器、商標、字型或假的 Canva 字型選單。使用者背景照原尺寸及版面規則呈現，低解析度警告不遮擋內容。背景上既有文字不會變成可編輯元素。開發 Mailpit 與未實作外部連線狀態必須清楚標示。
