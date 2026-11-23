// 판정 값과 최종 판정 규칙(docs/07 4절).
// 화면은 이 결과를 그대로 그린다. 판정 규칙을 화면에서 다시 계산하지 않는다.

import { won, wonRange } from './format';
import type { RegulationCard } from './types';

export const VERDICT_VALUES = ['저촉', '허가 대상', '허가 대상 아님', '반입 허용', '제한 대상 아님', '확인 필요'] as const;
export type VerdictValue = (typeof VERDICT_VALUES)[number];

export const VERDICT_INFO: Record<VerdictValue, { meaning: string; tone: string; dot: string }> = {
  저촉: {
    meaning: '카드의 제한 대상에 해당한다',
    tone: 'bg-red-50 text-red-800 ring-red-200',
    dot: 'bg-red-500',
  },
  '허가 대상': {
    meaning: '미리 허가를 받으면 할 수 있다',
    tone: 'bg-amber-50 text-amber-900 ring-amber-200',
    dot: 'bg-amber-500',
  },
  '허가 대상 아님': {
    meaning: '그 근거로는 허가를 받을 수 없다. 다른 근거로 가능한지는 따로 본다',
    tone: 'bg-rose-50 text-rose-800 ring-rose-200',
    dot: 'bg-rose-400',
  },
  '반입 허용': {
    meaning: '예외에 해당한다. 증빙이 필요하다',
    tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  '제한 대상 아님': {
    meaning: '이 카드의 제한 대상에 없다. 다른 규제는 보지 않았다',
    tone: 'bg-teal-50 text-teal-800 ring-teal-200',
    dot: 'bg-teal-400',
  },
  '확인 필요': {
    meaning: '위 판정을 내릴 근거가 부족하다',
    tone: 'bg-slate-100 text-slate-700 ring-slate-300',
    dot: 'bg-slate-400',
  },
};

export const GRADE_LABEL: Record<string, string> = {
  verified: '검수 완료',
  extracted: '모델 추출·미검수',
  candidate: '원문 없음',
};

export const STATUS_LABEL: Record<string, string> = {
  in_force: '시행',
  unconfirmed: '현재 효력 미확인',
  suspended: '유예',
  discussed: '논의',
  repealed: '폐지',
};

export interface Citation {
  card_id: string;
  /** 카드 안의 항목 ID. 예: R1-다, R1-다 단서, P3, E1, 조례 제6조제7호 */
  item_id: string;
  summary: string;
  /** 카드에 적힌 인용문 그대로. 카드에 인용문이 없으면 null */
  quote: string | null;
  locator: string | null;
  document: string;
}

export type FinalReasonCode =
  | 'not_verified'
  | 'outside_validity'
  | 'status_unconfirmed'
  | 'area_unresolved'
  | 'preliminary_unresolved';

export interface FinalReason {
  code: FinalReasonCode;
  message: string;
  detail?: string;
}

export interface FinalVerdict {
  value: VerdictValue;
  reasons: FinalReason[];
}

export interface PenaltyView {
  id: string;
  type: string;
  violation: string;
  basis: string | null;
  summary: string;
  lines: { label: string; quote: string | null }[];
  quote: string | null;
  locator: string | null;
  document: string;
}

export interface CardRef {
  card_id: string;
  title: string;
  document: string;
  issuer: string | null;
  evidence_grade: string;
  enforcement_status: string | null;
  valid_from: string | null;
  valid_until: string | null;
  url: string | null;
}

export interface CheckResult {
  kind: 'udo-visit' | 'conservation-plan';
  card: CardRef;
  preliminary: {
    value: VerdictValue;
    summary: string;
    items: string[];
    /** 방문일이 카드의 유효 기간 밖이라 참고로만 보이는 판정인지 */
    reference_only: boolean;
  };
  final: FinalVerdict;
  /** 판정 전체에 붙는 전제. 예: "그 위치가 절대보전지역 안이라면" */
  premise: string | null;
  citations: Citation[];
  alternatives: { item_id: string; text: string }[];
  proof: { summary: string; quote: string | null; locator: string | null } | null;
  procedure: {
    authority: string | null;
    steps: { label: string; summary: string; quote: string | null }[];
    locator: string | null;
    document: string;
  } | null;
  penalties: PenaltyView[];
  open_questions: string[];
  notes: string[];
  related: { id: string; name: string; check_status: string; note: string }[];
  as_of: {
    today: string;
    card_extracted_at: string | null;
    source_retrieved_at: string | null;
    source_published: string | null;
  };
  disclaimer: string;
}

export function documentFor(card: RegulationCard, src?: string): string {
  if (src && src !== card.source.source_id) {
    const extra = card.additional_sources?.find((s) => s.source_id === src);
    if (extra) return extra.document;
  }
  return card.source.document;
}

export function citation(
  card: RegulationCard,
  item_id: string,
  summary: string,
  quote: string | null | undefined,
  locator: string | null | undefined,
  src?: string,
): Citation {
  return {
    card_id: card.card_id,
    item_id,
    summary,
    quote: quote ?? null,
    locator: locator ?? null,
    document: documentFor(card, src),
  };
}

export function cardRef(card: RegulationCard): CardRef {
  return {
    card_id: card.card_id,
    title: card.title,
    document: card.source.document,
    issuer: card.source.issuer ?? null,
    evidence_grade: card.evidence_grade,
    enforcement_status: card.enforcement_status ?? null,
    valid_from: card.validity?.valid_from ?? null,
    valid_until: card.validity?.valid_until ?? null,
    url: card.source.url ?? null,
  };
}

export function asOf(card: RegulationCard, today: string): CheckResult['as_of'] {
  return {
    today,
    card_extracted_at: card.extracted_at ?? null,
    source_retrieved_at: card.source.retrieved_at ?? null,
    source_published: card.source.published ?? null,
  };
}

export function disclaimer(card: RegulationCard): string {
  const who = card.source.issuer ? `소관 기관(${card.source.issuer})` : '소관 기관';
  return `법률 자문이 아닙니다. 규제 카드의 문언을 옮긴 판정이며, 최종 확인은 ${who}에 하세요.`;
}

export function penaltyViews(card: RegulationCard): PenaltyView[] {
  return (card.penalties ?? []).map((p) => ({
    id: p.id,
    type: p.type,
    violation: p.violation,
    basis: p.basis ?? null,
    summary: p.summary ?? (typeof p.amount_krw === 'number' ? `${p.type} ${won(p.amount_krw)}` : p.type),
    lines: (p.amount_krw_range ?? []).map((r) => ({
      label: `${r.vehicle}: ${wonRange(r.min, r.max)}`,
      quote: r.quote ?? null,
    })),
    quote: p.quote ?? p.applies_quote?.quote ?? null,
    locator: p.locator ?? null,
    document: documentFor(card),
  }));
}

/** 카드의 열린 질문 가운데 낱말이 들어간 것을 고른다. 순서가 바뀌어도 찾을 수 있게 번호 대신 낱말로 찾는다. */
export function openQuestions(card: RegulationCard, keywords: string[]): string[] {
  const all = card.open_questions ?? [];
  const picked = new Set<string>();
  for (const keyword of keywords) {
    for (const question of all) if (question.includes(keyword)) picked.add(question);
  }
  return all.filter((q) => picked.has(q));
}

export interface FinalContext {
  /** 판정 기준일(방문일 등). 없으면 카드의 시행 상태로 본다 */
  date?: string;
  /** 기준일을 부르는 말. 기본값 "기준일" */
  dateLabel?: string;
  /** 대상 지역을 사용자가 확인했다고 입력했는지 */
  areaResolved?: boolean;
  /** 유효 기간 뒤일 때 덧붙일 설명(예: 보도만 있는 연장 소식) */
  afterValidityDetail?: string;
}

/**
 * 최종 판정 규칙(docs/07 4.2절).
 * 아래 조건 중 하나라도 걸리면 최종 판정은 "확인 필요"다. 예비 판정은 그대로 보인다.
 * 1. 카드가 verified가 아니다.
 * 2. 판정 기준일이 카드의 유효 기간 밖이다.
 * 3. 유효 기간이 없는 카드에서 시행 상태가 in_force가 아니다.
 * 4. 대상 지역을 조문으로 정할 수 없는데 위치를 확인하지 않았다.
 * 5. 예비 판정부터 "확인 필요"다(문언의 경계 등).
 */
export function finalVerdict(card: RegulationCard, preliminary: VerdictValue, ctx: FinalContext = {}): FinalVerdict {
  const reasons: FinalReason[] = [];

  if (card.evidence_grade !== 'verified') {
    reasons.push({
      code: 'not_verified',
      message: `규제 카드가 검수 전입니다(${GRADE_LABEL[card.evidence_grade] ?? card.evidence_grade}). 사람이 원문과 대조하기 전에는 판정을 확정하지 않습니다.`,
    });
  }

  const from = card.validity?.valid_from ?? null;
  const until = card.validity?.valid_until ?? null;
  const dated = Boolean(from || until);
  if (dated && ctx.date) {
    const range = `${from ?? '…'}~${until ?? '…'}`;
    if (until && ctx.date > until) {
      reasons.push({
        code: 'outside_validity',
        message: `${ctx.dateLabel ?? '기준일'}(${ctx.date})이 이 공고의 제한기간(${range}) 뒤입니다. 그 뒤의 공고 원문은 확보하지 못했습니다.`,
        detail: ctx.afterValidityDetail,
      });
    } else if (from && ctx.date < from) {
      reasons.push({
        code: 'outside_validity',
        message: `${ctx.dateLabel ?? '기준일'}(${ctx.date})이 이 공고의 제한기간(${range}) 앞입니다. 그 기간에는 이전 공고를 봐야 합니다.`,
      });
    }
  } else if (card.enforcement_status !== 'in_force') {
    reasons.push({
      code: 'status_unconfirmed',
      message: `시행 상태를 확인하지 못했습니다(${STATUS_LABEL[card.enforcement_status ?? ''] ?? card.enforcement_status ?? '표시 없음'}).`,
    });
  }

  if (card.target_area?.resolvable_from_text === false && !ctx.areaResolved) {
    reasons.push({
      code: 'area_unresolved',
      message: '대상 지역은 조문이 아니라 지정 고시와 구역도로 정해집니다. 구역 데이터를 연결하지 않아 그 위치가 구역 안인지 판정하지 않습니다.',
    });
  }

  if (preliminary === '확인 필요') {
    reasons.push({
      code: 'preliminary_unresolved',
      message: '카드 문언만으로는 판정할 수 없습니다. 예비 판정의 설명을 보세요.',
    });
  }

  return { value: reasons.length > 0 ? '확인 필요' : preliminary, reasons };
}

/** 같은 인용을 두 번 싣지 않는다. */
export function uniqueCitations(list: Citation[]): Citation[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const key = `${c.card_id}|${c.item_id}|${c.quote ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
