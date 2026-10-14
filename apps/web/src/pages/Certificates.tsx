import { VerificationLinks } from './Verification';
import { useState } from 'react';
import { DownloadIcon, FileTextIcon, ReloadIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { request } from '../lib/api';
import { useAction, usePagedResource } from '../lib/hooks';
import type { MyCertificate } from '../lib/types';
import { Alert, Empty, formatDate, Loading, LoadError, PageHeading, Pagination, Status } from '../components/common';
import { Button } from '../components/ui/button';

export function Certificates() {
  const resource = usePagedResource<MyCertificate>('/me/certificates');
  const action = useAction();
  const [organization, setOrganization] = useState('');
  const [search, setSearch] = useState('');
  const certificates = resource.data?.items ?? [];
  const organizations = [...new Set(certificates.map(certificate => certificate.organization.name))];
  const filtered = certificates.filter(certificate => (!organization || certificate.organization.name === organization) && (!search || `${certificate.batch.eventName} ${certificate.number}`.toLowerCase().includes(search.toLowerCase())));
  const download = (certificate: MyCertificate) => void action.run(async () => {
    const response = await request(`/me/certificates/${certificate.id}/pdf`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${certificate.number}.pdf`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    action.setSuccess('PDF 已開始下載。');
  });
  return <div className="recipient-content">
    <PageHeading eyebrow="你的學習與成就" title="我的證書" description="每一步累積，都有一份值得保留的紀錄。" action={<Button variant="outline" onClick={() => void resource.reload()} disabled={resource.loading}><ReloadIcon />重新整理</Button>} />
    <Alert message={action.error} /><Alert message={action.success} kind="success" />
    {resource.loading ? <Loading /> : resource.error ? <LoadError error={resource.error} retry={() => void resource.reload()} /> : !certificates.length ? <Empty title="你的證書將出現在這裡" description="組織完成發證後，你就能在此查看及下載屬於自己的證書。若已收到通知，請確認登入的電子郵件與收件地址相同。" /> : <>
      <div className="certificate-filters"><label>本頁發證組織<select value={organization} onChange={e => setOrganization(e.target.value)}><option value="">所有組織</option>{organizations.map(name => <option key={name}>{name}</option>)}</select></label><label className="search-label">本頁活動或證書編號<div><MagnifyingGlassIcon /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋本頁證書" type="search" /></div></label></div>
      <div className="section-bar"><span>本頁 {filtered.length} 份證書</span><span>僅本人可下載</span></div>
      {!filtered.length ? <Empty title="沒有符合條件的證書" description="試著選擇其他組織，或減少搜尋字詞。" /> : <div className="certificate-list">{filtered.map(certificate => <article className="certificate-card" key={certificate.id}><div className="certificate-symbol"><FileTextIcon /></div><div className="certificate-card-body"><div className="certificate-card-top"><span className="certificate-organization">{certificate.organization.name}</span><Status value={certificate.status} /></div><h2>{certificate.batch.eventName}</h2><dl><div><dt>證書編號</dt><dd>{certificate.number}</dd></div><div><dt>發證時間</dt><dd>{formatDate(certificate.issuedAt)}</dd></div></dl><p className="field-help">有效期限：{certificate.expiresAt ? formatDate(certificate.expiresAt) : "無到期日"}</p><VerificationLinks url={certificate.verificationUrl} />{!['active', 'valid'].includes(certificate.status.toLowerCase()) && <p className="field-help">請留意目前證書狀態；如有疑問，請聯絡發證組織。</p>}</div><Button variant="outline" onClick={() => download(certificate)} disabled={action.busy || certificate.status !== 'valid'}><DownloadIcon />下載 PDF</Button></article>)}</div>}
    </>}
    <Pagination {...resource.pagination} loading={resource.loading} onPageChange={page => { resource.pagination.onPageChange(page); setOrganization(''); setSearch(''); }} />
    <div className="recipient-footnote">證書為私人文件。此入口只會顯示發給目前登入帳號的證書。</div>
  </div>;
}
