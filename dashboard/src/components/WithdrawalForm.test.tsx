import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WithdrawalForm } from './WithdrawalForm';
import { I18nProvider } from '../i18n/config';
import type { FeeEstimate } from '../lib/fees';

const amountField = {
  key: 'amount',
  label: 'Amount',
  required: true,
  placeholder: '120.50',
};

const fullFields = [
  { key: 'iban', label: 'IBAN', required: true, placeholder: 'DE89370400440532013000' },
  amountField,
];

const tieredFee = (amount: number, feeFixed: number, feePercent: number): FeeEstimate => ({
  assetCode: 'USDC',
  feeType: 'tiered',
  inputAmount: amount,
  feeAmount: feeFixed + amount * feePercent,
  feeFixed,
  feePercent,
  feeMinimum: 0,
});

const renderWithI18n = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

const submitButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: /Continue to Verification/i }) as HTMLButtonElement;

describe('WithdrawalForm fee preview calculator', () => {
  it('renders the fee summary placeholder before an amount is entered', () => {
    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={vi.fn()}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByTestId('fee-summary')).toBeTruthy();
    expect(screen.getByText(/Enter an amount to preview fees/i)).toBeTruthy();
  });

  it('estimates fees on debounced amount change and displays the payout breakdown', async () => {
    const onEstimateFee = vi.fn().mockResolvedValue(tieredFee(100, 0.5, 0.005));

    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={onEstimateFee}
        onSubmit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '100' } });

    await waitFor(() => expect(onEstimateFee).toHaveBeenCalledTimes(1));
    expect(onEstimateFee).toHaveBeenCalledWith({ assetCode: 'USDC', amount: '100' });

    await waitFor(() => expect(screen.getByTestId('fee-amount').textContent).toBe('100.00'));
    expect(screen.getByTestId('fee-fixed').textContent).toBe('-0.50');
    expect(screen.getByTestId('fee-percent').textContent).toBe('-0.50');
    expect(screen.getByTestId('fee-net').textContent).toBe('99.00');
  });

  it('debounces rapid amount changes into a single estimation request', async () => {
    const onEstimateFee = vi.fn().mockResolvedValue(tieredFee(120, 0.5, 0.005));

    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={onEstimateFee}
        onSubmit={() => {}}
      />,
    );

    const input = screen.getByLabelText(/Amount/i);
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.change(input, { target: { value: '120' } });

    await waitFor(() => expect(onEstimateFee).toHaveBeenCalledTimes(1));
    expect(onEstimateFee).toHaveBeenCalledWith({ assetCode: 'USDC', amount: '120' });
  });

  it('disables the submit button when the net payout is zero or negative', async () => {
    const onEstimateFee = vi.fn().mockResolvedValue(tieredFee(5, 10, 0));

    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={onEstimateFee}
        onSubmit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '5' } });

    await waitFor(() => expect(submitButton().disabled).toBe(true));
    expect(screen.getByText(/Amount after fees is zero or negative/i)).toBeTruthy();
  });

  it('enables the submit button and calls onSubmit when the net payout is positive', async () => {
    const onEstimateFee = vi.fn().mockResolvedValue(tieredFee(120.5, 0.5, 0.005));
    const onSubmit = vi.fn();

    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={onEstimateFee}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/IBAN/i), {
      target: { value: 'DE89370400440532013000' },
    });
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '120.50' } });

    await waitFor(() => expect(submitButton().disabled).toBe(false));

    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({
      iban: 'DE89370400440532013000',
      amount: '120.50',
    });
  });

  it('does not trigger fee estimation for an empty or invalid amount', async () => {
    const onEstimateFee = vi.fn().mockResolvedValue(tieredFee(100, 0.5, 0.005));

    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={onEstimateFee}
        onSubmit={() => {}}
      />,
    );

    const input = screen.getByLabelText(/Amount/i);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    await waitFor(() => expect(screen.getByText(/Enter an amount to preview fees/i)).toBeTruthy());
    expect(onEstimateFee).not.toHaveBeenCalled();
  });

  it('shows an error message when fee estimation fails', async () => {
    const onEstimateFee = vi
      .fn()
      .mockRejectedValue(new Error('Fee estimate request failed with status 500'));

    renderWithI18n(
      <WithdrawalForm
        fields={fullFields}
        assetCode="USDC"
        onEstimateFee={onEstimateFee}
        onSubmit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '100' } });

    await waitFor(() =>
      expect(screen.getByText(/Fee estimate request failed with status 500/i)).toBeTruthy(),
    );
  });
});
