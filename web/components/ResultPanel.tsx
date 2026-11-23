import Link from 'next/link';
import type { ReactNode } from 'react';
import { CHECK_STATUS_LABEL } from '@/lib/report';
import { GRADE_LABEL, VERDICT_INFO, type CheckResult } from '@/lib/verdict';
import { Quote } from './Quote';
import { VerdictBadge } from './VerdictBadge';

function Panel({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="panel" data-testid={testId}>
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

export function ResultPanel({ result }: { result: CheckResult }) {
  const { final, preliminary } = result;
  return (
    <section id="result" aria-labelledby="result-heading" className="scroll-mt-32 space-y-4" data-testid="result">
      <h2 id="result-heading" className="sr-only">
        판정 결과
      </h2>

      <div className="panel shadow-sm" data-testid="final">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-stone-500">최종 판정</p>
          <Link href={`/cards/${result.card.card_id}`} className="text-xs text-stone-500 underline-offset-2 hover:underline">
            {result.card.title}
          </Link>
        </div>
        <div className="mt-2" aria-live="polite">
          <VerdictBadge value={final.value} size="lg" />
        </div>
        {result.premise ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="premise">
            <strong className="font-semibold">전제:</strong> {result.premise}
          </p>
        ) : null}
        {final.reasons.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-stone-700" data-testid="final-reasons">
            {final.reasons.map((reason) => (
              <li key={reason.code} className="flex gap-2" data-reason={reason.code}>
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                <span>
                  {reason.message}
                  {reason.detail ? <span className="mt-1 block text-xs text-stone-500">{reason.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="panel" data-testid="preliminary">
        <p className="text-sm font-medium text-stone-500">
          {preliminary.reference_only ? '공고문 문언 기준 판정 · 기간 밖이라 참고만' : '카드 문언 기준 예비 판정'}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <VerdictBadge value={preliminary.value} />
          {preliminary.items.map((id) => (
            <span key={id} className="chip">
              {id}
            </span>
          ))}
        </div>
        <p className="mt-3 leading-relaxed text-stone-800">{preliminary.summary}</p>
        <p className="mt-2 text-xs text-stone-500">「{preliminary.value}」: {VERDICT_INFO[preliminary.value].meaning}</p>
      </div>

      {result.citations.length > 0 ? (
        <Panel title="근거" testId="citations">
          {result.citations.map((c) => (
            <Quote key={`${c.item_id}|${c.quote}`} citation={c} />
          ))}
        </Panel>
      ) : null}

      {result.alternatives.length > 0 ? (
        <Panel title="이렇게 하면 달라집니다">
          <ul className="space-y-2">
            {result.alternatives.map((alt) => (
              <li key={alt.item_id} className="flex gap-2">
                <span className="chip h-fit">{alt.item_id}</span>
                <span>{alt.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {result.proof ? (
        <Panel title="준비할 증빙" testId="proof">
          <p>{result.proof.summary}</p>
          {result.proof.quote ? (
            <p className="text-xs text-stone-500">
              “{result.proof.quote}” · {result.card.document}
              {result.proof.locator ? ` · ${result.proof.locator}` : ''}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {result.procedure ? (
        <Panel title={`허가 절차${result.procedure.authority ? ` · 허가권자 ${result.procedure.authority}` : ''}`} testId="procedure">
          <ol className="space-y-2">
            {result.procedure.steps.map((step, i) => (
              <li key={step.label} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-900">
                  {i + 1}
                </span>
                <span>
                  <strong className="font-semibold text-stone-900">{step.label}</strong> {step.summary}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-stone-500">
            {result.procedure.document}
            {result.procedure.locator ? ` · ${result.procedure.locator}` : ''}
          </p>
        </Panel>
      ) : null}

      {result.penalties.length > 0 ? (
        <Panel title="위반하면" testId="penalties">
          <ul className="space-y-3">
            {result.penalties.map((p) => (
              <li key={p.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">{p.id}</span>
                  <strong className="font-semibold text-stone-900">{p.summary}</strong>
                </div>
                <p className="mt-1 text-stone-600">
                  {p.violation}
                  {p.basis ? ` · ${p.basis}` : ''}
                </p>
                {p.lines.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-stone-700">
                    {p.lines.map((line) => (
                      <li key={line.label}>{line.label}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-1 text-xs text-stone-500">
                  {p.document}
                  {p.locator ? ` · ${p.locator}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {result.open_questions.length > 0 ? (
        <Panel title="아직 확인할 것" testId="open-questions">
          <ul className="list-disc space-y-1.5 pl-5">
            {result.open_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {result.related.length > 0 ? (
        <Panel title="함께 볼 규제 (카드 없음 · 판정하지 않음)">
          <ul className="space-y-2">
            {result.related.map((r) => (
              <li key={r.id}>
                <span className="chip mr-2">{r.id}</span>
                <span className="font-medium text-stone-900">{r.name}</span>
                <span className="block text-xs text-stone-500">
                  {r.note} · 확인 상태: {CHECK_STATUS_LABEL[r.check_status] ?? r.check_status}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-stone-500">작성자가 고른 후보이며, 수집 대상 목록(data/udo-regulation-sources.csv)의 항목입니다.</p>
        </Panel>
      ) : null}

      {result.notes.length > 0 ? (
        <ul className="space-y-1 px-1 text-sm text-stone-600">
          {result.notes.map((note) => (
            <li key={note}>※ {note}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-1 rounded-xl bg-stone-100 px-4 py-3 text-xs leading-relaxed text-stone-600" data-testid="as-of">
        <p>
          정보 기준일: 카드 추출 {result.as_of.card_extracted_at ?? '없음'} · 원문 수집 {result.as_of.source_retrieved_at ?? '없음'}
          {result.as_of.source_published ? ` · 원문 게재 ${result.as_of.source_published}` : ''} · 근거 등급{' '}
          {GRADE_LABEL[result.card.evidence_grade] ?? result.card.evidence_grade}
        </p>
        <p>{result.disclaimer}</p>
        <p>
          <Link href={`/cards/${result.card.card_id}`} className="link">
            규제 카드 전체 보기
          </Link>
          {result.card.url ? (
            <>
              {' · '}
              <a href={result.card.url} className="link" target="_blank" rel="noreferrer">
                원문 출처
              </a>
            </>
          ) : null}
        </p>
      </div>
    </section>
  );
}

export function EmptyResult({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 p-6 text-sm leading-relaxed text-stone-600" data-testid="empty-result">
      {children}
    </div>
  );
}

/** 폼 아래 막대에 보이는 요약. 누르면 결과로 내려간다. */
export function ResultSummary({ result }: { result: CheckResult }) {
  return (
    <a href="#result" className="inline-flex flex-wrap items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800">
      <span>예비</span>
      <VerdictBadge value={result.preliminary.value} size="sm" />
      <span>최종</span>
      <VerdictBadge value={result.final.value} size="sm" />
      <span className="font-medium text-teal-800 lg:hidden">결과 보기 ↓</span>
    </a>
  );
}
