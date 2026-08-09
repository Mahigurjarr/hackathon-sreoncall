'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'cookie_consent_dismissed';

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-4 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0D1117] shadow-lg px-5 py-4 flex items-center gap-4">
        <p className="flex-1 text-[13px] text-[#334155] dark:text-[#94A3B8] leading-relaxed">
          SREonCall uses only essential cookies for authentication and session management.
          No tracking or analytics cookies are used.{' '}
          <a href="/privacy" className="text-[#FF6B2B] hover:underline font-medium">
            Privacy Policy
          </a>
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-lg bg-[#0D1117] dark:bg-[#FF6B2B] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
