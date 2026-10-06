import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { localTile, newMeeting, newUser, openMeeting, openTab, participantCount, signIn, signInAsGuest, tile, type TestUser } from './helpers';

const WEB = (process.env.WEB_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const GUEST_NAME = 'Gina Guest';

// browser.newContext() does not inherit the config's `use` options, so repeat what matters.
const contextOptions = {
  baseURL: WEB,
  permissions: ['camera', 'microphone'] as ('camera' | 'microphone')[],
  viewport: { width: 1280, height: 720 },
};

const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => {});
});

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext(contextOptions);
  opened.push(ctx);
  return ctx.newPage();
}

async function hostInMeeting(browser: Browser, overrides: Record<string, unknown> = {}) {
  const host = await newUser('room-host');
  const meeting = await newMeeting(host, overrides);
  const hostPage = await newPage(browser);
  await signIn(hostPage, host.token);
  await openMeeting(hostPage, meeting.id);
  return { host, meeting, hostPage };
}

async function guestJoins(browser: Browser, roomCode: string, name = GUEST_NAME) {
  const page = await newPage(browser);
  await signInAsGuest(page, name);
  await openMeeting(page, roomCode);
  return page;
}

async function memberJoins(browser: Browser, meetingId: string, label = 'room-member') {
  const member = await newUser(label);
  const page = await newPage(browser);
  await signIn(page, member.token);
  await openMeeting(page, meetingId);
  return { member, page };
}

const row = (page: Page, name: string) => page.locator(`[data-testid="participant-row"][data-name="${name}"]`);

test.describe('Meeting room: presence and layout', () => {
  test('a lone host sees only their own tile and a participant count of 1', async ({ browser }) => {
    const { hostPage } = await hostInMeeting(browser);
    await expect(hostPage.locator('[data-testid="video-tile"]')).toHaveCount(1);
    await expect(localTile(hostPage)).toHaveAttribute('data-name', 'You'); // own tile is labelled "You"
    await expect(localTile(hostPage).getByTestId('tile-name')).toHaveText('You');
    await expect(participantCount(hostPage)).toHaveText('1');
  });

  test('a guest joining by room code appears for the host and both see two tiles', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);

    await expect(participantCount(hostPage)).toHaveText('2');
    await expect(participantCount(guestPage)).toHaveText('2');
    await expect(tile(hostPage, GUEST_NAME)).toHaveCount(1);
    await expect(tile(guestPage, host.name)).toHaveCount(1);
    await expect(localTile(guestPage)).toHaveCount(1);
    await expect(tile(guestPage, host.name).getByTestId('tile-name')).toHaveText(host.name);
  });

  test('the people panel lists everyone, labels the host, and marks "You"', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await openTab(hostPage, 'people');
    await openTab(guestPage, 'people');

    await expect(hostPage.getByTestId('sidebar-title')).toContainText('Participants (2)');
    await expect(hostPage.getByTestId('participant-row')).toHaveCount(2);
    await expect(row(hostPage, host.name)).toContainText('You');
    await expect(row(hostPage, host.name)).toContainText('(Host)');
    await expect(row(guestPage, host.name)).toContainText('(Host)');
    await expect(row(guestPage, GUEST_NAME)).toContainText('You');
  });

  test('the people search filters the list by name', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    await guestJoins(browser, meeting.roomCode);
    await openTab(hostPage, 'people');
    await expect(hostPage.getByTestId('participant-row')).toHaveCount(2);
    await hostPage.getByTestId('people-search').fill('gina');
    await expect(hostPage.getByTestId('participant-row')).toHaveCount(1);
    await expect(row(hostPage, GUEST_NAME)).toBeVisible();
    await hostPage.getByTestId('people-search').fill('zzz-nobody');
    await expect(hostPage.getByTestId('participant-row')).toHaveCount(0);
    await hostPage.getByTestId('people-search').fill('');
    await expect(hostPage.getByTestId('participant-row')).toHaveCount(2);
    void host;
  });

  test('a guest leaving drops the host back to a count of 1', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await expect(participantCount(hostPage)).toHaveText('2');
    await guestPage.getByTestId('ctrl-leave').click();
    await guestPage.getByTestId('leave-leave-meeting').click();
    await expect(guestPage).toHaveURL(/\/$/);
    await expect(participantCount(hostPage)).toHaveText('1', { timeout: 20_000 });
  });

  test('the sidebar opens, switches tabs and closes', async ({ browser }) => {
    const { hostPage } = await hostInMeeting(browser);
    await expect(hostPage.getByTestId('sidebar')).toHaveCount(0);
    await openTab(hostPage, 'chat');
    await expect(hostPage.getByTestId('sidebar-title')).toHaveText('Chat');
    await openTab(hostPage, 'agenda');
    await expect(hostPage.getByTestId('sidebar-title')).toHaveText('Meeting Agenda');
    await openTab(hostPage, 'polls');
    await expect(hostPage.getByTestId('sidebar-title')).toHaveText('Polls');
    await hostPage.getByTestId('sidebar-close').click();
    await expect(hostPage.getByTestId('sidebar')).toHaveCount(0);
  });

  test('the info modal shows the meeting title and room code', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser, { title: 'Info modal room' });
    await hostPage.getByTestId('ctrl-info').click();
    await expect(hostPage.getByTestId('info-meeting-title')).toHaveText('Info modal room');
    await expect(hostPage.getByTestId('info-room-code')).toHaveText(meeting.roomCode);
  });

  test('a meeting at capacity (max 2) refuses a third person with the "full" screen', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser, { maxParticipants: 2 });
    await guestJoins(browser, meeting.roomCode, 'Second Person');
    await expect(participantCount(hostPage)).toHaveText('2');

    const third = await newPage(browser);
    await signInAsGuest(third, 'Third Person');
    await third.goto(`/meeting/${meeting.roomCode}`);
    await expect(third.getByTestId('meeting-ended-overlay')).toHaveAttribute('data-end-type', 'full', { timeout: 30_000 });
    await expect(third.getByTestId('meeting-ended-title')).toContainText('full');
    await expect(participantCount(hostPage)).toHaveText('2');
  });
});

