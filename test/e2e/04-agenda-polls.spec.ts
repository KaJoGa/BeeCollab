import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { newMeeting, newUser, openMeeting, openTab, signIn } from './helpers';

const WEB = (process.env.WEB_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
const contextOptions = {
  baseURL: WEB,
  permissions: ['camera', 'microphone'] as ('camera' | 'microphone')[],
  viewport: { width: 1280, height: 720 },
};
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => {});
});

async function hostAndMember(browser: Browser) {
  const host = await newUser('plan-host');
  const meeting = await newMeeting(host, { title: 'Agenda and polls' });
  const open = async (user: { token: string }) => {
    const ctx = await browser.newContext(contextOptions);
    opened.push(ctx);
    const page = await ctx.newPage();
    await signIn(page, user.token);
    await openMeeting(page, meeting.id);
    return page;
  };
  const hostPage = await open(host);
  const member = await newUser('plan-member');
  const memberPage = await open(member);
  return { hostPage, memberPage };
}

test.describe('Agenda', () => {
  test('only the host sees the agenda form; a member sees the empty state', async ({ browser }) => {
    const { hostPage, memberPage } = await hostAndMember(browser);
    await openTab(hostPage, 'agenda');
    await openTab(memberPage, 'agenda');
    await expect(hostPage.getByTestId('agenda-title-input')).toBeVisible();
    await expect(memberPage.getByTestId('agenda-title-input')).toHaveCount(0);
    await expect(memberPage.getByTestId('sidebar')).toContainText('No agenda items set for this meeting.');
  });

  test('the host saves a two-item agenda and everyone sees it in order', async ({ browser }) => {
    const { hostPage, memberPage } = await hostAndMember(browser);
    await openTab(hostPage, 'agenda');
    await openTab(memberPage, 'agenda');

    await hostPage.getByTestId('agenda-title-input').first().fill('Welcome');
    await hostPage.getByTestId('agenda-duration-input').first().fill('120');
    await hostPage.getByTestId('agenda-add-item').click();
    await hostPage.getByTestId('agenda-title-input').nth(1).fill('Demo');
    await hostPage.getByTestId('agenda-save').click();

    for (const page of [hostPage, memberPage]) {
      await expect(page.getByTestId('agenda-item')).toHaveCount(2);
      await expect(page.getByTestId('agenda-item').nth(0)).toContainText('Welcome');
      await expect(page.getByTestId('agenda-item').nth(0)).toContainText('2 min');
      await expect(page.getByTestId('agenda-item').nth(1)).toContainText('Demo');
    }
    // the form disappears once an agenda exists
    await expect(hostPage.getByTestId('agenda-title-input')).toHaveCount(0);
  });

  test('saving with only blank titles does nothing', async ({ browser }) => {
    const { hostPage } = await hostAndMember(browser);
    await openTab(hostPage, 'agenda');
    await hostPage.getByTestId('agenda-save').click();
    await hostPage.waitForTimeout(500);
    await expect(hostPage.getByTestId('agenda-item')).toHaveCount(0);
    await expect(hostPage.getByTestId('agenda-title-input')).toBeVisible();
  });

  test('starting an item marks it active for everyone and shows it as the current item', async ({ browser }) => {
    const { hostPage, memberPage } = await hostAndMember(browser);
    await openTab(hostPage, 'agenda');
    await openTab(memberPage, 'agenda');
    await hostPage.getByTestId('agenda-title-input').first().fill('Kickoff');
    await hostPage.getByTestId('agenda-save').click();
    await expect(memberPage.getByTestId('agenda-item')).toHaveCount(1);
    await expect(memberPage.getByTestId('agenda-start')).toHaveCount(0); // members cannot start items

    await hostPage.getByTestId('agenda-start').click();
    await expect(memberPage.getByTestId('agenda-current')).toHaveText('Kickoff');
    await expect(memberPage.getByTestId('agenda-item')).toHaveAttribute('data-active', 'true');
    await expect(hostPage.getByTestId('agenda-start')).toHaveCount(0); // the active item has no Start button
  });
});

