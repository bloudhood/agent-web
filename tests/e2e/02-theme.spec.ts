import { test, expect } from '@playwright/test';

test.describe('Theme toggle', () => {
  test('default theme matches system preference', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', /(washi|washi-dark)/);
  });

  test('persists theme via localStorage', async ({ page, context }) => {
    await page.goto('/');
    await context.addInitScript(() => localStorage.setItem('cc-web-theme', 'washi-dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'washi-dark');
  });
});
