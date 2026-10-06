'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const getApiBase = () => {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.trim()) return env.replace(/\/+$/, '');
  if (typeof window === 'undefined') return '';
  return `http://${window.location.hostname}:3000`;
};

// Unwrap ApiResponse envelope { success, data, ... } → data
const unwrap = <T = any>(json: any): T => json?.data ?? json;

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestError, setGuestError] = useState('');

  useEffect(() => {
    if (localStorage.getItem('token')) {
      router.push('/');
    }
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
    const body = mode === 'login'
      ? { email, password }
      : { email, name, password };

    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (res.ok) {
        const data = unwrap(json);
        if (data.access_token) {
          localStorage.setItem('token', data.access_token);
          router.push(redirectTo);
        } else if (mode === 'register') {
          setMode('login');
          setError('Registration successful! Please login.');
        }
      } else {
        // Error shape: { success: false, error: '...', statusCode: ... }
        setError(json.error || json.message || `${mode === 'login' ? 'Login' : 'Registration'} failed`);
      }
    } catch (err) {
      setError('Cannot connect to server. Is backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8f9fa', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: '400px', background: 'white', padding: '2.5rem', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', border: '1px solid #e1e4e8' }}>
        <h1 data-testid="auth-title" style={{ fontSize: '1.75rem', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center', color: '#202124' }}>
          {mode === 'login' ? 'Sign In' : 'Create Account'}
        </h1>
        <p style={{ color: '#5f6368', textAlign: 'center', marginBottom: '2rem', fontSize: '0.875rem' }}>
          {mode === 'login' ? 'Use your BeeCollab account' : 'Sign up to start collaborating'}
        </p>

        {error && <div data-testid="auth-error" style={{ color: '#d93025', marginBottom: '1.5rem', textAlign: 'center', background: '#fce8e6', padding: '0.75rem', borderRadius: '8px', fontSize: '0.875rem' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {mode === 'register' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#3c4043', marginBottom: '0.5rem' }}>FULL NAME</label>
              <input
                data-testid="auth-name-input"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #dadce0', fontSize: '1rem', outline: 'none' }}
              />
            </div>
          )}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#3c4043', marginBottom: '0.5rem' }}>EMAIL ADDRESS</label>
            <input
              data-testid="auth-email-input"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #dadce0', fontSize: '1rem', outline: 'none' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#3c4043', marginBottom: '0.5rem' }}>PASSWORD</label>
            <div style={{ position: 'relative' }}>
              <input
                data-testid="auth-password-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 6 : undefined}
                style={{ width: '100%', padding: '0.75rem', paddingRight: '2.75rem', borderRadius: '8px', border: '1px solid #dadce0', fontSize: '1rem', outline: 'none' }}
              />
              <button
                data-testid="auth-toggle-password"
                type="button"
                onClick={() => setShowPassword(p => !p)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: '0.5rem',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: '0.4rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#5f6368',
                  borderRadius: '4px'
                }}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {mode === 'register' && (
              <div data-testid="auth-password-hint" style={{
                marginTop: '0.375rem',
                fontSize: '0.75rem',
                color: password.length === 0 ? '#5f6368' : password.length >= 6 ? '#1e8e3e' : '#d93025'
              }}>
                {password.length === 0
                  ? 'Minimum 6 characters'
                  : password.length >= 6
                    ? '✓ Password meets requirements'
                    : `Minimum 6 characters (${password.length}/6)`}
              </div>
            )}
          </div>

          <button
            data-testid="auth-submit"
            type="submit"
            disabled={loading}
            style={{
              marginTop: '0.5rem',
              padding: '0.875rem',
              borderRadius: '8px',
              border: 'none',
              background: '#1a73e8',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Processing...' : (mode === 'login' ? 'Sign In' : 'Register')}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: '#5f6368' }}>
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                data-testid="auth-switch-to-register"
                onClick={() => setMode('register')}
                style={{ background: 'none', border: 'none', color: '#1a73e8', fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                data-testid="auth-switch-to-login"
                onClick={() => setMode('login')}
                style={{ background: 'none', border: 'none', color: '#1a73e8', fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button
            data-testid="auth-back-home"
            onClick={() => router.push('/')}
            style={{ background: 'none', border: 'none', color: '#5f6368', cursor: 'pointer', fontSize: '0.875rem', textDecoration: 'underline' }}
          >
            Back to Home
          </button>
        </div>

        {/* Guest divider */}
        <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1, height: '1px', background: '#e1e4e8' }} />
          <span style={{ fontSize: '0.75rem', color: '#5f6368', whiteSpace: 'nowrap' }}>or continue as guest</span>
          <div style={{ flex: 1, height: '1px', background: '#e1e4e8' }} />
        </div>

        <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <p style={{ fontSize: '0.8rem', color: '#5f6368', textAlign: 'center', margin: 0 }}>
            No account needed — just enter your name and join with a room code.
          </p>
          {guestError && (
            <div data-testid="auth-guest-error" style={{ color: '#d93025', background: '#fce8e6', padding: '0.6rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', textAlign: 'center' }}>
              {guestError}
            </div>
          )}
          <input
            data-testid="auth-guest-name-input"
            type="text"
            placeholder="Your display name"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #dadce0', fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }}
          />
          <button
            data-testid="auth-guest-submit"
            disabled={guestLoading || guestName.trim().length < 2}
            onClick={async () => {
              if (guestName.trim().length < 2) return;
              setGuestLoading(true);
              setGuestError('');
              try {
                const apiBase = getApiBase();
                const res = await fetch(`${apiBase}/auth/guest`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: guestName.trim() }),
                });
                const json = await res.json();
                if (res.ok) {
                  const data = unwrap(json);
                  localStorage.setItem('token', data.access_token);
                  localStorage.setItem('guestName', guestName.trim());
                  router.push(redirectTo);
                } else {
                  setGuestError(json.error || 'Failed to continue as guest');
                }
              } catch {
                setGuestError('Cannot connect to server.');
              } finally {
                setGuestLoading(false);
              }
            }}
            style={{
              padding: '0.75rem',
              borderRadius: '8px',
              border: '1px solid #dadce0',
              background: guestName.trim().length >= 2 ? '#f8f9fa' : '#f1f3f4',
              color: guestName.trim().length >= 2 ? '#3c4043' : '#9aa0a6',
              fontWeight: 500,
              fontSize: '0.9rem',
              cursor: guestName.trim().length >= 2 ? 'pointer' : 'not-allowed',
              opacity: guestLoading ? 0.7 : 1,
            }}
          >
            {guestLoading ? 'Joining...' : 'Continue as Guest'}
          </button>
        </div>
      </div>
    </main>
  );
}

// useSearchParams() must be wrapped in a Suspense boundary for Next.js
// static generation (App Router requirement).
export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthPageInner />
    </Suspense>
  );
}
