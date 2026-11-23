// ② 기획 점검: 절대보전지역 카드(제주특별법 제355조 등 + 보전지역 관리 조례)로 기획안을 판정한다.
// 판정은 docs/05 6절의 예시를 규칙으로 옮긴 것이다. 위치는 조문으로 정할 수 없으므로
// 사용자가 확인했다고 입력하지 않으면 "그 위치가 절대보전지역 안이라면"이라는 전제를 붙인다.

import { CONSERVATION_CARD_ID, getCard, getSource, RELATIVE_CONSERVATION_CARD_ID, requireCard } from '../data';
import { itemNo } from '../format';
import { first, labelOf, pick, type Option, type ParamGetter } from '../params';
import type { OrdinanceItem, PermitException, RegulationCard } from '../types';
import {
  asOf,
  cardRef,
  citation,
  disclaimer,
  documentFor,
  finalVerdict,
  openQuestions,
  penaltyViews,
  uniqueCitations,
  type CheckResult,
  type Citation,
  type VerdictValue,
} from '../verdict';

export const ACTIVITIES = [
  { value: 'trail', label: '산책로·탐방로 설치', hint: '시설 설치' },
  { value: 'deck', label: '탐방 데크·전망대 설치', hint: '시설 설치' },
  { value: 'monitoring', label: '학술 조사를 겸한 생태 모니터링', hint: '조사·연구' },
  { value: 'guided_program', label: '시설 없는 해설 탐방 프로그램', hint: '프로그램' },
  { value: 'beach_kiosk', label: '지정 해수욕장 안 개장기 임시 매점', hint: '가설건축물' },
  { value: 'park_lodging', label: '공원사업으로 숙박시설 설치', hint: '건축' },
  { value: 'coastal_building', label: '해안(공유수면)에 화장실·샤워실 외 건축물', hint: '건축' },
] as const satisfies readonly (Option<string> & { hint: string })[];
export type Activity = (typeof ACTIVITIES)[number]['value'];

export const ACTORS = [
  { value: 'private', label: '민간 사업자·단체' },
  { value: 'public', label: '국가·제주자치도' },
] as const satisfies readonly Option<string>[];
export type Actor = (typeof ACTORS)[number]['value'];

export const LOCATIONS = [
  { value: 'unknown', label: '모름', hint: '확인 전' },
  { value: 'inside', label: '구역 안', hint: '고시로 확인' },
  { value: 'outside', label: '구역 밖', hint: '고시로 확인' },
] as const satisfies readonly (Option<string> & { hint: string })[];
export type Location = (typeof LOCATIONS)[number]['value'];

export interface PlanInput {
  activity: Activity;
  actor: Actor;
  location: Location;
}

export function parsePlan(get: ParamGetter) {
  const errors: string[] = [];
  const activity = pick(ACTIVITIES, first(get, 'activity'), '기획 유형(activity)', errors);
  const actor = pick(ACTORS, first(get, 'actor'), '시행 주체(actor)', errors, 'private') ?? 'private';
  const location = pick(LOCATIONS, first(get, 'location'), '위치(location)', errors, 'unknown') ?? 'unknown';
  const values = { activity: activity ?? ('' as const), actor, location };
  const input: PlanInput | null = activity && errors.length === 0 ? { activity, actor, location } : null;
  return { values, input, errors };
}

export function planQuery(input: Partial<PlanInput>): string {
  const q = new URLSearchParams();
  if (input.activity) q.set('activity', input.activity);
  if (input.actor) q.set('actor', input.actor);
  if (input.location) q.set('location', input.location);
  return q.toString();
}

// ── 카드 항목 찾기 ─────────────────────────────────────────────

function exception(card: RegulationCard, id: string): PermitException {
  const e = card.permit_exceptions?.items.find((item) => item.id === id);
  if (!e) throw new Error(`${card.card_id}: 허가 예외 ${id}가 없습니다`);
  return e;
}

function ordinanceItem(card: RegulationCard, no: string): { item: OrdinanceItem; src?: string } {
  const detail = exception(card, 'E5').detail;
  const item = detail?.items.find((i) => i.no === no);
  if (!item) throw new Error(`${card.card_id}: 조례 제6조 ${no}호가 없습니다`);
  return { item, src: detail?.src };
}

