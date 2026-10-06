import { expect, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, createMeeting, guestToken, register, uniqueEmail } from '../tools/config.mjs';

export { PASSWORD };

export type TestUser = { email: string; name: string; token: string };

/** Registers a brand-new @qa.beecollab.test account through the API. */
export async function newUser(label: string): Promise<TestUser> {
  const email = uniqueEmail(label);
  const name = `QA ${label}`;
  const token = await register(email, name);
  return { email, name, token };
}

/** Creates a meeting through the API as the given user. */
export async function newMeeting(user: TestUser, overrides: Record<string, unknown> = {}) {
  return createMeeting(user.token, { title: 'E2E meeting', duration: 30, maxParticipants: 10, ...overrides });
}

/** Puts a session into the page's localStorage (what the app does after login). */
export async function signIn(page: Page, token: string, guestName?: string) {
  await page.goto('/login');
  await page.evaluate(
    ([t, g]) => {
      localStorage.setItem('token', t);
      if (g) localStorage.setItem('guestName', g);
      else localStorage.removeItem('guestName');
    },
    [token, guestName ?? ''],
  );
}

export async function signInAsGuest(page: Page, name: string) {
  const token = await guestToken(name);
  await signIn(page, token, name);
  return token;
}

/** A fresh browser context + page, signed in. Remember to close the context. */
export async function sessionPage(
  browserContext: () => Promise<BrowserContext>,
  who: { token: string; guestName?: string },
) {
  const context = await browserContext();
  const page = await context.newPage();
  await signIn(page, who.token, who.guestName);
  return { context, page };
}

/** Opens /meeting/<idOrCode> and waits until the socket is connected and the joining screen is gone. */
export async function openMeeting(page: Page, idOrCode: string) {
  await page.goto(`/meeting/${idOrCode}`);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 60_000 });
  await expect(page.getByTestId('joining-screen')).toHaveCount(0, { timeout: 30_000 });
}

/** The local user's own tile. The app labels it "You" (data-name="You"), never with the account name. */
export const localTile = (page: Page) => page.locator('[data-testid="video-tile"][data-local="true"]');
/** A remote participant's tile, by display name. */
export const tile = (page: Page, name: string) => page.locator(`[data-testid="video-tile"][data-name="${name}"]`);
export const participantCount = (page: Page) => page.getByTestId('participant-count');
export async function openTab(page: Page, tab: 'chat' | 'people' | 'agenda' | 'polls') {
  const sidebar = page.getByTestId('sidebar');
  if ((await sidebar.count()) && (await sidebar.getAttribute('data-tab')) === tab) return;
  await page.getByTestId(`ctrl-tab-${tab}`).click();
  await expect(sidebar).toHaveAttribute('data-tab', tab);
}
