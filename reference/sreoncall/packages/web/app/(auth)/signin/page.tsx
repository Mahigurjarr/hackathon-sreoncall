import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import SignInForm from './SignInForm';

export const metadata = {
  title: 'Sign In - SREonCall',
};

export default async function SignInPage() {
  const session = await auth();

  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <Suspense fallback={<div className="rounded-lg border border-border bg-card p-8 shadow-sm" />}>
      <SignInForm />
    </Suspense>
  );
}
