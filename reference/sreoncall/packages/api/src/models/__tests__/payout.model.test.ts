import { describe, it, expect } from 'vitest';
import { Payout } from '../payout.model';

describe('Payout model schema', () => {
  it('currency defaults to USD', () => {
    const currencyPath = Payout.schema.path('currency') as any;
    expect(currencyPath.options.default).toBe('USD');
  });

  it('amount has min 0', () => {
    const amountPath = Payout.schema.path('amount') as any;
    expect(amountPath.options.min).toBe(0);
  });

  it('reference has maxlength 200', () => {
    const refPath = Payout.schema.path('reference') as any;
    expect(refPath.options.maxlength).toBe(200);
  });

  it('notes has maxlength 1000', () => {
    const notesPath = Payout.schema.path('notes') as any;
    expect(notesPath.options.maxlength).toBe(1000);
  });
});
