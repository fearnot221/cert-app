import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowLeftIcon, CheckCircledIcon, ChevronLeftIcon, ChevronRightIcon, ExclamationTriangleIcon,
  InfoCircledIcon, ReloadIcon,
} from "@radix-ui/react-icons";
import { Button } from "./Button";
import { statusLabels, statusTone } from "../lib/format";

export function Notice({ message, kind = "error" }: { message?: string; kind?: "error" | "success" | "info" }) {
  if (!message) return null;
  const Icon = kind === "success" ? CheckCircledIcon : kind === "info" ? InfoCircledIcon : ExclamationTriangleIcon;
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function Loading({ label = "正在載入…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="skeleton-line" />
      <span className="skeleton-line short" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-seal" aria-hidden />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="load-error">
      <Notice message={error} />
      <Button variant="quiet" onClick={retry}>
        <ReloadIcon />
        重新載入
      </Button>
    </div>
  );
}

export function Status({ value }: { value: string }) {
  const state = value.toLowerCase();
  return <span className={`status status-${statusTone(state)}`}>{statusLabels[state] ?? value}</span>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back-link" to={to}>
      <ArrowLeftIcon aria-hidden />
      {children}
    </Link>
  );
}

export function Pagination({ page, pageSize, hasNext, loading, onPageChange }: {
  page: number; pageSize: number; hasNext: boolean; loading: boolean; onPageChange: (page: number) => void;
}) {
  if (page === 0 && !hasNext) return null;
  return (
    <nav className="pagination" aria-label="資料分頁">
      <span>第 {page + 1} 頁，每頁最多 {pageSize} 筆</span>
      <div className="btn-row">
        <Button variant="quiet" size="sm" disabled={loading || page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeftIcon />
          上一頁
        </Button>
        <Button variant="quiet" size="sm" disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)}>
          下一頁
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}

/** The two overlapping seals: yellow issues, green verifies. */
export function SealMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size * 1.5} height={size} viewBox="0 0 42 28" aria-hidden className="seal-mark">
      <circle cx="14" cy="14" r="14" fill="var(--color-issue)" />
      <circle cx="28" cy="14" r="14" fill="var(--color-verify)" style={{ mixBlendMode: "multiply" }} />
    </svg>
  );
}

export function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="certfolio 首頁">
      <SealMark />
      <span>certfolio</span>
    </Link>
  );
}
