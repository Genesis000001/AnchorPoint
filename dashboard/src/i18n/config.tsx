import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';

type Language = 'en' | 'es' | 'pt' | 'fr';
type TranslateParams = Record<string, string | number>;

type TranslationContextValue = {
  t: (key: string, params?: TranslateParams) => string;
  language: Language;
  changeLanguage: (language: Language) => void;
};

const resources: Record<Language, Record<string, unknown>> = {
  en,
  es,
  pt,
  fr,
};

const getValue = (dictionary: Record<string, unknown>, key: string): string | undefined => {
  const parts = key.split('.');
  let current: unknown = dictionary;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return typeof current === 'string' ? current : undefined;
};

const interpolate = (template: string, params?: TranslateParams): string => {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
};

const TranslationContext = createContext<TranslationContextValue>({
  t: (key: string) => key,
  language: 'en',
  changeLanguage: () => undefined,
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('en');

  const value = useMemo<TranslationContextValue>(() => ({
    t: (key: string, params?: TranslateParams) =>
      interpolate(getValue(resources[language] as Record<string, unknown>, key) ?? key, params),
    language,
    changeLanguage: (nextLanguage: Language) => setLanguage(nextLanguage),
  }), [language]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
};

export const useTranslation = () => useContext(TranslationContext);

export default TranslationContext;
