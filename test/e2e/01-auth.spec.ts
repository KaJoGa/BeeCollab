import { expect, test } from '@playwright/test';
import { PASSWORD, newUser, signIn } from './helpers';
import { uniqueEmail } from '../tools/config.mjs';

test.describe('Authentication UI', () => {
  test('register through the UI logs the user in and shows their name on the home page', async ({ page }) => {
    const email = uniqueEmail('ui-register');
    await page.goto('/login');
    await page.getByTestId('auth-switch-to-register').click();
    await expect(page.getByTestId('auth-title')).toHaveText('Create Account');
    await page.getByTestId('auth-name-input').fill('Ui Register');
    await page.getByTestId('auth-email-input').fill(email);
    await page.getByTestId('auth-password-input').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-user-name')).toContainText('Ui Register');
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeTruthy();
  });

  test('login with a wrong password shows the backend error and stays on /login', async ({ page }) => {
    const user = await newUser('ui-wrongpw');
    await page.goto('/login');
    await page.getByTestId('auth-email-input').fill(user.email);
    await page.getByTestId('auth-password-input').fill('definitely-wrong');
    await page.getByTestId('auth-submit').click();

    await expect(page.getByTestId('auth-error')).toContainText('Invalid credentials');
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('login with valid credentials redirects home and shows the display name', async ({ page }) => {
    const user = await newUser('ui-login');
    await page.goto('/login');
    await page.getByTestId('auth-email-input').fill(user.email);
    await page.getByTestId('auth-password-input').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-user-name')).toContainText(user.name);
    await expect(page.getByTestId('home-logout-btn')).toHaveText('Logout');
  });

  test('registering an email that already exists shows a conflict error', async ({ page }) => {
    const user = await newUser('ui-dupe');
    await page.goto('/login');
    await page.getByTestId('auth-switch-to-register').click();
    await page.getByTestId('auth-name-input').fill('Someone Else');
    await page.getByTestId('auth-email-input').fill(user.email);
    await page.getByTestId('auth-password-input').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText('Email already in use');
  });

  test('password strength hint follows the typed length (register mode)', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('auth-switch-to-register').click();
    const hint = page.getByTestId('auth-password-hint');
    const input = page.getByTestId('auth-password-input');
    await expect(hint).toHaveText('Minimum 6 characters');
    await input.fill('123');
    await expect(hint).toHaveText('Minimum 6 characters (3/6)');
    await input.fill('123456');
    await expect(hint).toContainText('Password meets requirements');
  });

  test('show/hide toggle switches the password field type', async ({ page }) => {
    await page.goto('/login');
    const input = page.getByTestId('auth-password-input');
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByTestId('auth-toggle-password').click();
    await expect(input).toHaveAttribute('type', 'text');
    await page.getByTestId('auth-toggle-password').click();
    await expect(input).toHaveAttribute('type', 'password');
  });

  test('a too-short password is blocked in the browser before any request is sent', async ({ page }) => {
    let registerCalls = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/auth/register')) registerCalls++;
    });
    await page.goto('/login');
    await page.getByTestId('auth-switch-to-register').click();
    await page.getByTestId('auth-name-input').fill('Short Pw');
    await page.getByTestId('auth-email-input').fill(uniqueEmail('ui-shortpw'));
    await page.getByTestId('auth-password-input').fill('123');
    await page.getByTestId('auth-submit').click();
    await page.waitForTimeout(500);
    expect(registerCalls).toBe(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test('switching between sign in and sign up changes the form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('auth-title')).toHaveText('Sign In');
    await expect(page.getByTestId('auth-name-input')).toHaveCount(0);
    await page.getByTestId('auth-switch-to-register').click();
    await expect(page.getByTestId('auth-name-input')).toBeVisible();
    await page.getByTestId('auth-switch-to-login').click();
    await expect(page.getByTestId('auth-title')).toHaveText('Sign In');
  });

  test('continue as guest from the login page: signed in as a guest on the home page', async ({ page }) => {
    await page.goto('/login');
    const submit = page.getByTestId('auth-guest-submit');
    await page.getByTestId('auth-guest-name-input').fill('G');
    await expect(submit).toBeDisabled();
    await page.getByTestId('auth-guest-name-input').fill('Gina Guest');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('home-user-name')).toContainText('Guest: Gina Guest');
    await expect(page.getByTestId('home-logout-btn')).toHaveText('Exit Guest');
    expect(await page.evaluate(() => localStorage.getItem('guestName'))).toBe('Gina Guest');
  });

  test('visiting /login while signed in redirects to the home page', async ({ page }) => {
    const user = await newUser('ui-redirect');
    await signIn(page, user.token);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
  });

  test('"Back to Home" on the login page returns to /', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('auth-back-home').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('logout asks for confirmation: cancel keeps the session, confirm ends it', async ({ page }) => {
    const user = await newUser('ui-logout');
    await signIn(page, user.token);
    await page.goto('/');
    await expect(page.getByTestId('home-user-name')).toContainText(user.name);

    await page.getByTestId('home-logout-btn').click();
    await expect(page.getByTestId('logout-confirm-dialog')).toBeVisible();
    await page.getByTestId('logout-cancel').click();
    await expect(page.getByTestId('logout-confirm-dialog')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeTruthy();

    await page.getByTestId('home-logout-btn').click();
    await page.getByTestId('logout-confirm').click();
    await expect(page.getByTestId('home-signin-btn')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });

  test('an invalid/tampered token is cleared automatically (home logs out on 401)', async ({ page }) => {
    const user = await newUser('ui-badtoken');
    await signIn(page, `${user.token}broken`);
    await page.goto('/');
    await expect(page.getByTestId('home-signin-btn')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  });
});
