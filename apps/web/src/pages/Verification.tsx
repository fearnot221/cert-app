import { useEffect, useRef, useState } from 'react';
import { VerificationQr } from '@cert/renderer';
import { useResource } from '../lib/hooks';
import { Alert, formatDate, Loading } from '../components/common';
import { Button } from '../components/ui/button';
export function VerificationLinks({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return <details className="verification-share"><summary>驗證連結與 QR Code</summary><div ref={ref}><VerificationQr value={url} size={160} /></div><a href={url} target="_blank" rel="noreferrer">開啟公開驗證頁 ↗</a><div className="button-row"><Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError('無法複製，請開啟驗證頁後複製網址。'); } }}>{copied ? '已複製' : '複製連結'}</Button><Button size="sm" variant="outline" onClick={() => { const svg = ref.current?.querySelector('svg'); if (!svg) return; const blob = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })); const a = document.createElement('a'); a.href = blob; a.download = 'certificate-verification.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(blob), 1000); }}>下載 QR</Button></div><Alert message={error} /><span role="status" className="field-help">{copied ? '驗證連結已複製。' : '持有連結者可查看遮罩姓名與證書狀態。'}</span></details>;
}
type Result = { status: string; number: string; organization: string; eventName: string; recipientName: string; issueDate: string | null; issuedAt: string; expiresAt: string | null; edition: number; hasReplacement: boolean; checkedAt: string };
const states: Record<string, { title: string; description: string }> = {
  valid: { title: '證書目前有效', description: '發證紀錄有效，且尚未到期。請核對證書編號、活動及持有人資料。' },
  expired: { title: '證書已到期', description: '這份證書已超過有效期限，請聯絡發證單位確認續期或重新發放。' },
  revoked: { title: '證書已撤銷', description: '發證單位已撤銷這份證書，請勿再將它作為有效證明。' },
  superseded: { title: '證書已被新版取代', description: '這份證書已失效，請向持有人索取新版證書及其驗證連結。' },
  unavailable: { title: '目前無法確認有效性', description: '發證組織目前停用，請向發證單位查詢。' },
};
export function PublicVerification() {
  const id = location.pathname.split('/')[2] ?? '';
  const preview = id === 'preview';
  const resource = useResource<Result>(preview ? null : `/public/certificates/${encodeURIComponent(id)}`);
  useEffect(() => {
    document.title = '證書公開驗證 · certfolio';
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow,noarchive'; document.head.appendChild(robots);
    const timer = setInterval(() => void resource.reload(), 30000);
    return () => { clearInterval(timer); robots.remove(); };
  }, [resource.reload]);
  const result = resource.data;
  const state = result ? states[result.status] ?? states.unavailable! : null;
  return <main className="public-verification"><header><a href="/">certfolio</a><span>公開證書驗證</span></header><article className="verification-card" aria-busy={resource.loading}>
    <p className="verification-eyebrow">CERTIFICATE VERIFICATION</p>
    {preview ? <><h1>這是樣張 QR Code</h1><p>樣張不能作為正式證書。正式產製後會使用每張證書專屬的驗證連結。</p></> : resource.loading && !result ? <Loading /> : resource.error && !result ? <><h1>無法驗證這份證書</h1><Alert message={resource.error} /><p>請向發證單位確認連結。查無資料不等於證書有效。</p><Button onClick={() => void resource.reload()}>重新查詢</Button></> : result && state && <>
      <div className={`verification-result result-${result.status}`}><span aria-hidden="true">{result.status === 'valid' ? '✓' : '!'}</span><h1>{state.title}</h1><p>{state.description}</p></div>
      {resource.error && <Alert message={`無法更新驗證結果，下方為上次查詢資料：${resource.error}`} />}
      <dl><div><dt>發證單位</dt><dd>{result.organization}</dd></div><div><dt>發證活動</dt><dd>{result.eventName}</dd></div><div><dt>持有人（遮罩）</dt><dd>{result.recipientName}</dd></div><div><dt>證書編號</dt><dd className="verification-number">{result.number}</dd></div><div><dt>發證日期</dt><dd>{result.issueDate ?? formatDate(result.issuedAt)}</dd></div><div><dt>有效期限（台北時間）</dt><dd>{result.expiresAt ? formatDate(result.expiresAt) : '無到期日'}</dd></div><div><dt>證書版本</dt><dd>第 {result.edition} 版</dd></div></dl>
      {result.hasReplacement && <p className="verification-note">此證書已有後繼版本。為保護個人資料，請向持有人取得新版連結。</p>}
      <footer><span>查詢時間：{formatDate(result.checkedAt)}<br/>每 30 秒更新狀態</span><Button variant="outline" disabled={resource.loading} onClick={() => void resource.reload()}>重新驗證</Button></footer>
    </>}
  </article><p className="verification-disclaimer">本頁僅驗證系統中的發證紀錄，不提供私人 PDF 或 Email。請確認網址屬於可信任的發證服務，並向持有人核對完整姓名。</p></main>;
}
