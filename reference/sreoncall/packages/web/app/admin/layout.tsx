import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AdminSidebar } from '@/components/layout/AdminSidebar';
import { Topbar } from '@/components/layout/Topbar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/signin');
  }

  if ((session.user as any).role !== 'platform_admin') {
    redirect('/signin');
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar user={session.user} orgSlug="platform" />
        <main className="flex-1 overflow-y-auto bg-muted/30 dot-texture-light dark:dot-texture-dark p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
