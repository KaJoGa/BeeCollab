'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './messages.en';
import { id, idApiErrors } from './messages.id';

export type Lang = 'en' | 'id';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Bahasa Indonesia' },
];

const STORAGE_KEY = 'lang';
const DEFAULT_LANG: Lang = 'en';
const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, id };

type Params = Record<string, string | number>;

type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a UI string; `{name}` placeholders are filled from params. */
  t: (key: MessageKey, params?: Params) => string;
  /** Translate a known backend error message (exact text); unknown messages pass through. */
  ta: (message: string) => string;
};

function format(template: string, params?: Params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : `{${name}}`));
}

const I18nContext = createContext<I18n | null>(null);

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'id' || v === 'en' ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/**
 * Language is kept in localStorage ("lang"). The first render is always English (same as the
 * server-rendered HTML, so hydration matches); a saved preference is applied right after mount.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode): the choice just lasts for this page view */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = dictionaries[lang];
    return {
      lang,
      setLang,
      t: (key, params) => format(dict[key] ?? en[key] ?? key, params),
      ta: (message) => (lang === 'id' ? idApiErrors[message] ?? message : message),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Used when a component renders outside <LanguageProvider> (e.g. an error boundary): plain English,
// never a crash.
const FALLBACK: I18n = {
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key, params) => format(en[key] ?? key, params),
  ta: (message) => message,
};

export function useI18n(): I18n {
  return useContext(I18nContext) ?? FALLBACK;
}