const cite = {
  ban(card: RegulationCard): Citation {
    const r = card.restricted?.find((item) => item.id === 'R1');
    if (!r) throw new Error(`${card.card_id}: 제한 항목 R1이 없습니다`);
    return citation(card, 'R1', r.scope, r.quote, r.locator);
  },
  permitClause(card: RegulationCard): Citation {
    const pe = card.permit_exceptions;
    return citation(card, '허가 단서', pe?.summary ?? '도지사의 허가를 받으면 할 수 있다', pe?.quote, pe?.locator);
  },
  exception(card: RegulationCard, id: string): Citation {
    const e = exception(card, id);
    return citation(card, id, e.summary, e.quote, e.locator);
  },
  ordinance(card: RegulationCard, no: string): Citation {
    const { item, src } = ordinanceItem(card, no);
    const id = `조례 제6조${itemNo(no)}`;
    return citation(card, id, item.summary, item.quote, id, src);
  },
  ordinancePeriod(card: RegulationCard, no: string): Citation {
    const { item, src } = ordinanceItem(card, no);
    const id = `조례 제6조${itemNo(no)}`;
    if (!item.period) throw new Error(`${card.card_id}: 조례 제6조 ${no}호에 기간이 없습니다`);
    return citation(card, `${id} 기간`, item.period.summary, item.period.quote, id, src);
  },
};

// ── 판정 ─────────────────────────────────────────────────────

interface Branch {
  value: VerdictValue;
  summary: string;
  items: string[];
  citations: Citation[];
  questions?: string[];
  permit?: boolean;
  facility?: boolean;
}

const NOT_PERMITTABLE_NOTE = '그 호로는 허가를 받을 수 없다는 뜻입니다. 다른 호나 다른 법령으로 가능한지는 따로 봐야 합니다.';

function planBranch(card: RegulationCard, input: PlanInput): Branch {
  if (input.location === 'outside') {
    return {
      value: '제한 대상 아님',
      items: [],
      summary:
        '절대보전지역 밖이라면 이 카드의 행위제한(제355조제3항)은 적용되지 않습니다. 상대·관리보전지역, 도립공원, 천연기념물 같은 다른 규제는 보지 않았습니다.',
      citations: [cite.ban(card)],
    };
  }

  switch (input.activity) {
    case 'trail':
      if (input.actor === 'public') {
        return {
          value: '허가 대상',
          items: ['E1'],
          summary: '국가 또는 제주자치도가 시행하는 등산로·산책로 설치는 도지사의 허가를 받으면 할 수 있습니다(E1).',
          citations: [cite.ban(card), cite.permitClause(card), cite.exception(card, 'E1')],
          questions: ['판단 기준'],
          permit: true,
          facility: true,
        };
      }
      return privateFacility(card, '산책로·탐방로');
    case 'deck':
      if (input.actor === 'public') {
        return {
          value: '확인 필요',
          items: ['E1', '조례 제6조제11호'],
          summary:
            'E1은 국가 또는 제주자치도가 시행하는 등산로, 산책로, 정자, 공원시설 등의 설치입니다. 탐방 데크·전망대가 그 시설에 드는지는 문언만으로 정하지 않습니다. 조례 제6조제11호(자연환경보전·이용시설)도 함께 봐야 합니다.',
          citations: [cite.ban(card), cite.permitClause(card), cite.exception(card, 'E1'), cite.ordinance(card, '11')],
          questions: ['인용하는 개별 법령'],
          permit: true,
          facility: true,
        };
      }
      return privateFacility(card, '탐방 데크·전망대');
    case 'monitoring':
      return {
        value: '허가 대상',
        items: ['E3'],
        summary: '학술적 조사·연구를 목적으로 하는 행위는 도지사의 허가를 받으면 할 수 있습니다(E3).',
        citations: [cite.ban(card), cite.permitClause(card), cite.exception(card, 'E3')],
        questions: ['판단 기준'],
        permit: true,
      };
    case 'guided_program':
      return {
        value: '확인 필요',
        items: ['R1'],
        summary:
          '조례 제6조의 39개 호는 모두 시설 설치나 사업 시행에 관한 것으로 읽었습니다. 시설을 설치하지 않는 탐방·해설 프로그램을 직접 다루는 호는 찾지 못했고, 제355조제3항의 "이와 유사한 행위"에 드는지도 문언만으로 판단하지 않습니다. 소관 부서 확인이 필요합니다.',
        citations: [cite.ban(card)],
        questions: ['유사한 행위', '탐방·해설'],
      };
    case 'beach_kiosk':
      return {
        value: '허가 대상',
        items: ['조례 제6조제27호'],
        summary:
          '지정 해수욕장 구역 안에서 개장 전 10일부터 폐장 후 10일까지 음식점·소매점용 가설건축물을 두는 것은 도지사의 허가를 받으면 할 수 있습니다(조례 제6조제27호).',
        citations: [cite.ban(card), cite.permitClause(card), cite.ordinance(card, '27'), cite.ordinancePeriod(card, '27')],
        questions: ['판단 기준', '인용하는 개별 법령'],
        permit: true,
        facility: true,
      };
    case 'park_lodging':
      return {
        value: '허가 대상 아님',
        items: ['조례 제6조제7호'],
        summary: `공원조성계획에 따른 공원사업은 허가 대상이지만 숙박시설은 제외됩니다(조례 제6조제7호 단서). ${NOT_PERMITTABLE_NOTE}`,
        citations: [cite.ban(card), cite.ordinance(card, '7')],
        facility: true,
      };
    case 'coastal_building':
    default:
      return {
        value: '허가 대상 아님',
        items: ['조례 제6조제33호'],
        summary: `공유수면의 점용·사용허가를 받은 행위는 허가 대상이지만 화장실·샤워실 외의 건축물은 제외됩니다(조례 제6조제33호 단서). ${NOT_PERMITTABLE_NOTE}`,
        citations: [cite.ban(card), cite.ordinance(card, '33')],
        facility: true,
      };
  }
}

