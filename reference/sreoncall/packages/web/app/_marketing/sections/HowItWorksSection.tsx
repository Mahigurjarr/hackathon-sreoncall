// packages/web/app/_marketing/sections/HowItWorksSection.tsx

const STEPS = [
  {
    number: '01',
    icon: '🔌',
    heading: 'Connect your stack',
    description: 'eBPF agent auto-discovers services and begins monitoring in minutes. Zero config, no code changes required.',
  },
  {
    number: '02',
    icon: '🔔',
    heading: 'Alerts reach the right person',
    description: 'Visual rotation builder and escalation policies ensure every page reaches the right engineer — fast.',
  },
  {
    number: '03',
    icon: '🤖',
    heading: 'AI resolves before you wake up',
    description: 'Autonomous agents run diagnostic playbooks, generate root cause analysis, and escalate with full context.',
  },
] as const;

export default function HowItWorksSection() {
  return (
    <section className="py-20 px-4" style={{ background: '#0D1117' }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p
            className="text-xs font-semibold tracking-[0.2em] uppercase mb-3"
            style={{ color: '#FF6B2B' }}
          >
            How it works
          </p>
          <h2
            className="text-3xl sm:text-4xl font-extrabold"
            style={{ color: '#E2E8F0' }}
          >
            Up and running in minutes.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connector line — desktop only */}
          <div
            className="hidden md:block absolute top-8 left-[calc(16.66%+16px)] right-[calc(16.66%+16px)] h-px"
            style={{ background: '#1E293B' }}
          />

          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col items-center text-center relative">
              {/* Number badge */}
              <div
                className="relative z-10 w-16 h-16 rounded-2xl flex items-center justify-center text-2xl mb-5"
                style={{ background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.2)' }}
              >
                {step.icon}
              </div>
              <p
                className="text-xs font-bold tracking-widest uppercase mb-2"
                style={{ color: '#FF6B2B' }}
              >
                Step {step.number}
              </p>
              <h3
                className="text-lg font-bold mb-3"
                style={{ color: '#E2E8F0' }}
              >
                {step.heading}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: '#64748B' }}>
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
