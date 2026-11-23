import { expect, test } from '@playwright/test';

const PAGES = ['/', '/check?date=2026-06-15&mode=rental_car', '/plan?activity=deck', '/report', '/report?audience=traveler', '/cards', '/cards/jeju-absolute-conservation-area'];

for (const path of PAGES) {
  test(`가로로 넘치지 않는다: ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('휴대폰에서는 폼 아래 막대에 판정 요약이 보이고 누르면 결과로 간다', async ({ page }) => {
  await page.goto('/check?date=2026-06-15');
  await page.getByRole('radio', { name: /렌터카/ }).check();
  const summary = page.getByTestId('summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('저촉');
  await expect(summary).toBeInViewport();
  await summary.getByRole('link').click();
  await expect(page.getByTestId('final')).toBeInViewport();
});
