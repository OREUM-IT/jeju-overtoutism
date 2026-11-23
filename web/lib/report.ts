// ③ 지역 진단 보고서. docs/01 2절의 보고서 구성(규제 현황 → 진단과 대응 방향 → 기획 → 근거와 한계)을
// 카드와 수집 대상 목록만으로 채운다. 모든 서술은 근거 인용, 수집 대상 목록 항목, 또는 "근거 없음, 제안"
// 표시 가운데 하나를 가진다. 근거 없는 수치(방문객 수, 효과)는 쓰지 않는다.

import { checkPlan, conservationCite, planQuery, type PlanInput } from './checks/conservation-plan';
import { checkVisit, udoCite, visitQuery, type VisitInput } from './checks/udo-visit';
import { CARDS, CONSERVATION_CARD_ID, SOURCES, UDO_VEHICLE_CARD_ID, dataAsOf, getSource, requireCard } from './data';
import { dateRange } from './format';
import type { Option } from './params';
import type { RegulationCard } from './types';
import { citation, GRADE_LABEL, STATUS_LABEL, uniqueCitations, type CheckResult, type Citation } from './verdict';

export const AUDIENCES = [
  { value: 'policy', label: '정책 담당자·관광 기획자' },
  { value: 'business', label: '관광 사업자·창업팀' },
  { value: 'traveler', label: '여행자' },
] as const satisfies readonly Option<string>[];
export type Audience = (typeof AUDIENCES)[number]['value'];

export function parseAudience(raw: string | string[] | undefined): Audience {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return AUDIENCES.find((a) => a.value === value)?.value ?? 'policy';
}

export type StatementKind = 'fact' | 'unknown' | 'measure';

export interface Statement {
  kind: StatementKind;
  text: string;
  basis: Citation[];
  /** 수집 대상 목록(data/udo-regulation-sources.csv)의 항목 ID */
  source_refs: string[];
}

export interface ReportTable {
  caption: string;
  columns: string[];
  rows: string[][];
}

export interface ReportIdea {
  id: string;
  title: string;
  description: string;
  href: string;
  check: CheckResult;
  recommend: boolean;
  note: string | null;
}

export interface ReportSection {
  id: string;
  title: string;
  lead: string | null;
  statements: Statement[];
  tables: ReportTable[];
  ideas: ReportIdea[];
}

export interface Report {
  area: string;
  audience: Audience;
  audience_label: string;
  title: string;
  today: string;
  as_of: ReturnType<typeof dataAsOf>;
  disclaimer: string;
  sections: ReportSection[];
  open_questions: { card_id: string; card_title: string; question: string }[];
  citations: Citation[];
}

const fact = (text: string, basis: Citation[] = [], source_refs: string[] = []): Statement => ({ kind: 'fact', text, basis, source_refs });
const unknown = (text: string, basis: Citation[] = [], source_refs: string[] = []): Statement => ({ kind: 'unknown', text, basis, source_refs });
const measure = (text: string, basis: Citation[] = [], source_refs: string[] = []): Statement => ({ kind: 'measure', text, basis, source_refs });

/** docs/04 2절의 확인 상태 뜻. */
export const CHECK_STATUS_LABEL: Record<string, string> = {
  provision_read: '조문 또는 공고문 본문을 읽음',
  existence_observed: '명칭과 시행일(게재일) 표기만 관측함',
  official_record: '공식 기관의 등록 정보를 읽음. 고시 원문은 아님',
  secondary_only: '보도 등 2차 자료만 있음',
  not_found: '찾지 못함',
};

function section(id: string, title: string, parts: Partial<Omit<ReportSection, 'id' | 'title'>>): ReportSection {
  return { id, title, lead: parts.lead ?? null, statements: parts.statements ?? [], tables: parts.tables ?? [], ideas: parts.ideas ?? [] };
}

/** 우도에 걸리는 카드: 본문에 우도가 나오거나 대상 지역이 제주 전역인 카드 */
export function udoRelatedCards(): RegulationCard[] {
  return CARDS.filter((card) => JSON.stringify(card).includes('우도') || /전역/.test(card.target_area?.value ?? ''));
}

function cardTable(): ReportTable {
  const cards = udoRelatedCards();
  return {
    caption: `우도에 걸리는 규제 카드 ${cards.length}건(전체 ${CARDS.length}건 가운데 본문에 우도가 나오거나 대상 지역이 제주 전역인 것)`,
    columns: ['규제', '원문', '시행 상태', '기간', '근거 등급', '추출일'],
    rows: cards.map((card) => [
      card.title,
      card.source.document,
      STATUS_LABEL[card.enforcement_status ?? ''] ?? card.enforcement_status ?? '표시 없음',
      card.validity && (card.validity.valid_from || card.validity.valid_until || card.validity.until)
        ? dateRange(card.validity.valid_from, card.validity.valid_until ?? card.validity.until)
        : '기간 없음',
      GRADE_LABEL[card.evidence_grade] ?? card.evidence_grade,
      card.extracted_at ?? '없음',
    ]),
  };
}

