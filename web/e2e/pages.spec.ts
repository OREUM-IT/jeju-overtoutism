import { expect, test } from '@playwright/test';

test('홈: 세 독자의 입구와 시안 안내', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('조문으로 확인합니다');
  for (const name of ['방문 전 체크', '기획 점검', '지역 진단 보고서']) {
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByText('화면 시안입니다.')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('법률 자문이 아닙니다');
});

test('방문 전 체크: 고르는 대로 판정과 근거가 바뀐다', async ({ page }) => {
  await page.goto('/check?date=2026-06-15');
  await expect(page.getByTestId('empty-result')).toBeVisible();

  await page.getByRole('radio', { name: /렌터카/ }).check();
  const final = page.getByTestId('final');
  const preliminary = page.getByTestId('preliminary');
  await expect(preliminary.locator('[data-verdict]')).toHaveText('저촉');
  await expect(preliminary).toContainText('R1-다');
  await expect(final.locator('[data-verdict]')).toHaveText('확인 필요');
  await expect(final.locator('[data-reason="not_verified"]')).toBeVisible();
  await expect(page.getByTestId('citations')).toContainText('등록된 본거지, 차고지가 우도면이 아닌');
  await expect(page.getByTestId('penalties')).toContainText('과태료 10만원');
  await expect(page).toHaveURL(/mode=rental_car/);

  await page.getByRole('checkbox', { name: '우도면 안 숙박시설 이용' }).check();
  await expect(preliminary.locator('[data-verdict]')).toHaveText('반입 허용');
  await expect(preliminary).toContainText('P3');
  await expect(page.getByTestId('proof')).toContainText('신분증');

  await page.getByRole('checkbox', { name: '우도면 안 숙박시설 이용' }).uncheck();
  await page.getByRole('radio', { name: '전기', exact: true }).check();
  await expect(preliminary.locator('[data-verdict]')).toHaveText('제한 대상 아님');
  await expect(page).toHaveURL(/fuel=electric/);
});

test('방문 전 체크: 이동수단에 따라 필요한 칸만 보인다', async ({ page }) => {
  await page.goto('/check?date=2026-06-15');
  await page.getByRole('radio', { name: /전세버스/ }).check();
  await expect(page.getByLabel('승차정원')).toBeVisible();
  await expect(page.getByRole('radio', { name: '하이브리드' })).toBeHidden();
  await page.getByLabel('승차정원').fill('16');
  await page.getByLabel('승차정원').press('Enter');
  await expect(page.getByTestId('preliminary').locator('[data-verdict]')).toHaveText('제한 대상 아님');
  await expect(page).toHaveURL(/seats=16/);
  await expect(page).not.toHaveURL(/fuel=/);

  await page.getByRole('radio', { name: /우도에서 빌리는 이동수단/ }).check();
  await expect(page.getByLabel('승차정원')).toBeHidden();
  await page.getByRole('radio', { name: '전동킥보드 등 개인형 이동장치' }).check();
  await expect(page.getByTestId('preliminary')).toContainText('R2-나');
});

test('방문 전 체크: 오늘 날짜는 공고 기간 밖이라 이유와 연장 소식을 보인다', async ({ page }) => {
  await page.goto('/check?mode=rental_car&fuel=combustion&operator=outside&date=2026-11-23');
  await expect(page.getByTestId('preliminary')).toContainText('기간 밖이라 참고만');
  const reason = page.getByTestId('final').locator('[data-reason="outside_validity"]');
  await expect(reason).toContainText('2026-03-19~2026-07-31');
  await expect(reason).toContainText('N07');
  await expect(page.getByTestId('open-questions')).toContainText('2026-08-01 이후');
});

test('방문 전 체크: 자바스크립트 없이도 폼으로 판정한다', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/check?date=2026-06-15&mode=charter_bus&operator=outside');
  await page.getByLabel('승차정원').fill('45');
  await page.getByRole('button', { name: '판정 보기' }).click();
  await expect(page.getByTestId('preliminary').locator('[data-verdict]')).toHaveText('저촉');
  await expect(page.getByTestId('preliminary')).toContainText('45인승');
  await context.close();
});

