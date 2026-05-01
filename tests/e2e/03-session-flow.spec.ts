import { test, expect } from '@playwright/test';

test.describe('Session lifecycle', () => {
  test('login -> send message -> see assistant response', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('输入密码').fill(process.env.CC_WEB_TEST_PW || 'E2eStrong123!');
    await page.getByRole('button', { name: /登录/ }).click();

    await expect(page.getByRole('heading', { name: '新会话' })).toBeVisible();

    await page.locator('textarea[placeholder*="给 Agent 发消息"]').fill('Hello e2e');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('Claude mock handled: Hello e2e')).toBeVisible();
  });
});
