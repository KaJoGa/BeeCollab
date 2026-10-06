import { defineConfig, devices } from '@playwright/test';

// WEB_URL / API_URL select the environment (defaults: local dev servers).
//   WEB_URL=https://beecollab.vercel.app API_URL=https://beecollab-rwbj.onrender.com npm run e2e
const WEB = (process.env.WEB_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // tests create their own unique data, but meetings are stateful: keep runs deterministic
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts', // no-op unless QA_CLEANUP=1 and TEST_ADMIN_TOKEN are set
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      // Fake camera/microphone so WebRTC runs headless without hardware or prompts.
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
