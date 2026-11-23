// 우도 차량 운행제한 카드의 판정 규칙. 정답은 docs/05 5절의 예시 표와 카드 문언에서 가져온다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkVisit, parseVisit, visitQuery, type VisitInput } from '../lib/checks/udo-visit';
import { fromJson, fromSearchParams } from '../lib/params';

const TODAY = '2026-11-23';
const BASE: VisitInput = {
  date: '2026-06-15',
  mode: 'rental_car',
  fuel: 'combustion',
  operator: 'outside',
  companions: [],
  stay: false,
  longTerm: false,
  approval: false,
};
const run = (over: Partial<VisitInput>) => checkVisit({ ...BASE, ...over }, TODAY);
const reasons = (over: Partial<VisitInput>) => run(over).final.reasons.map((r) => r.code);

describe('docs/05 5절 운행제한 카드 예시 표', () => {
  const rows: [string, Partial<VisitInput>, string, string[]][] = [
    ['본섬 업체의 휘발유 렌터카로 당일 방문', {}, '저촉', ['R1-다']],
    ['본섬 업체의 전기 렌터카로 당일 방문', { fuel: 'electric' }, '제한 대상 아님', ['R1-다 단서']],
    ['휘발유 렌터카, 우도 숙박시설 이용', { stay: true }, '반입 허용', ['R1-다', 'P3']],
    ['휘발유 렌터카, 6세 아동 동반', { companions: ['child7'] }, '반입 허용', ['R1-다', 'P1']],
    ['우도 안에서 빌린 전동킥보드', { mode: 'udo_rental', rental: 'pm' }, '저촉', ['R2-나']],
    ['15인승 전세버스', { mode: 'charter_bus', seats: 15 }, '확인 필요', ['R1-다', 'R1-다 단서']],
    ['본인 소유 승용차', { mode: 'own_car' }, '제한 대상 아님', []],
  ];

  for (const [label, over, value, items] of rows) {
    it(`${label} → ${value}`, () => {
      const result = run(over);
      assert.equal(result.preliminary.value, value);
      assert.deepEqual(result.preliminary.items, items);
      assert.equal(result.preliminary.reference_only, false);
    });
  }

  it('카드가 검수 전(extracted)이라 최종 판정은 모두 확인 필요', () => {
    for (const [, over] of rows) {
      const result = run(over);
      assert.equal(result.final.value, '확인 필요');
      assert.ok(result.final.reasons.some((r) => r.code === 'not_verified'));
    }
  });

  it('위의 어느 경우든 2026-11-22 방문은 공고 기간 밖이라 확인 필요', () => {
    for (const [, over] of rows) {
      const result = run({ ...over, date: '2026-11-22' });
      assert.equal(result.final.value, '확인 필요');
      assert.ok(result.final.reasons.some((r) => r.code === 'outside_validity'));
      assert.equal(result.preliminary.reference_only, true);
      assert.ok(result.open_questions.some((q) => q.includes('2026-08-01')), '연장 공고에 관한 열린 질문을 보여야 한다');
    }
  });

  it('기간 밖 이유에 보도만 있는 연장 소식(수집 대상 N07)을 붙인다', () => {
    const reason = run({ date: TODAY }).final.reasons.find((r) => r.code === 'outside_validity');
    assert.match(reason?.message ?? '', /^방문일\(2026-11-23\)/);
    assert.ok(reason?.detail?.includes('N07'));
    assert.ok(reason?.detail?.includes('보도'));
  });

  it('공고 기간 앞의 날짜도 기간 밖이다', () => {
    assert.ok(reasons({ date: '2026-03-18' }).includes('outside_validity'));
    assert.ok(!reasons({ date: '2026-03-19' }).includes('outside_validity'));
    assert.ok(!reasons({ date: '2026-07-31' }).includes('outside_validity'));
    assert.ok(reasons({ date: '2026-08-01' }).includes('outside_validity'));
  });
});

