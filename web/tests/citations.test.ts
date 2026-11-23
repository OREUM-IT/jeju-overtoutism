// 인용 검증(docs/02 6절)의 앱 쪽 시험.
// 판정과 보고서가 내놓는 인용문은 모두 카드에 글자 그대로 있어야 한다. 화면이 인용문을 지어내지 않는다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVITIES, ACTORS, LOCATIONS, checkPlan } from '../lib/checks/conservation-plan';
import { COMPANIONS, FUELS, OPERATORS, UDO_RENTALS, VISIT_MODES, checkVisit, type VisitInput } from '../lib/checks/udo-visit';
import { CARDS, requireCard } from '../lib/data';
import { collectQuotes } from '../lib/quotes';
import { AUDIENCES, buildReport } from '../lib/report';
import type { CheckResult, Citation } from '../lib/verdict';

const TODAY = '2026-11-23';
const quotesOf = new Map(CARDS.map((card) => [card.card_id, new Set(collectQuotes(card))]));

function assertCitation(c: Citation, where: string) {
  const known = quotesOf.get(c.card_id);
  assert.ok(known, `${where}: 없는 카드 ${c.card_id}`);
  if (c.quote !== null) assert.ok(known.has(c.quote), `${where}: 카드에 없는 인용문 "${c.quote}" (${c.item_id})`);
  assert.ok(c.document.length > 0, `${where}: 원문 이름이 없다`);
}

function assertResult(result: CheckResult, where: string) {
  for (const c of result.citations) assertCitation(c, where);
  const cited = new Set(result.citations.map((c) => c.item_id));
  for (const item of result.preliminary.items) assert.ok(cited.has(item), `${where}: 판정 근거 ${item}의 인용이 없다`);
  if (result.proof?.quote) assert.ok(quotesOf.get(result.card.card_id)?.has(result.proof.quote), `${where}: 증빙 인용문`);
  for (const step of result.procedure?.steps ?? []) {
    if (step.quote) assert.ok(quotesOf.get(result.card.card_id)?.has(step.quote), `${where}: 절차 인용문`);
  }
  for (const q of result.open_questions) assert.ok(requireCard(result.card.card_id).open_questions?.includes(q), `${where}: 카드에 없는 열린 질문`);
}

function* visitInputs(): Generator<VisitInput> {
  const subsets: VisitInput['companions'][] = [[], ['child7'], ['age65'], COMPANIONS.map((c) => c.value)];
  for (const date of ['2026-06-15', TODAY]) {
    for (const mode of VISIT_MODES.map((m) => m.value)) {
      for (const fuel of FUELS.map((f) => f.value)) {
        for (const operator of OPERATORS.map((o) => o.value)) {
          for (const seats of [12, 16, 45]) {
            for (const rental of UDO_RENTALS.map((r) => r.value)) {
              for (const companions of subsets) {
                for (const flags of [0, 1, 2, 4, 7]) {
                  yield { date, mode, fuel, operator, seats, rental, companions, stay: Boolean(flags & 1), longTerm: Boolean(flags & 2), approval: Boolean(flags & 4) };
                }
              }
            }
          }
        }
      }
    }
  }
}

describe('판정의 인용', () => {
  it('방문 전 체크의 모든 조합에서 인용문이 카드에 있다', () => {
    let count = 0;
    for (const input of visitInputs()) {
      assertResult(checkVisit(input, TODAY), JSON.stringify(input));
      count += 1;
    }
    assert.ok(count > 10000);
  });

  it('기획 점검의 모든 조합에서 인용문이 카드에 있다', () => {
    for (const activity of ACTIVITIES) {
      for (const actor of ACTORS) {
        for (const location of LOCATIONS) {
          const input = { activity: activity.value, actor: actor.value, location: location.value };
          assertResult(checkPlan(input, TODAY), JSON.stringify(input));
        }
      }
    }
  });

  it('카드 인용문을 바꾸면 시험이 잡아낸다', () => {
    const result = checkVisit(
      { date: '2026-06-15', mode: 'charter_bus', fuel: 'combustion', operator: 'outside', seats: 45, companions: [], stay: false, longTerm: false, approval: false },
      TODAY,
    );
    const tampered = { ...result, citations: result.citations.map((c) => ({ ...c, quote: c.quote?.replace('16인승', '6인승 이하') ?? null })) };
    assert.throws(() => assertResult(tampered, '변조'), /카드에 없는 인용문/);
  });
});

describe('보고서', () => {
  for (const audience of AUDIENCES.map((a) => a.value)) {
    describe(audience, () => {
      const report = buildReport(audience, TODAY);

      it('모든 인용문이 카드에 있다', () => {
        for (const c of report.citations) assertCitation(c, `${audience} 보고서`);
        for (const section of report.sections) {
          for (const idea of section.ideas) assertResult(idea.check, `${audience} ${idea.id}`);
        }
      });

      it('사실 서술은 근거 인용이나 수집 대상 항목을 가진다(근거와 한계 절 제외)', () => {
        for (const section of report.sections.filter((s) => s.id !== 'evidence')) {
          for (const st of section.statements.filter((s) => s.kind === 'fact')) {
            assert.ok(st.basis.length + st.source_refs.length > 0, `근거 없는 사실 서술: ${st.text}`);
          }
        }
      });

      it('정보 기준일과 법률 자문이 아니라는 안내가 있다', () => {
        assert.ok(report.as_of.source_retrieved_at);
        assert.match(report.disclaimer, /법률 자문이 아니다/);
      });
    });
  }

  it('정책 보고서는 문서 01의 네 절을 갖고, 대응 방향은 근거 있는 제안과 근거 없는 제안을 나눈다', () => {
    const report = buildReport('policy', TODAY);
    assert.deepEqual(
      report.sections.map((s) => s.id),
      ['status', 'diagnosis', 'planning', 'evidence'],
    );
    const measures = report.sections.find((s) => s.id === 'diagnosis')?.statements.filter((s) => s.kind === 'measure') ?? [];
    assert.ok(measures.some((m) => m.basis.length > 0));
    assert.ok(measures.some((m) => m.basis.length === 0));
  });

  it('보도만 있는 연장 소식은 확인 필요로 적고, 날짜는 수집 대상 목록에서 가져온다', () => {
    const report = buildReport('policy', TODAY);
    const st = report.sections.flatMap((s) => s.statements).find((s) => s.source_refs.includes('N07'));
    assert.equal(st?.kind, 'unknown');
    assert.match(st?.text ?? '', /2029-07-31/);
    assert.match(st?.text ?? '', /단정하지 않는다/);
  });

  it('부하 지표가 없으므로 혼잡·효과 수치를 쓰지 않는다고 밝힌다', () => {
    const texts = buildReport('policy', TODAY).sections.flatMap((s) => s.statements.map((st) => st.text));
    assert.ok(texts.some((t) => t.includes('부하 지표') && t.includes('수치로 쓰지 않는다')));
    assert.ok(!texts.some((t) => /\d+\s*(명|%|퍼센트)/.test(t)), '방문객 수나 비율을 쓰면 안 된다');
  });

  it('여행자 안내에는 아이템 후보 없이 방문 전 확인과 근거만 있다', () => {
    const report = buildReport('traveler', TODAY);
    assert.deepEqual(
      report.sections.map((s) => s.id),
      ['before-visit', 'evidence'],
    );
    assert.equal(report.sections.flatMap((s) => s.ideas).length, 0);
  });
});
