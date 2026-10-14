import { useEffect, useState } from "react";
import {
  DashboardIcon,
  FileTextIcon,
  PaperPlaneIcon,
  ReaderIcon,
  ExitIcon,
  PersonIcon,
  ArrowTopRightIcon,
  ChevronDownIcon,
} from "@radix-ui/react-icons";
import { api, ApiError, errorMessage, post, resetCsrf } from "./lib/api";
import type { Membership, Session, Template } from "./lib/types";
import { Button } from "./components/ui/button";
import { Alert, Loading } from "./components/common";
import { Auth } from "./pages/Auth";
import { Templates } from "./pages/Templates";
import { TemplateEditor } from "./pages/TemplateEditor";
import { Batches } from "./pages/Batches";
import { Records } from "./pages/Records";
import { Certificates } from "./pages/Certificates";

const initialActivationToken =
  location.pathname === "/activate"
    ? new URLSearchParams(location.hash.slice(1)).get("token")
    : undefined;

const initialResetToken =
  location.pathname === "/reset-password"
    ? new URLSearchParams(location.hash.slice(1)).get("token")
    : undefined;

type View = "templates" | "batches" | "deliveries" | "audit" | "certificates";
const navigation = [
  {
    id: "templates" as const,
    label: "證書模板",
    icon: DashboardIcon,
    permission: "templates.read",
  },
  {
    id: "batches" as const,
    label: "發證活動",
    icon: FileTextIcon,
    permission: "certificates.generate",
  },
  {
    id: "deliveries" as const,
    label: "郵件紀錄",
    icon: PaperPlaneIcon,
    permission: "mail.send",
  },
  {
    id: "audit" as const,
    label: "稽核紀錄",
    icon: ReaderIcon,
    permission: "audit.read",
  },
];
const roleNames: Record<string, string> = {
  owner: "組織擁有者",
  admin: "組織管理員",
  designer: "模板設計者",
  issuer: "發證人員",
  auditor: "稽核人員",
  template_designer: "模板設計者",
  certificate_issuer: "發證人員",
};

