// packages/web/app/page.tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import MarketingLayout from './_marketing/layout';
import Hero from './_marketing/sections/Hero';
import LogoStrip from './_marketing/sections/LogoStrip';
import StatsBar from './_marketing/sections/StatsBar';
import ProblemSection from './_marketing/sections/ProblemSection';
import FeaturesSection from './_marketing/sections/FeaturesSection';
import HowItWorksSection from './_marketing/sections/HowItWorksSection';
import DemoSection from './_marketing/sections/DemoSection';
import ComparisonSection from './_marketing/sections/ComparisonSection';
import PricingStrip from './_marketing/sections/PricingStrip';
import TestimonialsSection from './_marketing/sections/TestimonialsSection';
import CtaFooter from './_marketing/sections/CtaFooter';

export const metadata: Metadata = {
  title: 'SREonCall — The All-in-One SRE Platform',
  description:
    'Replace Datadog, PagerDuty, and your entire SRE toolchain with one flat-price platform. Incidents, on-call, observability, AI agents, and runbooks — unified.',
  openGraph: {
    title: 'SREonCall — One flat price for your entire SRE stack',
    description: 'Unlimited hosts. No per-GB charges. AI-powered RCA. From $999/mo.',
  },
};

export default async function RootPage() {
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <MarketingLayout>
      <Hero />
      <LogoStrip />
      <StatsBar />
      <ProblemSection />
      <FeaturesSection />
      <HowItWorksSection />
      <DemoSection />
      <ComparisonSection />
      <PricingStrip />
      <TestimonialsSection />
      <CtaFooter />
    </MarketingLayout>
  );
}
