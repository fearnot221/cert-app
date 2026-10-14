import { describe, expect, it } from 'vitest';
import { createDefaultDocument, interpolateText, TemplateDocumentSchema, validateTemplateData } from './index';

describe('versioned certificate document', () => {
  it('validates a fresh document and does not share mutable arrays between callers', () => {
    const first = createDefaultDocument();
    first.elements[0]!.text = '修改';
    expect(createDefaultDocument().elements[0]!.text).toBe('{{organization_name}}');
    expect(TemplateDocumentSchema.parse(createDefaultDocument()).rendererVersion).toBe('1');
  });

  it('rejects injected CSS, unknown HTML elements, duplicate IDs, and out of bounds rotation', () => {
    for (const change of [
      { color: 'red; background:url(https://attacker.invalid)' },
      { type: 'html', text: '<script>alert(1)</script>' },
      { x: 280, rotation: 45 },
    ]) {
      const document = createDefaultDocument();
      Object.assign(document.elements[0]!, change);
      expect(TemplateDocumentSchema.safeParse(document).success).toBe(false);
    }
    const document = createDefaultDocument();
    document.elements[1]!.id = document.elements[0]!.id;
    expect(TemplateDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('allows only declared field names and rejects expressions', () => {
    const document = createDefaultDocument();
    document.elements[0]!.text = '{{process.env.SECRET}}';
    expect(TemplateDocumentSchema.safeParse(document).success).toBe(false);
    document.elements[0]!.text = '{{unknown_field}}';
    expect(TemplateDocumentSchema.safeParse(document).success).toBe(false);
  });

  it('does not evaluate recipient values or read inherited properties', () => {
    expect(interpolateText('{{recipient_name}}', { recipient_name: '<img onerror=alert(1)>' })).toBe('<img onerror=alert(1)>');
    expect(() => interpolateText('{{constructor}}', {})).toThrow('缺少動態欄位');
    expect(() => interpolateText('{{recipient_name}}', {})).toThrow('缺少動態欄位');
  });

  it('reports field errors before PDF work, including impossible calendar dates', () => {
    const errors = validateTemplateData(createDefaultDocument(), {
      recipient_name: '', recipient_email: 'invalid', organization_name: '測試組織',
      event_name: '課程', issue_date: '2026-02-30',
    });
    expect(errors.map(error => error.field)).toEqual(['recipient_name', 'recipient_email', 'issue_date']);
  });
});
