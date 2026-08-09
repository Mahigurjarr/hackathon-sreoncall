// packages/web/app/_marketing/layout.tsx
import type { ReactNode } from 'react';
import Nav from './Nav';
import Footer from './Footer';
import { AnnouncementBar } from './AnnouncementBar';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <AnnouncementBar />
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
