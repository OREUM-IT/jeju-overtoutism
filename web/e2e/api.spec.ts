import { expect, test } from '@playwright/test';

test('POST /api/check/visit', async ({ request }) => {
  const ok = await request.post('/api/check/visit', {
    data: { date: '2026-06-15', mode: 'rental_car', fuel: 'combustion', operator: 'outside', companion: ['child7'] },
  });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.preliminary.value).toBe('반입 허용');
  expect(body.preliminary.items).toEqual(['R1-다', 'P1']);
  expect(body.final.value).toBe('확인 필요');
  expect(body.as_of.card_extracted_at).toBe('2026-11-22');

  const bad = await request.post('/api/check/visit', { data: { mode: 'charter_bus' } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).messages.join()).toContain('승차정원');

  const missing = await request.post('/api/check/visit', { data: {} });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).messages[0]).toContain('mode');
});

test('POST /api/check/plan', async ({ request }) => {
  const res = await request.post('/api/check/plan', { data: { activity: 'monitoring', actor: 'private', location: 'unknown' } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.preliminary.value).toBe('허가 대상');
  expect(body.premise).toBe('그 위치가 절대보전지역 안이라면');
  expect(body.final.reasons.map((r: { code: string }) => r.code)).toEqual(['not_verified', 'area_unresolved']);
});

test('GET /api/cards, /api/cards/{id}, /api/report', async ({ request }) => {
  const list = await (await request.get('/api/cards')).json();
  expect(list.cards.map((c: { card_id: string }) => c.card_id).sort()).toEqual([
    'jeju-absolute-conservation-area',
    'udo-vehicle-restriction-2026-715',
  ]);
  const card = await request.get('/api/cards/udo-vehicle-restriction-2026-715');
  expect((await card.json()).schema_version).toBe('0.1-draft');
  expect((await request.get('/api/cards/nope')).status()).toBe(404);

  const report = await (await request.get('/api/report?area=우도&audience=business')).json();
  expect(report.title).toBe('우도 에코투어리즘 기획 점검표');
  expect(report.citations.length).toBeGreaterThan(0);
  expect((await request.get('/api/report?area=서귀포')).status()).toBe(400);
});
