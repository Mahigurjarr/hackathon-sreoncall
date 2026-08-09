'use client';

export const dynamic = 'force-dynamic';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, Phone } from 'lucide-react';

const acceptSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  phone_number: z.string().max(20).optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and a number',
    ),
  confirm_password: z.string().min(1, 'Please confirm your password'),
}).refine(data => data.password === data.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
});

type AcceptFormData = z.infer<typeof acceptSchema>;

function PasswordInput({ id, placeholder, autoComplete, registration, error }: {
  id: string;
  placeholder: string;
  autoComplete: string;
  registration: any;
  error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
          {...registration}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-[#DC2626]">{error}</p>}
    </div>
  );
}

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptFormData>({
    resolver: zodResolver(acceptSchema),
  });

  async function onSubmit(data: AcceptFormData) {
    if (!token) return;
    setError(null);

    try {
      const res = await fetch('/api/v1/users/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invite_token: token,
          password: data.password,
          name: data.name,
          phone_number: data.phone_number || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || body.message || 'Failed to accept invitation.');
        return;
      }

      const result = await res.json();
      setOrgSlug(result.org_slug || null);
      setUserEmail(result.email || null);
      setSuccess(true);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    }
  }

  if (!token) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[#DC2626]" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Invalid Invite Link</h2>
        <p className="mb-6 text-[14px] text-[#64748B]">
          This invitation link is invalid or has expired.
        </p>
        <Link
          href="/signin"
          className="inline-flex items-center justify-center rounded-[10px] border-[1.5px] border-[#E2E8F0] bg-white dark:bg-navy-elevated px-6 text-[14px] font-medium text-[#334155] dark:text-[#E2E8F0] transition-colors hover:bg-[#F8FAFC] dark:hover:bg-white/[0.06]"
          style={{ height: 44 }}
        >
          Go to Sign In
        </Link>
      </div>
    );
  }

  if (success) {
    const signinUrl = orgSlug
      ? `/signin?org_slug=${encodeURIComponent(orgSlug)}${userEmail ? `&email=${encodeURIComponent(userEmail)}` : ''}`
      : '/signin';
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Account Activated</h2>
        <p className="mb-6 text-[14px] text-[#64748B]">
          Your account is ready. Click below to sign in.
        </p>
        <button
          onClick={() => router.push(signinUrl)}
          className="inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-6 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5"
          style={{ height: 48 }}
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
      <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">Accept Invitation</h2>
      <p className="mt-2 text-[14px] text-[#64748B]">
        Set your name and password to activate your account.
      </p>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Your Name
          </label>
          <input
            id="name"
            placeholder="Jane Smith"
            autoComplete="name"
            className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            {...register('name')}
          />
          {errors.name && (
            <p className="text-[11px] text-[#DC2626]">{errors.name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="phone_number" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Phone Number <span className="text-[#94A3B8] font-normal">(optional)</span>
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
            <input
              id="phone_number"
              placeholder="+91 9876543210"
              autoComplete="tel"
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated pl-9 pr-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
              maxLength={20}
              {...register('phone_number')}
            />
          </div>
          <p className="text-[11px] text-[#94A3B8]">For voice/SMS escalation notifications. Include country code.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Password
          </label>
          <PasswordInput
            id="password"
            placeholder="Min. 8 characters"
            autoComplete="new-password"
            registration={register('password')}
            error={errors.password?.message}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm_password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Confirm Password
          </label>
          <PasswordInput
            id="confirm_password"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            registration={register('confirm_password')}
            error={errors.confirm_password?.message}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
          style={{ height: 48 }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Activating...
            </>
          ) : (
            'Activate Account'
          )}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#FF6B2B]" />
      </div>
    }>
      <AcceptInviteForm />
    </Suspense>
  );
}
