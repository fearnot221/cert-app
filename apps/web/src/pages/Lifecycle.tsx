import { useEffect, useId, useRef, useState } from 'react';
import type { Audit, Batch, BatchRow } from '../lib/types';
import { api, orgPath } from '../lib/api';
import { useAction, usePagedResource } from '../lib/hooks';
import { Alert, formatDate, Pagination, Status } from '../components/common';
import { Button } from '../components/ui/button';
export const actionNames: Record<string,string> = { 'certificate.expiry_changed': '調整證書期限', 'batch.created': '建立活動', 'batch.edited': '編輯活動', 'batch.cancelled': '取消活動', 'certificate.revoked': '撤銷證書', 'certificate.reissued': '重新發放證書', 'batch.generate_requested': '提交產製', 'batch.retry_failed': '重試失敗項目', 'batch.mail_requested': '提交寄送通知', 'batch.zip_downloaded': '下載證書 ZIP' };
export function AuditDetail({ audit }: { audit: Audit }) {
  const metadata = audit.metadata as { actorEmail?: string; reason?: string } | undefined;
  return <><strong>{actionNames[audit.action] ?? audit.action}</strong><span className="cell-sub">{metadata?.actorEmail ?? audit.actorId ?? '系統'} · {formatDate(audit.createdAt)}</span>{metadata?.reason && <p>{metadata.reason}</p>}{audit.metadata != null && <details><summary>查看完整操作資料</summary><pre className="audit-json">{JSON.stringify(audit.metadata, null, 2)}</pre></details>}</>;
}
export function BatchHistory({ org, id, revision }: { org: string; id: string; revision: number }) {
  const history = usePagedResource<Audit>(orgPath(org, `/batches/${id}/history?revision=${revision}`), 50);
  return <section className="panel lifecycle-history"><h2>操作紀錄</h2><p className="field-help">保留操作原因、執行者、變更前後資料及新舊證書關聯。</p><Alert message={history.error} />{history.data?.items.map(a => <article key={a.id}><AuditDetail audit={a} /></article>)}<Pagination {...history.pagination} loading={history.loading} /></section>;
}
export function LifecycleActions({ org, batch, row, permissions, reload }: { org: string; batch: Batch; row?: BatchRow; permissions: string[]; reload: () => Promise<void> }) {
  const [mode, setMode] = useState<'edit'|'cancel'|'revoke'|'reissue'|'expiry'|null>(null);
  const [expiresOn, setExpiresOn] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState(batch.eventName);
  const [records, setRecords] = useState(batch.rows.map(r => ({ rowNumber: r.rowNumber, data: { ...r.data } })));
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const action = useAction();
  const title = mode === 'expiry' ? '調整有效期限' : mode === 'edit' ? '編輯活動' : mode === 'cancel' ? '取消活動' : mode === 'revoke' ? '撤銷證書' : '重新發放證書';
  useEffect(() => { if (mode) dialog.current?.showModal(); }, [mode]);
  const open = (m: typeof mode) => { setExpiresOn((row?.certificate?.expiresAt ?? batch.expiresAt ?? '').slice(0,10)); setReason(''); setName(batch.eventName); setRecords((row ? [row] : batch.rows).map(r => ({ rowNumber: r.rowNumber, data: { ...r.data } }))); setMode(m); };
  const submit = () => void action.run(async () => {
    const path = mode === 'edit' ? `/batches/${batch.id}` : mode === 'cancel' ? `/batches/${batch.id}/cancel` : `/certificates/${row!.certificate!.id}/${mode}`;
    await api(orgPath(org, path), { method: mode === 'edit' ? 'PUT' : 'POST', body: JSON.stringify(mode === 'edit' ? { reason, revision: batch.revision, eventName: name, records, expiresOn: expiresOn || null } : mode === 'cancel' ? { reason, revision: batch.revision } : mode === 'expiry' ? { reason, expiresOn: expiresOn || null, revision: row!.certificate!.revision } : { reason, ...(mode === 'reissue' ? { data: records[0]!.data, expiresOn: expiresOn || null } : {}) }) });
    dialog.current?.close(); setMode(null); await reload();
  });
  const canRevoke = permissions.includes('certificates.revoke');
  return <>
    <div className="button-row lifecycle-actions">
      {!row && batch.status === 'validated' && permissions.includes('recipients.import') && <Button variant="outline" onClick={() => open('edit')}>編輯活動</Button>}
      {!row && batch.status !== 'cancelled' && canRevoke && <Button variant="outline" onClick={() => open('cancel')}>取消活動</Button>}
      {row?.certificate && batch.status !== 'cancelled' && canRevoke && <>
        {row.certificate.storedStatus === 'valid' && permissions.includes('certificates.issue') && <Button variant="ghost" size="sm" onClick={() => open('expiry')}>管理期限</Button>}
        {row.certificate.storedStatus === 'valid' && <Button variant="ghost" size="sm" onClick={() => open('revoke')}>撤銷</Button>}
        {['success','failed','cancelled'].includes(row.status) && permissions.includes('certificates.issue') && <Button variant="ghost" size="sm" onClick={() => open('reissue')}>重新發放</Button>}
      </>}
    </div>
    {row?.history && row.history.length > 1 && <details className="certificate-history"><summary>{row.history.length} 個版本</summary>{row.history.map(c => <p key={c.id}>第 {c.edition} 版 · <Status value={c.status} /><span className="cell-sub">{c.number}</span></p>)}</details>}
    {mode && <dialog ref={dialog} className="lifecycle-dialog" aria-labelledby={heading} onCancel={e => { if (action.busy) e.preventDefault(); else setMode(null); }}>
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <h2 id={heading}>{title}</h2>
        <p>{row ? row.data.recipient_name : batch.eventName}</p>
        <p className="field-help">{mode === 'expiry' ? '效期以台北時間當日 23:59:59 為準；調整不會重寫原 PDF，公開驗證頁顯示最新期限。留空代表無到期日。' : mode === 'edit' ? '更新後需重新預覽樣張，修改前後的名單都會保留在操作紀錄。' : mode === 'reissue' ? '補發會建立新編號及 PDF，舊證書將失效。完成後請到通知分頁寄送新版通知。' : '此操作無法復原。失效證書將停止下載與尚未開始的寄送；已開始寄送或已寄出的郵件無法收回。'}</p>
        {mode === 'edit' && <label>活動名稱<input autoFocus required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>}
        {(mode === 'edit' || mode === 'reissue') && <div className="lifecycle-fields">{records.map((record, index) => <fieldset key={record.rowNumber}><legend>收件人 {index + 1} · 來源列號 {record.rowNumber}</legend>{Object.entries(record.data).map(([key,value]) => <label key={key}>{({ recipient_name: '姓名', recipient_email: 'Email', issue_date: '發證日期' } as Record<string,string>)[key] ?? key}<input type={key === 'recipient_email' ? 'email' : 'text'} maxLength={500} required={['recipient_name','recipient_email'].includes(key)} value={value} onChange={e => setRecords(current => current.map((r,i) => i === index ? { ...r, data: { ...r.data, [key]: e.target.value } } : r))} /></label>)}</fieldset>)}</div>}
        {["expiry", "edit", "reissue"].includes(mode) && <label>證書到期日（選填）<input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} /></label>}
        <label>操作原因<textarea autoFocus={mode === 'cancel' || mode === 'revoke'} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="說明本次修改、取消或補發的原因" /></label>
        <Alert message={action.error} />
        <div className="button-row"><Button type="button" variant="outline" disabled={action.busy} onClick={() => { dialog.current?.close(); setMode(null); }}>返回</Button><Button type="submit" disabled={action.busy || !reason.trim()}>{action.busy ? '處理中…' : `確認${title}`}</Button></div>
      </form>
    </dialog>}
  </>;
}
