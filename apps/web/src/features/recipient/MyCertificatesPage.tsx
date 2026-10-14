import { useState } from "react";
import { DownloadIcon, MagnifyingGlassIcon, ReloadIcon } from "@radix-ui/react-icons";
import { request } from "../../lib/api";
import { saveBlob } from "../../lib/download";
import { useAction, usePagedResource } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { MyCertificate } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Empty, Loading, LoadError, Notice, PageHeader, Pagination, Status } from "../../ui/feedback";
import { VerificationLinks } from "../verification/VerificationPage";

export function MyCertificatesPage() {
  const resource = usePagedResource<MyCertificate>("/me/certificates");
  const action = useAction();
  const [organization, setOrganization] = useState("");
  const [search, setSearch] = useState("");
  const certificates = resource.data?.items ?? [];
  const organizations = [...new Set(certificates.map((c) => c.organization.name))];
  const filtered = certificates.filter(
    (c) =>
      (!organization || c.organization.name === organization) &&
      (!search || `${c.batch.eventName} ${c.number}`.toLowerCase().includes(search.toLowerCase())),
  );
  const download = (certificate: MyCertificate) =>
    void action.run(async () => {
      const response = await request(`/me/certificates/${certificate.id}/pdf`);
      saveBlob(await response.blob(), `${certificate.number}.pdf`);
      action.setSuccess("PDF 已開始下載。");
    });
  return (
    <div className="recipient">
      <PageHeader
        title="我的證書"
        description="發給這個帳號的證書都在這裡，可以下載 PDF，也能分享驗證連結。"
        action={
          <Button variant="quiet" onClick={() => void resource.reload()} aria-busy={resource.loading}>
            <ReloadIcon />
            重新整理
          </Button>
        }
      />
      <div className="stack">
        <Notice message={action.error} />
        <Notice message={action.success} kind="success" />
      </div>
      {resource.pending ? (
        <Loading />
      ) : resource.error && !resource.data ? (
        <LoadError error={resource.error} retry={() => void resource.reload()} />
      ) : !certificates.length ? (
        <Empty
          title="你的證書會出現在這裡"
          description="組織完成發證後，你就能在此查看及下載屬於自己的證書。若已收到通知，請確認登入的電子郵件與收件地址相同。"
        />
      ) : (
        <>
          <div className="filters">
            <label className="field">
              發證組織
              <select value={organization} onChange={(e) => setOrganization(e.target.value)}>
                <option value="">所有組織</option>
                {organizations.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="field filters-grow">
              搜尋活動或證書編號
              <span className="search-input">
                <MagnifyingGlassIcon aria-hidden />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="輸入關鍵字" type="search" />
              </span>
            </label>
          </div>
          <p className="list-count">本頁 {filtered.length} 份證書，只有你本人可以下載。</p>
          {!filtered.length ? (
            <Empty title="沒有符合條件的證書" description="試著選擇其他組織，或減少搜尋字詞。" />
          ) : (
            <ul className="certificate-list">
              {filtered.map((certificate) => {
                const usable = ["active", "valid"].includes(certificate.status.toLowerCase());
                return (
                  <li className={`certificate-item ${usable ? "" : "is-void"}`} key={certificate.id}>
                    <div className="certificate-seal" aria-hidden />
                    <div className="certificate-body">
                      <div className="certificate-meta">
                        <span>{certificate.organization.name}</span>
                        <Status value={certificate.status} />
                      </div>
                      <h2>{certificate.batch.eventName}</h2>
                      <dl className="facts">
                        <div>
                          <dt>證書編號</dt>
                          <dd className="tabular">{certificate.number}</dd>
                        </div>
                        <div>
                          <dt>發證時間</dt>
                          <dd>{formatDate(certificate.issuedAt)}</dd>
                        </div>
                        <div>
                          <dt>有效期限</dt>
                          <dd>{certificate.expiresAt ? formatDate(certificate.expiresAt) : "無到期日"}</dd>
                        </div>
                      </dl>
                      {!usable && <p className="field-help">請留意目前證書狀態；如有疑問，請聯絡發證組織。</p>}
                      <div className="certificate-actions">
                        <Button onClick={() => download(certificate)} disabled={action.busy || certificate.status !== "valid"}>
                          <DownloadIcon />
                          下載 PDF
                        </Button>
                        <VerificationLinks url={certificate.verificationUrl} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <Pagination
        {...resource.pagination}
        onPageChange={(page) => {
          resource.pagination.onPageChange(page);
          setOrganization("");
          setSearch("");
        }}
      />
      <p className="field-help page-foot">證書是私人文件。此入口只顯示發給目前登入帳號的證書。</p>
    </div>
  );
}
