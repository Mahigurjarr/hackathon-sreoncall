import { describe, it, expect } from 'vitest';
import {
  voiceAnswerQuerySchema,
  voiceAckQuerySchema,
  escapeXml,
  renderXml,
  buildXmlDocument,
} from '../plivo-webhooks.routes';

describe('plivo-webhooks query validation', () => {
  const validOid = 'a'.repeat(24);

  describe('voiceAnswerQuerySchema', () => {
    it('accepts a valid request with all params', () => {
      const r = voiceAnswerQuerySchema.safeParse({
        message: 'Sev 1 incident on payments',
        incidentId: validOid,
        tenantId: validOid,
        userId: validOid,
      });
      expect(r.success).toBe(true);
    });

    it('accepts an empty query (defaults handle missing values)', () => {
      const r = voiceAnswerQuerySchema.safeParse({});
      expect(r.success).toBe(true);
    });

    it.each([
      ['short non-hex id', 'not-an-object-id'],
      ['too-long hex id', 'a'.repeat(25)],
      ['too-short hex id', 'a'.repeat(23)],
      ['contains script tag', '<script>alert(1)</script>'],
      ['contains XML break-out', '"><Hangup/><!--'],
    ])('rejects malformed tenantId — %s', (_label, bad) => {
      const r = voiceAnswerQuerySchema.safeParse({ tenantId: bad });
      expect(r.success).toBe(false);
    });

    it('rejects a message longer than 500 chars', () => {
      const r = voiceAnswerQuerySchema.safeParse({ message: 'x'.repeat(501) });
      expect(r.success).toBe(false);
    });

    it('accepts a message at the 500-char boundary', () => {
      const r = voiceAnswerQuerySchema.safeParse({ message: 'x'.repeat(500) });
      expect(r.success).toBe(true);
    });
  });

  describe('voiceAckQuerySchema', () => {
    it('accepts a single-digit press with valid ids', () => {
      const r = voiceAckQuerySchema.safeParse({
        Digits: '1',
        incidentId: validOid,
        tenantId: validOid,
        userId: validOid,
      });
      expect(r.success).toBe(true);
    });

    it('rejects an injection-style userId', () => {
      const r = voiceAckQuerySchema.safeParse({
        Digits: '1',
        userId: '"><Hangup/>',
      });
      expect(r.success).toBe(false);
    });

    it('rejects an oversize Digits value', () => {
      const r = voiceAckQuerySchema.safeParse({ Digits: '1'.repeat(21) });
      expect(r.success).toBe(false);
    });
  });
});

describe('escapeXml', () => {
  it('escapes the five XML predefined entities', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('renders attacker-controlled break-out attempts as inert text', () => {
    const malicious = `"><Hangup/><Speak>own</Speak><Speak attr="`;
    const out = escapeXml(malicious);
    expect(out).not.toContain('<Hangup');
    expect(out).not.toContain('<Speak>own</Speak>');
    expect(out).toContain('&lt;Hangup/&gt;');
    expect(out).toContain('&quot;');
  });

  it('is a no-op on safe ASCII', () => {
    const safe = 'Press 1 to acknowledge. Severity 2 incident on payments service.';
    expect(escapeXml(safe)).toBe(safe);
  });
});

describe('renderXml + buildXmlDocument', () => {
  it('renders an empty element', () => {
    expect(renderXml({ tag: 'Response' })).toBe('<Response></Response>');
  });

  it('renders attributes and escapes their values', () => {
    const out = renderXml({
      tag: 'GetDigits',
      attrs: { action: 'https://example.com/ack?x="evil"&y=1', method: 'GET' },
    });
    // Escape doubles to &quot;, ampersands to &amp;
    expect(out).toContain('action="https://example.com/ack?x=&quot;evil&quot;&amp;y=1"');
    expect(out).toContain('method="GET"');
  });

  it('escapes user-controlled text body', () => {
    const out = renderXml({ tag: 'Speak', children: ['<Hangup/>'] });
    expect(out).toBe('<Speak>&lt;Hangup/&gt;</Speak>');
    expect(out).not.toContain('<Hangup/>');
  });

  it('nests children correctly', () => {
    const out = renderXml({
      tag: 'Response',
      children: [
        { tag: 'GetDigits', attrs: { action: '/x' }, children: [{ tag: 'Speak', children: ['hi'] }] },
      ],
    });
    expect(out).toBe('<Response><GetDigits action="/x"><Speak>hi</Speak></GetDigits></Response>');
  });

  it('buildXmlDocument prepends the XML declaration', () => {
    const out = buildXmlDocument({ tag: 'Response', children: ['ok'] });
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(out).toContain('<Response>ok</Response>');
  });

  it('attribute break-out attempts are neutralized', () => {
    const out = renderXml({
      tag: 'GetDigits',
      attrs: { action: '"><Hangup/><GetDigits action="evil' },
    });
    expect(out).not.toContain('<Hangup/>');
    expect(out).not.toMatch(/<GetDigits[^"]*?action="evil/);
    expect(out).toContain('&quot;&gt;&lt;Hangup/&gt;');
  });
});
