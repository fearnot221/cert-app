import { useState } from 'react';
import { PlusIcon, ArrowRightIcon, Pencil2Icon } from '@radix-ui/react-icons';
import { createDefaultDocument } from '@cert/contracts';
import { CertificateView } from '@cert/renderer';
import { orgPath, post } from '../lib/api';
import { useAction, usePagedResource } from '../lib/hooks';
import type { Organization, Template } from '../lib/types';
import { Alert, Empty, Loading, LoadError, PageHeading, Pagination, Status } from '../components/common';
import { Button } from '../components/ui/button';

export const previewData: Record<string, string> = { recipient_name: '王小明', recipient_email: 'recipient@example.org', organization_name: '發證組織', event_name: '專業培訓課程', course_name: '專業培訓課程', issue_date: '2026-10-15', start_date: '2026-10-01', end_date: '2026-10-15', hours: '12', certificate_number: 'PREVIEW-0001', custom_field: '示範內容' };

export function Templates({ organization, permissions, onEdit }: { organization: Organization; permissions: string[]; onEdit: (template: Template) => void }) {
  const resource = usePagedResource<Template>(orgPath(organization.id, '/templates'));
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const canWrite = permissions.includes('templates.write');
  const create = () => void action.run(async () => {
    const template = await post<Template>(orgPath(organization.id, '/templates'), { name, document: createDefaultDocument() });
    onEdit(template);
  });
  return <>
    <PageHeading eyebrow="設計與版本" title="證書模板" description="把每一次認可，整理成可以重複使用的設計。" action={canWrite && <Button onClick={() => setCreating(true)}><PlusIcon />建立模板</Button>} />
    <Alert message={action.error} />
    {creating && <form className="inline-create panel" onSubmit={e => { e.preventDefault(); create(); }}><label>模板名稱<input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120} required placeholder="例如：專業培訓結業證書" /></label><div className="button-row"><Button variant="ghost" type="button" onClick={() => setCreating(false)}>取消</Button><Button disabled={action.busy || !name.trim()}>{action.busy ? '建立中…' : '開始設計'}<ArrowRightIcon /></Button></div></form>}
    {resource.loading ? <Loading /> : resource.error ? <LoadError error={resource.error} retry={() => void resource.reload()} /> : !resource.data?.items.length ? <Empty title="第一份證書，從模板開始" description="上傳背景、加入姓名與課程欄位，完成設計後發布供發證人員使用。" action={canWrite && !creating ? <Button variant="outline" onClick={() => setCreating(true)}><PlusIcon />建立第一份模板</Button> : undefined} /> : <>
      <div className="section-bar"><span>本頁 {resource.data.items.length} 份模板</span><span>目前組織：{organization.name}</span></div>
      <div className="template-grid">{resource.data.items.map(template => <article className="template-card" key={template.id}>
        <div className="template-preview"><div className="template-miniature" style={{ width: `${template.document.widthMm}mm`, height: `${template.document.heightMm}mm` }}>
          <CertificateView document={template.document} data={{ ...previewData, organization_name: organization.name }} assetUrls={template.document.backgroundAssetId ? { [template.document.backgroundAssetId]: `/api${orgPath(organization.id, `/assets/${template.document.backgroundAssetId}/file`)}` } : {}} fontUrl="/api/fonts/noto-sans-tc" />
        </div><span className="preview-watermark">示範資料</span></div>
        <div className="template-info"><div><h2>{template.name}</h2><Status value={template.status} /></div><p>{template.document.widthMm} × {template.document.heightMm} mm<span>·</span>{template.versions?.length ? `已發布 ${template.versions.length} 個版本` : '尚未發布'}</p><Button variant="outline" onClick={() => onEdit(template)}><Pencil2Icon />{canWrite ? '編輯模板' : '檢視模板'}<ArrowRightIcon className="ml-auto" /></Button></div>
      </article>)}</div>
    </>}
    <Pagination {...resource.pagination} loading={resource.loading} />
    <div className="quiet-note"><strong>發布後的版本會被保留</strong><p>修改模板時會編輯草稿，已發出的證書與既有 PDF 會保持原樣。</p></div>
  </>;
}
