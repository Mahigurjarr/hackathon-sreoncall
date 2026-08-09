'use client';

import { useState } from 'react';
import type { LeadTrack } from './page';

const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–1,000', '1,000+'] as const;
const SIZE_MAP: Record<string, string> = {
  '1–10': '1-10',
  '11–50': '11-50',
  '51–200': '51-200',
  '201–1,000': '201-1000',
  '1,000+': '1000+',
};

interface Props {
  track: LeadTrack;
}

export function ContactForm({ track }: Props) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    role: '',
    company_size: '',
    message: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const payload: Record<string, string> = {
      name: form.name,
      email: form.email,
      company: form.company,
      track,
    };
    if (form.role) payload.role = form.role;
    if (form.company_size) payload.company_size = SIZE_MAP[form.company_size] || form.company_size;
    if (form.message) payload.message = form.message;

    try {
      const res = await fetch('/api/v1/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        setError('Too many submissions. Please try again in an hour.');
      } else if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.detail || 'Something went wrong. Please try again.');
      } else {
        setSuccess(true);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div
        className="rounded-2xl p-10 text-center"
        style={{ background: '#161B22', border: '1px solid #1E293B' }}
      >
        <div className="text-4xl mb-4">✅</div>
        <h3 className="text-xl font-bold mb-2" style={{ color: '#E2E8F0' }}>
          Message sent!
        </h3>
        <p className="text-sm" style={{ color: '#94A3B8' }}>
          Thanks for reaching out. We&apos;ll be in touch within one business day.
        </p>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    background: '#0D1117',
    border: '1px solid #1E293B',
    color: '#E2E8F0',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '14px',
    width: '100%',
    outline: 'none',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Row 1: Name + Email */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#94A3B8' }}>
            Name <span style={{ color: '#FF6B2B' }}>*</span>
          </label>
          <input type="text" value={form.name} onChange={set('name')} required style={inputStyle} placeholder="Jane Smith" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#94A3B8' }}>
            Work email <span style={{ color: '#FF6B2B' }}>*</span>
          </label>
          <input type="email" value={form.email} onChange={set('email')} required style={inputStyle} placeholder="jane@acme.com" />
        </div>
      </div>

      {/* Row 2: Company + Role */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#94A3B8' }}>
            Company <span style={{ color: '#FF6B2B' }}>*</span>
          </label>
          <input type="text" value={form.company} onChange={set('company')} required style={inputStyle} placeholder="Acme Corp" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: '#94A3B8' }}>
            Role <span style={{ color: '#64748B' }}>(optional)</span>
          </label>
          <input type="text" value={form.role} onChange={set('role')} style={inputStyle} placeholder="Head of Engineering" />
        </div>
      </div>

      {/* Row 3: Company size */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: '#94A3B8' }}>
          Company size <span style={{ color: '#64748B' }}>(optional)</span>
        </label>
        <select value={form.company_size} onChange={set('company_size')} style={{ ...inputStyle, appearance: 'none' }}>
          <option value="">Select…</option>
          {COMPANY_SIZES.map((s) => (
            <option key={s} value={s}>{s} employees</option>
          ))}
        </select>
      </div>

      {/* Row 4: Message */}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: '#94A3B8' }}>
          Message <span style={{ color: '#64748B' }}>(optional)</span>
        </label>
        <textarea
          value={form.message}
          onChange={set('message')}
          rows={4}
          maxLength={2000}
          style={{ ...inputStyle, resize: 'vertical' }}
          placeholder="Tell us about your stack, team size, or what you're looking to solve…"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: '#FF6B2B' }}
      >
        {loading ? 'Sending…' : 'Send message →'}
      </button>

      {error && (
        <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>
      )}
    </form>
  );
}
