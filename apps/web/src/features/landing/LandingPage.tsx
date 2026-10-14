import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { createDefaultDocument } from "@cert/contracts";
import { CertificateView } from "@cert/renderer";
import { homePath, useSession } from "../../app/session";
import { Wordmark } from "../../ui/feedback";
import { TemplateThumb } from "../templates/TemplateThumb";
import { useReveal } from "./useReveal";

const sampleDocument = createDefaultDocument();
const { verificationQr: _qr, ...documentWithoutQr } = sampleDocument;
const placeholders = Object.fromEntries(
  ["recipient_name", "organization_name", "event_name", "issue_date", "certificate_number"].map((key) => [key, `{{${key}}}`]),
);
const filled = {
  recipient_name: "王小明",
  recipient_email: "xiaoming@example.org",
  organization_name: "知行培訓中心",
  event_name: "2026 秋季專業培訓",
  issue_date: "2026-10-15",
  certificate_number: "CF-2026-000128",
};

/** The same certificate, four moments in its life: template, list, PDF, verified. */
const moments: { clause: ReactNode; data: Record<string, string>; tag?: string; field: string }[] = [
  { clause: <>先在模板放好<br />姓名、活動與日期欄位。</>, data: placeholders, field: "moment-issue" },
  { clause: <>再匯入名單，<br />每一列帶入一位收件人。</>, data: filled, tag: "名單第 2 列", field: "moment-verify" },
  { clause: <>然後逐人產製 PDF，<br />寄出領取通知。</>, data: filled, tag: "PDF 已產製", field: "moment-verify-strong" },
  { clause: <>最後，任何人掃 QR<br />都能查到真偽。</>, data: filled, tag: "證書目前有效", field: "moment-ink" },
];

const points: { title: string; body: string }[][] = [
  [
    { title: "不可變的模板版本", body: "發布後鎖定版本，之後修改只影響草稿，已發證書保持原樣。" },
    { title: "Excel 與 CSV 名單", body: "沿用自己的欄位名稱，系統自動對應並保留原始列號。" },
    { title: "產製前先看樣張", body: "每位收件人都能預覽伺服器產出的 PDF，確認字型與版面。" },
  ],
  [
    { title: "ZIP 與失敗報告", body: "一次下載全部成功的證書，失敗項目匯出 CSV 方便更正。" },
    { title: "撤銷與重新發放", body: "補發會產生新編號與新 PDF，舊證書立即失效。" },
    { title: "有效期限管理", body: "到期日以台北時間計算，公開驗證頁即時顯示最新期限。" },
  ],
  [
    { title: "只能新增的稽核紀錄", body: "誰在何時做了什麼都留存，資料庫層級禁止修改。" },
    { title: "多組織與角色權限", body: "設計、發證、稽核分開授權，知道網址不等於有權限。" },
    { title: "收件人自己的入口", body: "收件人啟用帳號後，在手機上也能下載與分享證書。" },
  ],
];

