import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useTranslation } from './config';

const LocaleSwitcherProbe = () => {
  const { t, language, changeLanguage } = useTranslation();

  return (
    <div>
      <span data-testid="current-language">{language}</span>
      <p data-testid="deposit-submit">{t('deposit.submit')}</p>
      <p data-testid="kyc-title">{t('kyc.title')}</p>
      <p data-testid="interpolated">{t('deposit.errors.summary', { count: 2, s: 's' })}</p>
      <button type="button" onClick={() => changeLanguage('es')}>
        Español
      </button>
      <button type="button" onClick={() => changeLanguage('fr')}>
        Français
      </button>
    </div>
  );
};

describe('i18n locale switching', () => {
  it('renders English by default', () => {
    render(
      <I18nProvider>
        <LocaleSwitcherProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('current-language').textContent).toBe('en');
    expect(screen.getByTestId('deposit-submit').textContent).toBe('Continue to Verification');
    expect(screen.getByTestId('kyc-title').textContent).toBe('Customer Details');
  });

  it('switches user-facing text when the locale changes', () => {
    render(
      <I18nProvider>
        <LocaleSwitcherProbe />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Español' }));

    expect(screen.getByTestId('current-language').textContent).toBe('es');
    expect(screen.getByTestId('deposit-submit').textContent).toBe('Continuar a la verificación');
    expect(screen.getByTestId('kyc-title').textContent).toBe('Datos del cliente');

    fireEvent.click(screen.getByRole('button', { name: 'Français' }));

    expect(screen.getByTestId('current-language').textContent).toBe('fr');
    expect(screen.getByTestId('deposit-submit').textContent).toBe('Continuer vers la vérification');
    expect(screen.getByTestId('kyc-title').textContent).toBe('Coordonnées du client');
  });

  it('falls back to the key when a translation is missing', () => {
    const MissingKeyProbe = () => <p>{useTranslation().t('nav.thisKeyDoesNotExist')}</p>;

    render(
      <I18nProvider>
        <MissingKeyProbe />
      </I18nProvider>,
    );

    expect(screen.getByText('nav.thisKeyDoesNotExist')).toBeTruthy();
  });

  it('interpolates parameters into translated templates', () => {
    render(
      <I18nProvider>
        <LocaleSwitcherProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('interpolated').textContent).toBe(
      'Please fix 2 validation errors before continuing.',
    );
  });
});
