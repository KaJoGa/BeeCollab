import { expect, test } from '@playwright/test';
import { newMeeting, newUser, signIn, signInAsGuest } from './helpers';

const UUID = /\/meeting\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

test.describe('Home page', () => {
  test('visitor sees Sign In and guest entry; Sign In goes to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-signin-btn')).toBeVisible();
    await expect(page.getByTestId('guest-join-open')).toBeVisible();
    await page.getByTestId('home-signin-btn').click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('wake-on-open: the page pings the backend and the status indicator turns online', async ({ page }) => {
    const healthCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/health')) healthCalls.push(r.url());
    });
    await page.goto('/');
    await expect(page.getByTestId('server-status')).toHaveAttribute('data-status', 'online');
    expect(healthCalls.length).toBeGreaterThan(0);
    await expect(page.getByTestId('wake-server-banner')).toHaveCount(0);
  });

  test('wake-on-open also fires on a direct /login visit (not only the home page)', async ({ page }) => {
    const healthCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/health')) healthCalls.push(r.url());
    });
    await page.goto('/login');
    await expect.poll(() => healthCalls.length).toBeGreaterThan(0);
  });

  test('wake banner shows while /health keeps failing, retries, and disappears once it answers', async ({ page }) => {
    let calls = 0;
    await page.route('**/health', async (route) => {
      calls++;
      if (calls <= 3) await route.abort('connectionrefused');
      else await route.continue();
    });
    await page.goto('/');
    await expect(page.getByTestId('wake-server-banner')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('wake-server-banner')).toContainText('Waking up the server');
    await expect(page.getByTestId('wake-server-banner')).toHaveCount(0, { timeout: 30_000 });
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  test('wake banner also covers a backend that answers but whose database is down', async ({ page }) => {
    let calls = 0;
    await page.route('**/health', async (route) => {
      calls++;
      if (calls <= 2) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { status: 'ok', db: 'down' } }),
        });
      } else await route.continue();
    });
    await page.goto('/');
    await expect(page.getByTestId('wake-server-banner')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('wake-server-banner')).toHaveCount(0, { timeout: 30_000 });
  });

  test('"Join" is disabled until something is typed', async ({ page }) => {
    const user = await newUser('home-join-disabled');
    await signIn(page, user.token);
    await page.goto('/');
    await expect(page.getByTestId('join-btn')).toBeDisabled();
    await page.getByTestId('join-code-input').fill('ABC');
    await expect(page.getByTestId('join-btn')).toBeEnabled();
  });

  test('create-meeting form: more than 10 participants is rejected client-side', async ({ page }) => {
    const user = await newUser('home-max');
    await signIn(page, user.token);
    await page.goto('/');
    await page.getByTestId('new-meeting-btn').click();
    await page.getByTestId('new-meeting-max-participants').fill('11');
    await page.getByTestId('new-meeting-submit').click();
    await expect(page.getByTestId('new-meeting-error')).toContainText('between 2 and 10');
    await page.getByTestId('new-meeting-max-participants').fill('1');
    await page.getByTestId('new-meeting-submit').click();
    await expect(page.getByTestId('new-meeting-error')).toContainText('between 2 and 10');
  });

  test('create-meeting form can be cancelled', async ({ page }) => {
    const user = await newUser('home-cancel');
    await signIn(page, user.token);
    await page.goto('/');
    await page.getByTestId('new-meeting-btn').click();
    await expect(page.getByTestId('new-meeting-title')).toBeVisible();
    await page.getByTestId('new-meeting-cancel').click();
    await expect(page.getByTestId('new-meeting-title')).toHaveCount(0);
    await expect(page.getByTestId('new-meeting-btn')).toBeVisible();
  });

  test('creating a meeting opens the room and the info modal shows its name and 8-char code', async ({ page }) => {
    const user = await newUser('home-create');
    await signIn(page, user.token);
    await page.goto('/');
    await page.getByTestId('new-meeting-btn').click();
    await page.getByTestId('new-meeting-title').fill('E2E created room');
    await page.getByTestId('new-meeting-submit').click();

    await expect(page).toHaveURL(UUID, { timeout: 30_000 });
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 60_000 });
    await expect(page.getByTestId('joining-screen')).toHaveCount(0, { timeout: 30_000 });
    await page.getByTestId('ctrl-info').click();
    await expect(page.getByTestId('info-meeting-title')).toHaveText('E2E created room');
    await expect(page.getByTestId('info-room-code')).toHaveText(/^[0-9A-F]{8}$/);
    await page.getByTestId('info-close').click();
    await expect(page.getByTestId('info-modal')).toHaveCount(0);
  });

  test('joining by room code from the home page resolves to the meeting UUID', async ({ page }) => {
    const host = await newUser('home-host');
    const meeting = await newMeeting(host, { title: 'Join by code' });
    const member = await newUser('home-member');
    await signIn(page, member.token);
    await page.goto('/');
    await page.getByTestId('join-code-input').fill(meeting.roomCode);
    await page.getByTestId('join-btn').click();
    await expect(page).toHaveURL(new RegExp(`/meeting/${meeting.id}`), { timeout: 30_000 });
  });

  test('pressing Enter in the code field joins as well', async ({ page }) => {
    const host = await newUser('home-enter-host');
    const meeting = await newMeeting(host);
    const member = await newUser('home-enter-member');
    await signIn(page, member.token);
    await page.goto('/');
    await page.getByTestId('join-code-input').fill(meeting.roomCode);
    await page.getByTestId('join-code-input').press('Enter');
    await expect(page).toHaveURL(new RegExp(`/meeting/${meeting.id}`), { timeout: 30_000 });
  });

  test('a guest cannot open the create-meeting form from the UI', async ({ page }) => {
    await signInAsGuest(page, 'Guest NoCreate');
    await page.goto('/');
    await expect(page.getByTestId('home-logout-btn')).toHaveText('Exit Guest');
    await page.getByTestId('new-meeting-btn').click();
    await expect(page.getByTestId('new-meeting-title')).toHaveCount(0);
  });

  test('guest join panel validates the name and the code before calling the API', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('guest-join-open').click();
    await page.getByTestId('guest-join-submit').click();
    await expect(page.getByTestId('guest-join-error')).toContainText('at least 2 characters');
    await page.getByTestId('guest-name-input').fill('Gus');
    await page.getByTestId('guest-join-submit').click();
    await expect(page.getByTestId('guest-join-error')).toContainText('room code');
    await page.getByTestId('guest-join-cancel').click();
    await expect(page.getByTestId('guest-name-input')).toHaveCount(0);
  });

  test('guest join upper-cases the typed room code', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('guest-join-open').click();
    await page.getByTestId('guest-code-input').fill('abcd1234');
    await expect(page.getByTestId('guest-code-input')).toHaveValue('ABCD1234');
  });

  test('guest join with a real code lands in the meeting as a guest', async ({ page }) => {
    const host = await newUser('home-guest-host');
    const meeting = await newMeeting(host, { title: 'Guest welcome' });
    await page.goto('/');
    await page.getByTestId('guest-join-open').click();
    await page.getByTestId('guest-name-input').fill('Walk In');
    await page.getByTestId('guest-code-input').fill(meeting.roomCode);
    await page.getByTestId('guest-join-submit').click();
    await expect(page).toHaveURL(new RegExp(`/meeting/${meeting.roomCode}|/meeting/${meeting.id}`), { timeout: 30_000 });
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 60_000 });
    await expect(page.locator('[data-testid="video-tile"][data-local="true"]')).toBeVisible({ timeout: 30_000 });
  });

  test('opening a meeting URL without a session sends the visitor to /login with a redirect back', async ({ page }) => {
    await page.goto('/meeting/00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL(/\/login\?redirect=\/meeting\/00000000/);
  });

  test('opening a non-existent meeting (valid UUID, signed in) returns to the home page', async ({ page }) => {
    const user = await newUser('home-ghost');
    await signIn(page, user.token);
    await page.goto('/meeting/00000000-0000-4000-8000-000000000001');
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  });
});
