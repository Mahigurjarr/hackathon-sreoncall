'use client';

import { GraduationCap, CheckCircle2, Clock } from 'lucide-react';
import { PartnerPage, PartnerCard } from '@/components/partner/PartnerPage';

interface Course {
  track: 'referral' | 'reseller' | 'msp';
  title: string;
  duration: string;
  description: string;
  required: boolean;
  status: 'not_started' | 'in_progress' | 'completed';
}

const COURSES: Course[] = [
  {
    track: 'referral',
    title: 'Referral Partner Onboarding',
    duration: '1 hour · live session',
    description: 'Product overview and pitch training. Scheduled with your Partner Manager.',
    required: true,
    status: 'not_started',
  },
  {
    track: 'reseller',
    title: 'Reseller Certification',
    duration: '4 hours · self-paced',
    description: 'Product, competitive positioning, and demo delivery. Required to activate Reseller track.',
    required: false,
    status: 'not_started',
  },
  {
    track: 'msp',
    title: 'MSP Technical Certification',
    duration: '8 hours · self-paced',
    description: 'Deployment, tenant management, agent configuration, and support workflows. Required to activate MSP track.',
    required: false,
    status: 'not_started',
  },
];

const STATUS_LABELS: Record<Course['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const STATUS_STYLES: Record<Course['status'], string> = {
  not_started: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

export default function PartnerTrainingPage() {
  return (
    <PartnerPage
      title="Training"
      subtitle="Partner enablement courses and certification"
      icon={GraduationCap}
    >
      <div className="space-y-4">
        {COURSES.map((c) => {
          const Icon = c.status === 'completed' ? CheckCircle2 : Clock;
          return (
            <PartnerCard key={c.title}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[#0F172A]">{c.title}</p>
                    {c.required && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FF6B2B]/10 text-[#FF6B2B] border border-[#FF6B2B]/20">
                        REQUIRED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#94A3B8] mt-1">{c.duration}</p>
                  <p className="text-xs text-[#64748B] mt-2 leading-relaxed">{c.description}</p>
                </div>
                <div className="shrink-0">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${STATUS_STYLES[c.status]}`}>
                    <Icon size={12} />
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
              </div>
            </PartnerCard>
          );
        })}
      </div>
    </PartnerPage>
  );
}
