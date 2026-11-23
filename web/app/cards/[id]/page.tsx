import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CARDS, getCard, getSource } from '@/lib/data';
import { dateRange, itemNo, shortHash, won } from '@/lib/format';
import { collectQuotes } from '@/lib/quotes';
import type { RegulationCard, SourceDoc } from '@/lib/types';
import { documentFor, GRADE_LABEL, penaltyViews, STATUS_LABEL } from '@/lib/verdict';

type Params = Promise<{ id: string }>;

export function generateStaticParams() {
  return CARDS.map((card) => ({ id: card.card_id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const card = getCard((await params).id);
  return card ? { title: card.title, description: `${card.source.document}에서 뽑은 규제 카드` } : { title: '카드 없음' };
}

function Section({ id, title, children, count }: { id: string; title: string; children: ReactNode; count?: number }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="panel">
      <h2 id={`${id}-title`} className="text-base font-bold text-stone-950">
        {title}
        {typeof count === 'number' ? <span className="ml-2 text-sm font-medium text-stone-500">{count}</span> : null}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

function Q({ quote, locator, doc }: { quote?: string | null; locator?: string | null; doc?: string }) {
  if (!quote) return null;
  return (
    <p className="border-l-4 border-teal-700/30 pl-3 text-[13px] text-stone-600">
      “{quote}”
      {locator || doc ? (
        <span className="ml-1 text-xs text-stone-400">
          — {[doc, locator].filter(Boolean).join(' · ')}
        </span>
      ) : null}
    </p>
  );
}

function SourceRow({ src, primary }: { src: SourceDoc; primary?: boolean }) {
  return (
    <div className="rounded-xl border border-stone-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">{src.source_id}</span>
        <span className="font-semibold text-stone-900">{src.document}</span>
        {primary ? <span className="text-xs text-stone-500">기본 원문</span> : null}
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-stone-600 sm:grid-cols-2">
        {src.issuer ? (
          <div>
            <dt className="inline text-stone-400">발행 </dt>
            <dd className="inline">{src.issuer}</dd>
          </div>
        ) : null}
        {src.published ? (
          <div>
            <dt className="inline text-stone-400">게재 </dt>
            <dd className="inline">{src.published}</dd>
          </div>
        ) : null}
        {src.version ? (
          <div className="sm:col-span-2">
            <dt className="inline text-stone-400">판본 </dt>
            <dd className="inline">{src.version}</dd>
          </div>
        ) : null}
        {src.amends ? (
          <div className="sm:col-span-2">
            <dt className="inline text-stone-400">변경 대상 </dt>
            <dd className="inline">{src.amends}</dd>
          </div>
        ) : null}
        {src.provisions?.length ? (
          <div className="sm:col-span-2">
            <dt className="inline text-stone-400">조문 </dt>
            <dd className="inline">{src.provisions.join(', ')}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline text-stone-400">수집 </dt>
          <dd className="inline">{src.retrieved_at ?? '없음'}</dd>
        </div>
        <div>
          <dt className="inline text-stone-400">원문 해시 </dt>
          <dd className="inline font-mono">{shortHash(src.text_sha256)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-stone-500">
        원문 사본은 로컬 전용입니다(Git 미포함).{' '}
        {src.url ? (
          <a href={src.url} target="_blank" rel="noreferrer" className="link">
            출처 열기
          </a>
        ) : null}
      </p>
    </div>
  );
}

function Overview({ card }: { card: RegulationCard }) {
  const v = card.validity;
  const dated = Boolean(v?.valid_from || v?.valid_until);
  return (
    <Section id="overview" title="요약">
      <dl className="divide-y divide-stone-100">
        {[
          ['의무 유형', card.obligation_type],
          ['대상 행위', card.target_activity],
          ['대상 지역', card.target_area?.value],
          ['기간', dated ? dateRange(v?.valid_from, v?.valid_until) : '기간이 정해진 규제가 아님'],
          ['시행 상태', STATUS_LABEL[card.enforcement_status ?? ''] ?? card.enforcement_status],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex gap-3 py-2">
              <dt className="w-20 shrink-0 text-stone-500">{label}</dt>
              <dd className="text-stone-900">{value}</dd>
            </div>
          ))}
      </dl>
      {card.target_area?.note ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">{card.target_area.note}</p> : null}
      <Q quote={card.target_area?.quote} locator={card.target_area?.locator} />
      {card.status_note ? <p className="rounded-lg bg-stone-100 px-3 py-2">{card.status_note}</p> : null}
      {v?.note ? <p className="text-stone-600">{v.note}</p> : null}
      {v?.history?.length ? (
        <div>
          <p className="mb-2 font-medium text-stone-800">제한기간 이력</p>
          <ol className="relative space-y-2 border-l-2 border-stone-200 pl-4">
            {v.history.map((h, i) => (
              <li key={`${h.label}-${h.from}`} className="relative">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[1.4rem] top-1.5 h-3 w-3 rounded-full ring-2 ring-white ${i === v.history!.length - 1 ? 'bg-teal-700' : 'bg-stone-300'}`}
                />
                <span className="font-medium text-stone-900">{h.label}</span> <span className="text-stone-600">{dateRange(h.from, h.until)}</span>
                {i === v.history!.length - 1 ? <span className="ml-2 text-xs text-teal-800">이 카드</span> : null}
              </li>
            ))}
          </ol>
          <Q quote={v.quote} locator={v.locator} />
        </div>
      ) : null}
    </Section>
  );
}

export default async function CardPage({ params }: { params: Params }) {
  const card = getCard((await params).id);
  if (!card) notFound();
  const quotes = collectQuotes(card).length;
  const penalties = penaltyViews(card);

  return (
    <div className="space-y-5">
      <nav aria-label="경로" className="text-sm text-stone-500">
        <Link href="/cards" className="hover:underline">
          규제 카드
        </Link>{' '}
        / <span className="font-mono">{card.card_id}</span>
      </nav>

      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-stone-950 sm:text-3xl">{card.title}</h1>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
            {GRADE_LABEL[card.evidence_grade] ?? card.evidence_grade}
          </span>
          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-700">스키마 {card.schema_version}</span>
          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-700" data-testid="quote-count">
            인용문 {quotes}개
          </span>
          <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-700">
            추출 {card.extracted_at ?? '없음'}({card.extracted_by ?? '추출자 없음'}) · 검수 {card.reviewed_at ?? '전'}
          </span>
        </div>
        {card.evidence_grade !== 'verified' ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            사람이 원문과 대조하기 전의 카드입니다. 이 카드로 내린 판정의 최종 값은 “확인 필요”입니다.
          </p>
        ) : null}
      </header>

      <Overview card={card} />

      <Section id="sources" title="원문">
        <SourceRow src={card.source} primary />
        {card.additional_sources?.map((src) => <SourceRow key={src.source_id} src={src} />)}
      </Section>

      {card.legal_basis ? (
        <Section id="legal-basis" title="법적 근거">
          <Q quote={card.legal_basis.quote} locator={card.legal_basis.locator} />
          <ul className="space-y-1">
            {card.legal_basis.provisions?.map((p) => (
              <li key={`${p.source_id}-${p.provision}`}>
                <span className="chip mr-2">{p.source_id}</span>
                {getSource(p.source_id)?.name ?? p.source_id} {p.provision}{' '}
                <span className={p.text_read ? 'text-teal-800' : 'text-stone-500'}>{p.text_read ? '· 본문 읽음' : '· 본문 읽지 않음'}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {card.restricted?.length ? (
        <Section id="restricted" title="제한 대상" count={card.restricted.length}>
          {card.restricted.map((r) => (
            <div key={r.id} className="rounded-xl border border-stone-200 p-3">
              <p>
                <span className="chip mr-2">{r.id}</span>
                <span className="font-semibold text-stone-900">{r.scope}</span>
              </p>
              <Q quote={r.quote} locator={r.locator} />
              {r.acts?.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {r.acts.map((act) => (
                    <li key={act} className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-800">
                      {act}
                    </li>
                  ))}
                </ul>
              ) : null}
              {r.conditions?.length ? (
                <ul className="mt-3 space-y-3 border-l-2 border-stone-100 pl-3">
                  {r.conditions.map((c) => (
                    <li key={c.id} className="space-y-1.5">
                      <p>
                        <span className="chip mr-2">{c.id}</span>
                        {c.summary}
                      </p>
                      <Q quote={c.quote} />
                      {c.exclusions?.map((ex) => (
                        <div key={ex.summary} className="rounded-lg bg-teal-50/70 px-3 py-2">
                          <p className="text-teal-900">
                            <span className="mr-1 font-semibold">단서(제외)</span>
                            {ex.summary}
                          </p>
                          <Q quote={ex.quote} />
                        </div>
                      ))}
                      {c.definitions?.map((d) => (
                        <div key={d.term} className="rounded-lg bg-stone-100 px-3 py-2">
                          <p>
                            <span className="mr-1 font-semibold">정의 · {d.term}</span>
                            {d.summary}
                          </p>
                          <Q quote={d.quote} />
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}

      {card.permitted_entry ? (
        <Section id="permitted" title="반입 허용(운행 제한 제외 대상)" count={card.permitted_entry.items.length}>
          <Q quote={card.permitted_entry.quote} locator={card.permitted_entry.locator} />
          <ul className="space-y-3">
            {card.permitted_entry.items.map((p) => (
              <li key={p.id} className="rounded-xl border border-stone-200 p-3">
                <p>
                  <span className="chip mr-2">{p.id}</span>
                  <span className="font-semibold text-stone-900">{p.summary}</span>
                </p>
                <Q quote={p.quote} />
                {p.who?.length ? (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5">
                    {p.who.map((w) => (
                      <li key={w.summary}>{w.summary}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {card.permitted_entry.proof ? (
            <div className="rounded-lg bg-stone-100 px-3 py-2">
              <p>
                <span className="mr-1 font-semibold">증빙</span>
                {card.permitted_entry.proof.summary}
              </p>
              <Q quote={card.permitted_entry.proof.quote} />
            </div>
          ) : null}
        </Section>
      ) : null}

      {card.permit_exceptions ? (
        <Section id="permit-exceptions" title="허가를 받으면 할 수 있는 행위" count={card.permit_exceptions.items.length}>
          <p>
            {card.permit_exceptions.summary}
            {card.permit_exceptions.permit_authority ? ` (허가권자: ${card.permit_exceptions.permit_authority})` : ''}
          </p>
          <Q quote={card.permit_exceptions.quote} locator={card.permit_exceptions.locator} />
          <ul className="space-y-3">
            {card.permit_exceptions.items.map((e) => (
              <li key={e.id} className="rounded-xl border border-stone-200 p-3">
                <p>
                  <span className="chip mr-2">{e.id}</span>
                  <span className="font-semibold text-stone-900">{e.summary}</span>
                </p>
                <Q quote={e.quote} locator={e.locator} />
                {e.detail ? (
                  <details className="mt-2 rounded-lg bg-stone-50 px-3 py-2" open>
                    <summary className="cursor-pointer font-medium text-stone-800">
                      {documentFor(card, e.detail.src)} {e.detail.locator} · {e.detail.items.length}개 호
                      {e.detail.item_count && e.detail.item_count !== e.detail.items.length ? `(원문 ${e.detail.item_count}개 호)` : ''}
                    </summary>
                    {e.detail.tourism_relevant_note ? <p className="mt-2 text-xs text-stone-500">{e.detail.tourism_relevant_note}</p> : null}
                    <ul className="mt-2 space-y-1.5">
                      {e.detail.items.map((item) => (
                        <li key={item.no} className={item.tourism_relevant ? 'rounded-md bg-teal-50 px-2 py-1' : 'px-2 py-0.5'}>
                          <span className="chip mr-2">{itemNo(item.no)}</span>
                          {item.summary}
                          {item.tourism_relevant ? <span className="ml-2 text-xs font-semibold text-teal-800">관광·탐방 관련</span> : null}
                          {item.exclusion ? <span className="ml-2 text-xs text-rose-700">단서: {item.exclusion.summary}</span> : null}
                          {item.period ? <span className="ml-2 text-xs text-amber-800">기간: {item.period.summary}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {card.permit_procedure ? (
        <Section id="procedure" title="허가 절차">
          {[
            ['신청', card.permit_procedure.application],
            ['처리', card.permit_procedure.processing],
            ['불허가', card.permit_procedure.refusal],
          ].map(([label, step]) =>
            step && typeof step === 'object' ? (
              <div key={String(label)}>
                <p>
                  <span className="mr-1 font-semibold">{String(label)}</span>
                  {step.summary}
                </p>
                <Q quote={step.quote} locator={card.permit_procedure?.locator} />
              </div>
            ) : null,
          )}
        </Section>
      ) : null}

      {card.grandfathering ? (
        <Section id="grandfathering" title="기존 사업">
          <p>{card.grandfathering.summary}</p>
          <Q quote={card.grandfathering.quote} locator={card.grandfathering.locator} />
        </Section>
      ) : null}

      {card.designation ? (
        <Section id="designation" title="지정">
          {card.designation.authority ? <p>지정권자: {card.designation.authority}</p> : null}
          {card.designation.procedure ? (
            <>
              <p>{card.designation.procedure.summary}</p>
              <Q quote={card.designation.procedure.quote} locator={card.designation.procedure.locator} />
            </>
          ) : null}
          <ul className="space-y-2">
            {card.designation.criteria?.map((d) => (
              <li key={d.id}>
                <span className="chip mr-2">{d.id}</span>
                {d.summary}
                {d.detail?.items.length ? (
                  <ul className="mt-1 list-disc pl-6 text-stone-600">
                    {d.detail.items.map((it) => (
                      <li key={it.summary}>{it.summary}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {penalties.length ? (
        <Section id="penalties" title="벌칙" count={penalties.length}>
          <ul className="space-y-3">
            {card.penalties?.map((p) => {
              const view = penalties.find((v) => v.id === p.id);
              return (
                <li key={p.id} className="rounded-xl border border-stone-200 p-3">
                  <p>
                    <span className="chip mr-2">{p.id}</span>
                    <span className="font-semibold text-stone-900">{view?.summary}</span>
                  </p>
                  <p className="mt-1 text-stone-600">
                    {p.violation}
                    {p.basis ? ` · ${p.basis}` : ''}
                  </p>
                  {p.amount_krw_range?.length ? (
                    <ul className="mt-1 list-disc pl-5">
                      {view?.lines.map((line) => (
                        <li key={line.label}>{line.label}</li>
                      ))}
                    </ul>
                  ) : null}
                  {p.fine_max_krw ? <p className="text-xs text-stone-500">벌금 상한 {won(p.fine_max_krw)}</p> : null}
                  <Q quote={p.quote ?? p.applies_quote?.quote} locator={p.locator} />
                  {p.procedure ? <p className="mt-1 text-stone-600">절차: {p.procedure.summary}</p> : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {card.delegations?.length ? (
        <Section id="delegations" title="조례 위임">
          {card.delegations.map((d) => (
            <div key={d.to}>
              <p>
                <span className="chip mr-2">{d.to}</span>
                {d.document} {d.text_read ? '· 본문 읽음' : '· 본문 읽지 않음'}
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {d.matters?.map((m) => (
                  <li key={m.law}>
                    {m.law} → 조례 {m.ordinance}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      ) : null}

      {card.related?.length ? (
        <Section id="related" title="관련">
          <ul className="list-disc space-y-1 pl-5">
            {card.related.map((r) => (
              <li key={r.note}>
                <span className="font-medium">{r.relation}</span>
                {r.source_id ? ` (${r.source_id})` : ''}: {r.note}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {card.open_questions?.length ? (
        <Section id="open-questions" title="열린 질문" count={card.open_questions.length}>
          <ul className="list-disc space-y-1.5 pl-5">
            {card.open_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <details className="panel">
        <summary className="cursor-pointer text-sm font-semibold text-stone-800">카드 원본(JSON)</summary>
        <pre className="mt-3 max-h-[32rem] overflow-auto rounded-lg bg-stone-950 p-3 text-xs leading-relaxed text-stone-100">
          {JSON.stringify(card, null, 2)}
        </pre>
        <p className="mt-2 text-xs text-stone-500">
          API: <code className="chip">GET /api/cards/{card.card_id}</code>
        </p>
      </details>
    </div>
  );
}
