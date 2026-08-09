import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import Providers from './providers';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { FaroRum } from '@/components/faro-rum';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SREonCall — The All-in-One SRE Platform',
    template: '%s — SREonCall',
  },
  description:
    'Replace Datadog, PagerDuty, and your entire SRE toolchain with one flat-price platform. Incidents, on-call, observability, AI agents, and runbooks — unified.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/logo/favicon.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/logo/apple-touch-icon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('sreoncall-ui')||'{}');var t=s.state&&s.state.theme?s.state.theme:'light';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <FaroRum />
        <Providers>{children}</Providers>
        <CookieConsentBanner />
      </body>
    </html>
  );
}
