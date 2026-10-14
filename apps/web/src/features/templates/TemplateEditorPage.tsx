import { useCallback, useEffect, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router";
import { orgPath } from "../../lib/api";
import { useResource } from "../../lib/hooks";
import type { Template } from "../../lib/types";
import { useWorkspace } from "../../app/AppShell";
import { BackLink, Loading, LoadError } from "../../ui/feedback";
import { TemplateEditor } from "./TemplateEditor";

export function TemplateEditorPage() {
  const { organization, permissions } = useWorkspace();
  const { templateId = "" } = useParams();
  const navigate = useNavigate();
  // Always read the latest draft from the server so a reload never resurrects an older copy.
  const resource = useResource<Template>(orgPath(organization.id, `/templates/${templateId}`), { gcTime: 0 });
  const template = resource.pending ? undefined : resource.data;
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("模板有尚未儲存的變更，確定離開嗎？")) {
      setDirty(false);
      blocker.proceed();
    } else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const close = useCallback(() => navigate(`/o/${organization.id}/templates`), [navigate, organization.id]);
  if (!template)
    return resource.error ? (
      <div className="stack">
        <BackLink to={`/o/${organization.id}/templates`}>返回證書模板</BackLink>
        <LoadError error={resource.error} retry={() => void resource.reload()} />
      </div>
    ) : (
      <Loading label="正在開啟模板…" />
    );
  return (
    <TemplateEditor
      key={template.id}
      organization={organization}
      permissions={permissions}
      template={template}
      onDirty={setDirty}
      onClose={close}
    />
  );
}
