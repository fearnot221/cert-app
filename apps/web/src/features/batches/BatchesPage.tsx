import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, PlusIcon } from "@radix-ui/react-icons";
import { orgPath } from "../../lib/api";
import { usePagedResource } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import type { Batch } from "../../lib/types";
import { useWorkspace } from "../../app/AppShell";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { Empty, Loading, LoadError, PageHeader, Pagination, Status } from "../../ui/feedback";

const nextStep: Record<string, string> = { failed: "處理失敗項目", generated: "下載與通知", cancelled: "查看紀錄" };

export function BatchesPage() {
  const { organization, permissions } = useWorkspace();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = usePagedResource<Batch>(
    orgPath(organization.id, `/batches?search=${encodeURIComponent(query)}${status ? `&status=${status}` : ""}`),
    12,
  );
  const canImport = permissions.includes("recipients.import");
  const base = `/${organization.slug}/batches`;
  const filtered = !!(search || status);
  return (
    <>
      <PageHeader
        title="發證活動"
        description="從名單到證書，每個活動的產製與通知進度都在這裡。"
        action={
          canImport && (
            <Button asChild>
              <Link to={`${base}/new`}>
                <PlusIcon />
                建立發證活動
              </Link>
            </Button>
          )
        }
      />
      <div className="filters">
        <label className="field filters-grow">
          搜尋活動
          <input
            type="search"
            placeholder="輸入活動名稱"
            maxLength={160}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field">
          活動狀態
          <Select
            label="活動狀態"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "全部狀態" },
              { value: "validated", label: "待產製" },
              { value: "generating", label: "產製中" },
              { value: "generated", label: "已產製" },
              { value: "cancelled", label: "已取消" },
              { value: "failed", label: "需要處理" },
            ]}
          />
        </label>
      </div>
      {resource.pending ? (
        <Loading />
      ) : resource.error && !resource.data ? (
        <LoadError error={resource.error} retry={() => void resource.reload()} />
      ) : !resource.data?.items.length ? (
        <Empty
          title={filtered ? "沒有符合的活動" : "建立你的第一個發證活動"}
          description={
            filtered
              ? "調整搜尋文字或狀態，查看其他活動。"
              : "上傳 Excel／CSV 或手動輸入名單。產製完成後，可以下載 ZIP 或通知收件人。"
          }
          action={
            canImport &&
            !filtered && (
              <Button asChild variant="quiet">
                <Link to={`${base}/new`}>
                  <PlusIcon />
                  建立第一個活動
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="table-wrap batch-table" aria-busy={resource.loading}>
          <table className="data-table">
            <thead>
              <tr>
                <th>活動名稱</th>
                <th>收件人</th>
                <th>狀態</th>
                <th>建立時間</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {resource.data.items.map((batch) => (
                <tr key={batch.id}>
                  <td className="cell-title">{batch.eventName}</td>
                  <td className="tabular">{batch._count?.rows ?? 0} 人</td>
                  <td>
                    <Status value={batch.status} />
                  </td>
                  <td className="tabular">{formatDate(batch.createdAt)}</td>
                  <td className="cell-action">
                    <Link className="row-link" to={`${base}/${batch.id}`} aria-label={`開啟活動：${batch.eventName}`}>
                      {nextStep[batch.status] ?? "繼續作業"}
                      <ArrowRightIcon aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...resource.pagination} />
    </>
  );
}
