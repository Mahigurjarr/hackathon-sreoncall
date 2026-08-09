'use client';

import { LifeBuoy, MessageCircle, Mail, Calendar, ExternalLink } from 'lucide-react';
import { PartnerPage, PartnerCard } from '@/components/partner/PartnerPage';

export default function PartnerSupportPage() {
  return (
    <PartnerPage
      title="Support"
      subtitle="Get help from your Partner Manager and the SREonCall team"
      icon={LifeBuoy}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PartnerCard>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
              <MessageCircle size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#0F172A]">Partner Slack channel</p>
              <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">
                Direct access to SREonCall engineering and support. Priority response within 4 business hours.
              </p>
              <a
                href="mailto:partners@sreoncall.com?subject=Request%20Slack%20channel%20invite"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#FF6B2B] hover:underline"
              >
                Request invite <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </PartnerCard>

        <PartnerCard>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
              <Calendar size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#0F172A]">Book your Partner Manager</p>
              <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">
                Co-selling, deal support, escalations, and programme questions.
              </p>
              <a
                href="mailto:partners@sreoncall.com?subject=Book%20Partner%20Manager"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#FF6B2B] hover:underline"
              >
                Book time <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </PartnerCard>

        <PartnerCard>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
              <Mail size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#0F172A]">Programme enquiries</p>
              <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">
                General partner programme questions and new track activation.
              </p>
              <a
                href="mailto:partners@sreoncall.com"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#FF6B2B] hover:underline"
              >
                partners@sreoncall.com <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </PartnerCard>

        <PartnerCard>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,107,43,0.12)] text-[#FF6B2B]">
              <Mail size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#0F172A]">Billing & invoicing</p>
              <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">
                Invoice, payout, and payment questions.
              </p>
              <a
                href="mailto:billing@sreoncall.com"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#FF6B2B] hover:underline"
              >
                billing@sreoncall.com <ExternalLink size={11} />
              </a>
            </div>
          </div>
        </PartnerCard>
      </div>
    </PartnerPage>
  );
}
