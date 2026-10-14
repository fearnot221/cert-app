import { useState, type FormEvent } from "react";
import { PaperPlaneIcon, ReloadIcon } from "@radix-ui/react-icons";
import { orgPath, post } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import type { Batch, Organization, Sender } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { Notice, Status } from "../../ui/feedback";

const usableSender = ["active", "verified", "enabled", "development"];
const retryableStatuses = ["failed", "cancelled"];

/** What the send and retry endpoints return; `queued` can be 0 when every recipient was skipped. */
export type MailResult = { ok: boolean; queued: number; message: string };

export function NotifyPanel({
  organization, permissions, batch, senders, eligibleCount, readyForMail, blocked, mailProcessing, mailAccepted,
  mailFailures, onSent,
}: {
  organization: Organization;
  permissions: string[];
  batch: Batch;
  senders: { data?: { items: Sender[] }; error: string; loading: boolean; reload: () => Promise<void> };
  eligibleCount: number;
  readyForMail: boolean;
  blocked: boolean;
  mailProcessing: boolean;
  mailAccepted: number;
  mailFailures: number;
  onSent: (result: MailResult) => Promise<void>;
}) {
  const action = useAction();
  const [senderId, setSenderId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryReason, setRetryReason] = useState("");
  if (!permissions.includes("mail.send") || !permissions.includes("certificates.issue"))
    return <Notice kind="info" message="此角色沒有通知收件人的權限。" />;
  const enabledSenders = senders.data?.items.filter((s) => usableSender.includes(s.status.toLowerCase())) ?? [];
  const sender = enabledSenders.find((item) => item.id === senderId);
  const rows = batch.rows;
  const send = () =>
    void action.run(async () => {
      const result = await post<MailResult>(orgPath(organization.id, `/batches/${batch.id}/send`), {
        senderIdentityId: senderId,
      });
      setConfirming(false);
      await onSent(result);
    });
  const retryableCount =
batch.deliveries?.filter((d) => retryableStatuses.includes(d.status)).length ?? 0;
  const retry = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const result = await post<MailResult>(orgPath(organization.id, `/batches/${batch.id}/deliveries/retry`), {
        senderIdentityId: senderId,
        reason: retryReason.trim(),
      });
      setRetrying(false);
      setRetryReason("");
      await onSent(result);
    });
  };
  return (
    <section className="panel stack notify" aria-labelledby="notify-heading">
      <div className="section-title">
        <h2 id="notify-heading">通知收件人</h2>
        <p>產製與寄信分開執行，通知只使用此組織被授權的寄件身分。</p>
      </div>
      <Notice message={senders.error} />
      <Notice message={action.error} />
      {senders.error && (
        <div>
          <Button variant="quiet" onClick={() => void senders.reload()}>
            重新載入寄件身分
          </Button>
        </div>
      )}
      <div className="filters">
        <label className="field filters-grow">
          寄件身分
          <Select
            label="寄件身分"
            value={senderId}
            onChange={(value) => {
              setSenderId(value);
              setConfirming(false);
              setRetrying(false);
            }}
            disabled={senders.loading || action.busy}
            placeholder={senders.loading ? "載入中…" : "選擇可用寄件身分"}
            options={enabledSenders.map((s) => ({
              value: s.id,
              label: `${s.displayName} <${s.fromAddress}>${s.status === "development" ? "（Mailpit 測試）" : ""}`,
            }))}
          />
        </label>
        <Button disabled={!readyForMail || !sender || blocked || action.busy} onClick={() => setConfirming(true)}>
          <PaperPlaneIcon />
          檢查發送內容
        </Button>
      </div>
      {sender?.status === "development" && (
        <Notice
          kind="info"
          message="目前使用 Mailpit 開發測試寄件身分，通知會送往本地測試郵箱，不代表正式 SMTP 已設定完成。"
        />
      )}
      {!readyForMail && <p className="field-help">需等有效證書產製成功，才能發送通知。已撤銷的證書不會寄出。</p>}
      {!senders.loading && !enabledSenders.length && (
        <Notice kind="info" message="沒有可用的寄件身分。請由平台管理員設定並授權 SMTP 連線與指定 From 地址。" />
      )}
      {confirming && sender && (
        <div className="send-confirm">
          <h3>確認發送通知</h3>
          <dl className="facts">
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
              <dd>{eligibleCount} 人，每人獨立一封郵件</dd>
            </div>
          </dl>
          <div className="mail-example">
            <p className="field-help">通知內容摘要</p>
            <p>
              {organization.name} 已發給你「{batch.eventName}」證書。
            </p>
            <p>新帳號會收到一次性啟用連結；已有帳號會收到登入領取通知。</p>
          </div>
          <div className="btn-row">
            <Button variant="quiet" onClick={() => setConfirming(false)} disabled={action.busy}>
              返回檢查
            </Button>
            <Button onClick={send} disabled={action.busy || batch.status === "cancelled" || !eligibleCount}>
              {action.busy ? "提交中…" : `確認通知 ${eligibleCount} 位收件人`}
            </Button>
          </div>
        </div>
      )}
      {retryableCount > 0 && !confirming && (
        <div className="send-confirm">
          <div className="toolbar">
            <div>
              <h3>重試失敗通知</h3>
              <p className="field-help">
                {retryableCount} 封通知先前失敗或被取消。重試只會重新排入這些郵件；結果不確定的郵件請先以 Message-ID 人工核對。
              </p>
            </div>
            {!retrying && (
              <Button variant="quiet" disabled={!sender || blocked || action.busy} onClick={() => setRetrying(true)}>
                <ReloadIcon />
                重試失敗通知
              </Button>
            )}
          </div>
          {!sender && <p className="field-help">請先在上方選擇寄件身分。</p>}
          {retrying && sender && (
            <form className="stack" onSubmit={retry}>
              <label className="field">
                重試原因
                <textarea
                  value={retryReason}
                  maxLength={500}
                  required
                  onChange={(e) => setRetryReason(e.target.value)}
                  placeholder="例如：SMTP 暫時無法連線，已確認恢復"
                />
              </label>
              <div className="btn-row">
                <Button variant="quiet" onClick={() => setRetrying(false)} disabled={action.busy}>
                  返回
                </Button>
                <Button type="submit" disabled={action.busy || !retryReason.trim()}>
                  {action.busy ? "提交中…" : `確認重試 ${retryableCount} 封通知`}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      <div className="notification-summary">
        <strong className="tabular">{mailAccepted} 封已交付 SMTP</strong>
        <span>{mailProcessing ? "通知仍在背景處理，畫面會自動更新。" : `${mailFailures} 筆失敗或結果不確定`}</span>
      </div>
      {batch.deliveries?.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>收件人</th>
                <th>狀態</th>
                <th>錯誤／確認資訊</th>
              </tr>
            </thead>
            <tbody>
              {batch.deliveries.map((d) => {
                const row = rows.find((r) => r.certificate?.id === d.certificateId);
                return (
                  <tr key={d.id}>
                    <td>
                      <span className="cell-title">{row?.data.recipient_name}</span>
                      <span className="cell-sub">{row?.data.recipient_email}</span>
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
      <p className="field-help">「已交付 SMTP」表示郵件伺服器已接受，並不代表對方已收到或閱讀。</p>
    </section>
  );
}