function sourceStatusTable(): ReportTable {
  const counts = new Map<string, number>();
  for (const row of SOURCES) counts.set(row.check_status, (counts.get(row.check_status) ?? 0) + 1);
  const order = [...Object.keys(CHECK_STATUS_LABEL), ...[...counts.keys()].filter((k) => !(k in CHECK_STATUS_LABEL))];
  return {
    caption: `수집 대상 목록 ${SOURCES.length}건의 확인 상태`,
    columns: ['상태', '뜻', '건수'],
    rows: order.filter((k) => counts.has(k)).map((k) => [k, CHECK_STATUS_LABEL[k] ?? '', String(counts.get(k))]),
  };
}

function validityCite(card: RegulationCard): Citation {
  const v = card.validity;
  return citation(card, '제한기간', `제한기간 ${dateRange(v?.valid_from, v?.valid_until)}`, v?.quote, v?.locator);
}

function areaCite(card: RegulationCard): Citation {
  const a = card.target_area;
  return citation(card, '대상 지역', a?.value ?? '', a?.quote, a?.locator);
}

function penaltyCites(card: RegulationCard): Citation[] {
  return (card.penalties ?? []).flatMap((p) => {
    const own = p.quote ? [citation(card, p.id, p.summary ?? p.violation, p.quote, p.locator)] : [];
    const ranges = (p.amount_krw_range ?? []).map((r) => citation(card, p.id, `${p.type} ${r.vehicle}`, r.quote, p.locator));
    return [...own, ...ranges];
  });
}

function procedureCites(card: RegulationCard): Citation[] {
  const pp = card.permit_procedure;
  if (!pp) return [];
  return [pp.application, pp.processing]
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => citation(card, '허가 절차', s.summary, s.quote, pp.locator, pp.src));
}

/** 수집 대상 목록 N07(보도만 있는 연장 소식)의 메모에서 연장 종료일을 읽는다. */
function reportedExtension(): string {
  const until = getSource('N07')?.note.match(/~(\d{4}-\d{2}-\d{2})/)?.[1];
  return until ? `보도상으로는 ${until}까지 연장됐다. ` : '';
}

function udoAbsoluteArea(card: RegulationCard): string | null {
  const m2 = card.target_area?.designated_areas?.udo?.absolute_m2;
  return typeof m2 === 'number' ? `${m2.toLocaleString('ko-KR')}㎡` : null;
}

function udoAreaCite(card: RegulationCard): Citation[] {
  const areas = card.target_area?.designated_areas;
  const udo = areas?.udo;
  return udo ? [citation(card, '우도면 지정 면적', udo.summary, udo.quote, udo.locator ?? areas?.locator, udo.src ?? areas?.src)] : [];
}

/** 우도면의 보전지역 지정 현황. 고시에서 읽은 면적이 카드에 있으면 사실로, 없으면 확인 필요로 적는다. */
function udoAreaStatements(card: RegulationCard): Statement[] {
  const udo = card.target_area?.designated_areas?.udo;
  if (!udo) {
    return [unknown('우도의 절대·상대보전지역 지정 현황을 카드로 확인하지 못했다. 보전지역 카드로는 우도의 특정 위치를 판정할 수 없다.', [areaCite(card)], ['N04'])];
  }
  return [
    fact(`${udo.summary}.`, udoAreaCite(card), ['N04']),
    unknown('그 면적이 어느 필지인지는 지형도면이 있어야 안다. 그래서 보전지역 카드로는 우도의 특정 위치를 판정하지 않는다.', [areaCite(card)]),
  ];
}

function unreadProvisions(card: RegulationCard): string[] {
  return (card.legal_basis?.provisions ?? [])
    .filter((p) => p.text_read === false)
    .map((p) => {
      const id = p.source_id ?? p.src ?? '';
      return `「${getSource(id)?.name ?? id}」 ${p.provision}`;
    });
}