test.describe('Polls', () => {
  test('only the host sees the poll form', async ({ browser }) => {
    const { hostPage, memberPage } = await hostAndMember(browser);
    await openTab(hostPage, 'polls');
    await openTab(memberPage, 'polls');
    await expect(hostPage.getByTestId('poll-question-input')).toBeVisible();
    await expect(memberPage.getByTestId('poll-question-input')).toHaveCount(0);
    await expect(memberPage.getByTestId('sidebar')).toContainText('No polls yet.');
  });

  test('a launched poll reaches the member, who votes and sees 100% and one vote', async ({ browser }) => {
    const { hostPage, memberPage } = await hostAndMember(browser);
    await openTab(hostPage, 'polls');
    await openTab(memberPage, 'polls');

    await hostPage.getByTestId('poll-question-input').fill('Best colour?');
    await hostPage.getByTestId('poll-option-input').nth(0).fill('Red');
    await hostPage.getByTestId('poll-option-input').nth(1).fill('Blue');
    await hostPage.getByTestId('poll-launch').click();

    await expect(memberPage.getByTestId('poll-card')).toHaveCount(1);
    await expect(memberPage.getByTestId('poll-card')).toContainText('Best colour?');
    await expect(memberPage.getByTestId('poll-option')).toHaveCount(2);
    await expect(memberPage.getByTestId('poll-total-votes')).toHaveText('0 total votes');
    // the form is cleared after launching
    await expect(hostPage.getByTestId('poll-question-input')).toHaveValue('');

    await memberPage.getByTestId('poll-option').filter({ hasText: 'Blue' }).click();
    for (const page of [hostPage, memberPage]) {
      await expect(page.getByTestId('poll-total-votes')).toHaveText('1 total votes');
      await expect(page.getByTestId('poll-option').filter({ hasText: 'Blue' })).toContainText('100%');
      await expect(page.getByTestId('poll-option').filter({ hasText: 'Red' })).toContainText('0%');
    }
  });

  test('voting twice still counts one vote in total (one vote per user)', async ({ browser }) => {
    const { hostPage, memberPage } = await hostAndMember(browser);
    await openTab(hostPage, 'polls');
    await openTab(memberPage, 'polls');
    await hostPage.getByTestId('poll-question-input').fill('Pick one');
    await hostPage.getByTestId('poll-option-input').nth(0).fill('Alpha');
    await hostPage.getByTestId('poll-option-input').nth(1).fill('Bravo');
    await hostPage.getByTestId('poll-launch').click();
    await expect(memberPage.getByTestId('poll-card')).toHaveCount(1);

    await memberPage.getByTestId('poll-option').filter({ hasText: 'Alpha' }).click();
    await expect(memberPage.getByTestId('poll-total-votes')).toHaveText('1 total votes');
    await memberPage.getByTestId('poll-option').filter({ hasText: 'Bravo' }).click();
    await memberPage.waitForTimeout(1000);
    await expect(memberPage.getByTestId('poll-total-votes')).toHaveText('1 total votes');
  });

  test('the poll question is required (empty question launches nothing)', async ({ browser }) => {
    const { hostPage } = await hostAndMember(browser);
    await openTab(hostPage, 'polls');
    await hostPage.getByTestId('poll-launch').click();
    await hostPage.waitForTimeout(500);
    await expect(hostPage.getByTestId('poll-card')).toHaveCount(0);
  });

  test('"+ Add Option" adds an input to the poll form', async ({ browser }) => {
    const { hostPage } = await hostAndMember(browser);
    await openTab(hostPage, 'polls');
    await expect(hostPage.getByTestId('poll-option-input')).toHaveCount(2);
    await hostPage.getByTestId('poll-add-option').click();
    await expect(hostPage.getByTestId('poll-option-input')).toHaveCount(3);
  });
});
