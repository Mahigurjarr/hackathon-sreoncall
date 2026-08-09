// packages/web/app/pricing/_components/FeatureTable.tsx
'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FEATURE_GROUPS } from '../../_marketing/data/pricing';

const HEADERS = ['Feature', 'Free', 'Startup', 'Growth', 'Enterprise', 'Dedicated'] as const;
const COL_KEYS = ['free', 'startup', 'growth', 'enterprise', 'dedicated'] as const;

function Cell({ value, isGrowth }: { value: string; isGrowth: boolean }) {
  if (value === '✓') return <span style={{ color: '#FF6B2B', fontWeight: 700 }}>✓</span>;
  if (value === '—') return <span style={{ color: '#94A3B8' }}>—</span>;
  return <span style={{ color: '#374151', fontWeight: isGrowth ? 600 : 400 }}>{value}</span>;
}

export function FeatureTable() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 mx-auto text-sm font-medium transition-colors hover:opacity-80"
        style={{ color: '#FF6B2B' }}
      >
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {open ? 'Collapse feature comparison' : '▼ Compare all features'}
      </button>

      {open && (
        <div className="mt-6 overflow-x-auto rounded-xl" style={{ border: '1px solid #E9ECEF' }}>
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr>
                {HEADERS.map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-semibold"
                    style={h === 'Growth' ? { background: '#FF6B2B', color: '#fff' } : { background: '#0D1117', color: '#94A3B8' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_GROUPS.map((group) => (
                <React.Fragment key={`group-${group.group}`}>
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-2 text-xs font-bold uppercase tracking-wider"
                      style={{ background: '#F1F5F9', color: '#0D1117' }}
                    >
                      {group.group}
                    </td>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.feature} style={{ borderBottom: '1px solid #F1F3F5' }}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: '#0D1117' }}>{row.feature}</td>
                      {COL_KEYS.map((key) => (
                        <td
                          key={key}
                          className="px-4 py-2.5 text-center"
                          style={key === 'growth' ? { background: '#FFF5F0' } : undefined}
                        >
                          <Cell value={row[key]} isGrowth={key === 'growth'} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