function ideas(today: string): ReportIdea[] {
  const visit = (over: Partial<VisitInput>): VisitInput => ({
    date: today,
    mode: 'rental_car',
    fuel: 'combustion',
    operator: 'outside',
    companions: [],
    stay: false,
    longTerm: false,
    approval: false,
    ...over,
  });
  const plan = (over: Partial<PlanInput>): PlanInput => ({ activity: 'guided_program', actor: 'private', location: 'unknown', ...over });
  const v = (id: string, title: string, description: string, input: VisitInput, recommend = true, note: string | null = null): ReportIdea => ({
    id,
    title,
    description,
    href: `/check?${visitQuery(input)}`,
    check: checkVisit(input, today),
    recommend,
    note,
  });
  const p = (id: string, title: string, description: string, input: PlanInput, note: string | null = null): ReportIdea => ({
    id,
    title,
    description,
    href: `/plan?${planQuery(input)}`,
    check: checkPlan(input, today),
    recommend: true,
    note,
  });
  return [
    v('low-carbon-pass', '저탄소 입도 패스', '본섬 전기 렌터카, 도항선, 자전거 대여를 묶은 안내', visit({ fuel: 'electric' })),
    v('accessible-trip', '교통약자 동행 우도 여행', '65세 이상·영유아 동반 가족의 렌터카 반입 안내와 증빙 준비', visit({ companions: ['age65'] })),
    v(
      'overnight-stay',
      '우도 1박 체류형 여행',
      '숙박객의 렌터카 반입 허용을 활용해 당일 방문 집중을 나눈다',
      visit({ stay: true }),
      true,
      '분산 효과는 부하 지표를 연결한 뒤 평가한다',
    ),
    p(
      'guided-beach-walk',
      '홍조단괴 해빈 해설 탐방',
      '시설 없이 해설사와 걷는 프로그램',
      plan({ activity: 'guided_program' }),
      '천연기념물(수집 대상 N03)의 행위제한은 읽지 않았다',
    ),
    p('coastal-monitoring', '해안 생태 모니터링 체험', '학술 조사와 연계한 시민 참여 프로그램', plan({ activity: 'monitoring' })),
    v(
      'kickboard-rental',
      '우도 안 전동킥보드 대여',
      '이동수단 대여 사업',
      visit({ mode: 'udo_rental', rental: 'pm' }),
      false,
      '제한 대상이라 사업 아이템으로 권하지 않는다',
    ),
  ];
}

function evidenceSection(cards: { udo: RegulationCard; cons: RegulationCard }, polite: boolean): ReportSection {
  const asOf = dataAsOf();
  const total = CARDS.length;
  const notVerified = CARDS.filter((c) => c.evidence_grade !== 'verified').length;
  const unread = unreadProvisions(cards.udo).join(', ');
  const retrieved = asOf.source_retrieved_at ?? '알 수 없음';
  const say = (formal: string, plain: string) => (polite ? plain : formal);

  const grade =
    notVerified === 0
      ? say(`규제 카드 ${total}건은 모두 검수를 마쳤다.`, `규제 카드 ${total}건은 모두 검수를 마쳤습니다.`)
      : say(
          `규제 카드 ${total}건 가운데 ${notVerified}건이 검수 전(모델 추출·미검수)이다. 검수 전 카드에 근거한 최종 판정은 모두 "확인 필요"이고, 카드 문언에 따른 예비 판정을 함께 적었다.`,
          `규제 카드 ${total}건 가운데 ${notVerified}건이 검수 전(모델 추출·미검수)입니다. 그래서 최종 판정은 "확인 필요"로 나오고, 카드 문언에 따른 예비 판정을 함께 보여 줍니다.`,
        );

  return section('evidence', '근거와 한계', {
    statements: [
      fact(grade),
      ...(unread
        ? [
            unknown(
              say(
                `운행제한 공고가 근거로 든 조문 가운데 ${unread}의 본문은 읽지 않았다.`,
                `운행제한 공고가 근거로 든 조문 가운데 ${unread}의 본문은 아직 읽지 않았습니다.`,
              ),
            ),
          ]
        : []),
      fact(
        say(
          `원문 수집일은 ${retrieved}이며 그 뒤의 개정·공고는 반영하지 않았다. 원문 사본은 재배포 조건을 확인하기 전이라 저장소에 넣지 않았고, 카드에 적은 해시로 같은 원문인지 확인한다.`,
          `원문 수집일은 ${retrieved}이고 그 뒤의 개정·공고는 반영하지 않았습니다.`,
        ),
      ),
    ],
  });
}

