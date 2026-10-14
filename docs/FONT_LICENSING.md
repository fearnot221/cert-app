# 字型來源、授權與 Canva 可行性

查核日期：2026-10-15。Phase 1 使用隨 repository 提供的 Noto Sans TC 與芫荽 Iansui 字型檔、授權檔及來源 metadata；**沒有 Canva 字型檔下載、Canva OAuth 或 Canva API 串接**。

## 內建字型

| 項目 | 內容 |
| --- | --- |
| 家族 | Noto Sans TC，包含繁體中文與拉丁字元 |
| 檔案 | `packages/renderer/fonts/NotoSansTC-wght.ttf` |
| 授權 | SIL Open Font License 1.1，隨檔保存 `OFL.txt` |
| 來源 | Google Fonts 官方 `ofl/notosanstc`；來源 metadata 隨 repository 保存 |
| 版本識別 | 檔案 SHA-256 及 renderer version；不得僅以家族名稱表示版本 |
| 支援判斷 | 使用實際 font cmap／檔案載入結果驗證；缺字必須阻止產製 |

OFL 容許使用、嵌入及在符合條件下隨軟體散布，要求保留授權與著作權聲明；不代表任何其他商業字型也有同樣權利。[本字型的官方 OFL](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/OFL.txt)

Google Fonts 提供可用於網站的字型與開發資源，但每個內建資產仍保存自己的授權，而非把「在 Google 找到」當授權證據。[Google Fonts 官方入口](https://developers.google.com/fonts)

前端、伺服器樣張及 PDF 必須使用同一檔案版本。只有瀏覽器顯示成功不足以驗證伺服器有相同字型；不允許以系統預設 sans-serif 靜默替代。

## 芫荽 Iansui（已內建）

依使用者指定，從[作者官方 repository](https://github.com/ButTaiwan/iansui) 取得，不經 Canva 下載。固定來源 commit `9d9a8e68bf1e138dd91e562eeff28d95bca33196`，檔案 `packages/renderer/fonts/Iansui-Regular.ttf`，SHA-256 `7f1aa62e9dcbf40d0ce41a5d3f1e5ea602e66c295778ac6fefb6b84d8ed08bd5`。同目錄保存 `Iansui-OFL.txt` 與 `Iansui-SOURCE.txt`，隨系統散布。

芫荽依 SIL OFL 1.1 允許商用與隨軟體提供；保留原始檔與授權。本次只有實際提供的 Regular 400，不提供合成粗體。編輯器選取文字後可選「芫荽 Iansui」；畫布、伺服器預覽與產證共用相同 bytes。發布 manifest 記錄芫荽的版本與 SHA-256；缺字與檔案完整性錯誤阻止產證。既有僅使用 Noto 的發布版本與 PDF 不變。

真實 Chromium 測試已驗證繁中／英數 glyph coverage、混合 Noto 與芫荽的 PDF 嵌入、Unicode mapping；瀏覽器 E2E 選擇芫荽後完成發布、預覽、worker 產證及私人下載。

## 組織上傳（Phase 2，尚未提供）

規劃支援 TTF、OTF、WOFF2。FontAsset 記錄 organizationId、family、weight、style、檔案 MIME／雜湊、版本、來源、license text/reference、上傳者、授權確認時間、可用／停用狀態。

上傳者需明確確認授權涵蓋網站載入、伺服器產製與 PDF 嵌入；僅桌面授權不自動涵蓋這些用途。檢查實際內容與字型表、檔案大小、解析時間／記憶體上限、embedding restrictions；技術旗標不能代替授權契約。

停用字型阻止新模板發布，但保留已發證書的資產及 PDF。組織常用字型、分類搜尋、實際字重列表、即時預覽、缺字訊息都以本組織合法可用資產為來源，不能列出沒有檔案或權利的假選項。

## Canva 的邊界

「Canva 也有的開源字型」可由原作者／Google Fonts 合法取得，依該獨立授權在本系統使用。Canva 專屬、Pro 或另有商業限制的字型則需另行確認授權，不能爬取 Canva 網頁資源、匯出底層字型，或把 Pro 訂閱等同於網站散布及伺服器授權。

Canva Apps 的字型 API 在 Canva 設計內操作 font reference；官方列出限制：不能下載底層檔案、不能存取 Pro 字型、不能上傳自訂字型。因此該 API 不是獨立 PDF worker 的字型供應 API。[Canva 字型 API](https://www.canva.dev/docs/apps/fonts/)

合法從 Canva 匯出的背景圖可以作為本系統圖片素材，但其內文字已成為圖片內容，不能宣稱能自動恢復文字物件。Canva 內容授權依內容類別與使用方式而異，訂閱不給予任意獨立散布內容的權利；上傳者仍需確認其匯出設計與實際用途符合授權。[Canva 內容授權](https://www.canva.com/policies/content-license-agreement/)

## 官方整合可行性（研究，未實測）

目前官方文件將 Apps SDK／Connect API 統整到 Canva Developers SDK；原 Connect 路徑會轉到 REST APIs 文件。可研究由使用者 OAuth 授權，選擇可 autofill 的 Canva 模板、填入欄位，再讓 Canva 自己匯出 PDF。這是另一條渲染流程，不能假稱與本地 HTML renderer 完全相同。

官方 autofill 指南目前列出 Pro（含 Education／Nonprofits）、Teams、Enterprise 等支援方案，開發帳號須啟用 MFA。指南需要 design:content 讀寫、design:meta 讀取、brandtemplate:meta／content 讀取與 asset 讀寫等 scopes；實作時按實際端點縮限。方案、使用額度和模板權限仍需用實際帳號驗證。[Autofill 指南](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/)、[OAuth 文件](https://www.canva.dev/docs/apps/rest-apis/authentication/)

PDF export 是非同步 job，需 `design:content:read`；下載 URL 短效，且可能因授權不足或審核未完成而失敗。外部匯出要等待成功後保存到私有 storage，記錄外部 design／export job 與模板版本，遵守當時速率限制。[Export API](https://www.canva.dev/docs/apps/rest-apis/reference/exports/create-design-export-job/)

待驗證項目：實際帳號方案、OAuth app 建立與審核、最小 scopes、品牌模板填值權限、繁中與長文字版面、指定字型可用性、PDF 匯出限制及內容授權。驗證完成前 UI 不顯示「完整支援 Canva 字型」，背景圖上傳也不命名為 Canva API 整合。
