// 최종 판정 규칙(docs/07 4.2절). 카드가 검수되면 "확인 필요"가 풀리는지도 본다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPlan } from '../lib/checks/conservation-plan';
import { checkVisit, type VisitInput } from '../lib/checks/udo-visit';
import { CONSERVATION_CARD_ID, requireCard, UDO_VEHICLE_CARD_ID } from '../lib/data';
import type { RegulationCard } from '../lib/types';
import { finalVerdict } from '../lib/verdict';

const TODAY = '2026-11-23';
const verified = (id: string, over: Partial<RegulationCard> = {}): RegulationCard => ({
  ...structuredClone(requireCard(id)),
  evidence_grade: 'verified',
  ...over,
});
const codes = (card: RegulationCard, value: Parameters<typeof finalVerdict>[1], ctx: Parameters<typeof finalVerdict>[2]) =>
  finalVerdict(card, value, ctx).reasons.map((r) => r.code);

describe('최종 판정을 "확인 필요"로 낮추는 조건', () => {
  it('검수 전 카드(extracted·candidate)', () => {
    assert.deepEqual(codes(verified(UDO_VEHICLE_CARD_ID, { evidence_grade: 'extracted' }), '저촉', { date: '2026-06-15' }), ['not_verified']);
    assert.deepEqual(codes(verified(UDO_VEHICLE_CARD_ID, { evidence_grade: 'candidate' }), '저촉', { date: '2026-06-15' }), ['not_verified']);
  });

  it('유효 기간 밖의 날짜', () => {
    const card = verified(UDO_VEHICLE_CARD_ID);
    assert.deepEqual(codes(card, '저촉', { date: '2026-08-01' }), ['outside_validity']);
    assert.deepEqual(codes(card, '저촉', { date: '2026-03-18' }), ['outside_validity']);
    assert.deepEqual(codes(card, '저촉', { date: '2026-06-15' }), []);
  });

  it('기간이 있는 카드는 날짜 안이면 시행 상태 표시(unconfirmed)를 그 날짜의 효력 문제로 보지 않는다', () => {
    const card = verified(UDO_VEHICLE_CARD_ID);
    assert.equal(card.enforcement_status, 'unconfirmed');
    assert.deepEqual(codes(card, '저촉', { date: '2026-06-15' }), []);
    assert.deepEqual(codes(card, '저촉', {}), ['status_unconfirmed']);
  });

  it('기간이 없는 카드는 시행 상태가 in_force가 아니면 확인 필요', () => {
    const card = verified(CONSERVATION_CARD_ID, { enforcement_status: 'discussed' });
    assert.deepEqual(codes(card, '허가 대상', { areaResolved: true }), ['status_unconfirmed']);
  });

  it('조문으로 지역을 정할 수 없는 카드는 위치를 확인했을 때만 판정한다', () => {
    const card = verified(CONSERVATION_CARD_ID);
    assert.deepEqual(codes(card, '허가 대상', {}), ['area_unresolved']);
    assert.deepEqual(codes(card, '허가 대상', { areaResolved: true }), []);
  });

  it('예비 판정이 확인 필요면 최종도 확인 필요', () => {
    assert.deepEqual(codes(verified(CONSERVATION_CARD_ID), '확인 필요', { areaResolved: true }), ['preliminary_unresolved']);
  });
});

describe('카드가 검수되면', () => {
  const base: VisitInput = {
    date: '2026-06-15',
    mode: 'rental_car',
    fuel: 'combustion',
    operator: 'outside',
    companions: [],
    stay: false,
    longTerm: false,
    approval: false,
  };

  it('운행제한: 기간 안의 날짜는 예비 판정이 그대로 최종 판정이 된다', () => {
    const card = verified(UDO_VEHICLE_CARD_ID);
    assert.equal(checkVisit(base, TODAY, card).final.value, '저촉');
    assert.equal(checkVisit({ ...base, stay: true }, TODAY, card).final.value, '반입 허용');
    assert.equal(checkVisit({ ...base, fuel: 'electric' }, TODAY, card).final.value, '제한 대상 아님');
    assert.equal(checkVisit({ ...base, date: TODAY }, TODAY, card).final.value, '확인 필요');
  });

  it('절대보전지역: 위치를 확인한 경우에만 예비 판정이 최종 판정이 된다', () => {
    const card = verified(CONSERVATION_CARD_ID);
    assert.equal(checkPlan({ activity: 'monitoring', actor: 'private', location: 'inside' }, TODAY, card).final.value, '허가 대상');
    assert.equal(checkPlan({ activity: 'monitoring', actor: 'private', location: 'unknown' }, TODAY, card).final.value, '확인 필요');
    assert.equal(checkPlan({ activity: 'park_lodging', actor: 'private', location: 'inside' }, TODAY, card).final.value, '허가 대상 아님');
  });
});
