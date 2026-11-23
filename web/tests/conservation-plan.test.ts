// 절대보전지역 카드의 기획 점검 규칙. 정답은 docs/05 5절의 예시 표에서 가져온다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVITIES, ACTORS, checkPlan, parsePlan, type PlanInput } from '../lib/checks/conservation-plan';
import { fromSearchParams } from '../lib/params';

const TODAY = '2026-11-23';
const run = (over: Partial<PlanInput>) => checkPlan({ activity: 'guided_program', actor: 'private', location: 'unknown', ...over }, TODAY);

describe('docs/05 5절 절대보전지역 카드 예시 표', () => {
  const rows: [string, Partial<PlanInput>, string, string[]][] = [
    ['제주자치도가 산책로를 설치', { activity: 'trail', actor: 'public' }, '허가 대상', ['E1']],
    ['학술 조사를 겸한 생태 모니터링', { activity: 'monitoring' }, '허가 대상', ['E3']],
    ['민간 사업자가 탐방 데크와 전망대를 설치', { activity: 'deck', actor: 'private' }, '확인 필요', ['E1', '조례 제6조제11호', '조례 제6조제18호']],
    ['공원사업으로 숙박시설을 설치', { activity: 'park_lodging' }, '허가 대상 아님', ['조례 제6조제7호']],
    ['지정 해수욕장 구역 안의 개장기 임시 매점', { activity: 'beach_kiosk' }, '허가 대상', ['조례 제6조제27호']],
    ['해안에 화장실·샤워실 외의 건축물', { activity: 'coastal_building' }, '허가 대상 아님', ['조례 제6조제33호']],
    ['시설을 설치하지 않는 해설 탐방 프로그램', { activity: 'guided_program' }, '확인 필요', ['R1']],
  ];

  for (const [label, over, value, items] of rows) {
    it(`${label} → ${value}`, () => {
      const result = run(over);
      assert.equal(result.preliminary.value, value);
      assert.deepEqual(result.preliminary.items, items);
    });
  }

  it('위치를 모르면 모든 판정에 "그 위치가 절대보전지역 안이라면" 전제를 붙이고 최종은 확인 필요', () => {
    for (const [, over] of rows) {
      const result = run({ ...over, location: 'unknown' });
      assert.equal(result.premise, '그 위치가 절대보전지역 안이라면');
      assert.equal(result.final.value, '확인 필요');
      assert.ok(result.final.reasons.some((r) => r.code === 'area_unresolved'));
    }
  });
});

describe('위치와 절차', () => {
  it('구역 안이라고 확인했으면 전제와 지역 이유가 빠지고, 위치는 입력값이라고 적는다', () => {
    const result = run({ activity: 'monitoring', location: 'inside' });
    assert.equal(result.premise, null);
    assert.ok(!result.final.reasons.some((r) => r.code === 'area_unresolved'));
    assert.ok(result.notes.some((n) => n.includes('입력한 값')));
  });

  it('구역 밖이면 이 카드의 제한 대상이 아니며 절차·벌칙을 붙이지 않는다', () => {
    const result = run({ activity: 'park_lodging', location: 'outside' });
    assert.equal(result.preliminary.value, '제한 대상 아님');
    assert.match(result.preliminary.summary, /다른 규제는 보지 않았습니다/);
    assert.equal(result.procedure, null);
    assert.equal(result.penalties.length, 0);
    assert.equal(result.related.length, 0);
  });

  it('허가 대상에는 조례 제8조의 신청·처리(5일)·불허가 절차를 붙인다', () => {
    const procedure = run({ activity: 'beach_kiosk', location: 'inside' }).procedure;
    assert.deepEqual(
      procedure?.steps.map((s) => s.label),
      ['신청', '처리', '불허가'],
    );
    assert.match(procedure?.steps[1].summary ?? '', /5일/);
    assert.equal(procedure?.authority, '도지사');
    assert.match(procedure?.document ?? '', /조례/);
  });

  it('허가 대상 아님에는 허가 절차를 붙이지 않고 벌칙(형벌·원상회복)을 붙인다', () => {
    const result = run({ activity: 'coastal_building' });
    assert.equal(result.procedure, null);
    assert.deepEqual(
      result.penalties.map((p) => p.id),
      ['X1', 'X2'],
    );
    assert.match(result.penalties[0].summary, /2년 이하의 징역/);
  });

  it('해설 탐방 프로그램은 "이와 유사한 행위"와 탐방·해설에 관한 열린 질문을 보여 준다', () => {
    const questions = run({ activity: 'guided_program' }).open_questions;
    assert.ok(questions.some((q) => q.includes('유사한 행위')));
    assert.ok(questions.some((q) => q.includes('탐방·해설')));
  });

  it('해수욕장·해안 기획에는 공유수면법(L17)을 함께 볼 규제로 보인다', () => {
    assert.ok(run({ activity: 'beach_kiosk' }).related.some((r) => r.id === 'L17'));
    assert.ok(!run({ activity: 'monitoring' }).related.some((r) => r.id === 'L17'));
    assert.ok(run({ activity: 'monitoring' }).related.some((r) => r.id === 'N03'));
  });

  it('국가·도의 데크·전망대도 E1 문언에 데크가 없어 확인 필요', () => {
    assert.equal(run({ activity: 'deck', actor: 'public' }).preliminary.value, '확인 필요');
  });

  it('모든 조합이 판정을 낸다', () => {
    for (const activity of ACTIVITIES) {
      for (const actor of ACTORS) {
        for (const location of ['unknown', 'inside', 'outside'] as const) {
          const result = run({ activity: activity.value, actor: actor.value, location });
          assert.ok(result.preliminary.summary.length > 0);
        }
      }
    }
  });
});

describe('입력 읽기', () => {
  it('기획 유형이 없으면 판정하지 않고 주체·위치는 기본값(민간·모름)', () => {
    const parsed = parsePlan(fromSearchParams({}));
    assert.equal(parsed.input, null);
    assert.equal(parsed.values.actor, 'private');
    assert.equal(parsed.values.location, 'unknown');
  });

  it('보기에 없는 값은 오류', () => {
    assert.match(parsePlan(fromSearchParams({ activity: 'casino' })).errors.join(), /activity/);
  });
});
