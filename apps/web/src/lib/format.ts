/** A calendar day ("2026-10-15" or a timestamp) in the same style as formatDate, without the time. */
export function formatDay(value?: string | null) {
  if (!value) return "尚無紀錄";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value;
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" }).format(new Date(day));
}
export function formatDate(value?: string | null) {
  if (!value) return "尚無紀錄";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export const statusLabels: Record<string, string> = {
  draft: "草稿", published: "已發布", archived: "已封存", validated: "已驗證", pending: "等待處理",
  queued: "排程中", generating: "產製中", processing: "處理中", ready: "產製完成", completed: "完成",
  success: "成功", generated: "已產製", failed: "失敗", partial: "部分失敗", sending: "傳送中",
  accepted: "已交付 SMTP", delivered: "已投遞", unknown: "結果不確定", bounced: "退信", active: "有效",
  valid: "有效", revoked: "已撤銷", superseded: "已取代", expired: "已到期", enabled: "可用",
  verified: "已驗證", disabled: "已停用", cancelled: "已取消", sent: "通知已提交",
};

export type StatusTone = "good" | "issue" | "danger" | "neutral";

export function statusTone(value: string): StatusTone {
  const state = value.toLowerCase();
  if (["failed", "bounced", "revoked"].includes(state)) return "danger";
  if (["active", "valid", "ready", "completed", "success", "published", "generated", "accepted", "verified", "delivered"].includes(state)) return "good";
  if (["pending", "queued", "generating", "processing", "sending", "validated", "expired", "unknown", "draft"].includes(state)) return "issue";
  return "neutral";
}

export const roleNames: Record<string, string> = {
  owner: "組織擁有者", admin: "組織管理員", designer: "模板設計者", issuer: "發證人員",
  auditor: "稽核人員", template_designer: "模板設計者", certificate_issuer: "發證人員",
};
