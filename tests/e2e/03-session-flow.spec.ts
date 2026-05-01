import { test, expect } from '@playwright/test';

/**
 * Phase 3.4 will fill out these tests against the server with mock CLIs.
 * Today they fail-with-skip when the server is not configured for testing.
 */

test.describe.skip('Session lifecycle', () => {
  test('login → new session → send message → see streaming', async ({ page }) => {
    // 1. Login with the test password
    await page.goto('/');
    await page.getByPlaceholder('输入密码').fill(process.env.CC_WEB_TEST_PW || 'test');
    await page.getByRole('button', { name: /登录/ }).click();

    // 2. Create a new session
    await page.getByRole('button', { name: /新会话/ }).click();

    // 3. Type message
    await page.getByPlaceholder(/输入消息/).fill('Hello agent');
    await page.keyboard.press('Enter');

    // 4. Streaming text appears
    await expect(page.locator('.message-stream')).toContainText(/hello/i);
  });

  test('switching session preserves background generation', async ({ page }) => {
    // detailed flow filled in phase 3.4
  });

  test('importing native history adds entries to sidebar', async ({ page }) => {
    // detailed flow filled in phase 3.4
  });

  test('changing password via settings reloads session', async ({ page }) => {
    // detailed flow filled in phase 3.4
  });

  test('mobile sidebar toggles via menu button', async ({ page }) => {
    // detailed flow filled in phase 3.4
  });
});
