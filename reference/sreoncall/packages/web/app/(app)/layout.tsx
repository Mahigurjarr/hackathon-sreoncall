import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { RealtimeProvider } from '@/components/layout/RealtimeProvider';
import { PlanChangePopup } from '@/components/PlanChangePopup';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/signin');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <RealtimeProvider />
      <PlanChangePopup />
      <Sidebar tenantType={(session.user as any).tenantType} />
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        <Topbar user={session.user} orgSlug={(session as any).tenantSlug || 'platform'} />
        <main className="flex-1 min-h-0 overflow-y-auto scroll-smooth bg-muted/30 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
