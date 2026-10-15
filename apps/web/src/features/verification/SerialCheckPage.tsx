import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useResource } from "../../lib/hooks";
import { formatDate, formatDay } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Loading, Notice, Wordmark } from "../../ui/feedback";

type Match = { organization: string; eventName: string; issueDate: string | null; expiresAt: string | null; status: string };
type Result = { serial: string; checkedAt: string; matches: Match[] };

const states: Record<string, { title: string; description: string; tone: "valid" | "issue" | "void" }> = {
  valid: { title: "這是有效的證書", description: "系統中有這個流水號的發證紀錄，且目前有效。請與紙本或 PDF 上的發證單位及活動核對。", tone: "valid" },
  expired: { title: "這張證書已到期", description: "系統中有這個流水號，但證書已超過有效期限。請向發證單位確認是否續期。", tone: "issue" },
  revoked: { title: "這張證書已撤銷", description: "發證單位已撤銷這張證書，請勿再將它作為有效證明。", tone: "void" },
  superseded: { title: "這張證書已由新版取代", description: "這個版本已失效，請向持有人索取新版證書。", tone: "void" },
  unavailable: { title: "目前無法確認有效性", description: "發證組織目前停用，請直接向發證單位查詢。", tone: "issue" },
};
const legacyQr = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The serial lookup box, on the home page and on the result page. */
export function SerialForm({ initial = "", compact = false }: { initial?: string; compact?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  useEffect(() => setValue(initial), [initial]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const serial = value.trim();
    if (!serial) {
      setError("請輸入證書上的流水號。");
      return;
    }
    navigate(`/verify/${encodeURIComponent(serial)}`);
  };
  return (
    <form className={compact ? "hero-verify hero-verify-compact" : "hero-verify"} onSubmit={submit} id="verify" noValidate>
      <label className="sr-only" htmlFor="verify-input">
        證書流水號
      </label>
      <input
        id="verify-input"
        className="hero-verify-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        placeholder="輸入證書流水號"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="verify-help"
        aria-invalid={!!error}
      />
      <button className="btn hero-verify-button" type="submit">
        查詢
        <ArrowRightIcon aria-hidden />
      </button>
      <p id="verify-help" className={error ? "hero-verify-help is-error" : "hero-verify-help"} role={error ? "alert" : undefined}>
        {error || "不必登入。只確認流水號是否存在與證書狀態，不顯示持有人資料。"}
      </p>
    </form>
  );
}

export function SerialCheckPage() {
  const { serial = "" } = useParams();
  const legacy = legacyQr.test(serial);
  const resource = useResource<Result>(serial && !legacy ? `/public/serials?serial=${encodeURIComponent(serial)}` : null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "查詢證書流水號 · certfolio";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex,nofollow,noarchive";
    document.head.appendChild(robots);
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, []);
  const result = resource.data;
  const first = result?.matches[0];
  const state = first ? (states[first.status] ?? states.unavailable!) : null;
  const failed = !!serial && !legacy && !result && !resource.pending && !!resource.error;
  const notFound = failed && resource.error.startsWith("查無");
  const tone = state?.tone ?? (failed || legacy ? "void" : "issue");
  const settled = !serial || legacy || !!result || !resource.pending;
  return (
    <main className={`verify verify-${tone}`}>
      <header className="verify-bar">
        <Wordmark />
        <Link to="/download" className="text-link">
          持有人下載證書
        </Link>
      </header>
      <section className="verify-result" aria-busy={resource.loading}>
        {settled ? (
          <div key={tone} className="verify-seal" aria-hidden>
            <span />
          </div>
        ) : (
          <div className="verify-seal" data-pending aria-hidden>
            <span />
          </div>
        )}
        <div className="verify-copy">
          {!serial ? (
            <>
              <h1>查詢證書流水號</h1>
              <p className="verify-lead">輸入證書上的流水號，確認它是否由發證單位在本系統發出。</p>
            </>
          ) : legacy ? (
            <>
              <h1>QR Code 驗證已停用</h1>
              <p className="verify-lead">請改為輸入證書上印的流水號查詢。</p>
            </>
          ) : resource.pending && !result ? (
            <Loading label="正在查詢發證紀錄…" />
          ) : notFound ? (
            <>
              <h1>查無這個流水號</h1>
              <p className="verify-lead">請確認輸入與證書上的完全相同。若仍查不到，請向發證單位確認。</p>
            </>
          ) : failed ? (
            <>
              <h1>暫時無法查詢</h1>
              <Notice message={resource.error} />
            </>
          ) : (
            state && (
              <>
                <h1>{state.title}</h1>
                <p className="verify-lead">{state.description}</p>
              </>
            )
          )}
          <SerialForm initial={legacy ? "" : serial} compact />
        </div>
      </section>
      {result?.matches.map((match, index) => (
        <section key={index} className="verify-record" aria-label="發證紀錄">
          <dl className="verify-facts">
            <div className="verify-serial">
              <dt>證書流水號</dt>
              <dd className="tabular">{result.serial}</dd>
            </div>
            <div>
              <dt>發證單位</dt>
              <dd>{match.organization}</dd>
            </div>
            <div>
              <dt>發證活動</dt>
              <dd>{match.eventName || "未提供"}</dd>
            </div>
            <div>
              <dt>發證日期</dt>
              <dd>{match.issueDate ? formatDay(match.issueDate) : "未提供"}</dd>
            </div>
            <div>
              <dt>有效期限（台北時間）</dt>
              <dd>{match.expiresAt ? formatDate(match.expiresAt) : "無到期日"}</dd>
            </div>
          </dl>
          {index === result.matches.length - 1 && (
            <footer className="verify-check">
              <span>查詢時間：{formatDate(result.checkedAt)}</span>
              <Button variant="quiet" aria-busy={resource.loading} onClick={() => void resource.reload()}>
                重新查詢
              </Button>
            </footer>
          )}
        </section>
      ))}
      <p className="verify-disclaimer">
        本頁只確認系統中的發證紀錄，不顯示持有人姓名、Email 或 PDF。持有人請用通知信中的流水號與密碼
        <Link to={`/download${serial && !legacy ? `?serial=${encodeURIComponent(serial)}` : ""}`}>下載證書</Link>
      </p>
    </main>
  );
}
