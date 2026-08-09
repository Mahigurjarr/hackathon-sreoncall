// packages/web/e2e/marketing.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('renders homepage for unauthenticated visitor', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SREonCall/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('SRE stack');
  });

  test('hero has primary CTA linking to /signup', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByRole('link', { name: /start for free/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/signup');
  });

  test('logo strip is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Alyssum')).toBeVisible();
    await expect(page.getByText('Binoloop')).toBeVisible();
  });

  test('features section renders with tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /incidents/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /on-call/i })).toBeVisible();
  });

  test('nav has pricing link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Pricing' })).toBeVisible();
  });

  test('footer renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('© 2026 SREonCall')).toBeVisible();
  });
});

test.describe('Pricing page', () => {
  test('renders pricing page', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveTitle(/Pricing/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('One price');
  });

  test('shows all five tier names', async ({ page }) => {
    await page.goto('/pricing');
    for (const tier of ['Free', 'Startup', 'Growth', 'Enterprise', 'Dedicated']) {
      await expect(page.getByText(tier).first()).toBeVisible();
    }
  });

  test('billing toggle switches prices', async ({ page }) => {
    await page.goto('/pricing');
    // Annual default — check Growth price
    await expect(page.getByText('$1,499')).toBeVisible();
    // Toggle to monthly
    await page.getByRole('switch').click();
    await expect(page.getByText('$1,724')).toBeVisible();
  });

  test('feature table expands on click', async ({ page }) => {
    await page.goto('/pricing');
    const toggle = page.getByText(/compare all features/i);
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByText('Core Limits')).toBeVisible();
  });

  test('FAQ accordion opens answers', async ({ page }) => {
    await page.goto('/pricing');
    const question = page.getByText(/Is there a free trial/i);
    await question.click();
    await expect(page.getByText(/14-day free trial/i)).toBeVisible();
  });
});

test.describe('Auth redirect', () => {
  test('unauthenticated user stays on homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
  });
});
