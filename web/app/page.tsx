import Link from 'next/link';
import { DraftNotice } from '@/components/PageIntro';
import { VerdictBadge } from '@/components/VerdictBadge';
import { CARDS, CONSERVATION_CARD_ID, getSource, requireCard, UDO_VEHICLE_CARD_ID } from '@/lib/data';
import { dateRange } from '@/lib/format';
import { GRADE_LABEL, STATUS_LABEL, VERDICT_INFO, VERDICT_VALUES } from '@/lib/verdict';

const AUDIENCES = [
  {
    href: '/check',
    who: '여행자',
    title: '방문 전 체크',
    body: '렌터카·전세버스·킥보드로 우도에 가도 되는지, 방문일과 동행 조건으로 확인합니다.',
    example: '예: 본섬 렌터카 + 7세 아이 동반',
  },
  {
    href: '/plan',
    who: '관광 사업자·창업팀',
    title: '기획 점검',
    body: '탐방 데크, 해설 프로그램, 해수욕장 매점 같은 기획이 절대보전지역 규제에 걸리는지 봅니다.',
    example: '예: 민간이 탐방 데크 설치',
  },
  {
    href: '/report',
    who: '정책 담당자·관광 기획자',
    title: '지역 진단 보고서',
    body: '우도의 규제 현황, 비어 있는 곳, 근거가 있는 대응 방향과 없는 제안을 나눠 보여 줍니다.',
    example: '인쇄·PDF 저장 가능',
  },
] as const;

export default function HomePage() {
  const udo = requireCard(UDO_VEHICLE_CARD_ID);
  const cons = requireCard(CONSERVATION_CARD_ID);
  const followUp = getSource('N07');
  const zones = getSource('N04');
  const unverified = CARDS.filter((card) => card.evidence_grade !== 'verified').length;

  return (
    <div className="space-y-12">
      <section className="max-w-3xl">
        <p className="text-sm font-semibold text-teal-800">시범 지역 · 우도</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-stone-950 sm:text-4xl">
          “이렇게 해도 되나”를
          <br className="sm:hidden" /> 조문으로 확인합니다
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-stone-700">
          판정마다 규제 카드의 인용문, 원문 위치, 시행 상태, 정보 기준일을 붙입니다. 확인되지 않은 것은 “확인 필요”라고 말합니다.
        </p>
        <div className="mt-5">
          <DraftNotice>
            <strong>화면 시안입니다.</strong> 규제 카드 {CARDS.length}건 가운데 {unverified}건이 사람의 검수 전(
            {GRADE_LABEL.extracted})이라 최종 판정은 모두 “확인 필요”로 나옵니다. 카드 문언에 따른 예비 판정은 함께 보여 줍니다.
          </DraftNotice>
        </div>
      </section>

      <section aria-labelledby="audiences">
        <h2 id="audiences" className="text-lg font-bold text-stone-900">
          누구신가요?
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className="group flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-teal-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              >
                <span className="text-sm font-semibold text-teal-800">{a.who}</span>
                <span className="mt-1 text-xl font-bold text-stone-950">{a.title}</span>
                <span className="mt-2 flex-1 text-sm leading-relaxed text-stone-600">{a.body}</span>
                <span className="mt-4 flex items-center justify-between text-xs text-stone-500">
                  {a.example}
                  <span aria-hidden="true" className="text-base text-teal-800 transition group-hover:translate-x-0.5">
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="known" className="grid gap-4 md:grid-cols-2">
        <h2 id="known" className="text-lg font-bold text-stone-900 md:col-span-2">
          지금 아는 것과 모르는 것
        </h2>
        <article className="panel">
          <h3 className="font-semibold text-stone-900">{udo.title}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-stone-500">확인함</dt>
              <dd>
                {udo.source.document}, 제한기간 {dateRange(udo.validity?.valid_from, udo.validity?.valid_until)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-stone-500">모름</dt>
              <dd>
                {udo.validity?.valid_until} 뒤의 공고 원문.{' '}
                {followUp ? <span className="text-stone-600">보도만 있음(수집 대상 {followUp.id}).</span> : null}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-stone-500">시행 상태</dt>
              <dd>{STATUS_LABEL[udo.enforcement_status ?? ''] ?? udo.enforcement_status}</dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <h3 className="font-semibold text-stone-900">{cons.title}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-stone-500">확인함</dt>
              <dd>
                제주특별법 제355조 등({cons.source.version?.split(',')[0] ?? '판본 표기 없음'} 판본)과 「보전지역 관리에 관한 조례」
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-stone-500">모름</dt>
              <dd>
                우도에 절대보전지역이 지정되어 있는지. {zones ? <span className="text-stone-600">찾지 못함(수집 대상 {zones.id}).</span> : null}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-stone-500">시행 상태</dt>
              <dd>{STATUS_LABEL[cons.enforcement_status ?? ''] ?? cons.enforcement_status}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section aria-labelledby="legend">
        <h2 id="legend" className="text-lg font-bold text-stone-900">
          판정 값
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {VERDICT_VALUES.map((value) => (
            <li key={value} className="flex items-start gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-stone-200">
              <VerdictBadge value={value} size="sm" />
              <span className="text-sm text-stone-700">{VERDICT_INFO[value].meaning}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-stone-600">
          검수 전 카드, 유효 기간 밖의 날짜, 확인하지 못한 위치에 대해서는 최종 판정을 “확인 필요”로 낮춥니다.{' '}
          <Link href="/cards" className="link">
            규제 카드 보기
          </Link>
        </p>
      </section>
    </div>
  );
}
