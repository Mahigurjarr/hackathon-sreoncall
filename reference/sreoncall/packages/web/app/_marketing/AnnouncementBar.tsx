// packages/web/app/_marketing/AnnouncementBar.tsx
'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'announcement-bar-dismissed-v1';

export function AnnouncementBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="relative z-50 flex items-center justify-center px-4 py-2 text-sm font-medium text-white"
      style={{ background: '#FF6B2B' }}
    >
      <span>
        🚀 AI-powered RCA is now available on all paid plans —{' '}
        <Link href="/#features" className="underline underline-offset-2 hover:opacity-80">
          See what&apos;s new →
        </Link>
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-4 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100"
        aria-label="Dismiss announcement"
      >
        <X size={16} />
      </button>
    </div>
  );
}