function policyReport(today: string, cards: { udo: RegulationCard; cons: RegulationCard }): ReportSection[] {
  const { udo, cons } = cards;
  const history = udo.validity?.history ?? [];
  const firstPeriod = history[0];
  const lastPeriod = history.at(-1);
  const read = SOURCES.filter((s) => s.check_status === 'provision_read').length;

  return [
    section('status', '1. 규제 현황', {
      lead: '우도에 걸리는 규제 카드와 수집 대상 목록의 확인 상태다.',
      tables: [cardTable(), sourceStatusTable()],
      statements: [
        fact(
          `${udo.target_area?.value ?? '우도면'}에서 전세버스·렌터카 일부와 우도 안 대여 이동수단의 운행을 제한한다(${udo.source.document}).`,
          [areaCite(udo), udoCite.scope(udo, 'R1'), udoCite.scope(udo, 'R2')],
        ),
        fact(
          '절대보전지역에서는 건축물의 건축, 시설 설치, 토지의 형질변경 등을 할 수 없고, 정해진 행위만 도지사의 허가를 받아 할 수 있다.',
          [conservationCite.ban(cons), conservationCite.permitClause(cons)],
        ),
        fact(
          `수집 대상 ${SOURCES.length}건 가운데 조문이나 공고문 본문을 읽은 것은 ${read}건이다. 나머지는 명칭·시행일만 관측했거나 2차 자료만 있다.`,
          [],
          ['udo-regulation-sources.csv'],
        ),
      ],
    }),
    section('diagnosis', '2. 진단과 대응 방향', {
      lead: '진단은 카드와 수집 대상 목록에서 확인한 것만 적는다. 대응 방향은 근거가 있는 것과 없는 것(제안)을 나눠 적는다.',
      statements: [
        fact(
          `공고문에 적힌 제한기간은 ${firstPeriod ? `${firstPeriod.label}(${dateRange(firstPeriod.from, firstPeriod.until)})` : '최초'}부터 ${lastPeriod ? `${lastPeriod.label}(${dateRange(lastPeriod.from, lastPeriod.until)})` : '마지막'}까지 ${history.length}건이다.`,
          [validityCite(udo)],
        ),
        unknown(
          `${udo.validity?.valid_until ?? '제한기간 종료일'} 뒤의 효력은 원문으로 확인하지 못했다. ${reportedExtension()}시행 중이라고 단정하지 않는다.`,
          [],
          ['N07'],
        ),
        ...udoAreaStatements(cons),
        unknown('방문객 수·혼잡도 같은 부하 지표는 아직 연결하지 않았다(6단계). 이 보고서는 혼잡이나 효과를 수치로 쓰지 않는다.'),
        measure(
          '교통약자 동반(P1)·우도 숙박(P3) 방문객의 반입 허용과 필요한 증빙을 방문 전에 알린다.',
          [udoCite.permitted(udo, 'P1'), udoCite.permitted(udo, 'P3')],
        ),
        measure(
          '렌터카 예약 단계에서 제1종 저공해자동차(전기·수소)가 제한에서 제외되는 점을 알린다.',
          [udoCite.exclusion(udo, 'R1-다'), udoCite.definition(udo, 'R1-다')],
        ),
        measure(
          '우도 안 원동기장치자전거·개인형 이동장치 대여 운행 제한을 도항선 대합실과 대여 현장에서 안내한다.',
          [udoCite.cond(udo, 'R2-나')],
        ),
        measure('당일 방문 집중을 줄이는 체류형 상품(P3 활용)의 효과는 부하 지표를 연결한 뒤 평가한다.', [udoCite.permitted(udo, 'P3')]),
        measure('방문객 총량·사전 예약 같은 수용력 관리 수단을 검토한다. 수집 대상 목록에는 우도 방문객 수를 제한하는 항목이 따로 없다.'),
        measure('보전지역 지정 고시와 지형도면을 공간 데이터로 연결해 위치 기반 판정을 가능하게 한다.'),
      ],
    }),
    section('planning', '3. 에코투어리즘 아이템 후보', {
      lead: '아이템은 제안이다. 판정은 카드에서 도출한 예비 판정이고 검수하지 않았다. 수요·수익·혼잡 완화 효과는 근거가 없어 적지 않는다.',
      ideas: ideas(today),
    }),
    evidenceSection(cards, false),
  ];
}

