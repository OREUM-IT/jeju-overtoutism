// ① 방문 전 체크: 우도 차량 운행제한 카드(공고 제2026-715호)로 방문 조건을 판정한다.
// 판정은 카드 문언에서 바로 나오는 것만 내린다. 문언으로 정할 수 없으면 "확인 필요"다.

import { getSource, requireCard, UDO_VEHICLE_CARD_ID } from '../data';
import { isIsoDate } from '../format';
import { all, first, flag, labelOf, pick, type Option, type ParamGetter } from '../params';
import type { RegulationCard, RestrictedCondition, RestrictedItem } from '../types';
import {
  asOf,
  cardRef,
  citation,
  disclaimer,
  finalVerdict,
  openQuestions,
  penaltyViews,
  uniqueCitations,
  type CheckResult,
  type Citation,
  type VerdictValue,
} from '../verdict';

export const VISIT_MODES = [
  { value: 'rental_car', label: '렌터카', hint: '자동차 대여사업용 자동차' },
  { value: 'charter_bus', label: '전세버스', hint: '전세버스 운송사업용 자동차' },
  { value: 'own_car', label: '내 차', hint: '본인 소유 자가용' },
  { value: 'udo_rental', label: '우도에서 빌리는 이동수단', hint: '킥보드·스쿠터·자전거 등' },
  { value: 'no_vehicle', label: '차 없이 들어가기', hint: '걷기·도항선만' },
] as const satisfies readonly (Option<string> & { hint: string })[];
export type VisitMode = (typeof VISIT_MODES)[number]['value'];

export const FUELS = [
  { value: 'combustion', label: '내연기관', hint: '휘발유·경유·LPG' },
  { value: 'hybrid', label: '하이브리드' },
  { value: 'electric', label: '전기' },
  { value: 'hydrogen', label: '수소' },
] as const satisfies readonly (Option<string> & { hint?: string })[];
export type Fuel = (typeof FUELS)[number]['value'];

export const OPERATORS = [
  { value: 'outside', label: '우도 밖', hint: '제주 본섬 등' },
  { value: 'udo', label: '우도면', hint: '우도에 차고지' },
  { value: 'unknown', label: '모름', hint: '업체에 확인 전' },
] as const satisfies readonly (Option<string> & { hint: string })[];
export type Operator = (typeof OPERATORS)[number]['value'];

export const UDO_RENTALS = [
  { value: 'bicycle', label: '자전거' },
  { value: 'e_bicycle', label: '전기자전거' },
  { value: 'pm', label: '전동킥보드 등 개인형 이동장치' },
  { value: 'moped', label: '원동기장치자전거(소형 스쿠터 등)' },
  { value: 'e_motorcycle', label: '전기 이륜자동차(사용신고함)' },
  { value: 'motorcycle', label: '그 밖의 이륜자동차' },
] as const satisfies readonly Option<string>[];
export type UdoRental = (typeof UDO_RENTALS)[number]['value'];

/** P1(교통약자)의 who 항목. keyword로 카드의 인용문을 찾는다. */
export const COMPANIONS = [
  { value: 'age65', label: '65세 이상', keyword: '65세 이상' },
  { value: 'child7', label: '7세 이하 취학 전 아동', keyword: '7세 이하' },
  { value: 'pregnant', label: '임신부', keyword: '임신부' },
  { value: 'severe_disability', label: '장애의 정도가 심한 장애인', keyword: '장애의 정도가 심한' },
  { value: 'wheelchair', label: '일시적으로 휠체어를 이용하는 사람', keyword: '휠체어' },
] as const satisfies readonly (Option<string> & { keyword: string })[];
export type Companion = (typeof COMPANIONS)[number]['value'];

