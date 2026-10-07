'use client';

import { LANGS, useI18n } from '@/lib/i18n';

/** Compact EN | ID toggle for pages without a settings dialog (home, login). */
export default function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('language')}
      data-testid="lang-switch"
      style={{ display: 'inline-flex', border: '1px solid #dadce0', borderRadius: '999px', overflow: 'hidden', fontSize: '12px' }}
    >
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          data-testid={`lang-${l.code}`}
          aria-pressed={lang === l.code}
          title={l.label}
          onClick={() => setLang(l.code)}
          style={{
            border: 'none',
            padding: '4px 10px',
            cursor: 'pointer',
            fontWeight: 600,
            background: lang === l.code ? '#1a73e8' : 'transparent',
            color: lang === l.code ? '#ffffff' : '#5f6368',
          }}
        >
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
