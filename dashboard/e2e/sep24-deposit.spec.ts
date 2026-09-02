import { test, expect } from '@playwright/test';

test.describe('SEP-24 deposit', () => {
  test('shows error banner on failure', async ({ page }) => {
    await page.route('**/transactions/deposit/interactive', route =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    );
    await page.goto('/deposit');
    await page.fill('#account', 'GABC');
    await page.fill('#amount', '100');
    await page.click('#submit');
    await expect(page.locator('.error-banner')).toBe Visible();
  });
});