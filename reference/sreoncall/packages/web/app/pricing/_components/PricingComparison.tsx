// packages/web/app/pricing/_components/PricingComparison.tsx
import { PRICING_COMPETITOR_COMPARISON } from '../../_marketing/data/pricing';

export function PricingComparison() {
  return (
    <section className="py-20 px-4 bg-white">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase mb-3 text-center" style={{ color: '#FF6B2B' }}>
          How We Compare
        </p>
        <h2 className="text-3xl font-extrabold text-center mb-3" style={{ color: '#0D1117' }}>
          Half the cost. One platform.
        </h2>
        <p className="text-center mb-10" style={{ color: '#64748B' }}>
          Replace your entire SRE toolchain for less than your current monitoring bill.
        </p>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #E9ECEF' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: '#0D1117' }}>
                <th className="text-left px-6 py-4 font-semibold" style={{ color: '#94A3B8' }}>Stack</th>
                <th className="text-center px-6 py-4 font-semibold" style={{ color: '#94A3B8' }}>Monthly cost (50 hosts)</th>
              </tr>
            </thead>
            <tbody>
              {PRICING_COMPETITOR_COMPARISON.map((row) => (
                <tr
                  key={row.stack}
                  style={
                    row.highlight
                      ? { background: '#FFF5F0', borderLeft: '3px solid #FF6B2B' }
                      : { borderBottom: '1px solid #F1F3F5' }
                  }
                >
                  <td className="px-6 py-4 font-medium" style={{ color: row.highlight ? '#0D1117' : '#374151' }}>
                    {row.stack}
                  </td>
                  <td
                    className="px-6 py-4 text-center font-bold tabular-nums"
                    style={{ color: row.highlight ? '#FF6B2B' : '#6B7280', fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {row.cost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs mt-3 text-center" style={{ color: '#94A3B8' }}>
          Estimates based on 50 hosts, 200K metrics series, standard support. Actual costs vary.
        </p>
      </div>
    </section>
  );
}
