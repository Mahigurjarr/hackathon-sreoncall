'use client';

import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Eye, EyeOff } from 'lucide-react';

const signUpSchema = z.object({
  tenant_name: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(200),
  tenant_slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(63)
    .regex(
      /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
      'Slug must be lowercase, alphanumeric, and may contain hyphens',
    ),
  website: z.string().max(2048).optional().or(z.literal('')),
  name: z.string().min(1, 'Your name is required').max(200),
  email: z.string().email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain uppercase, lowercase, and a number',
    ),
  consent_privacy: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the Privacy Policy and Terms of Service' }),
  }),
});

type SignUpFormData = z.infer<typeof signUpSchema>;

export default function SignUpPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // Scroll error into view when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      tenant_name: '',
      tenant_slug: '',
      website: '',
      name: '',
      email: '',
      password: '',
    },
  });

  const orgName = watch('tenant_name');
  const slugValue = watch('tenant_slug');
  const [slugTouched, setSlugTouched] = useState(false);

  // Auto-generate slug from org name (only if user hasn't manually edited the slug)
  function handleOrgNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setValue('tenant_name', val);
    if (!slugTouched) {
      const slug = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      setValue('tenant_slug', slug, { shouldValidate: slug.length >= 3 });
    }
  }

  async function onSubmit(data: SignUpFormData) {
    setError(null);

    try {
      const payload: Record<string, unknown> = { ...data };
      if (!payload.website) delete payload.website;

      const res = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || 'Failed to create organization. Please try again.');
        return;
      }

      setSuccess(true);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)] text-center">
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
        <h2 className="mb-2 text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
          Organization Created
        </h2>
        <p className="mb-6 text-[14px] text-[#64748B]">
          We&apos;ve sent a verification email to your admin email address.
          Please check your inbox and verify your email to get started.
        </p>
        <Link
          href="/signin"
          className="inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] px-6 text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5"
          style={{ height: 48 }}
        >
          Continue to Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[510px] rounded-[14px] bg-white dark:bg-navy-surface p-10 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
      <h2 className="text-[24px] font-bold text-[#0F172A] dark:text-[#E2E8F0]">
        Create your organization
      </h2>
      <p className="mt-2 text-[14px] text-[#64748B]">
        Set up your workspace to get started
      </p>

      {error && (
        <div ref={errorRef} className="mt-6 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-sm text-[#DC2626]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="tenant_name" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Organization Name
          </label>
          <input
            id="tenant_name"
            placeholder="Acme Corp"
            className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            {...register('tenant_name')}
            onChange={handleOrgNameChange}
          />
          {errors.tenant_name && (
            <p className="text-[11px] text-[#DC2626]">{errors.tenant_name.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tenant_slug" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Organization Slug
          </label>
          <input
            id="tenant_slug"
            placeholder="acme-corp"
            className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            {...register('tenant_slug')}
            value={slugValue}
            onChange={(e) => {
              setSlugTouched(true);
              setValue('tenant_slug', e.target.value, { shouldValidate: true });
            }}
          />
          <p className="text-[11px] text-[#64748B]">
            Used in your URL: <span className="font-mono">{orgName ? orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'your-org' : 'your-org'}.sreoncall.com</span>
          </p>
          {errors.tenant_slug && (
            <p className="text-[11px] text-[#DC2626]">{errors.tenant_slug.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="website" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Website URL <span className="font-normal text-[#94A3B8]">(optional)</span>
          </label>
          <input
            id="website"
            placeholder="www.acme-corp.com"
            className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            {...register('website')}
          />
          <p className="text-[11px] text-[#64748B]">
            We&apos;ll automatically monitor this URL for uptime
          </p>
        </div>

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
          <label htmlFor="email" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Admin Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="admin@company.com"
            autoComplete="email"
            className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-[11px] text-[#DC2626]">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-[12px] font-medium text-[#334155] dark:text-[#94A3B8]">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              className="h-[42px] w-full rounded-[8px] border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-navy-elevated px-4 pr-10 text-[14px] text-[#0F172A] dark:text-[#E2E8F0] placeholder:text-[#94A3B8] focus:border-[#FF6B2B] focus:outline-none focus:ring-[3px] focus:ring-[rgba(255,107,43,0.12)]"
              {...register('password')}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-[11px] text-[#DC2626]">{errors.password.message}</p>
          )}
        </div>

        <div className="flex items-start gap-2">
          <input
            id="consent_privacy"
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-[#E2E8F0] text-[#FF6B2B] focus:ring-[#FF6B2B]"
            {...register('consent_privacy')}
          />
          <label htmlFor="consent_privacy" className="text-[12px] text-[#64748B] leading-relaxed">
            I agree to the{' '}
            <a href="/privacy" target="_blank" className="text-[#FF6B2B] hover:underline font-medium">Privacy Policy</a>
            {' '}and{' '}
            <a href="/terms" target="_blank" className="text-[#FF6B2B] hover:underline font-medium">Terms of Service</a>
          </label>
        </div>
        {errors.consent_privacy && (
          <p className="text-[11px] text-[#DC2626]">{errors.consent_privacy.message}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center rounded-[10px] bg-gradient-to-br from-[#FF6B2B] to-[#E85D1C] text-[15px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all hover:shadow-[0_4px_16px_rgba(255,107,43,0.3)] hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
          style={{ height: 48 }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating organization...
            </>
          ) : (
            'Create Organization'
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-[#64748B]">
        Already have an account?{' '}
        <Link href="/signin" className="font-semibold text-[#FF6B2B] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