export interface VisitInput {
  date: string;
  mode: VisitMode;
  fuel: Fuel;
  operator: Operator;
  seats?: number;
  rental?: UdoRental;
  companions: Companion[];
  /** P3: 우도면 내 숙박시설 이용 */
  stay: boolean;
  /** P2: 제주도민·우도면 사업장 등록자의 6개월 이상 장기 대여 */
  longTerm: boolean;
  /** P4: 도지사(또는 시장)의 승인 */
  approval: boolean;
}

export interface VisitValues extends Omit<VisitInput, 'mode' | 'seats' | 'rental'> {
  mode: VisitMode | '';
  seats: string;
  rental: UdoRental | '';
}

export function parseVisit(get: ParamGetter, today: string) {
  const errors: string[] = [];
  const rawDate = first(get, 'date');
  const date = rawDate ? rawDate : today;
  if (!isIsoDate(date)) errors.push('방문일은 YYYY-MM-DD 형식의 실제 날짜로 입력하세요.');

  const mode = pick(VISIT_MODES, first(get, 'mode'), '이동수단(mode)', errors);
  const fuel = pick(FUELS, first(get, 'fuel'), '연료(fuel)', errors, 'combustion') ?? 'combustion';
  const operator = pick(OPERATORS, first(get, 'operator'), '업체 위치(operator)', errors, 'outside') ?? 'outside';
  const rental = pick(UDO_RENTALS, first(get, 'rental'), '우도 대여 이동수단(rental)', errors);
  const companions: Companion[] = [];
  for (const raw of all(get, 'companion')) {
    const value = pick(COMPANIONS, raw, '동행(companion)', errors);
    if (value && !companions.includes(value)) companions.push(value);
  }
  const seatsRaw = first(get, 'seats') ?? '';

  const values: VisitValues = {
    date,
    mode: mode ?? '',
    fuel,
    operator,
    seats: seatsRaw,
    rental: rental ?? '',
    companions,
    stay: flag(get, 'stay'),
    longTerm: flag(get, 'long_term'),
    approval: flag(get, 'approval'),
  };

  let seats: number | undefined;
  if (mode === 'charter_bus') {
    const n = Number(seatsRaw);
    if (seatsRaw === '') errors.push('전세버스의 승차정원을 입력하세요.');
    else if (!Number.isInteger(n) || n < 1 || n > 100) errors.push('승차정원은 1~100 사이의 정수로 입력하세요.');
    else seats = n;
  }
  if (mode === 'udo_rental' && !rental) errors.push('우도에서 빌릴 이동수단을 고르세요.');

  const input: VisitInput | null =
    mode && errors.length === 0
      ? { date, mode, fuel, operator, seats, rental, companions, stay: values.stay, longTerm: values.longTerm, approval: values.approval }
      : null;
  return { values, input, errors };
}

/** 검색 매개변수로 다시 바꾼다(링크·시험용). */
export function visitQuery(input: Partial<VisitInput>): string {
  const q = new URLSearchParams();
  if (input.date) q.set('date', input.date);
  if (input.mode) q.set('mode', input.mode);
  if (input.mode === 'rental_car') {
    if (input.fuel) q.set('fuel', input.fuel);
  }
  if (input.mode === 'rental_car' || input.mode === 'charter_bus') {
    if (input.operator) q.set('operator', input.operator);
  }
  if (input.mode === 'charter_bus' && input.seats) q.set('seats', String(input.seats));
  if (input.mode === 'udo_rental' && input.rental) q.set('rental', input.rental);
  if (input.mode === 'rental_car') {
    for (const c of input.companions ?? []) q.append('companion', c);
    if (input.stay) q.set('stay', '1');
    if (input.longTerm) q.set('long_term', '1');
    if (input.approval) q.set('approval', '1');
  }
  return q.toString();
}

// ── 카드 항목 찾기 ─────────────────────────────────────────────

function restrictedItem(card: RegulationCard, id: string): RestrictedItem {
  const item = card.restricted?.find((r) => r.id === id);
  if (!item) throw new Error(`${card.card_id}: 제한 항목 ${id}가 없습니다`);
  return item;
}

