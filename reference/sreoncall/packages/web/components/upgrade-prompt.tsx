'use client';

import { useRouter } from 'next/navigation';

interface UpgradePromptProps {
  limitKey?: string;
  plan?: string;
  detail?: string;
  onDismiss?: () => void;
}

export function UpgradePrompt({ limitKey, plan, detail, onDismiss }: UpgradePromptProps) {
  const router = useRouter();

  const featureName = limitKey
    ? limitKey.replace(/^max_/, '').replace(/_/g, ' ')
    : 'this feature';

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-amber-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-800">
            {plan
              ? `Your ${plan} plan doesn't include ${featureName}`
              : `Plan limit reached`}
          </p>
          {detail && (
            <p className="mt-1 text-sm text-amber-700">{detail}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => router.push('/settings/billing')}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
          >
            Upgrade Plan
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="rounded-md px-2 py-1.5 text-sm text-amber-700 hover:bg-amber-100 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Parse a 402 API error response and return UpgradePrompt props.
 * Usage: if (res.status === 402) { const props = parseUpgradeError(await res.json()); }
 */
export function parseUpgradeError(body: any): UpgradePromptProps {
  return {
    limitKey: body?.limit_key,
    plan: body?.plan,
    detail: body?.detail,
  };
}