export function App() {
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [view, setView] = useState<View>(
    ["/certificates", "/my-certificates"].includes(location.pathname)
      ? "certificates"
      : "templates",
  );
  const [editing, setEditing] = useState<Template | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activationToken, setActivationToken] = useState<
    string | null | undefined
  >(initialActivationToken);
  useEffect(() => {
    if (initialActivationToken !== undefined || initialResetToken !== undefined)
      history.replaceState({}, "", location.pathname);
  }, []);
  const [resetToken, setResetToken] = useState<string | null | undefined>(
    initialResetToken,
  );
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    const receiveLink = () => {
      if (
        !["/activate", "/reset-password"].includes(location.pathname) ||
        !location.hash
      )
        return;
      const token = new URLSearchParams(location.hash.slice(1)).get("token");
      setActivationToken(location.pathname === "/activate" ? token : undefined);
      setResetToken(
        location.pathname === "/reset-password" ? token : undefined,
      );
      setActivated(false);
      history.replaceState({}, "", location.pathname);
    };
    window.addEventListener("hashchange", receiveLink);
    return () => window.removeEventListener("hashchange", receiveLink);
  }, []);
  const loadSession = async () => {
    setError("");
    try {
      const result = await api<Session>("/auth/me");
      setSession(result);
      setOrganizationId((current) =>
        result.memberships.some((m) => m.organization.id === current)
          ? current
          : (result.memberships[0]?.organization.id ?? ""),
      );
      if (!result.memberships.length) setView("certificates");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        setSession(undefined);
      else setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadSession();
  }, []);
  useEffect(() => {
    const expired = () => {
      setSession(undefined);
      resetCsrf();
      setError("登入已逾期，請重新登入後繼續。");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const membership = session?.memberships.find(
    (m) => m.organization.id === organizationId,
  );
  const leaveEditor = () =>
    !dirty || window.confirm("模板有尚未儲存的變更，確定離開嗎？");
  const navigate = (next: View) => {
    if (!leaveEditor()) return;
    setDirty(false);
    setEditing(null);
    setView(next);
    history.replaceState(
      {},
      "",
      next === "certificates" ? "/certificates" : "/",
    );
  };
  const logout = async () => {
    if (!leaveEditor()) return;
    try {
      await post("/auth/logout");
      resetCsrf();
      setSession(undefined);
      setEditing(null);
      setDirty(false);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  if ((activationToken !== undefined || resetToken !== undefined) && !activated)
    return (
      <Auth
        key={activationToken ?? resetToken ?? "missing-token"}
        activationToken={activationToken}
        resetToken={resetToken}
        onAuthenticated={async () => {
          setActivated(true);
          history.replaceState({}, "", "/certificates");
          setView("certificates");
          await loadSession();
        }}
      />
    );
  if (loading)
    return (
      <div className="initial-loading">
        <Loading label="正在開啟工作空間…" />
      </div>
    );
  if (!session)
    return (
      <>
        <Alert message={error} />
        <Auth onAuthenticated={loadSession} />
      </>
    );
  return (
    <div
      className={`app-shell ${view === "certificates" ? "recipient-mode" : ""}`}
    >
      {session.memberships.length > 0 && (
        <aside className="sidebar">
          <a
            className="wordmark"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("templates");
            }}
          >
            <span className="brand-mark">C</span>certfolio
          </a>
          <div className="workspace-switch">
            <label htmlFor="organization-switch">目前組織</label>
            <div className="select-wrapper">
              <select
                id="organization-switch"
                value={organizationId}
                onChange={(e) => {
                  if (!leaveEditor()) return;
                  setOrganizationId(e.target.value);
                  setEditing(null);
                  setDirty(false);
                  setView("templates");
                }}
              >
                {session.memberships.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon aria-hidden />
            </div>
            {membership && (
              <span className="workspace-role">
                {roleNames[membership.role.toLowerCase()] ?? membership.role}
              </span>
            )}
          </div>
          <div className="nav-label">組織工作空間</div>
          <nav aria-label="主要導覽">
            {navigation
              .filter(
                (item) =>
                  membership?.permissions.includes(item.permission) ||
                  (item.id === "batches" &&
                    membership?.permissions.includes("recipients.import")),
              )
              .map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${view === item.id ? "active" : ""}`}
                  aria-current={view === item.id ? "page" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon />
                  <span>{item.label}</span>
                  {view === item.id && <span className="nav-active-mark" />}
                </button>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className={`nav-item ${view === "certificates" ? "active" : ""}`}
              onClick={() => navigate("certificates")}
            >
              <PersonIcon />
              <span>我的證書</span>
              <ArrowTopRightIcon />
            </button>
            <div className="account">
              <span className="avatar">
                {session.user.email.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{session.user.email}</strong>
                <span>已安全登入</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="登出"
                title="登出"
                onClick={() => void logout()}
              >
                <ExitIcon />
              </Button>
            </div>
          </div>
        </aside>
      )}
      <div className="app-content">
        <header className="topbar">
          <div>
            {view === "certificates" ? (
              <>
                <span>個人入口</span>
                <span className="breadcrumb-divider">/</span>
                <strong>我的證書</strong>
              </>
            ) : (
              <>
                <span>{membership?.organization.name}</span>
                <span className="breadcrumb-divider">/</span>
                <strong>
                  {editing
                    ? "模板編輯器"
                    : navigation.find((item) => item.id === view)?.label}
                </strong>
              </>
            )}
          </div>
          <div className="topbar-end">
            <span className="private-label">
              <span />
              私人工作空間
            </span>
            {!session.memberships.length && (
              <Button variant="ghost" onClick={() => void logout()}>
                <ExitIcon />
                登出
              </Button>
            )}
          </div>
        </header>
        <main
          className={editing ? "editor-main" : "main-content"}
          id="main-content"
        >
          <Alert message={error} />
          {view === "certificates" ? (
            <Certificates />
          ) : membership ? (
            <Workspace
              key={organizationId}
              view={view}
              membership={membership}
              editing={editing}
              onEdit={setEditing}
              onDirty={setDirty}
              onClose={() => {
                if (leaveEditor()) {
                  setEditing(null);
                  setDirty(false);
                }
              }}
            />
          ) : (
            <Alert message="此帳號尚未取得組織工作人員權限。" kind="info" />
          )}
        </main>
      </div>
    </div>
  );
}

function Workspace({
  view,
  membership,
  editing,
  onEdit,
  onDirty,
  onClose,
}: {
  view: View;
  membership: Membership;
  editing: Template | null;
  onEdit: (template: Template) => void;
  onDirty: (value: boolean) => void;
  onClose: () => void;
}) {
  const props = {
    organization: membership.organization,
    permissions: membership.permissions,
  };
  if (editing)
    return (
      <TemplateEditor
        {...props}
        template={editing}
        onDirty={onDirty}
        onClose={onClose}
      />
    );
  if (view === "templates") return <Templates {...props} onEdit={onEdit} />;
  if (view === "batches") return <Batches {...props} />;
  if (view === "deliveries" || view === "audit")
    return <Records organization={membership.organization} kind={view} />;
  return null;
}
