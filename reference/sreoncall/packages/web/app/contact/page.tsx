import type { Metadata } from 'next';
import MarketingLayout from '../_marketing/layout';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact — SREonCall',
};

export type LeadTrack = 'hero' | 'demo' | 'referral' | 'reseller' | 'msp' | 'partner' | 'general';

interface ContactSearchParams {
  demo?: string;
  plan?: string;
  track?: string;
}

function getHeroCopy(params: ContactSearchParams): { label: string; heading: string; sub: string } {
  if (params.demo === '1' || params.track === 'demo') {
    return {
      label: 'Book a demo',
      heading: 'See SREonCall in action.',
      sub: 'Schedule a 20-minute live walkthrough tailored to your stack and team size.',
    };
  }
  if (params.plan === 'dedicated') {
    return {
      label: 'Sales',
      heading: 'Talk to our sales team.',
      sub: "Custom pricing, migration support, and on-premises deployment — let's scope it together.",
    };
  }
  if (['referral', 'reseller', 'msp', 'partner'].includes(params.track ?? '')) {
    return {
      label: 'Partners',
      heading: 'Join our partner programme.',
      sub: 'Referral, Reseller, and MSP tracks. Best-in-class margins and co-sell support.',
    };
  }
  return {
    label: 'Contact',
    heading: 'Get in touch.',
    sub: "Whether you have a question, want a demo, or are ready to talk pricing — we're here.",
  };
}

function resolveTrack(params: ContactSearchParams): LeadTrack {
  if (params.demo === '1' || params.track === 'demo') return 'demo';
  const t = params.track as LeadTrack | undefined;
  if (t && ['referral', 'reseller', 'msp', 'partner', 'general'].includes(t)) return t;
  return 'general';
}

interface ContactPageProps {
  searchParams: Promise<ContactSearchParams>;
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = await searchParams;
  const hero = getHeroCopy(params);
  const track = resolveTrack(params);

  return (
    <MarketingLayout>
      {/* Hero */}
      <section
        className="pt-32 pb-16 px-4 text-center"
        style={{ background: 'linear-gradient(160deg, #0D1117, #161B22)' }}
      >
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-4" style={{ color: '#FF6B2B' }}>
            {hero.label}
          </p>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4" style={{ color: '#E2E8F0' }}>
            {hero.heading}
          </h1>
          <p className="text-lg" style={{ color: '#94A3B8' }}>
            {hero.sub}
          </p>
        </div>
      </section>

      {/* Form + info */}
      <section className="py-16 px-4" style={{ background: '#0D1117' }}>
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-5 gap-10">
          {/* Form — left, takes 3 cols */}
          <div
            className="md:col-span-3 rounded-2xl p-8"
            style={{ background: '#161B22', border: '1px solid #1E293B' }}
          >
            <h2 className="text-lg font-bold mb-6" style={{ color: '#E2E8F0' }}>
              Send us a message
            </h2>
            <ContactForm track={track} />
          </div>

          {/* Info cards — right, takes 2 cols */}
          <div className="md:col-span-2 space-y-4">
            {[
              {
                icon: '⏱',
                heading: 'Quick response',
                body: 'We reply to every enquiry within one business day.',
              },
              {
                icon: '📧',
                heading: 'Prefer email?',
                body: 'sales@sreoncall.com for product questions, partners@sreoncall.com for partnership enquiries.',
              },
              {
                icon: '🗓',
                heading: 'Book directly',
                body: "Looking for a demo? Mention it in the message and we'll send a calendar link.",
              },
            ].map((card) => (
              <div
                key={card.heading}
                className="rounded-xl p-5"
                style={{ background: '#161B22', border: '1px solid #1E293B' }}
              >
                <div className="text-xl mb-2">{card.icon}</div>
                <h3 className="text-sm font-semibold mb-1" style={{ color: '#E2E8F0' }}>{card.heading}</h3>
                <p className="text-xs leading-relaxed" style={{ color: '#64748B' }}>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
