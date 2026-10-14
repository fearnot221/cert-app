import { AuditDetail } from './Lifecycle';
import { ReloadIcon } from '@radix-ui/react-icons';
import { orgPath } from '../lib/api';
import { usePagedResource } from '../lib/hooks';
import type { Audit, Delivery, Organization } from '../lib/types';
import { Alert, Empty, formatDate, Loading, LoadError, PageHeading, Pagination, Status } from '../components/common';
import { Button } from '../components/ui/button';

export function Records({ organization, kind }: { organization: Organization; kind: 'deliveries' | 'audit' }) {
  const resource = usePagedResource<Audit | Delivery>(orgPath(organization.id, `/${kind}`));
  const mail = kind === 'deliveries';
  return <>
    <PageHeading eyebrow={organization.name} title={mail ? '郵件寄送紀錄' : '稽核紀錄'} description={mail ? '追蹤每封通知的處理狀態，保留 SMTP 回應與結果。' : '查看此組織的敏感操作、執行者與發生時間。'} action={<Button variant="outline" disabled={resource.loading} onClick={() => void resource.reload()}><ReloadIcon />重新整理</Button>} />
    {mail && <Alert kind="info" message="已交付 SMTP，代表郵件伺服器已接受。沒有可靠投遞事件時，最終投遞狀態未知；結果不確定的郵件應先人工確認，避免重複寄送。" />}
    {resource.loading ? <Loading /> : resource.error ? <LoadError error={resource.error} retry={() => void resource.reload()} /> : !resource.data?.items.length ? <Empty title={mail ? '尚無通知紀錄' : '尚無稽核紀錄'} description={mail ? '在發證活動確認發送後，每位收件人的處理結果會列在這裡。' : '模板儲存、發布、發證與通知等操作完成後，會留下可追查的紀錄。'} /> : <div className="panel table-scroll"><table><thead>{mail ? <tr><th>收件人</th><th>郵件狀態</th><th>時間</th><th>Message ID / 診斷</th></tr> : <tr><th>操作</th><th>執行者</th><th>資源</th><th>時間</th></tr>}</thead><tbody>{resource.data.items.map(item => {
      if (mail) { const delivery = item as Delivery; return <tr key={item.id}><td><strong>{delivery.recipientEmail ?? delivery.toAddress ?? delivery.recipient?.email ?? '收件人資料未提供'}</strong>{delivery.senderIdentity && <span className="cell-sub">由 {delivery.senderIdentity.fromAddress}</span>}</td><td><Status value={delivery.status} /></td><td>{formatDate(delivery.createdAt)}</td><td><span className="mono-small">{delivery.messageId ?? '尚無 Message ID'}</span>{(delivery.error ?? delivery.lastError) && <span className="cell-sub danger-text">{delivery.error ?? delivery.lastError}</span>}</td></tr>; }
      const audit = item as Audit; return <tr key={item.id}><td><AuditDetail audit={audit} /></td><td>{audit.actor?.email ?? audit.actorId ?? '系統'}</td><td><span>{audit.resourceType ?? '組織作業'}</span><span className="cell-sub mono-small">{audit.resourceId ?? ''}</span></td><td>{formatDate(audit.createdAt)}</td></tr>;
    })}</tbody></table></div>}
    <Pagination {...resource.pagination} loading={resource.loading} />
    <p className="field-help mt-4">時間顯示為台北時區（UTC+8）。</p>
  </>;
}
