import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckShell } from '@/components/CheckShell';
import { CheckboxCards, Conditional, FlagCard, FormErrors, Legend, RadioCards } from '@/components/fields';
import { PageIntro } from '@/components/PageIntro';
import { EmptyResult, ResultPanel, ResultSummary } from '@/components/ResultPanel';
import {
  checkVisit,
  COMPANIONS,
  FUELS,
  OPERATORS,
  parseVisit,
  UDO_RENTALS,
  VISIT_MODES,
  visitQuery,
  type VisitValues,
} from '@/lib/checks/udo-visit';
import { requireCard, UDO_VEHICLE_CARD_ID } from '@/lib/data';
import { dateRange, todayKst } from '@/lib/format';
import { fromSearchParams } from '@/lib/params';

export const metadata: Metadata = {
  title: '방문 전 체크',
  description: '우도 차량 운행제한 공고의 문언으로 방문 조건을 판정합니다.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function VisitFields({ values, errors }: { values: VisitValues; errors: string[] }) {
  const mode = values.mode;
  return (
    <>
      <FormErrors errors={errors} />
      <div>
        <label htmlFor="date" className="field-label">
          방문일
        </label>
        <input id="date" name="date" type="date" defaultValue={values.date} className="text-input" aria-describedby="date-hint" />
        <p id="date-hint" className="field-hint">
          공고문의 제한기간과 비교합니다.
        </p>
      </div>

      <fieldset>
        <Legend>어떻게 다니나요?</Legend>
        <RadioCards name="mode" options={VISIT_MODES} value={mode} />
      </fieldset>

      <Conditional field="mode" values={['rental_car']} current={mode}>
        <Legend>렌터카 연료</Legend>
        <RadioCards name="fuel" options={FUELS} value={values.fuel} columns="grid-cols-2" />
      </Conditional>

      <Conditional field="mode" values={['rental_car', 'charter_bus']} current={mode}>
        <Legend hint="차를 빌린 업체·운송사의 등록된 본거지와 차고지">업체 위치</Legend>
        <RadioCards name="operator" options={OPERATORS} value={values.operator} columns="sm:grid-cols-3" />
      </Conditional>

      <Conditional field="mode" values={['charter_bus']} current={mode}>
        <label htmlFor="seats" className="field-label">
          승차정원
        </label>
        <div className="flex items-center gap-2">
          <input
            id="seats"
            name="seats"
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            defaultValue={values.seats}
            className="text-input w-28"
            aria-describedby="seats-hint"
          />
          <span className="mt-1.5 text-sm text-stone-600">인승</span>
        </div>
        <p id="seats-hint" className="field-hint">
          자동차 등록증에 적힌 승차정원
        </p>
      </Conditional>

      <Conditional field="mode" values={['udo_rental']} current={mode}>
        <Legend hint="우도면 안에서 대여 목적으로 운행하는 이동수단">빌리는 이동수단</Legend>
        <RadioCards name="rental" options={UDO_RENTALS} value={values.rental} />
      </Conditional>

      <Conditional field="mode" values={['rental_car']} current={mode}>
        <Legend hint="해당하면 반입 허용 예외(P1~P4)를 봅니다. 증빙이 필요합니다.">해당하는 것</Legend>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-stone-600">함께 가는 사람(본인 포함)</p>
            <CheckboxCards name="companion" options={COMPANIONS} values={values.companions} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <FlagCard name="stay" label="우도면 안 숙박시설 이용" checked={values.stay} />
            <FlagCard
              name="long_term"
              label="6개월 이상 장기 대여"
              hint="제주도민 또는 우도면 사업장 등록자"
              checked={values.longTerm}
            />
            <FlagCard name="approval" label="도지사(시장) 승인 받음" hint="주민복리·농사·취재 등" checked={values.approval} />
          </div>
        </div>
      </Conditional>
    </>
  );
}

const EXAMPLES = [
  { label: '본섬 휘발유 렌터카', query: { mode: 'rental_car', fuel: 'combustion', operator: 'outside' } },
  { label: '전기 렌터카', query: { mode: 'rental_car', fuel: 'electric', operator: 'outside' } },
  { label: '렌터카 + 7세 아이', query: { mode: 'rental_car', fuel: 'combustion', operator: 'outside', companions: ['child7'] } },
  { label: '15인승 전세버스', query: { mode: 'charter_bus', operator: 'outside', seats: 15 } },
  { label: '우도 전동킥보드', query: { mode: 'udo_rental', rental: 'pm' } },
] as const;

export default async function CheckPage({ searchParams }: { searchParams: SearchParams }) {
  const today = todayKst();
  const { values, input, errors } = parseVisit(fromSearchParams(await searchParams), today);
  const result = input ? checkVisit(input, today) : null;
  const card = requireCard(UDO_VEHICLE_CARD_ID);

  return (
    <>
      <PageIntro eyebrow="여행자 · 우도 차량 운행제한" title="방문 전 체크">
        <p>
          방문일과 이동수단을 고르면 {card.source.document}의 문언에 따른 판정과 근거를 보여 줍니다. 이 공고의 제한기간은{' '}
          {dateRange(card.validity?.valid_from, card.validity?.valid_until)}입니다.
        </p>
      </PageIntro>
      <CheckShell
        summary={result ? <ResultSummary result={result} /> : null}
        fields={<VisitFields values={values} errors={errors} />}
        result={
          result ? (
            <ResultPanel result={result} />
          ) : (
            <EmptyResult>
              <p className="font-medium text-stone-800">이동수단을 고르면 판정이 나옵니다.</p>
              <p className="mt-3">예시로 시작하기</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <li key={ex.label}>
                    <Link
                      href={`/check?${visitQuery({ date: card.validity?.valid_until ?? today, ...ex.query, companions: 'companions' in ex.query ? [...ex.query.companions] : [] })}`}
                      className="inline-block rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:border-teal-500 hover:text-teal-900"
                    >
                      {ex.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-stone-500">예시는 공고문의 제한기간 마지막 날({card.validity?.valid_until})을 방문일로 씁니다.</p>
            </EmptyResult>
          )
        }
      />
    </>
  );
}
