// 규제 카드 스키마 0.1-draft(docs/05 3절)의 타입.
// 카드마다 있는 블록이 다르므로 선택 블록은 모두 optional이다.

export type EvidenceGrade = 'verified' | 'extracted' | 'candidate';

export interface QuoteBlock {
  summary?: string;
  quote?: string;
  locator?: string;
  src?: string;
}

export interface Exclusion {
  summary: string;
  quote?: string;
}

export interface Definition {
  term: string;
  summary: string;
  quote?: string;
}

export interface RestrictedCondition {
  id?: string;
  summary: string;
  quote?: string;
  exclusions?: Exclusion[];
  definitions?: Definition[];
}

export interface RestrictedItem {
  id: string;
  scope: string;
  src?: string;
  locator?: string;
  quote?: string;
  acts?: string[];
  conditions?: RestrictedCondition[];
  /** 항목 전체에 붙는 단서(예: 비어업인 포획·채취 제한) */
  exclusions?: Exclusion[];
  detail?: QuoteBlock;
}

export interface PermittedItem {
  id: string;
  summary: string;
  quote?: string;
  who?: { summary: string; quote?: string }[];
}

export interface OrdinanceItem {
  no: string;
  summary: string;
  quote?: string;
  tourism_relevant?: boolean;
  exclusion?: { summary: string; quote?: string };
  period?: { summary: string; quote?: string };
}

export interface PermitException {
  id: string;
  summary: string;
  locator?: string;
  quote?: string;
  /** 다른 카드의 항목을 그대로 가져올 때 그 항목(예: 상대보전지역 E1 → 절대보전지역 E1) */
  refers_to?: string;
  delegated_to?: string;
  detail?: {
    src?: string;
    locator?: string;
    quote?: string;
    item_count?: number;
    tourism_relevant_note?: string;
    items: OrdinanceItem[];
  };
}

export interface PenaltyRange {
  vehicle: string;
  min: number;
  max: number;
  quote?: string;
}

export interface Penalty {
  id: string;
  violation: string;
  basis?: string;
  type: string;
  summary?: string;
  amount_krw?: number;
  /** 상한만 정한 과태료 등 */
  amount_krw_max?: number;
  amount_krw_range?: PenaltyRange[];
  /** 벌칙의 근거 법령 조문 */
  law?: { src?: string; locator?: string; quote?: string };
  imprisonment_max_years?: number;
  fine_max_krw?: number;
  locator?: string;
  quote?: string;
  applies_quote?: { quote: string };
  follow_up?: { quote: string };
  procedure?: {
    src?: string;
    locator?: string;
    summary?: string;
    quote?: string;
    extension?: { quote: string };
  };
}

export interface SourceDoc {
  source_id: string;
  document: string;
  published?: string;
  issuer?: string;
  amends?: string;
  version?: string;
  version_check?: string;
  provisions?: string[];
  url?: string;
  retrieved_at?: string;
  local_text?: string;
  text_sha256?: string;
}

/** 지정 고시에서 읽은 면적(㎡) */
export interface AreaFigure {
  summary: string;
  absolute_m2?: number;
  relative_m2?: number;
  quote?: string;
  src?: string;
  locator?: string;
  published?: string;
}

export interface DesignationCriterion extends QuoteBlock {
  id: string;
  delegated_to?: string;
  detail?: { src?: string; locator?: string; quote?: string; items: { summary: string; quote?: string }[] };
}

export interface RegulationCard {
  schema_version: string;
  card_id: string;
  title: string;
  evidence_grade: EvidenceGrade | (string & {});
  extracted_by?: string;
  extracted_at?: string;
  reviewed_at?: string | null;
  source: SourceDoc;
  additional_sources?: SourceDoc[];
  legal_basis?: {
    locator?: string;
    quote?: string;
    /** 카드마다 모양이 다르다: { source_id, provision, text_read } 또는 { src, provision, summary, quote } */
    provisions?: { source_id?: string; src?: string; provision: string; text_read?: boolean; summary?: string; quote?: string }[];
  };
  obligation_type?: string;
  target_activity?: string;
  target_area?: {
    type?: string;
    value: string;
    resolvable_from_text?: boolean;
    note?: string;
    locator?: string;
    quote?: string;
    notice_requirements?: QuoteBlock & { map?: { quote: string } };
    designated_areas?: {
      src?: string;
      locator?: string;
      note?: string;
      jeju_total?: AreaFigure;
      udo?: AreaFigure;
      udo_first_designation?: AreaFigure;
    };
  };
  designation?: {
    authority?: string;
    procedure?: QuoteBlock;
    criteria?: DesignationCriterion[];
  };
  validity?: {
    valid_from: string | null;
    valid_until: string | null;
    /** 끝나는 날이 날짜가 아닐 때의 문언(예: 별도 공고 시까지) */
    until?: string;
    repealed_on?: string;
    locator?: string;
    quote?: string;
    note?: string;
    history?: { label: string; from: string; until: string }[];
  };
  enforcement_status?: string;
  status_note?: string;
  restricted?: RestrictedItem[];
  permitted_entry?: {
    locator?: string;
    quote?: string;
    items: PermittedItem[];
    proof?: { summary: string; quote?: string };
  };
  permit_exceptions?: {
    summary?: string;
    permit_authority?: string;
    locator?: string;
    quote?: string;
    items: PermitException[];
  };
  permit_procedure?: {
    src?: string;
    locator?: string;
    application?: { summary: string; quote?: string };
    processing?: { summary: string; days?: number; quote?: string };
    refusal?: { summary: string; quote?: string };
  };
  grandfathering?: QuoteBlock;
  delegations?: {
    to: string;
    document: string;
    text_read?: boolean;
    basis?: QuoteBlock;
    matters?: { law: string; ordinance: string; filled_in: string }[];
  }[];
  penalties?: Penalty[];
  related?: { relation: string; source_id?: string; card_id?: string; note: string; locator?: string; quote?: string }[];
  open_questions?: string[];
}

/** data/udo-regulation-sources.csv 한 줄. */
export interface SourceRow {
  id: string;
  category: string;
  doc_type: string;
  name: string;
  udo_relevance: string;
  relevance_basis: string;
  key_provisions: string;
  check_status: string;
  observed_effective: string;
  observed_promulgation: string;
  collection_route: string;
  source_url: string;
  observed_on: string;
  note: string;
}
