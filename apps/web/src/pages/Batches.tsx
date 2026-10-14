import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  EyeOpenIcon,
  FileTextIcon,
  PaperPlaneIcon,
  PlusIcon,
  ReloadIcon,
  Cross2Icon,
} from "@radix-ui/react-icons";
import { orgPath, post, request } from "../lib/api";
import { useAction, usePagedResource, useResource } from "../lib/hooks";
import type { Batch, Organization, Sender } from "../lib/types";
import {
  Alert,
  Empty,
  formatDate,
  Loading,
  LoadError,
  PageHeading,
  Pagination,
  Status,
} from "../components/common";
import { Button } from "../components/ui/button";

import { VerificationLinks } from "./Verification";
import { BatchHistory, LifecycleActions } from "./Lifecycle";
import { CreateBatch } from "./CreateBatch";
import { downloadFile } from "../lib/download";

export function Batches({
  organization,
  permissions,
}: {
  organization: Organization;
  permissions: string[];
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [layout, setLayout] = useState<"cards" | "table">("cards");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = usePagedResource<Batch>(
    orgPath(
      organization.id,
      `/batches?search=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`,
    ),
    12,
  );
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canImport = permissions.includes("recipients.import");
  if (selectedId)
    return (
      <BatchDetail
        id={selectedId}
        organization={organization}
        permissions={permissions}
        onClose={() => {
          setSelectedId(null);
          void resource.reload();
        }}
      />
    );
  if (creating)
    return (
      <CreateBatch
        organization={organization}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setSelectedId(id);
        }}
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="發證作業"
        title="發證活動"
        description="從名單到證書，掌握每個活動的進度。"
        action={
          canImport && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              建立發證活動
            </Button>
          )
        }
      />
      <div className="activity-toolbar panel activity-filters">
        <label>
          搜尋活動
          <input
            type="search"
            placeholder="輸入活動名稱"
            maxLength={160}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          活動狀態
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部狀態</option>
            <option value="validated">待產製</option>
            <option value="generating">產製中</option>
            <option value="generated">已產製</option>
            <option value="cancelled">已取消</option><option value="failed">需要處理</option>
          </select>
        </label>
        <div className="segmented" role="group" aria-label="活動顯示方式">
          <button
            aria-pressed={layout === "cards"}
            onClick={() => setLayout("cards")}
          >
            卡片
          </button>
          <button
            aria-pressed={layout === "table"}
            onClick={() => setLayout("table")}
          >
            列表
          </button>
        </div>
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <LoadError
          error={resource.error}
          retry={() => void resource.reload()}
        />
      ) : !resource.data?.items.length ? (
        <Empty
          title={search || status ? "沒有符合的活動" : "建立你的第一個發證活動"}
          description={
            search || status
              ? "調整搜尋文字或狀態，查看其他活動。"
              : "上傳 Excel／CSV 或手動輸入名單。產製完成後，可下載 ZIP 或通知收件人。"
          }
          action={
            canImport &&
            !search &&
            !status && (
              <Button variant="outline" onClick={() => setCreating(true)}>
                <PlusIcon />
                建立第一個活動
              </Button>
            )
          }
        />
      ) : layout === "cards" ? (
        <div className="activity-grid">
          {resource.data.items.map((batch) => (
            <article className="panel activity-card" key={batch.id}>
              <div className="activity-card-top">
                <span className="activity-symbol">
                  <FileTextIcon />
                </span>
                <Status value={batch.status} />
              </div>
              <h2>{batch.eventName}</h2>
              <p>{batch._count?.rows ?? 0} 位收件人</p>
              <footer>
                <span>{formatDate(batch.createdAt)}</span>
                <Button
                  variant="ghost"
                  onClick={() => setSelectedId(batch.id)}
                  aria-label={`開啟活動：${batch.eventName}`}
                >
                  {batch.status === "failed"
                    ? "處理失敗項目"
                    : batch.status === "generated"
                      ? "下載與通知"
                      : "繼續作業"}
                  <ArrowRightIcon />
                </Button>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>活動名稱</th>
                <th>收件人</th>
                <th>狀態</th>
                <th>建立時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {resource.data.items.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <strong>{batch.eventName}</strong>
                  </td>
                  <td>{batch._count?.rows ?? 0} 人</td>
                  <td>
                    <Status value={batch.status} />
                  </td>
                  <td>{formatDate(batch.createdAt)}</td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedId(batch.id)}
                    >
                      開啟活動
                      <ArrowRightIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...resource.pagination} loading={resource.loading} />
    </>
  );
}

function BatchDetail({
  id,
  organization,
  permissions,
  onClose,
}: {
  id: string;
  organization: Organization;
  permissions: string[];
  onClose: () => void;
}) {
  const resource = useResource<Batch>(
    orgPath(organization.id, `/batches/${id}`),
  );
  const senders = useResource<{ items: Sender[] }>(
    permissions.includes("mail.send")
      ? orgPath(organization.id, "/senders")
      : null,
  );
  const action = useAction();
  const [tab, setTab] = useState<"recipients" | "notifications" | "history">("recipients");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [senderId, setSenderId] = useState("");
  const [sendConfirm, setSendConfirm] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string }>();
  const [previewed, setPreviewed] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const batch = resource.data;
  const rows = batch?.rows ?? [];
  const generatedCount = rows.filter(
    (row) => row.status.toLowerCase() === "success",
  ).length;
  const failedCount = rows.filter(
    (row) => row.status.toLowerCase() === "failed",
  ).length;
  const pendingCount = rows.filter(row => ["pending", "generating"].includes(row.status)).length;
  const allGenerated = rows.length > 0 && generatedCount === rows.length;
  const enabledSenders =
    senders.data?.items.filter((sender) =>
      ["active", "verified", "enabled", "development"].includes(
        sender.status.toLowerCase(),
      ),
    ) ?? [];
  const sender = enabledSenders.find((item) => item.id === senderId);
  const isProcessing = [
    "generating",
    "processing",
    "queued",
    "sending",
  ].includes(batch?.status.toLowerCase() ?? "");
  const mailProcessing =
    batch?.deliveries?.some((d) => ["queued", "sending"].includes(d.status)) ??
    false;
  const mailFailures =
    batch?.deliveries?.filter((d) => ["failed", "unknown"].includes(d.status))
      .length ?? 0;
  const mailAccepted =
    batch?.deliveries?.filter((d) => d.status === "accepted").length ?? 0;
  const canDownload = permissions.includes("certificates.download");
  const eligibleRows = rows.filter(
    (r) =>
      r.status === "success" &&
      r.certificate &&
      r.certificate.status === "valid",
  );
  const readyForMail = eligibleRows.length > 0 && rows.filter(r => r.certificate?.status === "valid").every(r => r.status === "success");
  const selectedIds = eligibleRows
    .filter((r) => selection.has(r.certificate!.id))
    .map((r) => r.certificate!.id);
  const visibleRows = rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "pending"
          ? ["pending", "generating"].includes(r.status)
          : filter === "mail-failed"
            ? batch?.deliveries.some(
                (d) =>
                  d.certificateId === r.certificate?.id &&
                  ["failed", "unknown"].includes(d.status),
              )
            : ["revoked", "expired"].includes(filter) ? r.certificate?.status === filter : r.status === filter)) &&
      `${r.data.recipient_name} ${r.data.recipient_email} ${r.certificate?.number ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visibleEligible = visibleRows.filter((r) => eligibleRows.includes(r));
  const zip = (selected: boolean) =>
    void action.run(async () => {
      await downloadFile(
        orgPath(organization.id, `/batches/${id}/zip`),
        `${batch?.eventName ?? "證書"}.zip`,
        selected ? { certificateIds: selectedIds } : {},
      );
    });
  useEffect(() => {
    if (!isProcessing && !mailProcessing) return;
    const timer = window.setInterval(() => void resource.reload(), 3000);
    return () => window.clearInterval(timer);
  }, [isProcessing, mailProcessing, resource.reload]);
  useEffect(() => {
    if (preview) dialogRef.current?.showModal();
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);
  const generate = () =>
    void action.run(async () => {
      await post(
        orgPath(
          organization.id,
          `/batches/${id}/${failedCount > 0 ? "retry" : "generate"}`,
        ),
      );
      action.setSuccess("產製工作已提交。你可以離開此頁，工作會在背景繼續。");
      await resource.reload();
    });
  const send = () =>
    void action.run(async () => {
      await post(orgPath(organization.id, `/batches/${id}/send`), {
        senderIdentityId: senderId,
      });
      setSendConfirm(false);
      action.setSuccess(
        "通知工作已提交。SMTP 接受郵件後，最終投遞狀態仍可能未知。",
      );
      await resource.reload();
    });
  const openPreview = (rowId: string, name: string) =>
    void action.run(async () => {
      const response = await request(
        orgPath(organization.id, `/batches/${id}/preview`),
        { method: "POST", body: JSON.stringify({ rowId }) },
      );
      setPreview({ url: URL.createObjectURL(await response.blob()), name });
      setPreviewed((current) => new Set([...current, rowId]));
    });
  if (resource.loading && !batch) return <Loading />;
  if (resource.error && !batch)
    return (
      <LoadError error={resource.error} retry={() => void resource.reload()} />
    );
  if (!batch) return null;
  return (
    <>
      <Button variant="ghost" className="back-button" onClick={onClose}>
        <ArrowLeftIcon />
        返回發證活動
      </Button>
      <PageHeading
        eyebrow={organization.name}
        title={batch.eventName}
        description="檢查每一位收件人的 PDF，確認產製完成後再發送通知。"
        action={
          <Button
            variant="outline"
            onClick={() => void resource.reload()}
            disabled={resource.loading}
          >
            <ReloadIcon />
            重新整理
          </Button>
        }
      />
      <Alert message={resource.error} />
      <Alert message={action.error} />
      <Alert message={action.success} kind="success" />
      <LifecycleActions org={organization.id} batch={batch} permissions={permissions} reload={async () => { setPreviewed(new Set()); action.setSuccess(""); await resource.reload(); }} />
      {batch.status === "validated" && <p className="field-help">產製前可編輯活動名稱與名單；開始產製後，請以重新發放更正個別證書。</p>}
      {batch.cancelReason && <Alert kind="info" message={`活動已取消：${batch.cancelReason}`} />}
      <section className="batch-summary panel">
        <div>
          <span className="summary-label">活動狀態</span>
          <Status value={batch.status} />
        </div>
        <div>
          <span className="summary-label">收件人</span>
          <strong>
            {rows.length}
            <small> 人</small>
          </strong>
        </div>
        <div>
          <span className="summary-label">PDF 已產製</span>
          <strong>
            {generatedCount}
            <small> 份</small>
          </strong>
        </div>
        <div>
          <span className="summary-label">待處理 / 失敗</span>
          <strong>
            {pendingCount}
            <small> / </small>
            {failedCount}
          </strong>
        </div>
      </section>
      <section className="activity-progress panel">
        <div>
          <strong>
            {batch.status === "cancelled" ? "活動已取消，證書已停止使用" : isProcessing
              ? "正在背景產製證書"
              : failedCount
                ? "有產製項目需要處理"
                : allGenerated && !eligibleRows.length ? "目前沒有有效證書，可重新發放" : allGenerated
                  ? "證書已準備好，可下載或通知"
                  : "先檢查一份樣張，再開始產製"}
          </strong>
          <span>
            {generatedCount} / {rows.length} 份成功 · {mailAccepted} 封已交付
            SMTP
          </span>
        </div>
        <progress
          aria-label="證書產製進度"
          value={generatedCount + failedCount}
          max={Math.max(rows.length, 1)}
        />
      </section>
      <div className="activity-toolbar">
        <div className="segmented" role="group" aria-label="活動工作區">
          <button aria-pressed={tab === "history"} onClick={() => setTab("history")}>操作紀錄</button>
          <button
            aria-pressed={tab === "recipients"}
            onClick={() => setTab("recipients")}
          >
            收件人與產製
          </button>
          <button
            aria-pressed={tab === "notifications"}
            onClick={() => setTab("notifications")}
          >
            通知收件人{mailFailures ? `（${mailFailures} 筆異常）` : ""}
          </button>
        </div>
        <div className="button-row">
          {permissions.includes("recipients.export") && (
            <Button
              variant="outline"
              disabled={action.busy || !(failedCount + mailFailures)}
              onClick={() =>
                void action.run(() =>
                  downloadFile(
                    orgPath(organization.id, `/batches/${id}/failures.csv`),
                    `${batch.eventName}-失敗報告.csv`,
                  ),
                )
              }
            >
              <DownloadIcon />
              下載失敗報告
            </Button>
          )}
          {canDownload && (
            <Button
              variant="outline"
              disabled={action.busy || !eligibleRows.length}
              onClick={() => zip(false)}
            >
              <DownloadIcon />
              下載全部成功 ZIP（{eligibleRows.length}）
            </Button>
          )}
        </div>
      </div>
      {tab === "history" && <BatchHistory org={organization.id} id={id} revision={batch.revision} />}
      {tab === "recipients" && (
        <>
          <div className="batch-actions">
            <div>
              <h2>收件人與產製結果</h2>
              <p>預覽使用伺服器 renderer；樣張以示範編號顯示。</p>
            </div>
            {permissions.includes("certificates.generate") && (
              <Button
                onClick={generate}
                disabled={
                  batch.status === "cancelled" || action.busy ||
                  isProcessing ||
                  allGenerated ||
                  !rows.length ||
                  (previewed.size === 0 && !batch.previewedAt)
                }
              >
                <FileTextIcon />
                {failedCount > 0 ? "重試失敗項目" : "確認產製 PDF"}
              </Button>
            )}
          </div>
          {!allGenerated && previewed.size === 0 && !batch.previewedAt && (
            <p className="field-help mb-4">
              請先開啟至少一份 PDF 樣張，檢查版面後才能提交產製。
            </p>
          )}
          <div className="activity-toolbar recipient-filters">
            <label>
              搜尋收件人
              <input
                type="search"
                placeholder="姓名、Email 或證書編號"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              收件人狀態
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">全部（{rows.length}）</option>
                <option value="success">產製成功（{generatedCount}）</option>
                <option value="failed">產製失敗（{failedCount}）</option>
                <option value="pending">待處理（{pendingCount}）</option>
                <option value="mail-failed">通知異常</option><option value="revoked">證書已撤銷</option><option value="expired">證書已到期</option>
              </select>
            </label>
            {canDownload && (
              <Button
                disabled={action.busy || !selectedIds.length}
                onClick={() => zip(true)}
              >
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
          <p className="field-help mb-4">
            顯示 {visibleRows.length} / {rows.length}{" "}
            人。篩選不會取消其他列的勾選；ZIP 僅含成功且有效的證書。
          </p>
          <div className="panel table-scroll recipient-table">
            <table>
              <thead>
                <tr>
                  {canDownload && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="勾選目前顯示的成功證書"
                        checked={
                          visibleEligible.length > 0 &&
                          visibleEligible.every((r) =>
                            selection.has(r.certificate!.id),
                          )
                        }
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
                    </th>
                  )}
                  <th>序號</th>
                  <th>收件人</th>
                  <th>產製狀態</th>
                  <th className="certificate-column">證書編號 / 錯誤</th>
                  <th>通知狀態</th>
                  <th className="pdf-column">PDF</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    {canDownload && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`勾選 ${row.data.recipient_name} 的證書`}
                          checked={
                            !!row.certificate &&
                            selection.has(row.certificate.id)
                          }
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
                      </td>
                    )}
                    <td>{rows.indexOf(row) + 1}</td>
                    <td>
                      <strong>{row.data.recipient_name}</strong><span className="cell-sub">來源列號 {row.rowNumber}</span>
                      <span className="cell-sub">
                        {row.data.recipient_email}
                      </span>
                    </td>
                    <td>
                      <Status value={row.status} />{row.certificate && <Status value={row.certificate.status ?? "valid"} />}
                    </td>
                    <td>
                      {row.error ? (
                        <span className="danger-text">{row.error}</span>
                      ) : (
                        (row.certificate?.number ?? "等待產製")
                      )}
                    </td>
                    <td>
                      {batch.deliveries
                        ?.filter((d) => d.certificateId === row.certificate?.id)
                        .map((d) => (
                          <Status key={d.id} value={d.status} />
                        ))}
                      {!batch.deliveries?.some(
                        (d) => d.certificateId === row.certificate?.id,
                      ) && <span className="field-help">尚未通知</span>}
                    </td>
                    <td>
                      <div className="button-row">
                        {canDownload && eligibleRows.includes(row) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(() =>
                                downloadFile(
                                  orgPath(
                                    organization.id,
                                    `/certificates/${row.certificate!.id}/pdf`,
                                  ),
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
                          variant="ghost"
                          size="sm"
                          disabled={
                            batch.status === "cancelled" || action.busy ||
                            !permissions.includes("certificates.generate")
                          }
                          onClick={() =>
                            openPreview(row.id, row.data.recipient_name ?? "")
                          }
                        >
                          <EyeOpenIcon />
                          {previewed.has(row.id) ? "再次預覽" : "預覽 PDF"}
                        </Button>
                      </div>
                      {row.certificate && <><p className="field-help">效期：{row.certificate.expiresAt ? formatDate(row.certificate.expiresAt) : "無到期日"}</p><VerificationLinks url={row.certificate.verificationUrl} /></>}
                      <LifecycleActions org={organization.id} batch={batch} row={row} permissions={permissions} reload={async () => { setPreviewed(new Set()); action.setSuccess(""); await resource.reload(); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length && (
              <p className="empty-filter">沒有符合篩選條件的收件人。</p>
            )}
          </div>
        </>
      )}
      {tab === "notifications" &&
        (!permissions.includes("mail.send") ||
          !permissions.includes("certificates.issue")) && (
          <Alert kind="info" message="此角色沒有通知收件人的權限。" />
        )}
      {tab === "notifications" &&
        permissions.includes("mail.send") &&
        permissions.includes("certificates.issue") && (
          <section className="panel send-panel">
            <div className="section-title">
              <span className="step-number">
                <PaperPlaneIcon />
              </span>
              <div>
                <h2>通知收件人</h2>
                <p>產製與寄信分開執行，通知只使用此組織被授權的寄件身分。</p>
              </div>
            </div>
            <Alert message={senders.error} />
            {senders.error && (
              <Button variant="outline" onClick={() => void senders.reload()}>
                重新載入寄件身分
              </Button>
            )}
            <div className="send-controls">
              <label>
                寄件身分
                <select
                  value={senderId}
                  onChange={(e) => {
                    setSenderId(e.target.value);
                    setSendConfirm(false);
                  }}
                  disabled={senders.loading || action.busy}
                >
                  <option value="">
                    {senders.loading ? "載入中…" : "選擇可用寄件身分"}
                  </option>
                  {enabledSenders.map((sender) => (
                    <option value={sender.id} key={sender.id}>
                      {sender.displayName} &lt;{sender.fromAddress}&gt;
                      {sender.status === "development" ? " · Mailpit 測試" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={
                  !readyForMail ||
                  !sender ||
                  batch.status === "cancelled" || action.busy ||
                  isProcessing ||
                  mailProcessing
                }
                onClick={() => setSendConfirm(true)}
              >
                <PaperPlaneIcon />
                檢查發送內容
              </Button>
            </div>
            {sender?.status === "development" && (
              <Alert
                kind="info"
                message="目前使用 Mailpit 開發測試寄件身分，通知會送往本地測試郵箱，不代表正式 SMTP 已設定完成。"
              />
            )}
            {!readyForMail && (
              <p className="field-help">
                需等有效證書產製成功，才能發送通知。已撤銷的證書不會寄出。
              </p>
            )}
            {!senders.loading && !enabledSenders.length && (
              <Alert
                kind="info"
                message="沒有可用的寄件身分。請由平台管理員設定並授權 SMTP 連線與指定 From 地址。"
              />
            )}
            {sendConfirm && sender && (
              <div className="send-confirm">
                <h3>確認發送通知</h3>
                <dl>
                  <div>
                    <dt>組織</dt>
                    <dd>{organization.name}</dd>
                  </div>
                  <div>
                    <dt>活動</dt>
                    <dd>{batch.eventName}</dd>
                  </div>
                  <div>
                    <dt>寄件者</dt>
                    <dd>
                      {sender.displayName} &lt;{sender.fromAddress}&gt;
                    </dd>
                  </div>
                  <div>
                    <dt>收件人</dt>
                    <dd>{eligibleRows.length} 人，每人獨立一封郵件</dd>
                  </div>
                </dl>
                <div className="mail-example">
                  <span>通知內容摘要</span>
                  <p>
                    {organization.name} 已發給你「{batch.eventName}」證書。
                  </p>
                  <p>
                    新帳號會收到一次性啟用連結；已有帳號會收到登入領取通知。
                  </p>
                </div>
                <div className="button-row">
                  <Button
                    variant="outline"
                    onClick={() => setSendConfirm(false)}
                    disabled={action.busy}
                  >
                    返回檢查
                  </Button>
                  <Button onClick={send} disabled={action.busy || batch.status === "cancelled" || !eligibleRows.length}>
                    {action.busy
                      ? "提交中…"
                      : `確認通知 ${rows.length} 位收件人`}
                  </Button>
                </div>
              </div>
            )}
            <div className="notification-summary">
              <strong>{mailAccepted} 封已交付 SMTP</strong>
              <span>
                {mailProcessing
                  ? "通知仍在背景處理，畫面會自動更新。"
                  : `${mailFailures} 筆失敗或結果不確定`}
              </span>
            </div>
            {batch.deliveries?.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>收件人</th>
                      <th>狀態</th>
                      <th>錯誤／確認資訊</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.deliveries.map((d) => {
                      const row = rows.find(
                        (r) => r.certificate?.id === d.certificateId,
                      );
                      return (
                        <tr key={d.id}>
                          <td>
                            {row?.data.recipient_name}
                            <span className="cell-sub">
                              {row?.data.recipient_email}
                            </span>
                          </td>
                          <td>
                            <Status value={d.status} />
                          </td>
                          <td>{d.error || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="field-help mt-4">
              「已交付 SMTP」表示郵件伺服器已接受，並不代表對方已收到或閱讀。
            </p>
          </section>
        )}
      {preview && (
        <dialog
          ref={dialogRef}
          className="pdf-dialog"
          onCancel={() => setPreview(undefined)}
          onClose={() => setPreview(undefined)}
        >
          <header>
            <div>
              <h2>{preview.name} · PDF 樣張</h2>
              <p>伺服器產出。若瀏覽器無法顯示 PDF，請下載樣張查看。</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="關閉預覽"
              onClick={() => {
                dialogRef.current?.close();
                setPreview(undefined);
              }}
            >
              <Cross2Icon />
            </Button>
          </header>
          <iframe title={`${preview.name} 的證書 PDF 預覽`} src={preview.url} />
          <footer>
            <Button asChild variant="outline">
              <a href={preview.url} download="證書樣張.pdf">
                <DownloadIcon />
                下載樣張
              </a>
            </Button>
            <Button
              onClick={() => {
                dialogRef.current?.close();
                setPreview(undefined);
              }}
            >
              完成檢查
            </Button>
          </footer>
        </dialog>
      )}
    </>
  );
}
