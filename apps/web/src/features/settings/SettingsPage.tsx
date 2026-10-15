import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, orgPath } from "../../lib/api";
import { useAction, useResource } from "../../lib/hooks";
import { useWorkspace } from "../../app/AppShell";
import { workspacePath } from "../../app/session";
import { Button } from "../../ui/Button";
import { Loading, LoadError, Notice, PageHeader } from "../../ui/feedback";

type Settings = { id: string; name: string; slug: string };
const reserved = new Set(["o", "api", "login", "activate", "reset-password", "verify", "download", "me", "workspace", "certificates", "my-certificates", "assets", "landing", "fonts", "settings", "admin", "help"]);

/** Organization settings: the short address its workspace lives at. */
export function SettingsPage() {
  const { organization, permissions } = useWorkspace();
  const navigate = useNavigate();
  const path = orgPath(organization.id, "/settings");
  const settings = useResource<Settings>(path);
  const action = useAction();
  const canManage = permissions.includes("organization.manage");
  const [slug, setSlug] = useState(organization.slug);
  useEffect(() => {
    if (settings.data) setSlug(settings.data.slug);
  }, [settings.data]);
  const valid = /^[a-z0-9][a-z0-9-]{1,31}$/.test(slug) && !reserved.has(slug);
  const changed = !!settings.data && slug !== settings.data.slug;

  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const saved = await api<Settings>(path, { method: "PUT", body: JSON.stringify({ slug }) });
      // The workspace reloads the session when it meets the new address.
      navigate(workspacePath(saved, "settings"), { replace: true });
    });
  };

  return (
    <>
      <PageHeader title="組織設定" description={`${organization.name}的工作空間網址。`} />
      {settings.pending ? (
        <Loading />
      ) : settings.error && !settings.data ? (
        <LoadError error={settings.error} retry={() => void settings.reload()} />
      ) : (
        settings.data && (
          <section className="serial-settings" aria-labelledby="slug-heading">
            <div className="serial-preview" aria-live="polite">
              <h2 id="slug-heading">工作空間網址</h2>
              <p className="slug-preview">
                <span>{location.host}/</span>
                <strong>{valid ? slug : settings.data.slug}</strong>
                <span>/templates</span>
              </p>
              <dl className="serial-facts">
                <div>
                  <dt>目前網址</dt>
                  <dd>/{settings.data.slug}</dd>
                </div>
                <div>
                  <dt>舊連結</dt>
                  <dd>改名後，舊網址不再指向這個組織，請通知同事更新書籤</dd>
                </div>
              </dl>
            </div>
            <form className="serial-form" onSubmit={save}>
              <fieldset disabled={!canManage || action.busy} className="stack">
                <div className="field">
                  <label htmlFor="org-slug">網址代稱</label>
                  <input
                    id="org-slug"
                    aria-describedby="org-slug-help"
                    value={slug}
                    maxLength={32}
                    spellCheck={false}
                    autoCapitalize="none"
                    aria-invalid={!valid}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  />
                  <span className="field-help" id="org-slug-help">
                    2 至 32 個小寫英文字母、數字或連字號，例如 zhixing、sta-tw。每個組織不能重複。
                  </span>
                </div>
                <Notice message={action.error} />
                {canManage ? (
                  <div className="btn-row">
                    <Button type="submit" disabled={!changed || !valid || action.busy}>
                      {action.busy ? "儲存中…" : "儲存網址"}
                    </Button>
                  </div>
                ) : (
                  <p className="field-help">只有組織擁有者與管理員可以變更網址。</p>
                )}
              </fieldset>
            </form>
          </section>
        )
      )}
    </>
  );
}
