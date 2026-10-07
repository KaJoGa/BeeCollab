'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import styles from './page.module.css';
import { useI18n } from '@/lib/i18n';
import LanguageSwitch from './LanguageSwitch';

const getApiBase = () => {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.trim()) return env.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  return `http://${window.location.hostname}:3000`;
};

// Unwrap ApiResponse envelope { success, data, ... } → data
// Falls back to the raw value for backward compatibility
const unwrap = <T = any>(json: any): T => json?.data ?? json;

export default function Home() {
  const { t, ta } = useI18n();
  const router = useRouter();
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [pingData, setPingData] = useState<string | null>(null);
  const [meetingCode, setMeetingCode] = useState('');
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [hasActiveMeeting, setHasActiveMeeting] = useState(false);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [guestJoinName, setGuestJoinName] = useState('');
  const [guestJoinCode, setGuestJoinCode] = useState('');
  const [guestJoinError, setGuestJoinError] = useState('');
  const [guestJoinLoading, setGuestJoinLoading] = useState(false);
  const [showGuestJoin, setShowGuestJoin] = useState(false);

  useEffect(() => {
    const apiBase = getApiBase();
    const token = localStorage.getItem('token');
    if (token) {
      setIsLoggedIn(true);

      const storedGuestName = localStorage.getItem('guestName');
      if (storedGuestName) {
        // Guest user — name already known from localStorage
        setIsGuest(true);
        setUserName(storedGuestName);
      } else {
        // Registered user — fetch display name
        fetch(`${apiBase}/users/me`, {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.ok ? res.json() : null)
          .then(json => {
            if (json) {
              const me = unwrap(json);
              setUserName(me?.name ?? null);
            }
          })
          .catch(() => {});
      }

      fetch(`${apiBase}/meetings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(async res => {
          if (res.ok) return res.json();
          if (res.status === 401) {
            handleLogout();
            return [];
          }
          const errorText = await res.text();
          console.error(`Failed to fetch meetings: ${res.status} ${errorText}`);
          return [];
        })
        .then(json => {
          const data = unwrap<any[]>(json);
          if (Array.isArray(data) && data.length > 0) {
            const liveMeeting = data.find((m: any) => m.status === 'LIVE');
            if (liveMeeting) {
              setHasActiveMeeting(true);
              setActiveMeetingId(liveMeeting.id);
            }
          }
        })
        .catch(err => {
          console.error('Error fetching meetings:', err);
        });
    }

    const checkBackend = async () => {
      try {
        const res = await fetch(`${apiBase}/`, { mode: 'cors' });
        if (res.ok) {
          setServerStatus('online');
          try {
            const data = await res.text();
            setPingData(data);
          } catch (e) {
            setPingData("Connected, but no text response.");
          }
        } else {
          setServerStatus('offline');
        }
      } catch (err) {
        setServerStatus('offline');
      }
    };

    checkBackend();

    // Update time
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 60000);

    const handleScroll = () => setIsScrolled(window.scrollY > 40);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      clearInterval(timer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const performLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('guestName');
    setIsLoggedIn(false);
    setIsGuest(false);
    setHasActiveMeeting(false);
    setActiveMeetingId(null);
    setUserName(null);
    setShowLogoutConfirm(false);
    router.refresh();
  };

  const handleGuestJoin = async () => {
    if (guestJoinName.trim().length < 2) { setGuestJoinError(t('errNameMin')); return; }
    if (!guestJoinCode.trim()) { setGuestJoinError(t('errRoomCode')); return; }
    setGuestJoinLoading(true);
    setGuestJoinError('');
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: guestJoinName.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        const data = unwrap(json);
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('guestName', guestJoinName.trim());
        router.push(`/meeting/${guestJoinCode.trim()}`);
      } else {
        setGuestJoinError(json.error ? ta(json.error) : t('errGuestJoin'));
      }
    } catch {
      setGuestJoinError(t('errCannotConnect'));
    } finally {
      setGuestJoinLoading(false);
    }
  };

  // Silent logout for invalid-token (401) cases — no confirmation needed
  const handleLogout = performLogout;

  const handleJoin = async () => {
    if (meetingCode.trim()) {
      setLoading(true);
      setLoadingMessage(t('joiningMeetingMsg'));

      const apiBase = getApiBase();
      const token = localStorage.getItem('token');
      try {
        // Resolve code or check if exists first to show loading state
        const res = await fetch(`${apiBase}/meetings/code/${meetingCode.trim()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (res.ok) {
          const data = unwrap(await res.json());
          router.push(`/meeting/${data.id}`);
        } else {
          // If not found by code, maybe it's already an ID
          router.push(`/meeting/${meetingCode.trim()}`);
        }
      } catch (e) {
        // Fallback to direct push if check fails
        router.push(`/meeting/${meetingCode.trim()}`);
      }
    }
  };

  const [isCreating, setIsCreating] = useState(false);
  const [newMeetingForm, setNewMeetingForm] = useState({
    title: 'Daily Meeting',
    duration: 60,
    maxParticipants: 10
  });
  const [newMeetingError, setNewMeetingError] = useState('');

  const handleCreateNewMeeting = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const maxParticipants = Number(newMeetingForm.maxParticipants);
    if (Number.isNaN(maxParticipants) || maxParticipants < 2 || maxParticipants > 10) {
      setNewMeetingError(t('errParticipantsRange'));
      return;
    }

    setLoading(true);
    setLoadingMessage(t('settingUpMeeting'));
    setNewMeetingError('');

    const startedAt = Date.now();
    const minLoadingMs = 2000;

    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/meetings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: newMeetingForm.title,
          duration: Number(newMeetingForm.duration),
          maxParticipants
        })
      });
      if (res.ok) {
        const data = unwrap(await res.json());
        const elapsed = Date.now() - startedAt;
        if (elapsed < minLoadingMs) {
          await new Promise(resolve => setTimeout(resolve, minLoadingMs - elapsed));
        }
        router.push(`/meeting/${data.id}`);
      } else {
        setLoading(false);
        setNewMeetingError(t('errCreateFailed'));
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
      setNewMeetingError(t('errCreateException'));
    }
  };

  return (
    <div className={styles.lightThemeContainer}>
      <header className={styles.header}>
        <div className={styles.logoContainer}>
          <svg className={styles.logoIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="#00832d" />
            <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="url(#paint0_linear)" />
            <defs>
              <linearGradient id="paint0_linear" x1="12" y1="6" x2="12" y2="18" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00E676" />
                <stop offset="1" stopColor="#00C853" />
              </linearGradient>
            </defs>
          </svg>
          BeeCollab
        </div>

        <div className={styles.headerRight}>
          <span className={styles.dateTimeInline}>{currentTime}</span>
          <LanguageSwitch />
          {isLoggedIn ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {userName && (
                <span data-testid="home-user-name" style={{ fontSize: '0.875rem', color: isGuest ? '#e37400' : '#3c4043', fontWeight: 500 }}>
                  {isGuest ? `👤 ${t('guestWord')}: ` : '👤 '}{userName}
                </span>
              )}
              <button
                data-testid="home-logout-btn"
                className={styles.logoutBtn}
                onClick={() => setShowLogoutConfirm(true)}
                style={{ background: 'none', border: '1px solid #dadce0', color: '#d93025', fontWeight: 500, fontSize: '14px', cursor: 'pointer', padding: '8px 16px', borderRadius: '4px' }}
              >
                {isGuest ? t('exitGuest') : t('logout')}
              </button>
            </div>
          ) : (
            <button
              data-testid="home-signin-btn"
              className={styles.loginBtn}
              onClick={() => router.push('/login')}
              style={{ background: 'none', border: 'none', color: '#1a73e8', fontWeight: 500, fontSize: '16px', cursor: 'pointer' }}
            >
              {t('signIn')}
            </button>
          )}
        </div>
      </header>

      <main className={styles.mainContent}>
        <div className={styles.leftColumn}>
          <h1 className={styles.title}>{t('heroLine1')}<br />{t('heroLine2')}</h1>
          <p className={styles.subtitle}>
            {t('heroSubtitle')}
          </p>

          {isCreating ? (
            <div style={{ background: '#ffffff', border: '1px solid #dadce0', padding: '1.5rem', borderRadius: '12px', width: '100%', maxWidth: '400px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', alignSelf: 'center' }}>
              <h3 style={{ margin: '0 0 1rem 0', color: '#202124' }}>{t('createNewMeeting')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#3c4043', marginBottom: '0.5rem' }}>{t('meetingNameLabel')}</label>
                  <input data-testid="new-meeting-title" type="text" value={newMeetingForm.title} onChange={e => setNewMeetingForm({ ...newMeetingForm, title: e.target.value })} style={{ width: '100%', padding: '0.75rem', border: '1px solid #dadce0', borderRadius: '8px', fontSize: '1rem' }} />
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#3c4043', marginBottom: '0.5rem' }}>{t('durationLabel')}</label>
                    <input data-testid="new-meeting-duration" type="number" value={newMeetingForm.duration} onChange={e => setNewMeetingForm({ ...newMeetingForm, duration: parseInt(e.target.value) })} min="1" style={{ width: '100%', padding: '0.75rem', border: '1px solid #dadce0', borderRadius: '8px', fontSize: '1rem' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#3c4043', marginBottom: '0.5rem' }}>{t('maxParticipantsLabel')}</label>
                    <input data-testid="new-meeting-max-participants" type="number" value={newMeetingForm.maxParticipants} onChange={e => setNewMeetingForm({ ...newMeetingForm, maxParticipants: parseInt(e.target.value) })} min="2" max="10" style={{ width: '100%', padding: '0.75rem', border: '1px solid #dadce0', borderRadius: '8px', fontSize: '1rem' }} />
                  </div>
                </div>
                {newMeetingError && (
                  <div data-testid="new-meeting-error" style={{ color: '#d93025', background: '#fce8e6', border: '1px solid #fad2cf', padding: '0.75rem', borderRadius: '8px', fontSize: '0.875rem' }}>
                    {newMeetingError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button data-testid="new-meeting-cancel" onClick={() => setIsCreating(false)} style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: '1px solid #dadce0', background: 'transparent', cursor: 'pointer', fontWeight: 500, color: '#3c4043' }}>{t('cancel')}</button>
                  <button data-testid="new-meeting-submit" onClick={handleCreateNewMeeting} style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#1a73e8', color: 'white', cursor: 'pointer', fontWeight: 500 }}>{t('create')}</button>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.actionArea}>
              <button
                data-testid="new-meeting-btn"
                className={styles.newMeetingBtn}
                onClick={() => {
                  if (isGuest) return;
                  if (hasActiveMeeting && activeMeetingId) {
                    router.push(`/meeting/${activeMeetingId}`);
                    return;
                  }
                  setNewMeetingError('');
                  setIsCreating(true);
                }}
                title={isGuest ? t('guestsCannotCreate') : hasActiveMeeting ? t('resumeActiveMeeting') : t('createNewMeetingTitle')}
                style={{ opacity: isGuest ? 0.45 : 1, cursor: isGuest ? 'not-allowed' : 'pointer' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4z" />
                  <rect x="3" y="6" width="12" height="12" rx="2" />
                </svg>
                {hasActiveMeeting ? t('activeMeeting') : t('newMeeting')}
              </button>

              <div className={styles.inputGroup}>
                <span className={styles.keyboardIcon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
                  </svg>
                </span>
                <input
                  data-testid="join-code-input"
                  type="text"
                  placeholder={t('codePlaceholder')}
                  className={styles.codeInput}
                  value={meetingCode}
                  onChange={(e) => setMeetingCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                />
              </div>

              <button
                data-testid="join-btn"
                className={styles.joinBtn}
                disabled={!meetingCode.trim()}
                onClick={handleJoin}
              >
                {t('join')}
              </button>
            </div>
          )}

          <div className={styles.divider}></div>

          {/* Guest join panel — shown to non-logged-in users */}
          {!isLoggedIn && (
            <div style={{ marginTop: '0.5rem' }}>
              {!showGuestJoin ? (
                <p style={{ fontSize: '0.875rem', color: '#5f6368', textAlign: 'center' }}>
                  {t('noAccount')}{' '}
                  <button
                    data-testid="guest-join-open"
                    onClick={() => setShowGuestJoin(true)}
                    style={{ background: 'none', border: 'none', color: '#1a73e8', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: '0.875rem' }}
                  >
                    {t('joinAsGuest')}
                  </button>
                </p>
              ) : (
                <div style={{ background: '#f8f9fa', border: '1px solid #e1e4e8', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: '#202124' }}>{t('joinAsGuest')}</p>
                  <input
                    data-testid="guest-name-input"
                    type="text"
                    placeholder={t('guestNamePlaceholder')}
                    value={guestJoinName}
                    onChange={e => setGuestJoinName(e.target.value)}
                    style={{ padding: '0.65rem 0.75rem', borderRadius: '8px', border: '1px solid #dadce0', fontSize: '0.95rem', outline: 'none' }}
                  />
                  <input
                    data-testid="guest-code-input"
                    type="text"
                    placeholder={t('roomCodePlaceholder')}
                    value={guestJoinCode}
                    onChange={e => setGuestJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleGuestJoin()}
                    style={{ padding: '0.65rem 0.75rem', borderRadius: '8px', border: '1px solid #dadce0', fontSize: '0.95rem', outline: 'none', fontFamily: 'monospace', letterSpacing: '0.1em' }}
                  />
                  {guestJoinError && (
                    <p data-testid="guest-join-error" style={{ margin: 0, fontSize: '0.8rem', color: '#d93025' }}>{guestJoinError}</p>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button data-testid="guest-join-cancel" onClick={() => { setShowGuestJoin(false); setGuestJoinError(''); }} style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #dadce0', background: 'transparent', cursor: 'pointer', fontSize: '0.875rem', color: '#5f6368' }}>
                      {t('cancel')}
                    </button>
                    <button
                      data-testid="guest-join-submit"
                      onClick={handleGuestJoin}
                      disabled={guestJoinLoading}
                      style={{ flex: 2, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#1a73e8', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem', opacity: guestJoinLoading ? 0.7 : 1 }}
                    >
                      {guestJoinLoading ? t('joining') : t('joinMeeting')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className={styles.learnMore}>
            <a href="#" className={styles.learnMoreLink}>{t('learnMore')}</a> {t('aboutApp')}
          </div>
        </div>

        <div className={styles.rightColumn}>
          <div className={styles.carousel}>
            <Image
              src="/meet_illustration.png"
              alt={t('heroAlt')}
              width={360}
              height={240}
              priority
              className={styles.illustration}
              style={{ height: 'auto' }}
            />
            <h2 className={styles.carouselTitle}>{t('carouselTitle')}</h2>
            <p className={styles.carouselText}>
              {t('carouselClick')} <strong>{t('newMeeting')}</strong> {t('carouselRest')}
            </p>
          </div>
        </div>
      </main>

      <div className={`${styles.dateTime} ${isScrolled ? styles.dateTimeScrolled : ''}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>{currentTime}</span>
      </div>

      <div className={styles.statusIndicator} data-testid="server-status" data-status={serverStatus}>
        <div className={`${styles.statusDot} ${styles[serverStatus]}`}></div>
        <span>{serverStatus === 'checking' ? t('statusConnecting') : serverStatus === 'online' ? t('statusOnline') : t('statusOffline')}</span>
      </div>

      {showLogoutConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="logout-confirm-dialog"
          onClick={() => setShowLogoutConfirm(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              padding: '1.5rem',
              borderRadius: '14px',
              width: '100%',
              maxWidth: '380px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.2)'
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#202124', fontWeight: 600 }}>
              {t('signOutTitle')}
            </h3>
            <p style={{ margin: '0 0 1.5rem 0', fontSize: '0.875rem', color: '#5f6368', lineHeight: 1.5 }}>
              {t('signOutBody')}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                data-testid="logout-cancel"
                onClick={() => setShowLogoutConfirm(false)}
                style={{ padding: '0.6rem 1.25rem', borderRadius: '8px', border: '1px solid #dadce0', background: 'transparent', cursor: 'pointer', fontWeight: 500, color: '#3c4043', fontSize: '0.875rem' }}
              >
                {t('cancel')}
              </button>
              <button
                data-testid="logout-confirm"
                onClick={performLogout}
                style={{ padding: '0.6rem 1.25rem', borderRadius: '8px', border: 'none', background: '#d93025', color: 'white', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem' }}
              >
                {t('signOut')}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1.5rem',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
          `}</style>

          <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="#00832d" />
              <path d="M17 10.5V7C17 6.44772 16.5523 6 16 6H4C3.44772 6 3 6.44772 3 7V17C3 17.5523 3.44772 18 4 18H16C16.5523 18 17 17.5523 17 17V13.5L21 17.5V6.5L17 10.5Z" fill="url(#loadingLogoGradient)" />
              <defs>
                <linearGradient id="loadingLogoGradient" x1="12" y1="6" x2="12" y2="18" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#00E676" />
                  <stop offset="1" stopColor="#00C853" />
                </linearGradient>
              </defs>
            </svg>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1f3b64', margin: 0, letterSpacing: '-0.02em' }}>BeeCollab</h1>
          </div>

          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(26, 115, 232, 0.1)',
            borderTop: '3px solid #1a73e8',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            marginBottom: '1.5rem'
          }}></div>

          <div style={{ textAlign: 'center', maxWidth: '320px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#202124', margin: '0 0 0.5rem 0' }}>{loadingMessage}</h2>
            <p style={{ fontSize: '0.875rem', color: '#5f6368', margin: 0 }}>{t('pleaseWait')}</p>
          </div>

          <div style={{ position: 'absolute', bottom: '3rem', display: 'flex', gap: '0.5rem' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: '8px', height: '8px', background: '#1a73e8', borderRadius: '50%', animation: `bounce 1s infinite ${i * 0.2}s` }}></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
