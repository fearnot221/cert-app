import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { VerificationQr } from "@cert/renderer";
import { useResource } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Loading, Notice, Wordmark } from "../../ui/feedback";

type Result = {
  status: string; number: string; organization: string; eventName: string; recipientName: string;
  issueDate: string | null; issuedAt: string; expiresAt: string | null; edition: number;
  hasReplacement: boolean; checkedAt: string;
};

const states: Record<string, { title: string; description: string; tone: "valid" | "issue" | "void" }> = {
  valid: { title: "證書目前有效", description: "發證紀錄有效，且尚未到期。請核對證書編號、活動及持有人資料。", tone: "valid" },
  expired: { title: "證書已到期", description: "這份證書已超過有效期限，請聯絡發證單位確認續期或重新發放。", tone: "issue" },
  revoked: { title: "證書已撤銷", description: "發證單位已撤銷這份證書，請勿再將它作為有效證明。", tone: "void" },
  superseded: { title: "證書已被新版取代", description: "這份證書已失效，請向持有人索取新版證書及其驗證連結。", tone: "void" },
  unavailable: { title: "目前無法確認有效性", description: "發證組織目前停用，請向發證單位查詢。", tone: "issue" },
};

/** Share controls for a certificate's public link, used by staff and by the certificate's owner. */
export function VerificationLinks({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const downloadQr = () => {
    const svg = ref.current?.querySelector("svg");
    if (!svg) return;
    const blob = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = blob;
    a.download = "certificate-verification.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(blob), 1000);
  };
  return (
    <details className="disclosure verification-share">
      <summary>驗證連結與 QR Code</summary>
      <div className="verification-share-body">
        <div ref={ref} className="verification-share-qr">
          <VerificationQr value={url} size={140} />
        </div>
        <div className="stack verification-share-actions">
          <a href={url} target="_blank" rel="noreferrer" className="text-link">
            開啟公開驗證頁 ↗
          </a>
          <div className="btn-row">
            <Button
              size="sm"
              variant="quiet"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setError("無法複製，請開啟驗證頁後複製網址。");
                }
              }}
            >
              {copied ? "已複製" : "複製連結"}
            </Button>
            <Button size="sm" variant="quiet" onClick={downloadQr}>
              下載 QR
            </Button>
          </div>
          <Notice message={error} />
          <span role="status" className="field-help">
            {copied ? "驗證連結已複製。" : "持有連結者可查看遮罩姓名與證書狀態。"}
          </span>
        </div>
      </div>
    </details>
  );
}

export function VerificationPage() {
  const { publicId = "" } = useParams();
  const preview = publicId === "preview";
  const resource = useResource<Result>(preview ? null : `/public/certificates/${encodeURIComponent(publicId)}`, {
    refetchInterval: 30000,
  });
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "證書公開驗證 · certfolio";
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
  const state = result ? (states[result.status] ?? states.unavailable!) : null;
  const tone = preview ? "issue" : state?.tone ?? (resource.error ? "void" : "issue");
  return (
    <main className={`verify verify-${tone}`}>
      <header className="verify-bar">
        <Wordmark />
        <span>公開證書驗證</span>
      </header>
      <section className="verify-result" aria-busy={resource.loading}>
        <div className="verify-seal" aria-hidden>
          <span />
        </div>
        <div className="verify-copy">
          {preview ? (
            <>
              <h1>這是樣張 QR Code</h1>
              <p className="verify-lead">樣張不能作為正式證書。正式產製後，每張證書會使用專屬的驗證連結。</p>
            </>
          ) : resource.pending && !result ? (
            <Loading label="正在查詢發證紀錄…" />
          ) : resource.error && !result ? (
            <>
              <h1>無法驗證這份證書</h1>
              <Notice message={resource.error} />
              <p className="verify-lead">請向發證單位確認連結。查無資料不等於證書有效。</p>
              <div>
                <Button onClick={() => void resource.reload()}>重新查詢</Button>
              </div>
            </>
          ) : (
            result &&
            state && (
              <>
                <h1>{state.title}</h1>
                <p className="verify-lead">{state.description}</p>
                {resource.error && <Notice message={`無法更新驗證結果，下方為上次查詢資料：${resource.error}`} />}
              </>
            )
          )}
        </div>
      </section>
      {result && state && !preview && (
        <section className="verify-record" aria-label="發證紀錄">
          <dl className="verify-facts">
            <div>
              <dt>發證單位</dt>
              <dd>{result.organization}</dd>
            </div>
            <div>
              <dt>發證活動</dt>
              <dd>{result.eventName}</dd>
            </div>
            <div>
              <dt>持有人（遮罩）</dt>
              <dd>{result.recipientName}</dd>
            </div>
            <div>
              <dt>證書編號</dt>
              <dd className="tabular">{result.number}</dd>
            </div>
            <div>
              <dt>發證日期</dt>
              <dd>{result.issueDate ?? formatDate(result.issuedAt)}</dd>
            </div>
            <div>
              <dt>有效期限（台北時間）</dt>
              <dd>{result.expiresAt ? formatDate(result.expiresAt) : "無到期日"}</dd>
            </div>
            <div>
              <dt>證書版本</dt>
              <dd>第 {result.edition} 版</dd>
            </div>
          </dl>
          {result.hasReplacement && (
            <Notice kind="info" message="此證書已有後繼版本。為保護個人資料，請向持有人取得新版連結。" />
          )}
          <footer className="verify-check">
            <span>
              查詢時間：{formatDate(result.checkedAt)}
              <br />
              每 30 秒自動更新狀態
            </span>
            <Button variant="quiet" disabled={resource.loading} onClick={() => void resource.reload()}>
              重新驗證
            </Button>
          </footer>
        </section>
      )}
      <p className="verify-disclaimer">
        本頁只驗證系統中的發證紀錄，不提供私人 PDF 或 Email。請確認網址屬於可信任的發證服務，並向持有人核對完整姓名。
        <Link to="/">認識 certfolio</Link>
      </p>
    </main>
  );
}