function condition(card: RegulationCard, id: string): { parent: RestrictedItem; cond: RestrictedCondition } {
  for (const parent of card.restricted ?? []) {
    const cond = parent.conditions?.find((c) => c.id === id);
    if (cond) return { parent, cond };
  }
  throw new Error(`${card.card_id}: 세부 조건 ${id}가 없습니다`);
}

const cite = {
  scope(card: RegulationCard, id: string): Citation {
    const r = restrictedItem(card, id);
    return citation(card, id, r.scope, r.quote, r.locator);
  },
  cond(card: RegulationCard, id: string): Citation {
    const { parent, cond } = condition(card, id);
    return citation(card, id, cond.summary, cond.quote, parent.locator);
  },
  exclusion(card: RegulationCard, id: string): Citation {
    const { parent, cond } = condition(card, id);
    const ex = cond.exclusions?.[0];
    if (!ex) throw new Error(`${card.card_id}: ${id}에 단서가 없습니다`);
    return citation(card, `${id} 단서`, ex.summary, ex.quote, parent.locator);
  },
  definition(card: RegulationCard, id: string): Citation {
    const { parent, cond } = condition(card, id);
    const def = cond.definitions?.[0];
    if (!def) throw new Error(`${card.card_id}: ${id}에 정의가 없습니다`);
    return citation(card, `${id} 정의`, `${def.term}: ${def.summary}`, def.quote, parent.locator);
  },
  permitted(card: RegulationCard, id: string): Citation {
    const p = card.permitted_entry?.items.find((item) => item.id === id);
    if (!p) throw new Error(`${card.card_id}: 반입 허용 항목 ${id}가 없습니다`);
    return citation(card, id, p.summary, p.quote, card.permitted_entry?.locator);
  },
  who(card: RegulationCard, keyword: string): Citation | null {
    const p1 = card.permitted_entry?.items.find((item) => item.id === 'P1');
    const who = p1?.who?.find((w) => (w.quote ?? '').includes(keyword) || w.summary.includes(keyword));
    return who ? citation(card, 'P1', who.summary, who.quote, card.permitted_entry?.locator) : null;
  },
};

// ── 판정 ─────────────────────────────────────────────────────

interface Branch {
  value: VerdictValue;
  summary: string;
  items: string[];
  citations: Citation[];
  alternatives?: { item_id: string; text: string }[];
  /** 카드의 열린 질문을 고를 낱말 */
  questions?: string[];
  proof?: boolean;
  penalties?: boolean;
  notes?: string[];
}

function exceptionsFor(card: RegulationCard, input: VisitInput) {
  const ids: string[] = [];
  const labels: string[] = [];
  const citations: Citation[] = [];
  if (input.companions.length > 0) {
    ids.push('P1');
    labels.push('교통약자 이용(P1)');
    citations.push(cite.permitted(card, 'P1'));
    for (const value of input.companions) {
      const keyword = COMPANIONS.find((c) => c.value === value)?.keyword;
      const who = keyword ? cite.who(card, keyword) : null;
      if (who) citations.push(who);
    }
    if (input.companions.some((c) => c !== 'child7')) {
      const family = cite.who(card, '동반하는 가족');
      if (family) citations.push(family);
    }
  }
  if (input.longTerm) {
    ids.push('P2');
    labels.push('도민·우도 사업장 등록자의 6개월 이상 장기 대여(P2)');
    citations.push(cite.permitted(card, 'P2'));
  }
  if (input.stay) {
    ids.push('P3');
    labels.push('우도 숙박시설 이용(P3)');
    citations.push(cite.permitted(card, 'P3'));
  }
  if (input.approval) {
    ids.push('P4');
    labels.push('도지사 인정(P4)');
    citations.push(cite.permitted(card, 'P4'));
  }
  return { ids, labels, citations };
}

