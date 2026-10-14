import { describe, expect, it } from 'vitest';
import { BUILTIN_FIELDS, CertificateSerialSchema, createDefaultDocument, formatCertificateNumber, interpolateText, isBuiltinField, TemplateDocumentSchema, validateTemplateData, withBuiltinFields } from './index';

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
      event_name: '課程', issue_date: '2026-02-30', certificate_number: 'CERT-000001',
    });
    expect(errors.map(error => error.field)).toEqual(['recipient_name', 'recipient_email', 'issue_date']);
  });
});

describe('serial numbers and built-in fields', () => {
  it('pads the sequence after the prefix and never truncates a longer number', () => {
    expect(formatCertificateNumber('CERT', 6, 128)).toBe('CERT-000128');
    expect(formatCertificateNumber('ZX', 3, 12345)).toBe('ZX-12345');
  });

  it('uppercases prefixes and rejects characters that would be ambiguous on paper', () => {
    expect(CertificateSerialSchema.parse({ prefix: ' cert-a ', digits: 6 }).prefix).toBe('CERT-A');
    expect(CertificateSerialSchema.safeParse({ prefix: '證書', digits: 6 }).success).toBe(false);
    expect(CertificateSerialSchema.safeParse({ prefix: 'CERT', digits: 2 }).success).toBe(false);
  });

  it('adds missing built-in fields to older templates without touching custom ones', () => {
    const legacy = createDefaultDocument();
    legacy.fields = [legacy.fields[0]!, { key: 'hours', label: '時數', type: 'number', required: true }];
    legacy.elements = legacy.elements.filter((element) => element.text === '結業證書');
    const keys = withBuiltinFields(legacy).fields.map((field) => field.key);
    expect(keys.slice(0, 2)).toEqual(['recipient_name', 'hours']);
    for (const field of BUILTIN_FIELDS) expect(keys).toContain(field.key);
    expect(isBuiltinField('certificate_number')).toBe(true);
    expect(isBuiltinField('hours')).toBe(false);
  });
});
