import type { ReactNode } from 'react';
import { ExclamationTriangleIcon, CheckCircledIcon, ReloadIcon, FileTextIcon, ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Button } from './ui/button';

export function Alert({ message, kind = 'error' }: { message?: string; kind?: 'error' | 'success' | 'info' }) {
  if (!message) return null;
  return <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'success' ? <CheckCircledIcon /> : <ExclamationTriangleIcon />}<span>{message}</span>
  </div>;
}
export function Loading({ label = '正在載入…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="skeleton-line" /><span className="skeleton-line short" /><span>{label}</span></div>;
}
export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><FileTextIcon /></span><h2>{title}</h2><p>{description}</p>{action}</div>;
}
export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return <div className="load-error"><Alert message={error} /><Button variant="outline" onClick={retry}><ReloadIcon />重新載入</Button></div>;
}
const statuses: Record<string, string> = {
  draft: '草稿', published: '已發布', archived: '已封存', validated: '已驗證', pending: '等待處理', queued: '排程中', generating: '產製中', processing: '處理中', ready: '產製完成', completed: '完成', success: '成功', generated: '已產製', failed: '失敗', partial: '部分失敗', sending: '傳送中', accepted: '已交付 SMTP', delivered: '已投遞', unknown: '結果不確定', bounced: '退信', active: '有效', valid: '有效', revoked: '已撤銷', superseded: '已取代', expired: '已到期', enabled: '可用', verified: '已驗證', disabled: '已停用', cancelled: '已取消', sent: '通知已提交',
};
export function Status({ value }: { value: string }) {
  const state = value.toLowerCase();
  const kind = ['failed', 'bounced', 'revoked'].includes(state) ? 'danger' : ['active', 'valid', 'ready', 'completed', 'success', 'published', 'generated', 'accepted', 'verified'].includes(state) ? 'good' : 'neutral';
  return <span className={`status status-${kind}`}>{statuses[state] ?? value}</span>;
}
export function formatDate(value?: string) {
  if (!value) return '尚無紀錄';
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Taipei' }).format(new Date(value));
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function Pagination({ page, pageSize, hasNext, loading, onPageChange }: { page: number; pageSize: number; hasNext: boolean; loading: boolean; onPageChange: (page: number) => void }) {
  if (page === 0 && !hasNext) return null;
  return <nav className="pagination" aria-label="資料分頁"><span>第 {page + 1} 頁 · 每頁最多 {pageSize} 筆</span><div className="button-row"><Button variant="outline" size="sm" disabled={loading || page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeftIcon />上一頁</Button><Button variant="outline" size="sm" disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)}>下一頁<ChevronRightIcon /></Button></div></nav>;
}
