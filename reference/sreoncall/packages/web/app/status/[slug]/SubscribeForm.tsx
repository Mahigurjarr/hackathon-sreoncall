'use client';

import { useState } from 'react';

export function SubscribeForm({ slug }: { slug: string }) {
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms' | 'webhook' | 'rss'>('email');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (channel === 'rss') return; // RSS doesn't need a form submit

    if (!inputValue.trim()) return;

    setStatus('loading');
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const body: Record<string, string> = { channel };

      if (channel === 'email') {
        body.email = inputValue.trim();
      } else if (channel === 'sms') {
        body.phone = inputValue.trim();
      } else if (channel === 'webhook') {
        body.webhook_url = inputValue.trim();
      }

      const res = await fetch(`${apiUrl}/api/v1/public/status-pages/${slug}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
        setMessage(
          channel === 'email'
            ? (data.message || 'Check your email to confirm your subscription.')
            : channel === 'sms'
            ? (data.message || 'You will receive SMS notifications for status updates.')
            : (data.message || 'Webhook registered. You will receive POST requests for status updates.')
        );
        setInputValue('');
      } else {
        setStatus('error');
        setMessage(data.detail || 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  const channels = [
    { key: 'email' as const, label: 'Email', icon: '\u{1F4E7}' },
    { key: 'sms' as const, label: 'SMS', icon: '\u{1F4AC}' },
    { key: 'webhook' as const, label: 'Webhook', icon: '\u{1F517}' },
    { key: 'rss' as const, label: 'RSS', icon: '\u{1F4E1}' },
  ];

  const inputConfig = {
    email: { type: 'email', placeholder: 'your@email.com', helper: "You\u2019ll receive a confirmation email. Unsubscribe any time." },
    sms: { type: 'tel', placeholder: '+1 555 123 4567', helper: 'Enter your phone number with country code.' },
    webhook: { type: 'url', placeholder: 'https://your-app.com/webhook', helper: 'We\u2019ll send POST requests with JSON payloads for status changes.' },
    rss: { type: 'text', placeholder: '', helper: '' },
  };

  const cfg = inputConfig[channel];

  if (status === 'success') {
    return (
      <div className="rounded-lg border border-success/20 bg-success/10 p-3">
        <p className="text-sm text-success">{message}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Channel selector */}
      <div className="flex gap-1.5 mb-3.5 flex-wrap">
        {channels.map((ch) => (
          <button
            key={ch.key}
            type="button"
            onClick={() => {
              setChannel(ch.key);
              setInputValue('');
              setStatus('idle');
              setMessage('');
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              channel === ch.key
                ? 'border-brand/40 bg-brand/10 text-brand'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
            }`}
          >
            <span>{ch.icon}</span>
            {ch.label}
          </button>
        ))}
      </div>

      {/* RSS — just show the feed URL */}
      {channel === 'rss' ? (
        <div>
          <div className="flex h-[40px] items-center rounded-lg border border-slate-200 bg-slate-100 px-4 text-[13px] text-slate-700 font-mono select-all">
            {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/public/status-pages/${slug}/rss` : `/api/v1/public/status-pages/${slug}/rss`}
          </div>
          <p className="text-[11.5px] text-slate-500 mt-2">
            Copy this URL and add it to your RSS reader.
          </p>
        </div>
      ) : (
        <>
          {/* Input + subscribe */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type={cfg.type}
              placeholder={cfg.placeholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              required
              className="flex h-[40px] flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-brand/50 focus-visible:ring-[3px] focus-visible:ring-brand/12"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="inline-flex h-[40px] items-center justify-center rounded-lg bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand/90 disabled:opacity-50 transition-colors"
            >
              {status === 'loading' ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>

          {/* Helper text */}
          <p className="text-[11.5px] text-slate-500 mt-2">{cfg.helper}</p>
        </>
      )}

      {status === 'error' && (
        <p className="text-xs text-error mt-1.5">{message}</p>
      )}
    </div>
  );
}
