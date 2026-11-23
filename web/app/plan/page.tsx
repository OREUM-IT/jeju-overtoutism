import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckShell } from '@/components/CheckShell';
import { FormErrors, Legend, RadioCards } from '@/components/fields';
import { PageIntro } from '@/components/PageIntro';
import { EmptyResult, ResultPanel, ResultSummary } from '@/components/ResultPanel';
import { ACTIVITIES, ACTORS, checkPlan, LOCATIONS, parsePlan, planQuery } from '@/lib/checks/conservation-plan';
import { CONSERVATION_CARD_ID, requireCard } from '@/lib/data';
import { todayKst } from '@/lib/format';
import { fromSearchParams } from '@/lib/params';

export const metadata: Metadata = {
  title: '기획 점검',
  description: '에코투어리즘 기획안이 절대보전지역의 행위제한에 걸리는지 카드 문언으로 점검합니다.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const today = todayKst();
  const { values, input, errors } = parsePlan(fromSearchParams(await searchParams));
  const result = input ? checkPlan(input, today) : null;
  const card = requireCard(CONSERVATION_CARD_ID);
  const relevant = card.permit_exceptions?.items.find((e) => e.id === 'E5')?.detail?.items.filter((i) => i.tourism_relevant) ?? [];

  return (
    <>
      <PageIntro eyebrow="관광 사업자·창업팀 · 절대보전지역 행위제한" title="기획 점검">
        <p>
          기획 유형과 시행 주체, 위치를 고르면 제주특별법 제355조와 「보전지역 관리에 관한 조례」의 문언에 따른 판정, 허가 절차, 사전
          확인 목록을 보여 줍니다.
        </p>
        <p className="text-sm text-stone-600">
          어느 땅이 절대보전지역인지는 조문이 아니라 지정 고시와 구역도로 정해집니다. 위치를 확인하지 않았다면 모든 판정에 “그 위치가
          절대보전지역 안이라면”이라는 전제가 붙습니다.
        </p>
      </PageIntro>
      <CheckShell
        summary={result ? <ResultSummary result={result} /> : null}
        fields={
          <>
            <FormErrors errors={errors} />
            <fieldset>
              <Legend>기획 유형</Legend>
              <RadioCards name="activity" options={ACTIVITIES} value={values.activity} />
            </fieldset>
            <fieldset>
              <Legend>시행 주체</Legend>
              <RadioCards name="actor" options={ACTORS} value={values.actor} />
            </fieldset>
            <fieldset>
              <Legend hint="지정 고시·지형도면(토지이용계획 확인 등)으로 확인했는지">위치가 절대보전지역 안인가요?</Legend>
              <RadioCards name="location" options={LOCATIONS} value={values.location} columns="sm:grid-cols-3" />
            </fieldset>
          </>
        }
        result={
          result ? (
            <ResultPanel result={result} />
          ) : (
            <EmptyResult>
              <p className="font-medium text-stone-800">기획 유형을 고르면 판정이 나옵니다.</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {[
                  { label: '민간 탐방 데크', q: { activity: 'deck', actor: 'private', location: 'unknown' } },
                  { label: '해설 탐방 프로그램', q: { activity: 'guided_program', actor: 'private', location: 'unknown' } },
                  { label: '해수욕장 임시 매점', q: { activity: 'beach_kiosk', actor: 'private', location: 'inside' } },
                ].map((ex) => (
                  <li key={ex.label}>
                    <Link
                      href={`/plan?${planQuery(ex.q as Parameters<typeof planQuery>[0])}`}
                      className="inline-block rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:border-teal-500 hover:text-teal-900"
                    >
                      {ex.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-5 border-t border-stone-200 pt-4">
                <p className="font-medium text-stone-800">조례 제6조 가운데 관광·탐방과 관련 있어 보이는 호 {relevant.length}개</p>
                <ul className="mt-2 space-y-1">
                  {relevant.map((item) => (
                    <li key={item.no}>
                      <span className="chip mr-2">제{item.no}호</span>
                      {item.summary}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-stone-500">관련 여부는 카드 작성자의 판단이며 검수하지 않았습니다.</p>
              </div>
            </EmptyResult>
          )
        }
      />
    </>
  );
}
