import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test('shows login screen by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Agent-Web', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('输入密码')).toBeVisible();
  });

  test('rejects empty submit', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: /登录/ });
    await expect(button).toBeDisabled();
  });

  test('toggles password visibility', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder('输入密码');
    await input.fill('secret');
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /显示\/隐藏密码/ }).click();
    await expect(input).toHaveAttribute('type', 'text');
  });
});