function udoOperatorBranch(card: RegulationCard, what: string): Branch {
  return {
    value: '확인 필요',
    items: ['R1-가', 'R1-나'],
    summary: `우도면에 차고지를 둔 업체의 ${what}는 공고일에 이미 영업하던 업체의 기존 차량이면 제외되고(R1-가 단서), 공고일 이후 새로 차고지를 둔 업체의 차량(R1-가)이나 증차한 차량(R1-나)은 제한됩니다. 어느 쪽인지 업체에 확인하세요.`,
    citations: [cite.cond(card, 'R1-가'), cite.exclusion(card, 'R1-가'), cite.cond(card, 'R1-나')],
    questions: ['공고일', '과태료'],
    penalties: true,
  };
}

function unknownOperatorBranch(card: RegulationCard): Branch {
  return {
    value: '확인 필요',
    items: ['R1-가', 'R1-나', 'R1-다'],
    summary: '업체의 본거지·차고지가 어디인지에 따라 보는 항목이 다릅니다. 우도 밖이면 R1-다, 우도면이면 R1-가·R1-나입니다. 업체 위치를 골라 주세요.',
    citations: [cite.cond(card, 'R1-다'), cite.cond(card, 'R1-가'), cite.cond(card, 'R1-나')],
    questions: ['공고일'],
    penalties: true,
  };
}

function rentalCar(card: RegulationCard, input: VisitInput): Branch {
  const fuel = input.fuel === 'combustion' ? '휘발유·경유·LPG' : labelOf(FUELS, input.fuel);
  const lowEmission = input.fuel === 'electric' || input.fuel === 'hydrogen';
  if (input.operator === 'outside' && lowEmission) {
    return {
      value: '제한 대상 아님',
      items: ['R1-다 단서'],
      summary: `우도 밖 업체의 렌터카라도 ${fuel} 차는 제1종 저공해자동차라서 R1-다의 제한에서 제외됩니다.`,
      citations: [cite.cond(card, 'R1-다'), cite.exclusion(card, 'R1-다'), cite.definition(card, 'R1-다')],
    };
  }

  const exceptions = exceptionsFor(card, input);
  if (exceptions.ids.length > 0) {
    const base = input.operator === 'outside' ? ['R1-다'] : [];
    const lead =
      input.operator === 'outside'
        ? '우도 밖 업체의 렌터카는 제한 대상(R1-다)이지만'
        : '업체에 따라 제한 대상인지가 달라지지만, 제한 대상이더라도';
    return {
      value: '반입 허용',
      items: [...base, ...exceptions.ids],
      summary: `${lead} ${exceptions.labels.join(', ')}에 해당해 반입이 허용됩니다. 신분증이나 증명 서류를 보여 줘야 합니다.`,
      citations: [...(input.operator === 'outside' ? [cite.cond(card, 'R1-다')] : []), ...exceptions.citations],
      proof: true,
    };
  }

  if (input.operator === 'udo') return udoOperatorBranch(card, '렌터카');
  if (input.operator === 'unknown') return unknownOperatorBranch(card);

  const hybrid =
    input.fuel === 'hybrid' ? ' 하이브리드 차는 카드의 제1종 저공해자동차 정의(전기·태양광·수소전기)에 들지 않습니다.' : '';
  return {
    value: '저촉',
    items: ['R1-다'],
    summary: `우도 밖에 본거지·차고지를 둔 업체의 ${fuel} 렌터카는 제한 대상(R1-다)입니다.${hybrid}`,
    citations: [cite.scope(card, 'R1'), cite.cond(card, 'R1-다'), cite.definition(card, 'R1-다')],
    alternatives: [
      { item_id: 'R1-다 단서', text: '전기·수소 렌터카(제1종 저공해자동차)는 제외됩니다.' },
      { item_id: 'P3', text: '우도면 안 숙박시설을 이용하면 반입이 허용됩니다. 증빙이 필요합니다.' },
      {
        item_id: 'P1',
        text: '65세 이상, 임신부, 7세 이하 아동 동반 등 교통약자와 함께라면 반입이 허용됩니다. 증빙이 필요합니다.',
      },
    ],
    questions: ['과태료'],
    penalties: true,
  };
}

