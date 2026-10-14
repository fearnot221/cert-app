import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation, useMatches, useNavigate, useParams } from "react-router";
import { ExitIcon } from "@radix-ui/react-icons";
import { findMembership, useSession } from "./session";
import type { Membership } from "../lib/types";
import { roleNames } from "../lib/format";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Notice, Wordmark } from "../ui/feedback";

const navigation = [
  { to: "templates", label: "證書模板", permission: "templates.read" },
  { to: "batches", label: "發證活動", permission: "certificates.generate" },
  { to: "deliveries", label: "郵件紀錄", permission: "mail.send" },
  { to: "audit", label: "稽核紀錄", permission: "audit.read" },
  { to: "settings", label: "組織設定", permission: "organization.manage" },
] as const;

type Workspace = { membership: Membership; organization: Membership["organization"]; permissions: string[] };
const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside an organization route");
  return value;
}

export type RouteHandle = { wide?: boolean };

/** Signed-in chrome: wordmark, organization switch, the organization's sections, and the account. */
function Shell({ membership, children }: { membership?: Membership; children: ReactNode }) {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // On narrow screens the section links scroll sideways; keep the current one in view.
  useEffect(() => {
    const active = nav.current?.querySelector<HTMLElement>("a.active");
    const bar = nav.current;
    if (!active || !bar || bar.scrollWidth <= bar.clientWidth) return;
    const a = active.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    bar.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
  }, [pathname]);
  const wide = useMatches().some((match) => (match.handle as RouteHandle | undefined)?.wide);
  const memberships = session?.memberships ?? [];
  const current = membership ?? memberships[0];
  const sections = navigation.filter(
    (item) =>
      current?.permissions.includes(item.permission) ||
      (item.to === "batches" && current?.permissions.includes("recipients.import")),
  );
  const signOut = async () => {
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : "登出失敗，請再試一次。");
    }
  };
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        跳到主要內容
      </a>
      <header className="app-bar">
        <div className="app-bar-row">
          <Wordmark to={current ? `/o/${current.organization.id}/templates` : "/me"} />
          {current && (
            <label className="org-switch">
              <span className="sr-only">目前組織</span>
              <Select
                variant="pill"
                label="目前組織"
                value={current.organization.id}
                onChange={(id) => navigate(`/o/${id}/templates`)}
                options={memberships.map((m) => ({ value: m.organization.id, label: m.organization.name }))}
              />
              <span className="org-role">{roleNames[current.role.toLowerCase()] ?? current.role}</span>
            </label>
          )}
          {current && (
            <nav className="app-nav" aria-label="主要導覽" ref={nav}>
              {sections.map((item) => (
                <NavLink key={item.to} to={`/o/${current.organization.id}/${item.to}`}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="app-account">
            <NavLink to="/me" className="app-account-link">
              我的證書
            </NavLink>
            <span className="app-account-email" title={session?.user.email}>
              {session?.user.email}
            </span>
            <Button variant="quiet" size="icon" aria-label="登出" title="登出" onClick={() => void signOut()}>
              <ExitIcon />
            </Button>
          </div>
        </div>
      </header>
      <main id="main-content" className={wide ? "app-main app-main-wide" : "app-main"}>
        <Notice message={error} />
        {children}
      </main>
    </div>
  );
}

export function AccountLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

export function WorkspaceLayout() {
  const { orgId } = useParams();
  const { session } = useSession();
  const membership = findMembership(session, orgId);
  if (!membership) {
    const first = session?.memberships[0]?.organization.id;
    return <Navigate to={first ? `/o/${first}/templates` : "/me"} replace />;
  }
  return (
    <WorkspaceContext.Provider
      key={membership.organization.id}
      value={{ membership, organization: membership.organization, permissions: membership.permissions }}
    >
      <Shell membership={membership}>
        <Outlet />
      </Shell>
    </WorkspaceContext.Provider>
  );
}
