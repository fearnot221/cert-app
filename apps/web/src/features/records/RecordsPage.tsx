import { ReloadIcon } from "@radix-ui/react-icons";
import { orgPath } from "../../lib/api";
import { usePagedResource } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { Audit, Delivery } from "../../lib/types";
import { useWorkspace } from "../../app/AppShell";
import { Button } from "../../ui/Button";
import { Empty, Loading, LoadError, Notice, PageHeader, Pagination, Status } from "../../ui/feedback";
import { AuditDetail } from "../batches/lifecycle";

export function RecordsPage({ kind }: { kind: "deliveries" | "audit" }) {
  const { organization } = useWorkspace();
  const resource = usePagedResource<Audit | Delivery>(orgPath(organization.id, `/${kind}`));
  const mail = kind === "deliveries";
  return (
    <>
      <PageHeader
        title={mail ? "郵件寄送紀錄" : "稽核紀錄"}
        description={
          mail
            ? "追蹤每封通知的處理狀態，保留 SMTP 回應與結果。"
            : "查看此組織的敏感操作、執行者與發生時間。紀錄只能新增，不能修改或刪除。"
        }
        action={
          <Button variant="quiet" disabled={resource.loading} onClick={() => void resource.reload()}>
            <ReloadIcon />
            重新整理
          </Button>
        }
      />
      {mail && (
        <div className="stack records-note">
          <Notice
            kind="info"
            message="「已交付 SMTP」代表郵件伺服器已接受。沒有可靠投遞事件時，最終投遞狀態未知；結果不確定的郵件應先人工確認，避免重複寄送。"
          />
        </div>
      )}
      {resource.pending ? (
        <Loading />
      ) : resource.error && !resource.data ? (
        <LoadError error={resource.error} retry={() => void resource.reload()} />
      ) : !resource.data?.items.length ? (
        <Empty
          title={mail ? "還沒有通知紀錄" : "還沒有稽核紀錄"}
          description={
            mail
              ? "在發證活動確認發送後，每位收件人的處理結果會列在這裡。"
              : "模板儲存、發布、發證與通知等操作完成後，會留下可追查的紀錄。"
          }
        />
      ) : (
        <div className="table-wrap" aria-busy={resource.loading}>
          <table className="data-table">
            <thead>
              {mail ? (
                <tr>
                  <th>收件人</th>
                  <th>郵件狀態</th>
                  <th>時間</th>
                  <th>Message ID / 診斷</th>
                </tr>
              ) : (
                <tr>
                  <th>操作</th>
                  <th>執行者</th>
                  <th>資源</th>
                  <th>時間</th>
                </tr>
              )}
            </thead>
            <tbody>
              {resource.data.items.map((item) => {
                if (mail) {
                  const delivery = item as Delivery;
                  const error = delivery.error ?? delivery.lastError;
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="cell-title">
                          {delivery.recipientEmail ?? delivery.toAddress ?? delivery.recipient?.email ?? "收件人資料未提供"}
                        </span>
                        {delivery.senderIdentity && <span className="cell-sub">由 {delivery.senderIdentity.fromAddress}</span>}
                      </td>
                      <td>
                        <Status value={delivery.status} />
                      </td>
                      <td className="tabular">{formatDate(delivery.createdAt)}</td>
                      <td>
                        <span className="code-small">{delivery.messageId ?? "尚無 Message ID"}</span>
                        {error && <span className="cell-sub danger-text">{error}</span>}
                      </td>
                    </tr>
                  );
                }
                const audit = item as Audit;
                return (
                  <tr key={item.id}>
                    <td>
                      <AuditDetail audit={audit} />
                    </td>
                    <td>{audit.actor?.email ?? audit.actorId ?? "系統"}</td>
                    <td>
                      <span>{audit.resourceType ?? "組織作業"}</span>
                      <span className="cell-sub code-small">{audit.resourceId ?? ""}</span>
                    </td>
                    <td className="tabular">{formatDate(audit.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...resource.pagination} loading={resource.loading} />
      <p className="field-help page-foot">時間以台北時區（UTC+8）顯示。</p>
    </>
  );
}