function privateFacility(card: RegulationCard, what: string): Branch {
  return {
    value: '확인 필요',
    items: ['E1', '조례 제6조제11호', '조례 제6조제18호'],
    summary: `법률 E1은 국가 또는 제주자치도가 시행하는 경우입니다. 민간이 ${what}를 설치하는 것은 조례 제6조제11호(자연환경보전·이용시설)나 제18호(숲길 등)에 해당하면 허가 대상일 수 있으나, 그 호가 인용하는 법령에서 누가 설치할 수 있는지는 읽지 않았습니다.`,
    citations: [
      cite.ban(card),
      cite.permitClause(card),
      cite.exception(card, 'E1'),
      cite.ordinance(card, '11'),
      cite.ordinance(card, '18'),
    ],
    questions: ['인용하는 개별 법령'],
    permit: true,
    facility: true,
  };
}

/** 우도 기획에서 함께 볼 규제. 작성자가 고른 것이며 이 화면에서는 판정하지 않는다. */
function relatedSources(activity: Activity): CheckResult['related'] {
  const cards: CheckResult['related'] = [];
  const relative = getCard(RELATIVE_CONSERVATION_CARD_ID);
  if (relative) {
    const area = relative.target_area?.designated_areas?.udo?.relative_m2;
    cards.push({
      id: relative.card_id,
      name: relative.title,
      check_status: relative.evidence_grade,
      note: `상대보전지역${typeof area === 'number' ? `(우도면 ${area.toLocaleString('ko-KR')}㎡)` : ''}은 허가 범위가 다르다. 이 화면은 절대보전지역 카드로만 판정한다`,
      href: `/cards/${relative.card_id}`,
    });
  }
  const ids = ['N02', 'N03'];
  if (activity === 'beach_kiosk' || activity === 'coastal_building') ids.push('L17');
  const sources = ids
    .map((id) => getSource(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({ id: row.id, name: row.name, check_status: row.check_status, note: row.udo_relevance }));
  return [...cards, ...sources];
}

export function checkPlan(input: PlanInput, today: string, card: RegulationCard = requireCard(CONSERVATION_CARD_ID)): CheckResult {
  const branch = planBranch(card, input);
  const final = finalVerdict(card, branch.value, { areaResolved: input.location !== 'unknown' });
  const inArea = input.location !== 'outside';
  const pp = card.permit_procedure;

  const notes: string[] = [];
  if (input.location !== 'unknown') notes.push('위치는 입력한 값을 따랐습니다. 구역 데이터로 확인하지 않았습니다.');
  if (inArea && branch.facility && card.grandfathering?.summary) {
    notes.push(`${card.grandfathering.summary}(${card.grandfathering.locator ?? '근거 위치 없음'}).`);
  }

  const keywords = [...(branch.questions ?? []), ...(inArea ? ['필지', '우도에 절대보전지역'] : [])];

  return {
    kind: 'conservation-plan',
    card: cardRef(card),
    preliminary: { value: branch.value, summary: branch.summary, items: branch.items, reference_only: false },
    final,
    premise: input.location === 'unknown' ? '그 위치가 절대보전지역 안이라면' : null,
    citations: uniqueCitations(branch.citations),
    alternatives: [],
    proof: null,
    procedure:
      inArea && branch.permit && pp
        ? {
            authority: card.permit_exceptions?.permit_authority ?? null,
            steps: [
              pp.application && { label: '신청', summary: pp.application.summary, quote: pp.application.quote ?? null },
              pp.processing && { label: '처리', summary: pp.processing.summary, quote: pp.processing.quote ?? null },
              pp.refusal && { label: '불허가', summary: pp.refusal.summary, quote: pp.refusal.quote ?? null },
            ].filter((step): step is { label: string; summary: string; quote: string | null } => Boolean(step)),
            locator: pp.locator ?? null,
            document: documentFor(card, pp.src),
          }
        : null,
    penalties: inArea ? penaltyViews(card) : [],
    open_questions: openQuestions(card, keywords),
    notes,
    related: inArea ? relatedSources(input.activity) : [],
    as_of: asOf(card, today),
    disclaimer: disclaimer(card),
  };
}

export function activityLabel(value: Activity): string {
  return labelOf(ACTIVITIES, value);
}

/** 보고서(lib/report.ts)가 같은 인용을 쓰도록 내보낸다. */
export { cite as conservationCite };
