// Commission calculation engine for partner deals.
//
// Source of truth: partner-engagement.md
//   - Referral:   15% Year 1 / 7.5% Year 2+  (flat rate applied to ARR)
//   - Reseller:   35% Y1 / 30% Y2 / 25% Y3+  (margin on list price)
//   - MSP:        40% platform (flat)        (+ 80% managed services, handled as separate line)
//
// Self Hosted and Services tiers are custom — sales-negotiated.
// For these, `track` may be any of the three but the computed breakdown should
// be treated as an admin-editable estimate, not a hard commitment.

import type { PartnerType } from '../models/partner.model';
import type { ProductTier } from '../models/deal.model';

export type CommissionTrack = 'referral' | 'reseller' | 'msp';

export interface CommissionYear {
  year: 1 | 2 | 3;             // 1=Y1, 2=Y2, 3=Y3+ (ongoing)
  ratePct: number;             // 0-100
  annualAmount: number;        // USD
}

export interface CommissionBreakdown {
  track: CommissionTrack;
  basis: 'flat' | 'tapered' | 'custom';
  years: CommissionYear[];
  totalThreeYear: number;      // Y1 + Y2 + Y3 ongoing
  notes?: string;
}

/**
 * Map partner type to default commission track.
 * Admins may override per deal (e.g. a reseller partner doing a referral deal).
 */
export function defaultTrackForPartner(partnerType: PartnerType): CommissionTrack {
  return partnerType;
}

const REFERRAL_RATES = { year1: 15, year2Plus: 7.5 } as const;
const RESELLER_RATES = { year1: 35, year2: 30, year3Plus: 25 } as const;
const MSP_PLATFORM_RATE = 40 as const;

/**
 * Compute commission breakdown for a deal.
 *
 * @param track        - Partner track (referral/reseller/msp)
 * @param annualARR    - Customer's annual contract value (USD)
 * @param productTier  - Plan tier; self_hosted & services are marked 'custom'
 */
export function computeCommissionBreakdown(
  track: CommissionTrack,
  annualARR: number,
  productTier: ProductTier
): CommissionBreakdown {
  const isCustomTier = productTier === 'self_hosted' || productTier === 'services';

  if (track === 'referral') {
    const y1 = (annualARR * REFERRAL_RATES.year1) / 100;
    const yRest = (annualARR * REFERRAL_RATES.year2Plus) / 100;
    return {
      track,
      basis: isCustomTier ? 'custom' : 'flat',
      years: [
        { year: 1, ratePct: REFERRAL_RATES.year1, annualAmount: Math.round(y1) },
        { year: 2, ratePct: REFERRAL_RATES.year2Plus, annualAmount: Math.round(yRest) },
        { year: 3, ratePct: REFERRAL_RATES.year2Plus, annualAmount: Math.round(yRest) },
      ],
      totalThreeYear: Math.round(y1 + yRest + yRest),
      notes: isCustomTier
        ? 'Custom-priced tier — commission is an estimate; admin should finalise.'
        : undefined,
    };
  }

  if (track === 'reseller') {
    const y1 = (annualARR * RESELLER_RATES.year1) / 100;
    const y2 = (annualARR * RESELLER_RATES.year2) / 100;
    const y3 = (annualARR * RESELLER_RATES.year3Plus) / 100;
    return {
      track,
      basis: isCustomTier ? 'custom' : 'tapered',
      years: [
        { year: 1, ratePct: RESELLER_RATES.year1, annualAmount: Math.round(y1) },
        { year: 2, ratePct: RESELLER_RATES.year2, annualAmount: Math.round(y2) },
        { year: 3, ratePct: RESELLER_RATES.year3Plus, annualAmount: Math.round(y3) },
      ],
      totalThreeYear: Math.round(y1 + y2 + y3),
      notes: isCustomTier
        ? 'Custom-priced tier — commission is an estimate; admin should finalise.'
        : undefined,
    };
  }

  // MSP — platform only. Managed services are tracked separately.
  const platform = (annualARR * MSP_PLATFORM_RATE) / 100;
  return {
    track,
    basis: isCustomTier ? 'custom' : 'flat',
    years: [
      { year: 1, ratePct: MSP_PLATFORM_RATE, annualAmount: Math.round(platform) },
      { year: 2, ratePct: MSP_PLATFORM_RATE, annualAmount: Math.round(platform) },
      { year: 3, ratePct: MSP_PLATFORM_RATE, annualAmount: Math.round(platform) },
    ],
    totalThreeYear: Math.round(platform * 3),
    notes: isCustomTier
      ? 'Custom-priced tier — commission is an estimate; admin should finalise.'
      : 'Platform margin only. Managed services revenue share (80%) tracked separately.',
  };
}