function businessReport(today: string, cards: { udo: RegulationCard; cons: RegulationCard }): ReportSection[] {
  const { udo, cons } = cards;
  return [
    section('planning', '1. 기획안과 규제 점검', {
      lead: '기획안마다 걸리는 규제와 예비 판정이다. 판정을 누르면 근거와 사전 확인 목록을 볼 수 있다.',
      ideas: ideas(today),
    }),
    section('checklist', '2. 사전 확인 목록', {
      statements: [
        unknown(
          `기획 장소가 절대보전지역 안인지 지정 고시와 지형도면으로 먼저 확인한다. ${udoAbsoluteArea(cons) ? `우도면에도 절대보전지역 ${udoAbsoluteArea(cons)}가 있다. ` : ''}이 서비스는 구역 데이터를 연결하지 않았다.`,
          [areaCite(cons), ...udoAreaCite(cons)],
          ['N04'],
        ),
        fact('절대보전지역에서 허가 대상인 행위는 신청서와 첨부 서류를 내고 도지사의 허가를 받는다. 특별한 사유가 없으면 5일 이내에 처분하며 심의·협의 기간은 빼고 센다.', procedureCites(cons)),
        fact('허가 없이 하면 2년 이하의 징역 또는 2천만원 이하의 벌금, 그리고 원상회복 명령 대상이다.', penaltyCites(cons)),
        fact('우도 안에서 대여 목적으로 운행하는 원동기장치자전거·개인형 이동장치는 운행제한 대상이다. 이동수단 대여 사업을 기획할 때 먼저 본다.', [udoCite.cond(udo, 'R2-나')]),
        unknown('천연기념물 「제주 우도 홍조단괴 해빈」과 우도해양도립공원의 행위제한은 카드가 없어 판정하지 않았다.', [], ['N02', 'N03']),
      ],
    }),
    section('status', '3. 규제 현황', { tables: [cardTable()] }),
    evidenceSection(cards, false),
  ];
}

function travelerReport(cards: { udo: RegulationCard; cons: RegulationCard }): ReportSection[] {
  const { udo } = cards;
  const until = udo.validity?.valid_until ?? '제한기간 종료일';
  return [
    section('before-visit', '방문 전 확인', {
      statements: [
        fact(
          '제주 본섬 등 우도 밖 업체의 렌터카와 전세버스는 우도면에서 운행이 제한됩니다. 전기·수소 렌터카와 승차정원 16인승 전세버스는 제외됩니다.',
          [udoCite.cond(udo, 'R1-다'), udoCite.exclusion(udo, 'R1-다')],
        ),
        fact(
          '교통약자와 함께 가거나(65세 이상, 임신부, 7세 이하 아동 동반 등) 우도 숙박시설을 이용하면 렌터카 반입이 허용됩니다. 신분증이나 증명 서류를 보여 줘야 합니다.',
          [udoCite.permitted(udo, 'P1'), udoCite.permitted(udo, 'P3')],
        ),
        fact('우도 안에서 빌리는 전동킥보드와 원동기장치자전거는 운행이 제한됩니다. 자전거는 제외됩니다.', [
          udoCite.cond(udo, 'R2-나'),
          udoCite.exclusion(udo, 'R2-나'),
        ]),
        fact('위반하면 과태료 10만원 또는 범칙금(승용자동차 4~8만원 등)이 부과될 수 있습니다.', penaltyCites(udo)),
        unknown(
          `위 내용은 ${until}까지의 공고문 기준입니다. 그 뒤의 공고 원문은 확보하지 못했습니다. 가기 전에 제주특별자치도 공고나 현장 안내를 확인하세요.`,
          [],
          ['N07'],
        ),
      ],
    }),
    evidenceSection(cards, true),
  ];
}

const TITLES: Record<Audience, string> = {
  policy: '우도 지역 진단 보고서',
  business: '우도 에코투어리즘 기획 점검표',
  traveler: '우도 방문 전 안내',
};

export function buildReport(audience: Audience, today: string): Report {
  const cards = { udo: requireCard(UDO_VEHICLE_CARD_ID), cons: requireCard(CONSERVATION_CARD_ID) };
  const sections =
    audience === 'traveler' ? travelerReport(cards) : audience === 'business' ? businessReport(today, cards) : policyReport(today, cards);

  const citations = uniqueCitations([
    ...sections.flatMap((s) => s.statements.flatMap((st) => st.basis)),
    ...sections.flatMap((s) => s.ideas.flatMap((idea) => idea.check.citations)),
  ]);
  const cited = new Set(citations.map((c) => c.card_id));

  return {
    area: '우도',
    audience,
    audience_label: AUDIENCES.find((a) => a.value === audience)?.label ?? audience,
    title: TITLES[audience],
    today,
    as_of: dataAsOf(),
    disclaimer:
      '이 보고서는 법률 자문이 아니다. 규제 카드와 수집 대상 목록에서 확인한 것만 근거로 적었고, 확인하지 못한 것은 확인 필요로 표시했다. 최종 확인은 소관 부서에 한다.',
    sections,
    open_questions: CARDS.filter((card) => cited.has(card.card_id)).flatMap((card) =>
      (card.open_questions ?? []).map((question) => ({ card_id: card.card_id, card_title: card.title, question })),
    ),
    citations,
  };
}
