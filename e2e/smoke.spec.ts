import { expect, test } from '@playwright/test';

test('Startseite lädt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Schweizer System/ })).toBeVisible();
});
