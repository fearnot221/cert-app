import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useLocation, useRouteError } from "react-router";
import { homePath, useSession } from "./session";
import { AccountLayout, LegacyWorkspaceRedirect, WorkspaceLayout, type RouteHandle } from "./AppShell";
import { Loading, LoadError, Wordmark } from "../ui/feedback";
import { LandingPage } from "../features/landing/LandingPage";
import { AuthPage } from "../features/auth/AuthPage";
import { SerialCheckPage } from "../features/verification/SerialCheckPage";
import { DownloadPage } from "../features/verification/DownloadPage";
import { MyCertificatesPage } from "../features/recipient/MyCertificatesPage";
import { TemplatesPage } from "../features/templates/TemplatesPage";
import { TemplateEditorPage } from "../features/templates/TemplateEditorPage";
import { BatchesPage } from "../features/batches/BatchesPage";
import { CreateBatchPage } from "../features/batches/CreateBatchPage";
import { BatchDetailPage } from "../features/batches/BatchDetailPage";
import { RecordsPage } from "../features/records/RecordsPage";
import { SettingsPage } from "../features/settings/SettingsPage";

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

function RequireSession() {
  const { session, loading, error, refresh } = useSession();
  const location = useLocation();
  if (loading)
    return (
      <div className="splash">
        <Loading label="正在開啟工作空間…" />
      </div>
    );
  if (error && !session)
    return (
      <div className="splash">
        <LoadError error={error} retry={() => void refresh()} />
      </div>
    );
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

function SignedInHome() {
  const { session } = useSession();
  return <Navigate to={homePath(session)} replace />;
}

function NotFound() {
  return (
    <main className="splash not-found">
      <Wordmark />
      <h1>找不到這個頁面</h1>
      <p>網址可能已變更。請回到首頁，或從工作空間重新開啟。</p>
      <a className="btn" href="/">回到首頁</a>
    </main>
  );
}

function RouteError() {
  const error = useRouteError();
  return (
    <main className="splash not-found">
      <Wordmark />
      <h1>畫面發生錯誤</h1>
      <p>{error instanceof Error ? error.message : "請重新整理後再試一次。"}</p>
      <button className="btn" type="button" onClick={() => location.reload()}>重新整理</button>
    </main>
  );
}

const wide: RouteHandle = { wide: true };

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <AuthPage key="login" mode="login" /> },
      { path: "/activate", element: <AuthPage key="activation" mode="activation" /> },
      { path: "/reset-password", element: <AuthPage key="reset" mode="reset" /> },
      { path: "/verify", element: <SerialCheckPage /> },
      { path: "/verify/:serial", element: <SerialCheckPage /> },
      { path: "/download", element: <DownloadPage /> },
      {
        element: <RequireSession />,
        children: [
          { path: "/workspace", element: <SignedInHome /> },
          { path: "/certificates", element: <Navigate to="/me" replace /> },
          { path: "/my-certificates", element: <Navigate to="/me" replace /> },
          { element: <AccountLayout />, children: [{ path: "/me", element: <MyCertificatesPage /> }] },
          {
            path: "/o/:orgId/*",
            element: <LegacyWorkspaceRedirect />,
          },
          {
            path: "/:orgSlug",
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <Navigate to="templates" replace /> },
              { path: "templates", element: <TemplatesPage /> },
              { path: "templates/:templateId", element: <TemplateEditorPage />, handle: wide },
              { path: "batches", element: <BatchesPage /> },
              { path: "batches/new", element: <CreateBatchPage /> },
              { path: "batches/:batchId", element: <BatchDetailPage /> },
              { path: "deliveries", element: <RecordsPage kind="deliveries" /> },
              { path: "audit", element: <RecordsPage kind="audit" /> },
              { path: "settings", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
