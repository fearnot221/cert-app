import type { TemplateDocument } from "../../lib/types";

/** Sample values for the canvas and thumbnails. Real certificates use the imported list instead. */
export const previewData: Record<string, string> = {
  recipient_name: "王小明",
  recipient_email: "recipient@example.org",
  organization_name: "發證組織",
  event_name: "專業培訓課程",
  issue_date: "2026-10-15",
  certificate_number: "STA-2026-0001",
};

const sampleByType = { text: "", date: "2026-10-15", number: "12", email: "name@example.org" } as const;

/** Preview values for one template: the built-ins above, plus a sample for each custom field. */
export function previewDataFor(document: TemplateDocument, organizationName: string) {
  const data: Record<string, string> = { ...previewData, organization_name: organizationName };
  for (const field of document.fields)
    if (!(field.key in data)) data[field.key] = sampleByType[field.type] || field.label;
  return data;
}
