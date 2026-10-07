import { cleanEnvValue, readTestSupportConfig } from './test-support.config';

const TOKEN = 'a-sufficiently-long-token';

describe('readTestSupportConfig', () => {
  it('is disabled with a clear reason when TEST_SUPPORT_ENABLED is not set', () => {
    const c = readTestSupportConfig({ TEST_ADMIN_TOKEN: TOKEN });
    expect(c).toEqual({ enabled: false, reason: 'TEST_SUPPORT_ENABLED is not set' });
  });

  it('is enabled for "true" with a long enough token', () => {
    expect(readTestSupportConfig({ TEST_SUPPORT_ENABLED: 'true', TEST_ADMIN_TOKEN: TOKEN })).toEqual({ enabled: true, token: TOKEN });
  });

  it('tolerates whitespace, upper case and wrapping quotes pasted into a dashboard', () => {
    for (const flag of [' true ', 'TRUE', 'True', '"true"', "'true'", ' "TRUE" \n']) {
      expect(readTestSupportConfig({ TEST_SUPPORT_ENABLED: flag, TEST_ADMIN_TOKEN: TOKEN }).enabled).toBe(true);
    }
    const quoted = readTestSupportConfig({ TEST_SUPPORT_ENABLED: 'true', TEST_ADMIN_TOKEN: `  "${TOKEN}"\n` });
    expect(quoted).toEqual({ enabled: true, token: TOKEN });
  });

  it('is disabled and shows the offending value when a whole sentence was pasted instead of "true"', () => {
    const pasted = 'true (menyalakan endpoint pembersih data QA; default mati)';
    const c = readTestSupportConfig({ TEST_SUPPORT_ENABLED: pasted, TEST_ADMIN_TOKEN: TOKEN });
    expect(c.enabled).toBe(false);
    if (!c.enabled) {
      expect(c.reason).toContain('must be exactly "true"');
      expect(c.reason).toContain('true (menyalakan endpoint pembersih');
      expect(c.reason).toContain(`${pasted.length} characters`);
    }
  });

  it('treats other values ("1", "yes", "false") as disabled', () => {
    for (const flag of ['1', 'yes', 'false', 'enabled']) {
      expect(readTestSupportConfig({ TEST_SUPPORT_ENABLED: flag, TEST_ADMIN_TOKEN: TOKEN }).enabled).toBe(false);
    }
  });

  it('is disabled when the token is missing or shorter than 16 characters, reporting only its length', () => {
    const none = readTestSupportConfig({ TEST_SUPPORT_ENABLED: 'true' });
    expect(none).toEqual({ enabled: false, reason: 'TEST_ADMIN_TOKEN must be at least 16 characters (got 0)' });
    const secret = 'short-secret-1';
    const short = readTestSupportConfig({ TEST_SUPPORT_ENABLED: 'true', TEST_ADMIN_TOKEN: secret });
    expect(short.enabled).toBe(false);
    if (!short.enabled) {
      expect(short.reason).toContain(`got ${secret.length}`);
      expect(short.reason).not.toContain(secret);
    }
  });

  it('never leaks the token in any reason', () => {
    const secret = 'x'.repeat(30);
    for (const flag of [undefined, 'nope', 'true']) {
      const c = readTestSupportConfig({ TEST_SUPPORT_ENABLED: flag, TEST_ADMIN_TOKEN: secret });
      if (!c.enabled) expect(c.reason).not.toContain(secret);
    }
  });
});

describe('cleanEnvValue', () => {
  it('trims and strips matching wrapping quotes only at the ends', () => {
    expect(cleanEnvValue('  abc  ')).toBe('abc');
    expect(cleanEnvValue('"abc"')).toBe('abc');
    expect(cleanEnvValue("'abc'")).toBe('abc');
    expect(cleanEnvValue('a"b"c')).toBe('a"b"c');
    expect(cleanEnvValue(undefined)).toBe('');
  });
});
