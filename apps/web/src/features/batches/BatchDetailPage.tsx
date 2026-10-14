import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { DownloadIcon, EyeOpenIcon, FileTextIcon, ReloadIcon } from "@radix-ui/react-icons";
import { orgPath, post, request } from "../../lib/api";
import { downloadFile } from "../../lib/download";
import { useAction, useResource } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { Batch, Sender } from "../../lib/types";
import { useWorkspace } from "../../app/AppShell";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { BackLink, Loading, LoadError, Notice, PageHeader, Status } from "../../ui/feedback";
import { VerificationLinks } from "../verification/VerificationPage";
import { BatchHistory, LifecycleActions } from "./lifecycle";
import { NotifyPanel } from "./NotifyPanel";
import { PdfPreviewDialog } from "./PdfPreviewDialog";

type Tab = "recipients" | "notifications" | "history";

export function BatchDetailPage() {
  const { organization, permissions } = useWorkspace();
  const { batchId: id = "" } = useParams();
  const resource = useResource<Batch>(orgPath(organization.id, `/batches/${id}`));
  const senders = useResource<{ items: Sender[] }>(
    permissions.includes("mail.send") ? orgPath(organization.id, "/senders") : null,
  );
  const action = useAction();
  const [tab, setTab] = useState<Tab>("recipients");
  const [mailNotice, setMailNotice] = useState<{ kind: "success" | "info"; message: string }>();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ url: string; name: string }>();
  const [previewed, setPreviewed] = useState<Set<string>>(new Set());
  const batch = resource.data;
  const rows = batch?.rows ?? [];
  const generatedCount = rows.filter((row) => row.status.toLowerCase() === "success").length;
  const failedCount = rows.filter((row) => row.status.toLowerCase() === "failed").length;
  const pendingCount = rows.filter((row) => ["pending", "generating"].includes(row.status)).length;
  const allGenerated = rows.length > 0 && generatedCount === rows.length;
  const isProcessing = ["generating", "processing", "queued", "sending"].includes(batch?.status.toLowerCase() ?? "");
  const mailProcessing = batch?.deliveries?.some((d) => ["queued", "sending"].includes(d.status)) ?? false;
  const mailFailures = batch?.deliveries?.filter((d) => ["failed", "unknown"].includes(d.status)).length ?? 0;
  const mailAccepted = batch?.deliveries?.filter((d) => d.status === "accepted").length ?? 0;
  const canDownload = permissions.includes("certificates.download");
  const cancelled = batch?.status === "cancelled";
  const eligibleRows = rows.filter((r) => r.status === "success" && r.certificate && r.certificate.status === "valid");
  const selectedIds = eligibleRows.filter((r) => selection.has(r.certificate!.id)).map((r) => r.certificate!.id);
  const visibleRows = rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "pending"
          ? ["pending", "generating"].includes(r.status)
          : filter === "mail-failed"
            ? batch?.deliveries.some(
                (d) => d.certificateId === r.certificate?.id && ["failed", "unknown"].includes(d.status),
              )
            : ["revoked", "expired"].includes(filter)
              ? r.certificate?.status === filter
              : r.status === filter)) &&
      `${r.data.recipient_name} ${r.data.recipient_email} ${r.certificate?.number ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visibleEligible = visibleRows.filter((r) => eligibleRows.includes(r));
  const needsPreview = previewed.size === 0 && !batch?.previewedAt;
  const reload = resource.reload;

  useEffect(() => {
    if (!isProcessing && !mailProcessing) return;
    const timer = window.setInterval(() => void reload(), 3000);
    return () => window.clearInterval(timer);
  }, [isProcessing, mailProcessing, reload]);

  const afterLifecycle = async () => {
    setPreviewed(new Set());
    action.setSuccess("");
    await reload();
  };
  const zip = (selected: boolean) =>
    void action.run(async () => {
      await downloadFile(
        orgPath(organization.id, `/batches/${id}/zip`),
        `${batch?.eventName ?? "證書"}.zip`,
        selected ? { certificateIds: selectedIds } : {},
      );
    });
  const generate = () =>
    void action.run(async () => {
      await post(orgPath(organization.id, `/batches/${id}/${failedCount > 0 ? "retry" : "generate"}`));
      action.setSuccess("產製工作已提交。你可以離開此頁，工作會在背景繼續。");
      await reload();
    });
  const openPreview = (rowId: string, name: string) =>
    void action.run(async () => {
      const response = await request(orgPath(organization.id, `/batches/${id}/preview`), {
        method: "POST",
        body: JSON.stringify({ rowId }),
      });
      setPreview({ url: URL.createObjectURL(await response.blob()), name });
      setPreviewed((current) => new Set([...current, rowId]));
    });

  const back = <BackLink to={`/o/${organization.id}/batches`}>返回發證活動</BackLink>;
  if (resource.pending)
    return (
      <>
        {back}
        <Loading />
      </>
    );
  if (resource.error && !batch)
    return (
      <>
        {back}
        <LoadError error={resource.error} retry={() => void reload()} />
      </>
    );
  if (!batch) return null;

  const headline = cancelled
    ? "活動已取消，證書已停止使用"
    : isProcessing
      ? "正在背景產製證書"
      : failedCount
        ? "有產製項目需要處理"
        : allGenerated && !eligibleRows.length
          ? "目前沒有有效證書，可重新發放"
          : allGenerated
            ? "證書已準備好，可以下載或通知"
            : "先檢查一份樣張，再開始產製";

  return (
    <div className="batch">
      {back}
      <PageHeader
        title={batch.eventName}
        description="逐一檢查收件人的 PDF，確認產製完成後再發送通知。"
        action={
          <Button variant="quiet" onClick={() => void reload()} aria-busy={resource.loading}>
            <ReloadIcon />
            重新整理
          </Button>
        }
      />
      <div className="stack">
        <Notice message={resource.error} />
        <Notice message={action.error} />
        <Notice message={action.success} kind="success" />
        {mailNotice && <Notice message={mailNotice.message} kind={mailNotice.kind} />}
        {batch.cancelReason && <Notice kind="info" message={`活動已取消：${batch.cancelReason}`} />}
      </div>

      <section className={`batch-overview ${cancelled ? "is-cancelled" : ""}`} aria-label="活動進度">
        <div className="batch-overview-head">
          <div>
            <Status value={batch.status} />
            <h2>{headline}</h2>
            <p className="tabular">
              {generatedCount} / {rows.length} 份成功，{mailAccepted} 封已交付 SMTP
            </p>
          </div>
          <LifecycleActions org={organization.id} batch={batch} permissions={permissions} reload={afterLifecycle} />
        </div>
        <progress
          className="progress"
          aria-label="證書產製進度"
          value={generatedCount + failedCount}
          max={Math.max(rows.length, 1)}
        />
        <dl className="batch-stats">
          <div>
            <dt>收件人</dt>
            <dd className="tabular">
              {rows.length}
              <small> 人</small>
            </dd>
          </div>
          <div>
            <dt>PDF 已產製</dt>
            <dd className="tabular">
              {generatedCount}
              <small> 份</small>
            </dd>
          </div>
          <div>
            <dt>待處理 / 失敗</dt>
            <dd className="tabular">
              {pendingCount}
              <small> / </small>
              {failedCount}
            </dd>
          </div>
          <div>
            <dt>已交付 SMTP</dt>
            <dd className="tabular">
              {mailAccepted}
              <small> 封</small>
            </dd>
          </div>
        </dl>
        {batch.status === "validated" && (
          <p className="field-help">產製前可以編輯活動名稱與名單；開始產製後，請以「重新發放」更正個別證書。</p>
        )}
      </section>

      <div className="toolbar batch-tabs">
        <div className="segmented" role="group" aria-label="活動工作區">
          <button type="button" aria-pressed={tab === "recipients"} onClick={() => setTab("recipients")}>
            收件人與產製
          </button>
          <button type="button" aria-pressed={tab === "notifications"} onClick={() => setTab("notifications")}>
            通知收件人{mailFailures ? `（${mailFailures} 筆異常）` : ""}
          </button>
          <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}>
            操作紀錄
          </button>
        </div>
        <div className="btn-row">
          {permissions.includes("recipients.export") && failedCount + mailFailures > 0 && (
            <Button
              variant="quiet"
              disabled={action.busy}
              onClick={() =>
                void action.run(() =>
                  downloadFile(orgPath(organization.id, `/batches/${id}/failures.csv`), `${batch.eventName}-失敗報告.csv`),
                )
              }
            >
              <DownloadIcon />
              下載失敗報告
            </Button>
          )}
          {canDownload && (
            <Button variant="quiet" disabled={action.busy || !eligibleRows.length} onClick={() => zip(false)}>
              <DownloadIcon />
              下載全部成功 ZIP（{eligibleRows.length}）
            </Button>
          )}
        </div>
      </div>

      {tab === "history" && <BatchHistory org={organization.id} id={id} revision={batch.revision} />}

      {tab === "recipients" && (
        <section className="panel stack" aria-labelledby="recipients-heading">
          <div className="section-title section-title-row">
            <div>
              <h2 id="recipients-heading">收件人與產製結果</h2>
              <p>預覽由伺服器產出，樣張使用示範編號。</p>
            </div>
            {permissions.includes("certificates.generate") && !allGenerated && (
              <Button
                onClick={generate}
                disabled={cancelled || action.busy || isProcessing || !rows.length || needsPreview}
              >
                <FileTextIcon />
                {failedCount > 0 ? "重試失敗項目" : "確認產製 PDF"}
              </Button>
            )}
          </div>
          {!allGenerated && needsPreview && (
            <Notice kind="info" message="請先開啟至少一份 PDF 樣張，檢查版面後才能提交產製。" />
          )}
          <div className="filters">
            <label className="field filters-grow">
              搜尋收件人
              <input
                type="search"
                placeholder="姓名、Email 或證書編號"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="field">
              收件人狀態
              <Select
                label="收件人狀態"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: `全部（${rows.length}）` },
                  { value: "success", label: `產製成功（${generatedCount}）` },
                  { value: "failed", label: `產製失敗（${failedCount}）` },
                  { value: "pending", label: `待處理（${pendingCount}）` },
                  { value: "mail-failed", label: "通知異常" },
                  { value: "revoked", label: "證書已撤銷" },
                  { value: "expired", label: "證書已到期" },
                ]}
              />
            </label>
            {canDownload && (
              <Button disabled={action.busy || !selectedIds.length} onClick={() => zip(true)}>
                <DownloadIcon />
                下載勾選 ZIP（{selectedIds.length}）
              </Button>
            )}
            {selection.size > 0 && (
              <Button variant="ghost" onClick={() => setSelection(new Set())}>
                清除勾選
              </Button>
            )}
          </div>
          <p className="list-count">
            顯示 {visibleRows.length} / {rows.length} 人。篩選不會取消其他列的勾選；ZIP 只包含成功且有效的證書。
          </p>
          <div className="table-wrap recipient-table">
            <table className="data-table recipients-table">
              <thead>
                <tr>
                  {canDownload && (
                    <th>
                      <label className="check-hit">
                        <input
                          type="checkbox"
                        aria-label="勾選目前顯示的成功證書"
                        checked={visibleEligible.length > 0 && visibleEligible.every((r) => selection.has(r.certificate!.id))}
                        disabled={!visibleEligible.length}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelection((current) => {
                            const next = new Set(current);
                            for (const row of visibleEligible) {
                              if (checked) next.add(row.certificate!.id);
                              else next.delete(row.certificate!.id);
                            }
                            return next;
                          });
                        }}
                        />
                      </label>
                    </th>
                  )}
                  <th>序號</th>
                  <th>收件人</th>
                  <th>產製狀態</th>
                  <th>證書編號 / 錯誤</th>
                  <th>通知狀態</th>
                  <th>PDF 與證書</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const deliveries = batch.deliveries?.filter((d) => d.certificateId === row.certificate?.id) ?? [];
                  return (
                    <tr key={row.id}>
                      {canDownload && (
                        <td>
                          <label className="check-hit">
                            <input
                              type="checkbox"
                            aria-label={`勾選 ${row.data.recipient_name} 的證書`}
                            checked={!!row.certificate && selection.has(row.certificate.id)}
                            disabled={!eligibleRows.includes(row)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelection((current) => {
                                const next = new Set(current);
                                if (checked) next.add(row.certificate!.id);
                                else next.delete(row.certificate!.id);
                                return next;
                              });
                            }}
                            />
                          </label>
                        </td>
                      )}
                      <td className="tabular">{rows.indexOf(row) + 1}</td>
                      <td>
                        <span className="cell-title">{row.data.recipient_name}</span>
                        <span className="cell-sub">來源列號 {row.rowNumber}</span>
                        <span className="cell-sub">{row.data.recipient_email}</span>
                      </td>
                      <td>
                        <span className="status-stack">
                          <Status value={row.status} />
                          {row.certificate && <Status value={row.certificate.status ?? "valid"} />}
                        </span>
                      </td>
                      <td className="tabular">
                        {row.error ? <span className="danger-text">{row.error}</span> : (row.certificate?.number ?? "等待產製")}
                      </td>
                      <td>
                        {deliveries.map((d) => (
                          <Status key={d.id} value={d.status} />
                        ))}
                        {!deliveries.length && <span className="field-help">尚未通知</span>}
                      </td>
                      <td className="cell-pdf">
                        <div className="btn-row">
                          {canDownload && eligibleRows.includes(row) && (
                            <Button
                              variant="quiet"
                              size="sm"
                              disabled={action.busy}
                              onClick={() =>
                                void action.run(() =>
                                  downloadFile(
                                    orgPath(organization.id, `/certificates/${row.certificate!.id}/pdf`),
                                    `${row.certificate!.number}.pdf`,
                                  ),
                                )
                              }
                            >
                              <DownloadIcon />
                              正式 PDF
                            </Button>
                          )}
                          <Button
                            variant="quiet"
                            size="sm"
                            disabled={cancelled || action.busy || !permissions.includes("certificates.generate")}
                            onClick={() => openPreview(row.id, row.data.recipient_name ?? "")}
                          >
                            <EyeOpenIcon />
                            {previewed.has(row.id) ? "再次預覽" : "預覽 PDF"}
                          </Button>
                        </div>
                        {row.certificate && (
                          <>
                            <p className="field-help">
                              效期：{row.certificate.expiresAt ? formatDate(row.certificate.expiresAt) : "無到期日"}
                            </p>
                            <VerificationLinks url={row.certificate.verificationUrl} />
                          </>
                        )}
                        <LifecycleActions
                          org={organization.id}
                          batch={batch}
                          row={row}
                          permissions={permissions}
                          reload={afterLifecycle}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visibleRows.length && <p className="empty-filter">沒有符合篩選條件的收件人。</p>}
          </div>
        </section>
      )}

      {tab === "notifications" && (
        <NotifyPanel
          organization={organization}
          permissions={permissions}
          batch={batch}
          senders={senders}
          eligibleCount={eligibleRows.length}
          readyForMail={
            eligibleRows.length > 0 &&
            rows.filter((r) => r.certificate?.status === "valid").every((r) => r.status === "success")
          }
          blocked={cancelled || isProcessing || mailProcessing}
          mailProcessing={mailProcessing}
          mailAccepted={mailAccepted}
          mailFailures={mailFailures}
          onSent={async (result) => {
            setMailNotice(
              result.queued
                ? { kind: "success", message: `${result.message}。SMTP 接受郵件後，最終投遞狀態仍可能未知。` }
                : { kind: "info", message: result.message },
            );
            await reload();
          }}
        />
      )}
      {preview && <PdfPreviewDialog preview={preview} onClose={() => setPreview(undefined)} />}
    </div>
  );
}
