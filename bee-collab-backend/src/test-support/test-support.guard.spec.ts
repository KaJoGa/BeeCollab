import { ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TestSupportGuard } from './test-support.guard';

const TOKEN = 'a-sufficiently-long-token';

function ctx(headers: Record<string, string> = {}): ExecutionContext {
  const req = {
    method: 'POST',
    originalUrl: '/test-support/cleanup',
    header: (name: string) => headers[name.toLowerCase()],
  };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('TestSupportGuard', () => {
  const realEnv = { ...process.env };
  const guard = new TestSupportGuard();

  beforeEach(() => {
    delete process.env.TEST_SUPPORT_ENABLED;
    delete process.env.TEST_ADMIN_TOKEN;
  });
  afterAll(() => {
    process.env = { ...realEnv };
  });

  it('behaves like an unknown route (404) when disabled, even with a valid token', () => {
    process.env.TEST_ADMIN_TOKEN = TOKEN;
    expect(() => guard.canActivate(ctx({ 'x-test-token': TOKEN }))).toThrow(NotFoundException);
  });

  it('is 404 when enabled but the token is missing or too short', () => {
    process.env.TEST_SUPPORT_ENABLED = 'true';
    expect(() => guard.canActivate(ctx())).toThrow(NotFoundException);
    process.env.TEST_ADMIN_TOKEN = 'short';
    expect(() => guard.canActivate(ctx({ 'x-test-token': 'short' }))).toThrow(NotFoundException);
  });

  it('is 401 when enabled and the header is missing or wrong', () => {
    process.env.TEST_SUPPORT_ENABLED = 'true';
    process.env.TEST_ADMIN_TOKEN = TOKEN;
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-test-token': 'wrong' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-test-token': TOKEN + 'x' }))).toThrow(UnauthorizedException);
  });

  it('allows the request when enabled and the token matches', () => {
    process.env.TEST_SUPPORT_ENABLED = 'true';
    process.env.TEST_ADMIN_TOKEN = TOKEN;
    expect(guard.canActivate(ctx({ 'x-test-token': TOKEN }))).toBe(true);
  });

  it('accepts a padded/quoted environment configuration and a header with stray whitespace', () => {
    process.env.TEST_SUPPORT_ENABLED = ' "TRUE" ';
    process.env.TEST_ADMIN_TOKEN = `"${TOKEN}" `;
    expect(guard.canActivate(ctx({ 'x-test-token': `  ${TOKEN}  ` }))).toBe(true);
  });

  it('treats any value other than "true" as disabled', () => {
    process.env.TEST_SUPPORT_ENABLED = '1';
    process.env.TEST_ADMIN_TOKEN = TOKEN;
    expect(() => guard.canActivate(ctx({ 'x-test-token': TOKEN }))).toThrow(NotFoundException);
  });
});
