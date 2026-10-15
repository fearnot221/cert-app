import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { createDefaultDocument } from "@cert/contracts";
import { CertificateView } from "@cert/renderer";
import { homePath, useSession } from "../../app/session";
import { Wordmark } from "../../ui/feedback";
import { TemplateThumb } from "../templates/TemplateThumb";
import { useReveal } from "./useReveal";
import { SerialForm } from "../verification/SerialCheckPage";

const sampleDocument = createDefaultDocument();
const placeholders = Object.fromEntries(
  ["recipient_name", "organization_name", "event_name", "issue_date", "certificate_number"].map((key) => [key, `{{${key}}}`]),
);
const filled = {
  recipient_name: "王小明",
  recipient_email: "xiaoming@example.org",
  organization_name: "知行培訓中心",
  event_name: "2026 秋季專業培訓",
  issue_date: "2026-10-15",
  certificate_number: "STA-2026-0128",
};

/** The same certificate, four moments in its life: template, list, PDF, download. */
const moments: { clause: ReactNode; data: Record<string, string>; tag?: string; field: string }[] = [
  { clause: <>先在模板放好<br />姓名、流水號與日期欄位。</>, data: placeholders, field: "moment-issue" },
  { clause: <>再匯入名單，每一列<br />帶入姓名、Email 與流水號。</>, data: filled, tag: "名單第 1 筆", field: "moment-verify" },
  { clause: <>逐人產製 PDF，<br />寄出流水號與下載密碼。</>, data: filled, tag: "PDF 已產製", field: "moment-verify-strong" },
  { clause: <>收件人輸入兩者下載，<br />任何人都能查流水號。</>, data: filled, tag: "流水號有效", field: "moment-ink" },
];

const points: { title: string; body: string }[][] = [
  [
    { title: "不可變的模板版本", body: "PDF 或圖片都能當背景；發布後鎖定版本，已發證書保持原樣。" },
    { title: "一個活動，多種模板", body: "名單加一欄「模板」，結業證書與時數證明可以在同一個活動發出。" },
    { title: "產製前先看樣張", body: "每位收件人都能預覽伺服器產出的 PDF，確認字型與版面。" },
  ],
  [
    { title: "ZIP 與失敗報告", body: "一次下載全部成功的證書，失敗項目匯出 CSV 方便更正。" },
    { title: "撤銷與重新發放", body: "補發沿用原流水號與密碼，收件人用原本的通知信就能下載新版。" },
    { title: "有效期限管理", body: "到期日以台北時間計算，流水號查詢即時顯示最新狀態。" },
  ],
  [
    { title: "只能新增的稽核紀錄", body: "誰在何時做了什麼都留存，資料庫層級禁止修改。" },
    { title: "多組織與角色權限", body: "設計、發證、稽核分開授權，知道網址不等於有權限。" },
    { title: "不必註冊就能下載", body: "收件人用信中的流水號與密碼下載 PDF；密碼只存雜湊值，錯誤太多次會暫停。" },
  ],
];

function Certificate({ data }: { data: Record<string, string> }) {
  return (
    <TemplateThumb widthMm={sampleDocument.widthMm} heightMm={sampleDocument.heightMm}>
      <CertificateView
        document={sampleDocument}
        data={data}
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
          <a href="#verify">查詢證書</a>
          <Link to="/download">下載證書</Link>
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
            一組流水號，
            <br />
            就能查真偽。
          </h1>
          <p className="hero-lead">
            組織在這裡設計模板、批次產製 PDF，寄出流水號與下載密碼。收件人不必註冊就能下載，任何人都能查流水號是否真實。
          </p>
          <SerialForm />
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
              <Certificate data={moment.data} />
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
            alt="certfolio 發證活動頁：產製進度、使用的模板，以及收件人的流水號與產製狀態"
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
          ，到每個人手上都查得到的證書
          <img className="inline-shot" src="/landing/inline-verify.webp" alt="" width={240} height={240} loading="lazy" />
          。
        </p>
      </section>

      <Link to={enter} className="cta-band" aria-label={signedIn ? "進入工作空間" : "登入 certfolio"}>
        <span className="cta-note">
          {signedIn ? "回到你的組織工作空間。" : "發證單位請登入工作空間；收件人請用通知信中的流水號下載。"}
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
            <Link to="/download">用流水號與密碼下載</Link>
          </div>
          <div>
            <h3>查詢</h3>
            <a href="#verify">查詢證書流水號</a>
          </div>
          <p className="foot-note">
            流水號查詢只顯示發證單位、活動與證書狀態，不提供持有人姓名、Email 或 PDF。
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