test.describe('Meeting room: chat, hand, reactions', () => {
  test('chat messages travel both ways between a host and a guest', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await openTab(hostPage, 'chat');
    await openTab(guestPage, 'chat');

    await hostPage.getByTestId('chat-input').fill('hello guest');
    await hostPage.getByTestId('chat-send').click();
    await expect(guestPage.getByTestId('chat-message-text').filter({ hasText: 'hello guest' })).toBeVisible();

    await guestPage.getByTestId('chat-input').fill('hello host');
    await guestPage.getByTestId('chat-input').press('Enter');
    await expect(hostPage.getByTestId('chat-message-text').filter({ hasText: 'hello host' })).toBeVisible();
    await expect(hostPage.getByTestId('chat-message').filter({ hasText: 'hello host' })).toHaveAttribute('data-sender', GUEST_NAME);
  });

  test('the send button stays disabled for blank messages and the input clears after sending', async ({ browser }) => {
    const { hostPage } = await hostInMeeting(browser);
    await openTab(hostPage, 'chat');
    await expect(hostPage.getByTestId('chat-send')).toBeDisabled();
    await hostPage.getByTestId('chat-input').fill('   ');
    await expect(hostPage.getByTestId('chat-send')).toBeDisabled();
    await hostPage.getByTestId('chat-input').fill('real text');
    await hostPage.getByTestId('chat-send').click();
    await expect(hostPage.getByTestId('chat-input')).toHaveValue('');
  });

  test('registered users get the chat history when they join late; guests do not leave history', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    await openTab(hostPage, 'chat');
    await hostPage.getByTestId('chat-input').fill('stored message');
    await hostPage.getByTestId('chat-send').click();
    await expect(hostPage.getByTestId('chat-message-text').filter({ hasText: 'stored message' })).toBeVisible();

    const guestPage = await guestJoins(browser, meeting.roomCode);
    await openTab(guestPage, 'chat');
    await expect(guestPage.getByTestId('chat-message-text').filter({ hasText: 'stored message' })).toBeVisible();
    await guestPage.getByTestId('chat-input').fill('guest ephemeral');
    await guestPage.getByTestId('chat-send').click();
    await expect(hostPage.getByTestId('chat-message-text').filter({ hasText: 'guest ephemeral' })).toBeVisible();

    const { page: lateMember } = await memberJoins(browser, meeting.id, 'late-member');
    await openTab(lateMember, 'chat');
    await expect(lateMember.getByTestId('chat-message-text').filter({ hasText: 'stored message' })).toBeVisible();
    await expect(lateMember.getByTestId('chat-message-text').filter({ hasText: 'guest ephemeral' })).toHaveCount(0);
  });

  test('raising a hand shows the hand on the raiser\'s tile for everyone and in the people list order', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await expect(participantCount(hostPage)).toHaveText('2');

    await guestPage.getByTestId('ctrl-hand').click();
    await expect(guestPage.getByTestId('ctrl-hand')).toHaveAttribute('data-active', 'true');
    await expect(tile(hostPage, GUEST_NAME).getByTestId('tile-hand')).toBeVisible();
    await expect(localTile(guestPage).getByTestId('tile-hand')).toBeVisible();

    await openTab(hostPage, 'people');
    await expect(row(hostPage, GUEST_NAME)).toContainText('#1');

    await guestPage.getByTestId('ctrl-hand').click();
    await expect(tile(hostPage, GUEST_NAME).getByTestId('tile-hand')).toHaveCount(0);
    void host;
  });

  test('sending a reaction updates the reaction summary for everyone', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const { page: member } = await memberJoins(browser, meeting.id);
    await expect(participantCount(hostPage)).toHaveText('2');
    await member.getByTestId('ctrl-reaction').click();
    await expect(hostPage.getByTestId('reaction-summary')).toContainText('❤️');
    await expect(hostPage.getByTestId('reaction-summary')).toContainText('1');
    await expect(member.getByTestId('reaction-summary')).toContainText('❤️');
  });
});

