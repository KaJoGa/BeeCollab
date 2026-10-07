import { MIN_TOKEN_LENGTH } from './test-support.constants';

export type TestSupportConfig =
  | { enabled: true; token: string }
  | { enabled: false; reason: string };

/**
 * Environment values are often pasted with stray whitespace or wrapping quotes
 * (dashboards, .env files). Strip those so "true", " TRUE " and "\"true\"" all work.
 */
export function cleanEnvValue(value: string | undefined): string {
  return (value ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
}

/**
 * NAMES (never values) of environment variables that look related to this feature.
 * Printed as JSON so a trailing space or a different letter case in a name is visible
 * when TEST_SUPPORT_ENABLED "is not set" although the owner believes it is.
 */
export function relatedEnvNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env)
    .filter((name) => /test|support|admin|qa/i.test(name))
    .sort();
}

/**
 * Single source of truth for whether the QA endpoints are on, used by the guard,
 * the startup log and /health. When disabled it says WHY (never printing the token).
 */
export function readTestSupportConfig(env: NodeJS.ProcessEnv = process.env): TestSupportConfig {
  const flag = cleanEnvValue(env.TEST_SUPPORT_ENABLED);
  if (flag === '') {
    return { enabled: false, reason: 'TEST_SUPPORT_ENABLED is not set' };
  }
  if (flag.toLowerCase() !== 'true') {
    const shown = flag.length > 40 ? `${flag.slice(0, 40)}…` : flag;
    return {
      enabled: false,
      reason: `TEST_SUPPORT_ENABLED must be exactly "true" (got "${shown}", ${flag.length} characters)`,
    };
  }
  const token = cleanEnvValue(env.TEST_ADMIN_TOKEN);
  if (token.length < MIN_TOKEN_LENGTH) {
    return {
      enabled: false,
      reason: `TEST_ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters (got ${token.length})`,
    };
  }
  return { enabled: true, token };
}