function charterBus(card: RegulationCard, input: VisitInput): Branch {
  if (input.operator === 'udo') return udoOperatorBranch(card, '전세버스');
  if (input.operator === 'unknown') return unknownOperatorBranch(card);
  const seats = input.seats ?? 0;
  if (seats === 16) {
    return {
      value: '제한 대상 아님',
      items: ['R1-다 단서'],
      summary: '우도 밖 운송사의 전세버스라도 승차정원이 16인승인 자동차는 R1-다의 제한에서 제외됩니다.',
      citations: [cite.cond(card, 'R1-다'), cite.exclusion(card, 'R1-다')],
    };
  }
  if (seats < 16) {
    return {
      value: '확인 필요',
      items: ['R1-다', 'R1-다 단서'],
      summary: `제외 문언은 "승차정원이 16인승인 자동차"입니다. ${seats}인승이 여기에 드는지는 문언만으로 판단하지 않습니다.`,
      citations: [cite.cond(card, 'R1-다'), cite.exclusion(card, 'R1-다')],
      questions: ['16인승'],
      penalties: true,
    };
  }
  return {
    value: '저촉',
    items: ['R1-다'],
    summary: `우도 밖에 본거지·차고지를 둔 운송사의 ${seats}인승 전세버스는 제한 대상(R1-다)입니다. 제외되는 전세버스는 승차정원이 16인승인 자동차입니다.`,
    citations: [cite.scope(card, 'R1'), cite.cond(card, 'R1-다'), cite.exclusion(card, 'R1-다')],
    alternatives: [{ item_id: 'R1-다 단서', text: '승차정원 16인승 전세버스는 제외됩니다.' }],
    questions: ['과태료'],
    penalties: true,
  };
}

function udoRental(card: RegulationCard, input: VisitInput): Branch {
  switch (input.rental) {
    case 'bicycle':
      return {
        value: '제한 대상 아님',
        items: ['R2-나 단서'],
        summary: '우도면 안에서 빌려 타는 이동수단 가운데 자전거로 분류되는 것은 R2-나의 제한에서 제외됩니다.',
        citations: [cite.scope(card, 'R2'), cite.exclusion(card, 'R2-나')],
      };
    case 'e_bicycle':
      return {
        value: '확인 필요',
        items: ['R2-나', 'R2-나 단서'],
        summary:
          '자전거로 분류되는 이동수단은 제외됩니다(R2-나 단서). 그 전기자전거가 자전거로 분류되는지는 카드에 기준이 없어 대여 업체에 확인해야 합니다.',
        citations: [cite.scope(card, 'R2'), cite.cond(card, 'R2-나'), cite.exclusion(card, 'R2-나')],
        penalties: true,
      };
    case 'pm':
    case 'moped':
      return {
        value: '저촉',
        items: ['R2-나'],
        summary: `우도면 안에서 대여 목적으로 운행하는 ${input.rental === 'pm' ? '개인형 이동장치(전동킥보드 등)' : '원동기장치자전거'}는 제한 대상(R2-나)입니다.`,
        citations: [cite.scope(card, 'R2'), cite.cond(card, 'R2-나')],
        alternatives: [
          { item_id: 'R2-나 단서', text: '자전거로 분류되는 이동수단은 제외됩니다.' },
          { item_id: 'R2-다 단서', text: '전기를 동력원으로 하고 사용신고를 한 이륜자동차는 제외됩니다.' },
        ],
        questions: ['과태료'],
        penalties: true,
      };
    case 'e_motorcycle':
      return {
        value: '제한 대상 아님',
        items: ['R2-다 단서'],
        summary:
          '전기를 동력원으로 하고 사용신고를 한 이륜자동차는 R2-다의 제한에서 제외됩니다. 사용신고를 했으므로 R2-가(사용신고를 하지 않은 이륜자동차)에도 들지 않습니다.',
        citations: [cite.scope(card, 'R2'), cite.exclusion(card, 'R2-다'), cite.cond(card, 'R2-가')],
      };
    case 'motorcycle':
    default:
      return {
        value: '확인 필요',
        items: ['R2-가', 'R2-다'],
        summary:
          '사용신고를 하지 않은 이륜자동차(R2-가)와 공고일 이후 신규 등록·운행하는 이륜자동차(R2-다)는 제한됩니다. 사용신고 여부와 등록 시점을 대여 업체에 확인하세요.',
        citations: [cite.scope(card, 'R2'), cite.cond(card, 'R2-가'), cite.cond(card, 'R2-다')],
        questions: ['공고일', '과태료'],
        penalties: true,
      };
  }
}