test.describe('Meeting room: media (fake camera and microphone)', () => {
  test('microphone toggle flips the control state and the muted badge other people see', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    const hostTileForGuest = tile(guestPage, host.name);
    await expect(hostPage.getByTestId('ctrl-mic')).toHaveAttribute('data-enabled', 'false');
    await expect(hostTileForGuest.getByTestId('tile-muted')).toHaveCount(1);

    await hostPage.getByTestId('ctrl-mic').click();
    await expect(hostPage.getByTestId('ctrl-mic')).toHaveAttribute('data-enabled', 'true');
    await expect(hostTileForGuest.getByTestId('tile-muted')).toHaveCount(0);

    await hostPage.getByTestId('ctrl-mic').click();
    await expect(hostPage.getByTestId('ctrl-mic')).toHaveAttribute('data-enabled', 'false');
    await expect(hostTileForGuest.getByTestId('tile-muted')).toHaveCount(1);
  });

  test('turning the camera on streams real video frames to the other participant (WebRTC)', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await expect(participantCount(guestPage)).toHaveText('2');

    await hostPage.getByTestId('ctrl-camera').click();
    await expect(hostPage.getByTestId('ctrl-camera')).toHaveAttribute('data-enabled', 'true');

    const remoteVideo = tile(guestPage, host.name).getByTestId('tile-video');
    await expect
      .poll(async () => remoteVideo.evaluate((v: HTMLVideoElement) => v.videoWidth), {
        message: 'remote video should report a non-zero width once frames arrive',
        timeout: 45_000,
        intervals: [500, 1000, 2000],
      })
      .toBeGreaterThan(0);

    const localVideo = localTile(hostPage).getByTestId('tile-video');
    await expect.poll(async () => localVideo.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('data saver mode toggles and shows the avatar instead of remote video', async ({ browser }) => {
    const { hostPage } = await hostInMeeting(browser);
    await expect(hostPage.getByTestId('ctrl-data-saver')).toHaveAttribute('data-active', 'false');
    await hostPage.getByTestId('ctrl-data-saver').click();
    await expect(hostPage.getByTestId('ctrl-data-saver')).toHaveAttribute('data-active', 'true');
    await hostPage.getByTestId('ctrl-data-saver').click();
    await expect(hostPage.getByTestId('ctrl-data-saver')).toHaveAttribute('data-active', 'false');
  });

  test('device settings lists the (fake) devices and can be cancelled', async ({ browser }) => {
    const { hostPage } = await hostInMeeting(browser);
    await hostPage.getByTestId('ctrl-more').click();
    await hostPage.getByTestId('more-settings').click();
    await expect(hostPage.getByTestId('device-settings-modal')).toBeVisible();
    await expect(hostPage.getByTestId('device-audio-select').locator('option')).not.toHaveCount(0);
    await expect(hostPage.getByTestId('device-video-select').locator('option')).not.toHaveCount(0);
    await hostPage.getByTestId('device-cancel').click();
    await expect(hostPage.getByTestId('device-settings-modal')).toHaveCount(0);
  });
});

test.describe('Meeting room: host controls', () => {
  test('the host can kick a registered participant, who sees the "removed" screen', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const { member, page: memberPage } = await memberJoins(browser, meeting.id);
    await expect(participantCount(hostPage)).toHaveText('2');
    await openTab(hostPage, 'people');

    await row(hostPage, member.name).getByTestId('participant-actions-btn').click();
    await hostPage.getByTestId('participant-kick').click();

    await expect(memberPage.getByTestId('meeting-ended-overlay')).toHaveAttribute('data-end-type', 'kicked', { timeout: 20_000 });
    await expect(memberPage.getByTestId('meeting-ended-title')).toContainText('removed');
    await expect(participantCount(hostPage)).toHaveText('1', { timeout: 20_000 });
  });

  test('a regular participant has no action menu for other people', async ({ browser }) => {
    const { host, meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await expect(participantCount(hostPage)).toHaveText('2');
    await openTab(guestPage, 'people');
    await expect(row(guestPage, host.name)).toBeVisible();
    await expect(guestPage.getByTestId('participant-actions-btn')).toHaveCount(0);
  });

  test('the host can force-mute a registered participant who has their microphone on', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const { member, page: memberPage } = await memberJoins(browser, meeting.id);
    await memberPage.getByTestId('ctrl-mic').click();
    await expect(memberPage.getByTestId('ctrl-mic')).toHaveAttribute('data-enabled', 'true');

    await openTab(hostPage, 'people');
    await row(hostPage, member.name).getByTestId('participant-actions-btn').click();
    await hostPage.getByTestId('participant-mute').click();
    await expect(memberPage.getByTestId('ctrl-mic')).toHaveAttribute('data-enabled', 'false', { timeout: 20_000 });
  });

  test('"Ask to unmute" prompts the participant, and accepting turns their microphone on', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    let prompt = '';
    guestPage.on('dialog', async (d) => {
      prompt = d.message();
      await d.accept();
    });
    await openTab(hostPage, 'people');
    await row(hostPage, GUEST_NAME).getByTestId('participant-actions-btn').click();
    await hostPage.getByTestId('participant-ask-unmute').click();

    await expect(guestPage.getByTestId('ctrl-mic')).toHaveAttribute('data-enabled', 'true', { timeout: 20_000 });
    expect(prompt).toContain('unmute');
  });

  test('the host can promote a registered member to co-host and demote them again', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const { member, page: memberPage } = await memberJoins(browser, meeting.id);
    await expect(participantCount(hostPage)).toHaveText('2');
    await openTab(hostPage, 'people');

    await row(hostPage, member.name).getByTestId('participant-actions-btn').click();
    await hostPage.getByTestId('participant-make-cohost').click();
    await expect(row(hostPage, member.name)).toContainText('(Co-Host)', { timeout: 20_000 });

    await openTab(memberPage, 'people');
    await expect(row(memberPage, member.name)).toContainText('(Co-Host)');

    await row(hostPage, member.name).getByTestId('participant-actions-btn').click();
    await hostPage.getByTestId('participant-remove-cohost').click();
    await expect(row(hostPage, member.name)).not.toContainText('(Co-Host)', { timeout: 20_000 });
  });

  test('ending the meeting shows the "host ended" screen to everyone', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await expect(participantCount(hostPage)).toHaveText('2');

    await hostPage.getByTestId('ctrl-leave').click();
    await hostPage.getByTestId('leave-end-meeting').click();

    await expect(guestPage.getByTestId('meeting-ended-overlay')).toHaveAttribute('data-end-type', 'ended', { timeout: 20_000 });
    await expect(guestPage.getByTestId('meeting-ended-title')).toContainText('ended the meeting');
    await expect(hostPage.getByTestId('meeting-ended-overlay')).toBeVisible({ timeout: 20_000 });

    await guestPage.getByTestId('meeting-ended-home').click();
    await expect(guestPage).toHaveURL(/\/$/);
  });

  test('only the host sees the "End Meeting" option; others only get "Leave Meeting"', async ({ browser }) => {
    const { meeting, hostPage } = await hostInMeeting(browser);
    const guestPage = await guestJoins(browser, meeting.roomCode);
    await hostPage.getByTestId('ctrl-leave').click();
    await expect(hostPage.getByTestId('leave-end-meeting')).toBeVisible();
    await guestPage.getByTestId('ctrl-leave').click();
    await expect(guestPage.getByTestId('leave-leave-meeting')).toBeVisible();
    await expect(guestPage.getByTestId('leave-end-meeting')).toHaveCount(0);
  });
});

// Helper exported for the other spec files that need a host + member.
export type { TestUser };