function parseVerification(input: string) {
  const value = input.trim();
  if (!value) return null;
  const fromUrl = value.match(/\/verify\/([^/?#\s]+)/);
  if (fromUrl) return decodeURIComponent(fromUrl[1]!);
  return /^[A-Za-z0-9_-]{8,}$/.test(value) ? value : null;
}

function VerifyForm() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const id = parseVerification(value);
    if (!id) {
      setError("請貼上完整的驗證連結，或證書 QR Code 裡的驗證代碼。");
      return;
    }
    navigate(`/verify/${encodeURIComponent(id)}`);
  };
  return (
    <form className="hero-verify" onSubmit={submit} id="verify" noValidate>
      <label className="sr-only" htmlFor="verify-input">
        驗證連結或驗證代碼
      </label>
      <input
        id="verify-input"
        className="hero-verify-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        placeholder="貼上證書的驗證連結"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="verify-help"
        aria-invalid={!!error}
      />
      <button className="btn hero-verify-button" type="submit">
        查詢真偽
        <ArrowRightIcon aria-hidden />
      </button>
      <p id="verify-help" className={error ? "hero-verify-help is-error" : "hero-verify-help"} role={error ? "alert" : undefined}>
        {error || "不必登入。查詢結果只顯示遮罩後的姓名與證書狀態。"}
      </p>
    </form>
  );
}

function Certificate({ data, withQr }: { data: Record<string, string>; withQr: boolean }) {
  return (
    <TemplateThumb widthMm={sampleDocument.widthMm} heightMm={sampleDocument.heightMm}>
      <CertificateView
        document={withQr ? sampleDocument : documentWithoutQr}
        data={{ ...data, verification_url: "preview" }}
        assetUrls={{}}
        fontUrl="/api/fonts/noto-sans-tc"
      />
    </TemplateThumb>
  );
}

export function LandingPage() {
  const { session } = useSession();
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  useEffect(() => {
    document.title = "certfolio · 證書工作室";
  }, []);
  const signedIn = !!session;
  const enter = signedIn ? homePath(session) : "/login";
  return (
    <div className="landing" ref={root}>
      <a className="skip-link" href="#main-content">
        跳到主要內容
      </a>
      <header className="landing-bar">
        <Wordmark />
        <nav aria-label="首頁導覽" className="landing-links">
          <a href="#how">運作方式</a>
          <a href="#features">功能</a>
          <a href="#verify">驗證證書</a>
        </nav>
        <Link to={enter} className="btn btn-sm landing-enter">
          {signedIn ? "進入工作空間" : "登入"}
        </Link>
      </header>

      <main id="main-content">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-seals" aria-hidden>
          <span className="seal seal-issue" />
          <span className="seal seal-verify" />
        </div>
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-title">
            證書真偽，
            <br />
            一查就知。
          </h1>
          <p className="hero-lead">
            組織在這裡設計模板、批次產製 PDF 並寄出通知；每張證書都附上公開驗證連結與 QR Code。
          </p>
          <VerifyForm />
        </div>
      </section>

      <section className="moments" id="how" aria-labelledby="moments-title">
        {moments.map((moment, index) => (
          <article key={moment.field} className={`moment ${moment.field}`} data-reveal-group>
            {index === 0 && (
              <h2 id="moments-title" className="moment-title" data-reveal>
                一張證書的四個時刻
              </h2>
            )}
            <div className="moment-card" data-ui data-reveal>
              <Certificate data={moment.data} withQr={index === moments.length - 1} />
              {moment.tag && <span className="moment-tag">{moment.tag}</span>}
            </div>
            <p className="moment-clause" data-reveal>
              {moment.clause}
            </p>
          </article>
        ))}
      </section>

      <section className="features" id="features" aria-labelledby="features-title">
        <figure className="features-figure" data-shutter>
          <img
            src="/landing/workspace-batch.webp"
            alt="certfolio 發證活動頁：收件人表格列出產製狀態、證書編號與 PDF 操作"
            width={1600}
            height={1600}
            loading="lazy"
          />
        </figure>
        <div className="features-copy">
          <h2 id="features-title" data-reveal>
            發證會遇到的事，
            <br />
            都先想好了
          </h2>
          <div className="features-grid">
            {points.map((column, columnIndex) => (
              <ul key={columnIndex} className={`features-column features-column-${columnIndex}`}>
                {column.map((point) => (
                  <li key={point.title} data-reveal>
                    <h3>
                      <span className="seal-dot" aria-hidden />
                      {point.title}
                    </h3>
                    <p>{point.body}</p>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>

      <section className="statement" aria-label="從名單到證書">
        <p data-reveal>
          從一份名單
          <img className="inline-shot" src="/landing/inline-list.webp" alt="" width={240} height={240} loading="lazy" />
          、一張模板
          <img className="inline-shot" src="/landing/inline-editor.webp" alt="" width={240} height={240} loading="lazy" />
          ，到每個人手上都能被驗證的證書
          <img className="inline-shot" src="/landing/inline-verify.webp" alt="" width={240} height={240} loading="lazy" />
          。
        </p>
      </section>

      <Link to={enter} className="cta-band" aria-label={signedIn ? "進入工作空間" : "登入 certfolio"}>
        <span className="cta-note">
          {signedIn ? "回到你的組織工作空間。" : "已經收到啟用信？登入後就能下載你的證書。"}
        </span>
        <svg className="cta-arrow" viewBox="0 0 48 48" aria-hidden>
          <path d="M14 34 34 14M18 14h16v16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className="cta-word">{signedIn ? "進入" : "登入"}</span>
      </Link>
      </main>

      <footer className="landing-foot">
        <div className="foot-mark" aria-hidden>
          <span className="foot-seal foot-seal-issue" />
          <span className="foot-seal foot-seal-verify" />
          <span className="foot-seal foot-seal-strong" />
          <span className="foot-seal foot-seal-ink" />
          <span className="foot-word">certfolio</span>
        </div>
        <div className="foot-links">
          <div>
            <h3>發證組織</h3>
            <Link to="/login">登入工作空間</Link>
            <a href="#how">運作方式</a>
            <a href="#features">功能</a>
          </div>
          <div>
            <h3>收件人</h3>
            <Link to="/me">我的證書</Link>
            <Link to="/login">啟用與登入</Link>
          </div>
          <div>
            <h3>驗證</h3>
            <a href="#verify">查詢證書真偽</a>
          </div>
          <p className="foot-note">
            公開驗證只顯示發證紀錄與遮罩姓名，不提供私人 PDF 或 Email。
            <br />
            首頁圖片均為 certfolio 本身的介面與證書輸出畫面。
          </p>
        </div>
        <div className="foot-base">
          <span>© {new Date().getFullYear()} certfolio 證書工作室</span>
          <a className="btn btn-sm btn-quiet" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0 }); }}>
            回到頂端
          </a>
        </div>
      </footer>
    </div>
  );
}