describe('문언의 경계', () => {
  it('승차정원 16인승 전세버스는 제외, 17인승 이상은 저촉, 16인승 미만은 확인 필요', () => {
    assert.equal(run({ mode: 'charter_bus', seats: 16 }).preliminary.value, '제한 대상 아님');
    assert.equal(run({ mode: 'charter_bus', seats: 17 }).preliminary.value, '저촉');
    assert.equal(run({ mode: 'charter_bus', seats: 45 }).preliminary.value, '저촉');
    const small = run({ mode: 'charter_bus', seats: 12 });
    assert.equal(small.preliminary.value, '확인 필요');
    assert.ok(small.open_questions.some((q) => q.includes('16인승')));
    assert.ok(small.final.reasons.some((r) => r.code === 'preliminary_unresolved'));
  });

  it('하이브리드는 제1종 저공해자동차 정의에 없어 저촉, 수소는 제외', () => {
    const hybrid = run({ fuel: 'hybrid' });
    assert.equal(hybrid.preliminary.value, '저촉');
    assert.match(hybrid.preliminary.summary, /하이브리드/);
    assert.equal(run({ fuel: 'hydrogen' }).preliminary.value, '제한 대상 아님');
  });

  it('우도면 업체 차량은 공고일 전후에 따라 달라 확인 필요(R1-가·R1-나)', () => {
    for (const mode of ['rental_car', 'charter_bus'] as const) {
      const result = run({ mode, operator: 'udo', seats: 45 });
      assert.equal(result.preliminary.value, '확인 필요');
      assert.deepEqual(result.preliminary.items, ['R1-가', 'R1-나']);
      assert.ok(result.open_questions.some((q) => q.includes('공고일')));
    }
  });

  it('업체 위치를 모르면 확인 필요. 우도면 업체에는 저공해 단서가 없으므로 전기차도 같다', () => {
    assert.equal(run({ operator: 'unknown' }).preliminary.value, '확인 필요');
    assert.equal(run({ operator: 'unknown', fuel: 'electric' }).preliminary.value, '확인 필요');
    assert.equal(run({ operator: 'udo', fuel: 'electric' }).preliminary.value, '확인 필요');
  });

  it('예외(P1~P4)에 해당하면 업체 위치와 관계없이 반입 허용', () => {
    for (const operator of ['outside', 'udo', 'unknown'] as const) {
      assert.equal(run({ operator, stay: true }).preliminary.value, '반입 허용');
    }
    assert.deepEqual(run({ longTerm: true }).preliminary.items, ['R1-다', 'P2']);
    assert.deepEqual(run({ approval: true }).preliminary.items, ['R1-다', 'P4']);
    assert.deepEqual(run({ companions: ['age65'], stay: true }).preliminary.items, ['R1-다', 'P1', 'P3']);
  });

  it('교통약자 본인 외에 동반 가족·보호자 인용도 붙는다(아동 동반은 별도 항목)', () => {
    const elderly = run({ companions: ['age65'] }).citations.map((c) => c.quote ?? '');
    assert.ok(elderly.some((q) => q.includes('65세 이상')));
    assert.ok(elderly.some((q) => q.includes('동반하는 가족')));
    const child = run({ companions: ['child7'] }).citations.map((c) => c.quote ?? '');
    assert.ok(child.some((q) => q.includes('7세 이하')));
    assert.ok(!child.some((q) => q.includes('동반하는 가족')));
  });

  it('우도 안 대여 이동수단', () => {
    const v = (rental: VisitInput['rental']) => run({ mode: 'udo_rental', rental }).preliminary;
    assert.deepEqual([v('bicycle').value, v('bicycle').items], ['제한 대상 아님', ['R2-나 단서']]);
    assert.equal(v('e_bicycle').value, '확인 필요');
    assert.equal(v('pm').value, '저촉');
    assert.deepEqual([v('moped').value, v('moped').items], ['저촉', ['R2-나']]);
    assert.deepEqual([v('e_motorcycle').value, v('e_motorcycle').items], ['제한 대상 아님', ['R2-다 단서']]);
    assert.deepEqual([v('motorcycle').value, v('motorcycle').items], ['확인 필요', ['R2-가', 'R2-다']]);
  });

  it('차 없이 들어가면 제한 대상 아님', () => {
    const result = run({ mode: 'no_vehicle' });
    assert.equal(result.preliminary.value, '제한 대상 아님');
    assert.match(result.preliminary.summary, /다른 규제는 확인하지 않았습니다/);
  });

  it('반입 허용에는 증빙을, 저촉에는 벌칙과 대안을 붙인다', () => {
    const allowed = run({ stay: true });
    assert.ok(allowed.proof?.quote);
    assert.equal(allowed.penalties.length, 0);
    const banned = run({});
    assert.equal(banned.proof, null);
    assert.deepEqual(
      banned.penalties.map((p) => p.id),
      ['X1', 'X2'],
    );
    assert.equal(banned.penalties[0].summary, '과태료 10만원');
    assert.deepEqual(
      banned.penalties[1].lines.map((l) => l.label),
      ['승합자동차 등: 5~9만원', '승용자동차 등: 4~8만원', '이륜자동차 등: 3~6만원'],
    );
    assert.deepEqual(
      banned.alternatives.map((a) => a.item_id),
      ['R1-다 단서', 'P3', 'P1'],
    );
  });
});

describe('입력 읽기', () => {
  it('이동수단이 없으면 판정하지 않고 방문일은 오늘로 채운다', () => {
    const parsed = parseVisit(fromSearchParams({}), TODAY);
    assert.equal(parsed.input, null);
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.values.date, TODAY);
  });

  it('없는 날짜, 보기에 없는 값, 승차정원 누락을 오류로 알린다', () => {
    assert.equal(parseVisit(fromSearchParams({ mode: 'own_car', date: '2026-02-30' }), TODAY).input, null);
    assert.match(parseVisit(fromSearchParams({ mode: 'plane' }), TODAY).errors.join(), /mode/);
    assert.match(parseVisit(fromSearchParams({ mode: 'charter_bus' }), TODAY).errors.join(), /승차정원/);
    assert.match(parseVisit(fromSearchParams({ mode: 'charter_bus', seats: '3.5' }), TODAY).errors.join(), /정수/);
    assert.match(parseVisit(fromSearchParams({ mode: 'udo_rental' }), TODAY).errors.join(), /이동수단/);
  });

  it('검색 매개변수와 JSON 본문을 같은 값으로 읽는다', () => {
    const query = parseVisit(
      fromSearchParams({ mode: 'rental_car', companion: ['age65', 'child7'], stay: '1', date: '2026-06-15' }),
      TODAY,
    ).input;
    const json = parseVisit(fromJson({ mode: 'rental_car', companion: ['age65', 'child7'], stay: true, date: '2026-06-15' }), TODAY).input;
    assert.deepEqual(query, json);
    assert.deepEqual(query?.companions, ['age65', 'child7']);
  });

  it('visitQuery로 만든 주소를 다시 읽으면 같은 입력이 된다', () => {
    const input: VisitInput = { ...BASE, companions: ['pregnant'], stay: true };
    const params = Object.fromEntries(new URLSearchParams(visitQuery(input)));
    const back = parseVisit(fromSearchParams({ ...params, companion: new URLSearchParams(visitQuery(input)).getAll('companion') }), TODAY);
    assert.deepEqual(back.input, { ...input, seats: undefined, rental: undefined });
  });
});
