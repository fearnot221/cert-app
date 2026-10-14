import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  DownloadIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from "@radix-ui/react-icons";
import { collectPlaceholders } from "@cert/contracts";
import { api, orgPath, post } from "../../lib/api";
import { csvBlob, saveBlob } from "../../lib/download";
import { useAction, usePagedResource } from "../../lib/hooks";
import type { Batch, Template, Validation } from "../../lib/types";
import { useWorkspace } from "../../app/AppShell";
import { BackLink, LoadError, Notice, PageHeader, Pagination } from "../../ui/feedback";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";

type Sheet = {
  name: string;
  headers: string[];
  rows: { rowNumber: number; values: string[] }[];
};
type RecordRow = { rowNumber: number; data: Record<string, string> };
const aliases: Record<string, string[]> = {
  recipient_name: ["姓名", "收件人姓名", "name"],
  recipient_email: ["email", "電子郵件", "信箱"],
  issue_date: ["發證日期", "日期"],
};
export function CreateBatchPage() {
  const { organization } = useWorkspace();
  const navigate = useNavigate();
  const onCreated = (id: string) => navigate(`/o/${organization.id}/batches/${id}`, { replace: true });
  const templates = usePagedResource<Template>(
    orgPath(organization.id, "/templates"),
  );
  const [expiresOn, setExpiresOn] = useState("");
  const [eventName, setEventName] = useState("");
  const [templateVersionId, setTemplateVersionId] = useState("");
  const [mode, setMode] = useState<"file" | "paste" | "manual">("file");
  const [csv, setCsv] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [filename, setFilename] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<RecordRow[]>([
    { rowNumber: 2, data: {} },
  ]);
  const nextManualRow = useRef(3);
  const [validation, setValidation] = useState<Validation>();
  const [onlyErrors, setOnlyErrors] = useState(false);
  const action = useAction();
  const idempotencyKey = useRef(crypto.randomUUID());
  const versions =
    templates.data?.items.flatMap((t) =>
      (t.versions ?? []).map((v) => ({ ...v, templateName: t.name })),
    ) ?? [];
  const version = versions.find((v) => v.id === templateVersionId);
  const fields = [
    { key: "recipient_name", label: "姓名", required: true },
    { key: "recipient_email", label: "Email", required: true },
    ...(version?.document?.fields ?? []).filter(
      (f) =>
        ![
          "recipient_name",
          "recipient_email",
          "organization_name",
          "event_name",
          "certificate_number",
          "issue_date",
        ].includes(f.key),
    ),
    { key: "issue_date", label: "發證日期", required: false },
  ];
  for (const key of version?.document
    ? collectPlaceholders(version.document)
    : []) {
    if (
      !["organization_name", "event_name", "certificate_number"].includes(
        key,
      ) &&
      !fields.some((f) => f.key === key)
    )
      fields.push({ key, label: key, required: true });
  }
  const sheet = sheets[sheetIndex];
  const records =
    mode === "manual"
      ? manual
      : (sheet?.rows.map((r) => ({
          rowNumber: r.rowNumber,
          data: Object.fromEntries(
            fields
              .filter(
                (f) => mapping[f.key] !== undefined && mapping[f.key] !== "",
              )
              .map((f) => [f.key, r.values[Number(mapping[f.key])] ?? ""]),
          ),
        })) ?? []);
  const invalidate = () => {
    setValidation(undefined);
    idempotencyKey.current = crypto.randomUUID();
    action.setError("");
  };
  const autoMap = (sheet: Sheet) =>
    Object.fromEntries(
      fields
        .map((f) => [
          f.key,
          String(
            sheet.headers.findIndex((h) =>
              [f.key, f.label, ...(aliases[f.key] ?? [])].some(
                (v) => v.toLowerCase() === h.trim().toLowerCase(),
              ),
            ),
          ),
        ])
        .filter(([, value]) => value !== "-1"),
    );
  const readFile = (file: File) =>
    void action.run(async () => {
      setSheets([]);
      setFilename("");
      invalidate();
      if (file.size > 2 * 1024 * 1024) throw new Error("檔案不可超過 2 MB。");
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ sheets: Sheet[] }>(
        orgPath(organization.id, "/imports/parse"),
        { method: "POST", body: form },
      );
      setSheets(result.sheets);
      setSheetIndex(0);
      setFilename(file.name);
      setMapping(autoMap(result.sheets[0]!));
    });
  const payload = () => ({
    eventName,
    expiresOn: expiresOn || null,
    templateVersionId,
    ...(mode === "paste" ? { csv } : { records }),
  });
  const validate = () =>
    void action.run(async () => {
      if (mode === "file" && fields.some((f) => f.required && !mapping[f.key]))
        throw new Error("請先對應所有必要欄位。");
      setValidation(
        await post<Validation>(
          orgPath(organization.id, "/batches/validate"),
          payload(),
        ),
      );
    });
  const create = () =>
    void action.run(async () => {
      const batch = await post<Batch>(orgPath(organization.id, "/batches"), {
        ...payload(),
        idempotencyKey: idempotencyKey.current,
      });
      onCreated(batch.id);
    });
  const sample = () =>
    saveBlob(
      csvBlob([
        fields.map((f) => f.key),
        fields.map(
          (f) =>
            ({
              recipient_name: "王小明",
              recipient_email: "recipient@example.test",
              issue_date: "2026-10-15",
            })[f.key] ?? "範例內容",
        ),
      ]),
      "收件人名單範例.csv",
    );
  return (
    <>
      <BackLink to={`/o/${organization.id}/batches`}>返回發證活動</BackLink>
      <PageHeader
        title="建立發證活動"
        description={`${organization.name}：選擇模板與名單來源，核對欄位後再建立活動。`}
      />
      <Notice message={action.error} />
      {templates.error && (
        <LoadError
          error={templates.error}
          retry={() => void templates.reload()}
        />
      )}
      <section className="panel form-panel stack">
        <div className="section-title">
          <h2>活動與模板</h2>
          <p>選擇已發布的模板版本，名單欄位會隨模板調整。</p>
        </div>
        <div className="form-grid">
          <label className="field">
            活動名稱
            <input
              value={eventName}
              maxLength={160}
              onChange={(e) => {
                setEventName(e.target.value);
                invalidate();
              }}
              placeholder="例如：2026 秋季專業培訓"
              required
              disabled={action.busy}
            />
          </label>
          <label className="field">
            模板版本
            <Select
              label="模板版本"
              value={templateVersionId}
              onChange={(value) => {
                setTemplateVersionId(value);
                setMapping({});
                invalidate();
              }}
              disabled={templates.loading || action.busy}
              placeholder="選擇已發布模板"
              options={versions.map((v) => ({ value: v.id, label: `${v.templateName} · 第 ${v.number} 版` }))}
            />
          </label>
          <div className="field">
            <label htmlFor="batch-expires-on">證書到期日（選填）</label>
            <input
              id="batch-expires-on"
              type="date"
              value={expiresOn}
              onChange={(e) => {
                setExpiresOn(e.target.value);
                invalidate();
              }}
              aria-describedby="batch-expires-help"
              disabled={action.busy}
            />
            <span className="field-help" id="batch-expires-help">
              效期至當日台北時間 23:59:59；留空代表無到期日。
            </span>
          </div>
        </div>
        <Pagination
          {...templates.pagination}
          onPageChange={(page) => {
            templates.pagination.onPageChange(page);
            setTemplateVersionId("");
            invalidate();
          }}
        />
        {!templates.loading && !versions.length && (
          <Notice
            kind="info"
            message="本頁沒有已發布的模板。請切換模板頁，或先儲存並發布模板。"
          />
        )}
        <div className="section-title section-title-spaced">
          <h2>收件人名單</h2>
          <p>每批最多 100 人，可以沿用自己的 Excel 欄位名稱。</p>
        </div>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="名單輸入方式">
            {(
              [
                ["file", "上傳 Excel／CSV"],
                ["paste", "貼上 CSV"],
                ["manual", "手動新增"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={mode === key}
                disabled={action.busy}
                onClick={() => {
                  setMode(key);
                  invalidate();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={sample}>
            <DownloadIcon />
            範例 CSV
          </Button>
        </div>
        {mode === "file" && (
          <>
            <label className={`file-drop ${action.busy ? "is-disabled" : ""}`}>
              <span className="file-drop-seal" aria-hidden>
                <UploadIcon />
              </span>
              <strong>{filename || "選擇 Excel 或 CSV 名單"}</strong>
              <span>.xlsx（2 MB）／UTF-8 .csv（512 KB）· 第一列為欄位名稱</span>
              <input
                aria-label="上傳收件人名單"
                type="file"
                accept=".xlsx,.csv"
                disabled={action.busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {sheet && (
              <div className="mapping-panel">
                <div className="toolbar">
                  <label className="field">
                    工作表
                    <Select
                      label="工作表"
                      value={String(sheetIndex)}
                      disabled={action.busy}
                      onChange={(value) => {
                        const index = Number(value);
                        setSheetIndex(index);
                        setMapping(autoMap(sheets[index]!));
                        invalidate();
                      }}
                      options={sheets.map((s, index) => ({ value: String(index), label: `${s.name}（${s.rows.length} 筆）` }))}
                    />
                  </label>
                  <span>{sheet.rows.length} 筆名單 · 保留原始列號</span>
                </div>
                <div className="mapping-grid">
                  {fields.map((f) => (
                    <label className="field" key={f.key}>
                      {f.label}
                      {f.required ? "（必填）" : "（選填）"}
                      <Select
                        label={`對應${f.label}`}
                        value={mapping[f.key] ?? ""}
                        disabled={action.busy}
                        onChange={(value) => {
                          setMapping((m) => ({
                            ...m,
                            [f.key]: value,
                          }));
                          invalidate();
                        }}
                        options={[
                          { value: "", label: "不匯入此欄" },
                          ...sheet.headers.map((h, index) => ({ value: String(index), label: h || `第 ${index + 1} 欄（無標題）` })),
                        ]}
                      />
                      <small>
                        {mapping[f.key] !== undefined && mapping[f.key] !== ""
                          ? `例如：${sheet.rows[0]?.values[Number(mapping[f.key])] || "空白"}`
                          : f.key}
                      </small>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {mode === "paste" && (
          <label className="field">
            或貼上 CSV 內容
            <textarea
              className="csv-input"
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                invalidate();
              }}
              rows={8}
              disabled={action.busy}
              placeholder="recipient_name,recipient_email"
              spellCheck={false}
            />
          </label>
        )}
        {mode === "manual" && (
          <>
            <div className="table-wrap">
              <table className="data-table manual-table">
                <thead>
                  <tr>
                    <th>來源列號</th>
                    {fields.map((f) => (
                      <th key={f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </th>
                    ))}
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {manual.map((r, index) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      {fields.map((f) => (
                        <td key={f.key}>
                          <input
                            aria-label={`第 ${index + 1} 人${f.label}`}
                            value={r.data[f.key] ?? ""}
                            maxLength={500}
                            disabled={action.busy}
                            onChange={(e) => {
                              setManual((current) =>
                                current.map((row) =>
                                  row.rowNumber === r.rowNumber
                                    ? {
                                        ...row,
                                        data: {
                                          ...row.data,
                                          [f.key]: e.target.value,
                                        },
                                      }
                                    : row,
                                ),
                              );
                              invalidate();
                            }}
                          />
                        </td>
                      ))}
                      <td>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`刪除第 ${index + 1} 人`}
                          disabled={action.busy || manual.length === 1}
                          onClick={() => {
                            setManual((current) =>
                              current.filter(
                                (row) => row.rowNumber !== r.rowNumber,
                              ),
                            );
                            invalidate();
                          }}
                        >
                          <TrashIcon />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="quiet"
              disabled={action.busy || manual.length >= 100}
              onClick={() => {
                setManual((current) => [
                  ...current,
                  { rowNumber: nextManualRow.current++, data: {} },
                ]);
                invalidate();
              }}
            >
              <PlusIcon />
              新增收件人
            </Button>
          </>
        )}
        <p className="field-help">
          姓名與 Email 必填，日期請使用 YYYY-MM-DD。Excel
          日期儲存格會自動轉換；公式請先貼上為值。檢查通過前不會建立活動。
        </p>
        <div className="form-footer">
          <Button
            variant="quiet"
            onClick={validate}
            disabled={
              action.busy ||
              !eventName.trim() ||
              !templateVersionId ||
              (mode === "paste" ? !csv.trim() : !records.length)
            }
          >
            <CheckCircledIcon />
            {action.busy ? "處理中…" : "檢查名單"}
          </Button>
        </div>
      </section>
      {validation && (
        <section className="panel validation-panel stack">
          <div className="toolbar">
            <div>
              <h2>名單檢查結果</h2>
              <p>
                {validation.rows.length} 筆資料 ·{" "}
                {validation.rows.filter((r) => r.errors.length).length}{" "}
                筆需要修正
              </p>
            </div>
            <div className="btn-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={onlyErrors}
                  onChange={(e) => setOnlyErrors(e.target.checked)}
                />
                只看錯誤
              </label>
              <Button
                variant="quiet"
                onClick={() =>
                  saveBlob(
                    csvBlob([
                      ["原始列號", "姓名", "Email", "欄位", "錯誤原因"],
                      ...validation.rows.flatMap((r) =>
                        r.errors.map((e) => [
                          r.rowNumber,
                          r.data.recipient_name ?? "",
                          r.data.recipient_email ?? "",
                          e.field,
                          e.message,
                        ]),
                      ),
                    ]),
                    "名單檢查失敗報告.csv",
                  )
                }
                disabled={validation.valid}
              >
                <DownloadIcon />
                下載檢查失敗報告
              </Button>
            </div>
          </div>
          <Notice
            kind={validation.valid ? "success" : "error"}
            message={
              validation.valid
                ? "資料檢查通過。建立活動後，請逐人預覽 PDF 確認文字與字型。"
                : "請修正下列錯誤後重新檢查；目前不會建立活動或忽略錯誤列。"
            }
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>原始列號</th>
                  {fields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {validation.rows
                  .filter((r) => !onlyErrors || r.errors.length)
                  .map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.rowNumber}</td>
                      {fields.map((f) => (
                        <td key={f.key}>{r.data[f.key] || "—"}</td>
                      ))}
                      <td>
                        {r.errors.length ? (
                          <ul className="validation-errors">
                            {r.errors.map((e, i) => (
                              <li key={i}>
                                {e.field}：{e.message}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="good-text">檢查通過</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="form-footer">
            <Button
              onClick={create}
              disabled={!validation.valid || action.busy}
            >
              建立活動並預覽
              <ArrowRightIcon />
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
