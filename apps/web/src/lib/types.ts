import type { createDefaultDocument } from "@cert/contracts";

export type TemplateDocument = ReturnType<typeof createDefaultDocument>;
export type TextElement = TemplateDocument["elements"][number];
export interface Organization {
  id: string;
  name: string;
  /** Short workspace address segment, e.g. "zhixing" in /zhixing/templates. */
  slug: string;
}
export interface Membership {
  organization: Organization;
  role: string;
  permissions: string[];
}
export interface Session {
  user: { id: string; email: string };
  memberships: Membership[];
}
export interface Template {
  id: string;
  name: string;
  document: TemplateDocument;
  revision: number;
  status: string;
  versions: { id: string; number: number; document?: TemplateDocument }[];
}
export interface ValidationRow {
  rowNumber: number;
  templateVersionId?: string | null;
  data: Record<string, string>;
  errors: { field: string; message: string }[];
}
export interface BatchTemplateRef {
  id: string;
  name: string;
  number: number;
}
export interface Validation {
  rows: ValidationRow[];
  valid: boolean;
  templates?: BatchTemplateRef[];
}
export interface BatchRow {
  id: string;
  rowNumber: number;
  data: Record<string, string>;
  status: string;
  error?: string | null;
  history?: { id: string; number: string; status: string; edition: number }[];
  templateVersionId?: string;
  templateName?: string;
  certificate?: { id: string; number: string; status?: string; storedStatus?: string; expiresAt?: string | null; revision: number; passwordSent?: boolean } | null;
}
export interface Batch {
  revision: number;
  cancelReason?: string;
  expiresAt?: string | null;
  id: string;
  eventName: string;
  status: string;
  createdAt?: string;
  templateVersionId?: string;
  previewedAt?: string | null;
  templates?: BatchTemplateRef[];
  _count?: { rows: number };
  rows: BatchRow[];
  deliveries: Delivery[];
}
export interface Sender {
  id: string;
  displayName: string;
  fromAddress: string;
  status: string;
}
export interface Delivery {
  id: string;
  certificateId?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  messageId?: string;
  recipientEmail?: string;
  toAddress?: string;
  error?: string;
  lastError?: string;
  recipient?: { email: string };
  senderIdentity?: Sender;
}
export interface Audit {
  id: string;
  action: string;
  createdAt: string;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  actor?: { email: string };
  metadata?: unknown;
}
export interface MyCertificate {
  expiresAt: string | null;
  id: string;
  number: string;
  status: string;
  issuedAt: string;
  organization: { name: string };
  batch: { eventName: string };
}