function branchFor(card: RegulationCard, input: VisitInput): Branch {
  switch (input.mode) {
    case 'rental_car':
      return rentalCar(card, input);
    case 'charter_bus':
      return charterBus(card, input);
    case 'udo_rental':
      return udoRental(card, input);
    case 'own_car':
      return {
        value: '제한 대상 아님',
        items: [],
        summary:
          '이 공고가 제한하는 자동차(R1)는 전세버스 운송사업용과 자동차 대여사업용입니다. 본인 소유 자가용은 여기에 없습니다. 다른 규제는 확인하지 않았습니다.',
        citations: [cite.scope(card, 'R1'), cite.scope(card, 'R3')],
        notes: ['의무보험에 가입하지 않아 도로에서 운행할 수 없는 자동차는 차종과 관계없이 제한됩니다(R3).'],
      };
    case 'no_vehicle':
    default:
      return {
        value: '제한 대상 아님',
        items: [],
        summary:
          '이 공고는 일부 자동차와 우도 안 대여 이동수단의 운행을 제한합니다. 운전하지 않고 들어가는 방문객은 제한 대상에 없습니다. 다른 규제는 확인하지 않았습니다.',
        citations: [cite.scope(card, 'R1'), cite.scope(card, 'R2')],
      };
  }
}

export function checkVisit(input: VisitInput, today: string, card: RegulationCard = requireCard(UDO_VEHICLE_CARD_ID)): CheckResult {
  const branch = branchFor(card, input);
  const from = card.validity?.valid_from ?? null;
  const until = card.validity?.valid_until ?? null;
  const after = Boolean(until && input.date > until);
  const before = Boolean(from && input.date < from);

  const followUp = getSource('N07');
  const afterValidityDetail = followUp
    ? `수집 대상 목록 ${followUp.id}(보도만 있음): ${followUp.note}`
    : undefined;
  const final = finalVerdict(card, branch.value, { date: input.date, dateLabel: '방문일', afterValidityDetail });

  const keywords = [...(after ? ['연장 공고'] : []), ...(branch.questions ?? [])];
  const proof = card.permitted_entry?.proof;

  return {
    kind: 'udo-visit',
    card: cardRef(card),
    preliminary: {
      value: branch.value,
      summary: branch.summary,
      items: branch.items,
      reference_only: after || before,
    },
    final,
    premise: null,
    citations: uniqueCitations(branch.citations),
    alternatives: branch.alternatives ?? [],
    proof:
      branch.proof && proof
        ? { summary: proof.summary, quote: proof.quote ?? null, locator: card.permitted_entry?.locator ?? null }
        : null,
    procedure: null,
    penalties: branch.penalties ? penaltyViews(card) : [],
    open_questions: openQuestions(card, keywords),
    notes: branch.notes ?? [],
    related: [],
    as_of: asOf(card, today),
    disclaimer: disclaimer(card),
  };
}

/** 보고서(lib/report.ts)가 같은 인용을 쓰도록 내보낸다. */
export { cite as udoCite };
