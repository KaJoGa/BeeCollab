import { expect, test } from '@playwright/test';
import { PASSWORD, localTile, openTab, participantCount, tile } from './helpers';
import { uniqueEmail } from '../tools/config.mjs';

const WEB = (process.env.WEB_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

// One test that walks the whole product through the UI only (no API shortcuts):
// register -> create a meeting -> a guest joins with the room code -> chat -> raise hand -> host ends.
test('happy path: host registers, creates a meeting, a guest joins by code, they chat, the host ends it', async ({ browser }) => {
  const opts = {
    baseURL: WEB,
    permissions: ['camera', 'microphone'] as ('camera' | 'microphone')[],
    viewport: { width: 1280, height: 720 },
  };
  const hostCtx = await browser.newContext(opts);
  const guestCtx = await browser.newContext(opts);
  try {
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    // Host: register through the UI
    await host.goto('/login');
    await host.getByTestId('auth-switch-to-register').click();
    await host.getByTestId('auth-name-input').fill('Happy Host');
    await host.getByTestId('auth-email-input').fill(uniqueEmail('happy'));
    await host.getByTestId('auth-password-input').fill(PASSWORD);
    await host.getByTestId('auth-submit').click();
    await expect(host.getByTestId('home-user-name')).toContainText('Happy Host');

    // Host: create the meeting
    await host.getByTestId('new-meeting-btn').click();
    await host.getByTestId('new-meeting-title').fill('Happy path meeting');
    await host.getByTestId('new-meeting-submit').click();
    await expect(host.getByTestId('connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 60_000 });
    await expect(host.getByTestId('joining-screen')).toHaveCount(0, { timeout: 30_000 });

    // Host: read the room code from the info modal
    await host.getByTestId('ctrl-info').click();
    const roomCode = (await host.getByTestId('info-room-code').textContent())!.trim();
    expect(roomCode).toMatch(/^[0-9A-F]{8}$/);
    await host.getByTestId('info-close').click();

    // Guest: join from the home page with the code
    await guest.goto('/');
    await guest.getByTestId('guest-join-open').click();
    await guest.getByTestId('guest-name-input').fill('Happy Guest');
    await guest.getByTestId('guest-code-input').fill(roomCode);
    await guest.getByTestId('guest-join-submit').click();
    await expect(guest.getByTestId('connection-status')).toHaveAttribute('data-connected', 'true', { timeout: 60_000 });
    await expect(guest.getByTestId('joining-screen')).toHaveCount(0, { timeout: 30_000 });

    await expect(participantCount(host)).toHaveText('2');
    await expect(participantCount(guest)).toHaveText('2');
    await expect(tile(host, 'Happy Guest')).toHaveCount(1);
    await expect(tile(guest, 'Happy Host')).toHaveCount(1);

    // Chat both ways
    await openTab(host, 'chat');
    await openTab(guest, 'chat');
    await host.getByTestId('chat-input').fill('welcome!');
    await host.getByTestId('chat-send').click();
    await expect(guest.getByTestId('chat-message-text').filter({ hasText: 'welcome!' })).toBeVisible();
    await guest.getByTestId('chat-input').fill('thanks!');
    await guest.getByTestId('chat-send').click();
    await expect(host.getByTestId('chat-message-text').filter({ hasText: 'thanks!' })).toBeVisible();

    // Hand raise is visible to the host
    await guest.getByTestId('ctrl-hand').click();
    await expect(tile(host, 'Happy Guest').getByTestId('tile-hand')).toBeVisible();
    await expect(localTile(guest).getByTestId('tile-hand')).toBeVisible();

    // Host ends the meeting for everyone
    await host.getByTestId('ctrl-leave').click();
    await host.getByTestId('leave-end-meeting').click();
    await expect(guest.getByTestId('meeting-ended-overlay')).toHaveAttribute('data-end-type', 'ended', { timeout: 20_000 });
    await guest.getByTestId('meeting-ended-home').click();
    await expect(guest).toHaveURL(/\/$/);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
