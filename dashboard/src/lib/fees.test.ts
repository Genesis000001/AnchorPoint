import { describe, expect, it } from 'vitest';
import { computePayoutBreakdown } from './fees';
import type { FeeEstimate } from './fees';

const makeFee = (overrides: Partial<FeeEstimate> = {}): FeeEstimate => ({
  assetCode: 'USDC',
  feeType: 'tiered',
  inputAmount: 100,
  feeAmount: 1,
  feeFixed: 0.5,
  feePercent: 0.005,
  feeMinimum: 0,
  ...overrides,
});

describe('computePayoutBreakdown', () => {
  it('computes net payout as Amount - Fixed Fee - % Fee', () => {
    const breakdown = computePayoutBreakdown(100, makeFee());

    expect(breakdown.amount).toBe(100);
    expect(breakdown.fixedFee).toBe(0.5);
    expect(breakdown.percentFee).toBe(0.5);
    expect(breakdown.totalFee).toBe(1);
    expect(breakdown.netPayout).toBe(99);
  });

  it('returns a negative net payout when fees exceed the amount', () => {
    const breakdown = computePayoutBreakdown(5, makeFee({ feeFixed: 10, feePercent: 0, feeAmount: 10 }));

    expect(breakdown.netPayout).toBe(-5);
  });

  it('returns zero net payout when fees equal the amount', () => {
    const breakdown = computePayoutBreakdown(0.5, makeFee({ feeFixed: 0.5, feePercent: 0, feeAmount: 0.5 }));

    expect(breakdown.netPayout).toBe(0);
  });

  it('handles flat-fee-only assets with no percentage component', () => {
    const breakdown = computePayoutBreakdown(120, makeFee({ feeFixed: 0.5, feePercent: 0, feeAmount: 0.5, feeType: 'flat' }));

    expect(breakdown.fixedFee).toBe(0.5);
    expect(breakdown.percentFee).toBe(0);
    expect(breakdown.netPayout).toBe(119.5);
  });

  it('avoids floating-point dust when computing the breakdown', () => {
    const breakdown = computePayoutBreakdown(120.5, makeFee({ feeFixed: 0.5, feePercent: 0.005 }));

    expect(breakdown.percentFee).toBe(0.6025);
    expect(breakdown.netPayout).toBe(119.3975);
  });
});
