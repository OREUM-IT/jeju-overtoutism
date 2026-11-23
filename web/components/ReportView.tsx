import Link from 'next/link';
import { getSource } from '@/lib/data';
import { CHECK_STATUS_LABEL, type Report, type Statement } from '@/lib/report';
import type { Citation } from '@/lib/verdict';
import { Quote } from './Quote';
import { VerdictBadge } from './VerdictBadge';

const citeKey = (c: Citation) => `${c.card_id}|${c.item_id}|${c.quote ?? ''}`;

function KindBadge({ statement }: { statement: Statement }) {
  if (statement.kind === 'fact') {
    return <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-inset ring-teal-200">근거 있음</span>;
  }
  if (statement.kind === 'unknown') {
    return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300">확인 필요</span>;
  }
  return statement.basis.length > 0 ? (
    <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-200">제안 · 근거 있음</span>
  ) : (
    <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-800 ring-1 ring-inset ring-violet-200">근거 없음, 제안</span>
  );
}

export function ReportView({ report }: { report: Report }) {
  const index = new Map(report.citations.map((c, i) => [citeKey(c), i + 1]));
  const sourceRefs = [...new Set(report.sections.flatMap((s) => s.statements.flatMap((st) => st.source_refs)))]
    .map((id) => getSource(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return (
    <article className="space-y-8" data-testid="report">
      <header className="panel space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-stone-950 sm:text-2xl">{report.title}</h2>
          <p className="text-sm text-stone-500">독자: {report.audience_label}</p>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm text-stone-600 sm:grid-cols-3">
          <div>
            <dt className="inline text-stone-500">작성일 </dt>
            <dd className="inline font-medium text-stone-800">{report.today}</dd>
          </div>
          <div>
            <dt className="inline text-stone-500">카드 추출 </dt>
            <dd className="inline font-medium text-stone-800">{report.as_of.card_extracted_at ?? '없음'}</dd>
          </div>
          <div>
            <dt className="inline text-stone-500">원문 수집 </dt>
            <dd className="inline font-medium text-stone-800">{report.as_of.source_retrieved_at ?? '없음'}</dd>
          </div>
        </dl>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950">{report.disclaimer}</p>
      </header>

      {report.sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="space-y-4">
          <h2 id={`${section.id}-title`} className="text-lg font-bold text-stone-950">
            {section.title}
          </h2>
          {section.lead ? <p className="text-sm leading-relaxed text-stone-600">{section.lead}</p> : null}

          {section.tables.map((table) => (
            <div key={table.caption} className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="border-b border-stone-200 px-3 py-2 text-left text-xs font-semibold text-stone-500">{table.caption}</caption>
                <thead className="bg-stone-50 text-xs text-stone-500">
                  <tr>
                    {table.columns.map((col) => (
                      <th key={col} scope="col" className="px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {table.rows.map((row) => (
                    <tr key={row.join('|')}>
                      {row.map((cell, i) => (
                        <td
                          key={`${i}-${cell}`}
                          className={`px-3 py-2 align-top text-stone-800 ${/^\d{4}-\d{2}-\d{2}$/.test(cell) ? 'whitespace-nowrap' : ''}`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {section.statements.length > 0 ? (
            <ul className="space-y-2">
              {section.statements.map((st) => (
                <li key={st.text} className="rounded-xl border border-stone-200 bg-white px-4 py-3" data-kind={st.kind}>
                  <div className="flex flex-wrap items-start gap-2">
                    <KindBadge statement={st} />
                    <p className="min-w-0 flex-1 basis-64 leading-relaxed text-stone-800">{st.text}</p>
                  </div>
                  {st.basis.length > 0 || st.source_refs.length > 0 ? (
                    <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {st.basis.map((c) => (
                        <a key={citeKey(c)} href={`#cite-${index.get(citeKey(c))}`} className="chip hover:bg-teal-100" title={c.quote ?? c.summary}>
                          [{index.get(citeKey(c))}] {c.item_id}
                        </a>
                      ))}
                      {st.source_refs.map((id) => (
                        <a key={id} href={getSource(id) ? `#source-${id}` : undefined} className="chip bg-stone-200/70">
                          수집 대상 {getSource(id) ? id : '목록'}
                        </a>
                      ))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {section.ideas.length > 0 ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {section.ideas.map((idea) => (
                <li key={idea.id} className="panel flex flex-col gap-3" data-testid={`idea-${idea.id}`}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-stone-950">{idea.title}</h3>
                      {!idea.recommend ? (
                        <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-800">권하지 않음</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-stone-600">{idea.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-stone-500">{idea.check.preliminary.reference_only ? '예비(기간 밖 참고)' : '예비'}</span>
                    <VerdictBadge value={idea.check.preliminary.value} size="sm" />
                    {idea.check.preliminary.items.map((id) => (
                      <span key={id} className="chip">
                        {id}
                      </span>
                    ))}
                    <span className="text-xs text-stone-500">최종</span>
                    <VerdictBadge value={idea.check.final.value} size="sm" />
                  </div>
                  <p className="text-sm leading-relaxed text-stone-700">
                    {idea.check.premise ? <span className="font-medium">{idea.check.premise}: </span> : null}
                    {idea.check.preliminary.summary}
                  </p>
                  {idea.note ? <p className="text-xs text-stone-500">※ {idea.note}</p> : null}
                  <Link href={idea.href} className="link mt-auto text-sm print:hidden">
                    판정 자세히 보기 →
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {report.open_questions.length > 0 ? (
        <section aria-labelledby="open-questions-title" className="space-y-3">
          <h2 id="open-questions-title" className="text-lg font-bold text-stone-950">
            열린 질문
          </h2>
          <ul className="space-y-2 text-sm">
            {report.open_questions.map((q) => (
              <li key={q.question} className="rounded-xl border border-stone-200 bg-white px-4 py-3 leading-relaxed text-stone-800">
                <span className="mb-1 block text-xs text-stone-500">{q.card_title}</span>
                {q.question}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="citations-title" className="space-y-3">
        <h2 id="citations-title" className="text-lg font-bold text-stone-950">
          인용 목록 ({report.citations.length})
        </h2>
        <div className="grid gap-2">
          {report.citations.map((c, i) => (
            <Quote key={citeKey(c)} citation={c} index={i + 1} />
          ))}
        </div>
        {sourceRefs.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-stone-700">참고한 수집 대상 항목</h3>
            <ul className="space-y-2 text-sm">
              {sourceRefs.map((row) => (
                <li key={row.id} id={`source-${row.id}`} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                  <span className="chip mr-2">{row.id}</span>
                  <span className="font-medium text-stone-900">{row.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-stone-500">
                    {CHECK_STATUS_LABEL[row.check_status] ?? row.check_status} · {row.note || row.udo_relevance} · 관측 {row.observed_on}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </article>
  );
}
