import { useEffect, useState, type FormEvent } from "react";
import { formatCertificateNumber } from "@cert/contracts";
import { api, orgPath } from "../../lib/api";
import { useAction, useResource } from "../../lib/hooks";
import { useWorkspace } from "../../app/AppShell";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { Loading, LoadError, Notice, PageHeader } from "../../ui/feedback";

type Serial = { prefix: string; digits: number; issued: number; nextSequence: number; nextNumber: string };

/** Organization settings. For now: the certificate serial number format. */
export function SettingsPage() {
  const { organization, permissions } = useWorkspace();
  const path = orgPath(organization.id, "/settings/serial");
  const serial = useResource<Serial>(path);
  const action = useAction();
  const canManage = permissions.includes("organization.manage");
  const [prefix, setPrefix] = useState("");
  const [digits, setDigits] = useState("6");
  const [next, setNext] = useState("");

  useEffect(() => {
    if (!serial.data) return;
    setPrefix(serial.data.prefix);
    setDigits(String(serial.data.digits));
    setNext(String(serial.data.nextSequence));
  }, [serial.data]);

  const nextNumber = Number(next);
  const validPrefix = /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(prefix);
  const validNext = Number.isInteger(nextNumber) && nextNumber >= (serial.data?.nextSequence ?? 1);
  const preview = (offset: number) =>
    formatCertificateNumber(validPrefix ? prefix : "CERT", Number(digits), (validNext ? nextNumber : serial.data?.nextSequence ?? 1) + offset);
  const changed =
    !!serial.data &&
    (prefix !== serial.data.prefix || Number(digits) !== serial.data.digits || nextNumber !== serial.data.nextSequence);

  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api<Serial>(path, {
        method: "PUT",
        body: JSON.stringify({ prefix, digits: Number(digits), nextSequence: nextNumber }),
      });
      action.setSuccess(`已更新。下一張證書的編號是 ${preview(0)}。`);
    });
  };

  return (
    <>
      <PageHeader title="組織設定" description={`${organization.name}的證書編號規則。每張證書在產製時取得一個流水號，印在證書上，也會出現在驗證頁與通知信中。`} />
      {serial.pending ? (
        <Loading />
      ) : serial.error && !serial.data ? (
        <LoadError error={serial.error} retry={() => void serial.reload()} />
      ) : (
        serial.data && (
          <section className="serial-settings" aria-labelledby="serial-heading">
            <div className="serial-preview" aria-live="polite">
              <h2 id="serial-heading">證書流水號</h2>
              <p className="serial-next tabular">{preview(0)}</p>
              <p className="serial-after tabular">
                接著是 {preview(1)}、{preview(2)}
              </p>
              <dl className="serial-facts">
                <div>
                  <dt>已發出</dt>
                  <dd className="tabular">{serial.data.issued.toLocaleString("zh-TW")} 張</dd>
                </div>
                <div>
                  <dt>規則</dt>
                  <dd>只往前編號，同一組織內不會重複</dd>
                </div>
              </dl>
            </div>
            <form className="serial-form" onSubmit={save}>
              <fieldset disabled={!canManage || action.busy} className="stack">
                <div className="field">
                  <label htmlFor="serial-prefix">前綴</label>
                  <input
                    id="serial-prefix"
                    aria-describedby="serial-prefix-help"
                    value={prefix}
                    maxLength={16}
                    spellCheck={false}
                    autoCapitalize="characters"
                    aria-invalid={!validPrefix}
                    onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                  />
                  <span className="field-help" id="serial-prefix-help">英文字母、數字與連字號，例如 CERT、ZX2026。</span>
                </div>
                <label className="field">
                  號碼位數
                  <Select
                    label="號碼位數"
                    value={digits}
                    onChange={setDigits}
                    options={[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: `${n} 位（${formatCertificateNumber("", n, 1).slice(1)}）` }))}
                  />
                </label>
                <div className="field">
                  <label htmlFor="serial-next">下一個號碼</label>
                  <input
                    id="serial-next"
                    aria-describedby="serial-next-help"
                    type="number"
                    inputMode="numeric"
                    min={serial.data.nextSequence}
                    value={next}
                    aria-invalid={!validNext}
                    onChange={(e) => setNext(e.target.value)}
                  />
                  <span className="field-help" id="serial-next-help">
                    可以往後跳號（例如接續紙本證書），不能小於 {serial.data.nextSequence}。
                  </span>
                </div>
                <Notice message={action.error} />
                <Notice message={action.success} kind="success" />
                {canManage ? (
                  <div className="btn-row">
                    <Button type="submit" disabled={!changed || !validPrefix || !validNext || action.busy}>
                      {action.busy ? "儲存中…" : "儲存編號規則"}
                    </Button>
                  </div>
                ) : (
                  <p className="field-help">只有組織擁有者與管理員可以變更編號規則。</p>
                )}
              </fieldset>
            </form>
          </section>
        )
      )}
    </>
  );
}
