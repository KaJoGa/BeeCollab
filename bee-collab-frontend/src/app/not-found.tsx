'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '24px 24px 6rem',
      fontFamily: "'Google Sans', 'Inter', Roboto, Arial, sans-serif",
      backgroundColor: '#ffffff',
      color: '#202124'
    }}>
      <div style={{ marginBottom: '2rem' }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="#dadce0" />
        </svg>
      </div>
      
      <h1 style={{ fontSize: '2.5rem', fontWeight: 400, marginBottom: '1rem', letterSpacing: '-0.01em' }}>{t('notFoundTitle')}</h1>
      <p style={{ color: '#5f6368', fontSize: '1.1rem', marginBottom: '2.5rem', maxWidth: '500px', lineHeight: '1.5' }}>
        {t('notFoundBody')}
      </p>
      
      <Link href="/" style={{
        backgroundColor: '#1a73e8',
        color: '#ffffff',
        padding: '12px 32px',
        borderRadius: '24px',
        textDecoration: 'none',
        fontWeight: 500,
        fontSize: '0.9rem',
        boxShadow: '0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)',
        transition: 'background-color 0.2s'
      }}>
        {t('backToHome')}
      </Link>
      
      <div style={{ position: 'absolute', bottom: '2.5rem', display: 'flex', alignItems: 'center', gap: '10px', color: '#5f6368' }}>
         <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="#00832d" />
          </svg>
          <span style={{ fontWeight: 500, fontSize: '1.1rem', color: '#5f6368' }}>BeeCollab</span>
      </div>
    </div>
  );
}