test('방문 전 체크: 잘못된 값은 오류로 알린다', async ({ page }) => {
  await page.goto('/check?mode=charter_bus&seats=0');
  await expect(page.locator('form').getByRole('alert')).toContainText('1~100');
  await expect(page.getByTestId('result')).toHaveCount(0);
});

test('기획 점검: 위치를 모르면 전제가 붙고, 구역 밖이면 이 카드의 대상이 아니다', async ({ page }) => {
  await page.goto('/plan');
  await page.getByRole('radio', { name: /공원사업으로 숙박시설 설치/ }).check();
  await expect(page.getByTestId('preliminary').locator('[data-verdict]')).toHaveText('허가 대상 아님');
  await expect(page.getByTestId('premise')).toContainText('그 위치가 절대보전지역 안이라면');
  await expect(page.getByTestId('final').locator('[data-reason="area_unresolved"]')).toBeVisible();

  await page.getByRole('radio', { name: /지정 해수욕장/ }).check();
  await expect(page.getByTestId('preliminary').locator('[data-verdict]')).toHaveText('허가 대상');
  await expect(page.getByTestId('procedure')).toContainText('5일 이내');

  await page.getByRole('radio', { name: /구역 밖/ }).check();
  await expect(page.getByTestId('preliminary').locator('[data-verdict]')).toHaveText('제한 대상 아님');
  await expect(page.getByTestId('premise')).toHaveCount(0);
  await expect(page.getByTestId('procedure')).toHaveCount(0);
});

test('보고서: 독자별로 절이 다르고 인용 번호가 인용 목록으로 이어진다', async ({ page }) => {
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: '우도 지역 진단 보고서' })).toBeVisible();
  for (const title of ['1. 규제 현황', '2. 진단과 대응 방향', '3. 에코투어리즘 아이템 후보', '근거와 한계']) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  await expect(page.locator('[data-kind="measure"]').filter({ hasText: '근거 없음, 제안' }).first()).toBeVisible();
  await expect(page.getByTestId('idea-kickboard-rental')).toContainText('권하지 않음');

  const chip = page.locator('a[href^="#cite-"]').first();
  const target = await chip.getAttribute('href');
  await chip.click();
  await expect(page.locator(target!)).toBeInViewport();

  await page.getByRole('link', { name: '여행자' }).click();
  await expect(page.getByRole('heading', { name: '우도 방문 전 안내' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '방문 전 확인' })).toBeVisible();
  await expect(page.locator('[data-testid^="idea-"]')).toHaveCount(0);
});

test('규제 카드: 저장소의 카드를 모두 싣고, 상세 화면의 인용문 수가 API와 같다', async ({ page, request }) => {
  const { cards } = (await (await request.get('/api/cards')).json()) as { cards: { card_id: string; title: string; quote_count: number }[] };
  expect(cards.length).toBeGreaterThanOrEqual(2);
  await page.goto('/cards');
  await expect(page.getByTestId('card-list').getByRole('link')).toHaveCount(cards.length);
  for (const card of cards) {
    const response = await page.goto(`/cards/${card.card_id}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(card.title);
    await expect(page.getByTestId('quote-count')).toHaveText(`인용문 ${card.quote_count}개`);
    await expect(page.getByText('undefined')).toHaveCount(0);
  }
  await page.goto('/cards/udo-vehicle-restriction-2026-715');
  await expect(page.getByTestId('quote-count')).toHaveText('인용문 33개');
  await page.goto('/cards/jeju-absolute-conservation-area');
  await expect(page.getByText('관광·탐방 관련').first()).toBeVisible();
  await expect(page.getByText('우도면 최초 지정')).toBeVisible();
  const response = await page.goto('/cards/no-such-card');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '찾는 화면이 없습니다' })).toBeVisible();
});
