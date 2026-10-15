import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRightIcon, PlusIcon } from "@radix-ui/react-icons";
import { createDefaultDocument } from "@cert/contracts";
import { CertificateView } from "@cert/renderer";
import { orgPath, post } from "../../lib/api";
import { useAction, usePagedResource } from "../../lib/hooks";
import type { Template } from "../../lib/types";
import { useWorkspace } from "../../app/AppShell";
import { Button } from "../../ui/Button";
import { Empty, Loading, LoadError, Notice, PageHeader, Pagination, Status } from "../../ui/feedback";
import { previewDataFor } from "./previewData";
import { TemplateThumb } from "./TemplateThumb";

export function TemplatesPage() {
  const { organization, permissions } = useWorkspace();
  const navigate = useNavigate();
  const resource = usePagedResource<Template>(orgPath(organization.id, "/templates"));
  const action = useAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const canWrite = permissions.includes("templates.write");
  const create = () =>
    void action.run(async () => {
      const template = await post<Template>(orgPath(organization.id, "/templates"), {
        name,
        document: createDefaultDocument(),
      });
      navigate(`/${organization.slug}/templates/${template.id}`);
    });
  return (
    <>
      <PageHeader
        title="證書模板"
        description="把每一次認可整理成可以重複使用的設計。發布後的版本會被保留，已發出的證書不受之後的修改影響。"
        action={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              建立模板
            </Button>
          )
        }
      />
      <div className="stack">
        <Notice message={action.error} />
        {creating && (
          <form
            className="panel inline-create"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <label className="field">
              模板名稱
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
                placeholder="例如：專業培訓結業證書"
              />
            </label>
            <div className="btn-row">
              <Button variant="ghost" onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button type="submit" disabled={action.busy || !name.trim()}>
                {action.busy ? "建立中…" : "開始設計"}
                <ArrowRightIcon />
              </Button>
            </div>
          </form>
        )}
      </div>
      {resource.pending ? (
        <Loading />
      ) : resource.error && !resource.data ? (
        <LoadError error={resource.error} retry={() => void resource.reload()} />
      ) : !resource.data?.items.length ? (
        <Empty
          title="第一份證書，從模板開始"
          description="上傳背景、放上姓名與課程欄位，完成設計後發布，發證人員就能使用。"
          action={
            canWrite && !creating ? (
              <Button variant="quiet" onClick={() => setCreating(true)}>
                <PlusIcon />
                建立第一份模板
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="template-gallery">
          {resource.data.items.map((template) => (
            <li key={template.id}>
              <Link to={`/${organization.slug}/templates/${template.id}`} className="template-tile">
                <TemplateThumb widthMm={template.document.widthMm} heightMm={template.document.heightMm}>
                  <CertificateView
                      document={template.document}
                      data={previewDataFor(template.document, organization.name)}
                      assetUrls={
                        template.document.backgroundAssetId
                          ? {
                              [template.document.backgroundAssetId]: `/api${orgPath(organization.id, `/assets/${template.document.backgroundAssetId}/file`)}`,
                            }
                          : {}
                      }
                      fontUrl="/api/fonts/noto-sans-tc"
                    />
                </TemplateThumb>
                <span className="template-caption">
                  <span className="template-name">{template.name}</span>
                  <Status value={template.status} />
                </span>
                <span className="template-detail">
                  {template.document.widthMm} × {template.document.heightMm} mm，
                  {template.versions?.length ? `已發布 ${template.versions.length} 個版本` : "尚未發布"}
                  <span className="template-open">{canWrite ? "編輯" : "檢視"} →</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination {...resource.pagination} />
    </>
  );
}
