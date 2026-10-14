import { useState, type FormEvent } from "react";
import { Pencil1Icon, PlusIcon } from "@radix-ui/react-icons";
import { BUILTIN_FIELDS, extractPlaceholders, isBuiltinField } from "@cert/contracts";
import type { TemplateDocument } from "../../lib/types";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";

type Field = TemplateDocument["fields"][number];
type Draft = { originalKey?: string; key: string; label: string; type: Field["type"]; required: boolean };

const typeLabels: Record<Field["type"], string> = { text: "文字", date: "日期", number: "數字", email: "Email" };
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const builtin = new Map(BUILTIN_FIELDS.map((field) => [field.key, field]));

/**
 * The template's dynamic fields. Built-in fields (the recipient's name and email, the serial number
 * and the other system values) are always present and cannot be removed; designers add their own
 * fields, which then appear as columns to map when a batch is imported.
 */
export function FieldsPanel({
  document,
  canWrite,
  onInsert,
  onChange,
}: {
  document: TemplateDocument;
  canWrite: boolean;
  onInsert: (key: string) => void;
  onChange: (update: (current: TemplateDocument) => TemplateDocument) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const builtins = BUILTIN_FIELDS.map((field) => document.fields.find((f) => f.key === field.key) ?? field);
  const custom = document.fields.filter((field) => !isBuiltinField(field.key));
  const usage = (key: string) =>
    document.elements.filter((element) => extractPlaceholders(element.text).includes(key)).length;

  const startNew = () => {
    let n = custom.length + 1;
    while (document.fields.some((field) => field.key === `field_${n}`)) n++;
    setError("");
    setDraft({ key: `field_${n}`, label: "", type: "text", required: true });
  };
  const startEdit = (field: Field) => {
    setError("");
    setDraft({ originalKey: field.key, ...field });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const key = draft.key.trim();
    const label = draft.label.trim();
    if (!label) return setError("請輸入欄位名稱。");
    if (!keyPattern.test(key)) return setError("欄位代碼需以小寫英文字母開頭，只能使用小寫英文、數字與底線。");
    if (isBuiltinField(key)) return setError("這是內建欄位的代碼，請換一個。");
    if (key !== draft.originalKey && document.fields.some((field) => field.key === key))
      return setError("已經有相同代碼的欄位。");
    const next: Field = { key, label, type: draft.type, required: draft.required };
    const from = draft.originalKey;
    onChange((current) => ({
      ...current,
      fields: from ? current.fields.map((field) => (field.key === from ? next : field)) : [...current.fields, next],
      // Renaming a field's code rewrites every placeholder that used the old one.
      elements:
        from && from !== key
          ? current.elements.map((element) => ({
              ...element,
              text: element.text.replace(new RegExp(`{{\\s*${from}\\s*}}`, "g"), `{{${key}}}`),
            }))
          : current.elements,
    }));
    setDraft(null);
  };

  const remove = () => {
    if (!draft?.originalKey) return;
    const used = usage(draft.originalKey);
    if (used) return setError(`有 ${used} 個文字框使用這個欄位，請先刪除或改寫它們。`);
    const key = draft.originalKey;
    onChange((current) => ({ ...current, fields: current.fields.filter((field) => field.key !== key) }));
    setDraft(null);
  };

  const row = (field: Field, editable: boolean) => {
    const info = builtin.get(field.key);
    const used = usage(field.key);
    return (
      <li key={field.key} className={field.key === "certificate_number" ? "field-row is-serial" : "field-row"}>
        <button
          type="button"
          className="field-insert"
          disabled={!canWrite}
          onClick={() => onInsert(field.key)}
          aria-label={`加入動態文字：${field.label}`}
        >
          <span className="field-row-text">
            <span className="field-row-name">{field.label}</span>
            <span className="field-row-meta">
              {info ? info.hint : `${typeLabels[field.type]}${field.required ? "，必填" : "，選填"}`}
              {used > 0 && `，已用 ${used} 處`}
            </span>
          </span>
          <PlusIcon aria-hidden />
        </button>
        {editable && canWrite && (
          <Button
            variant="ghost"
            size="icon"
            className="field-edit"
            aria-label={`編輯欄位：${field.label}`}
            onClick={() => startEdit(field)}
          >
            <Pencil1Icon />
          </Button>
        )}
      </li>
    );
  };

  return (
    <section className="editor-section fields-section" aria-labelledby="fields-heading">
      <h2 id="fields-heading">
        動態欄位 <span>點一下加到畫布</span>
      </h2>
      <ul className="field-list" aria-label="內建欄位">
        {builtins.map((field) => row(field, false))}
      </ul>
      <h3 className="field-group-title">自訂欄位</h3>
      {custom.length > 0 ? (
        <ul className="field-list" aria-label="自訂欄位">
          {custom.map((field) => row(field, true))}
        </ul>
      ) : (
        !draft && <p className="field-help">例如課程時數、成績或講師。新增後會成為匯入名單時要對應的欄位。</p>
      )}
      {draft ? (
        <form className="field-form" onSubmit={submit} noValidate>
          <label className="field">
            欄位名稱
            <input
              autoFocus
              value={draft.label}
              maxLength={80}
              placeholder="例如：課程時數"
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <div className="field">
            <label htmlFor="field-key">欄位代碼</label>
            <input
              id="field-key"
              aria-describedby="field-key-help"
              value={draft.key}
              maxLength={64}
              spellCheck={false}
              autoCapitalize="none"
              onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })}
            />
            <span className="field-help" id="field-key-help">
              在文字中寫作 {`{{${draft.key || "code"}}}`}
            </span>
          </div>
          <label className="field">
            資料類型
            <Select
              label="資料類型"
              value={draft.type}
              onChange={(type) => setDraft({ ...draft, type: type as Field["type"] })}
              options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.required}
              onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
            />
            每位收件人都必須提供
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="field-form-actions">
            {draft.originalKey && (
              <Button variant="ghost" size="sm" className="field-remove" onClick={remove}>
                刪除欄位
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button type="submit" size="sm">
              {draft.originalKey ? "更新欄位" : "加入欄位"}
            </Button>
          </div>
        </form>
      ) : (
        canWrite && (
          <Button variant="quiet" className="btn-block" onClick={startNew}>
            <PlusIcon />
            新增自訂欄位
          </Button>
        )
      )}
    </section>
  );
}
