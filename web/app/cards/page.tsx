import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro } from '@/components/PageIntro';
import { CARDS } from '@/lib/data';
import { dateRange } from '@/lib/format';
import { collectQuotes } from '@/lib/quotes';
import { GRADE_LABEL, STATUS_LABEL } from '@/lib/verdict';

export const metadata: Metadata = {
  title: '규제 카드',
  description: '판정의 근거가 되는 규제 카드 목록. 인용문, 원문 위치, 유효 기간, 열린 질문을 담는다.',
};

export default function CardsPage() {
  return (
    <>
      <PageIntro eyebrow="공통 · 근거 저장소" title="규제 카드">
        <p>
          조문과 공고문에서 규제의 대상·예외·벌칙을 구조화한 카드입니다. 모든 항목에 원문 인용문과 위치가 붙어 있고, 카드는 모델이 추출한 뒤
          사람이 검수합니다. 저장소의 <code className="chip">data/cards/</code>에 있는 파일을 그대로 읽습니다.
        </p>
      </PageIntro>
      <ul className="grid gap-4 md:grid-cols-2" data-testid="card-list">
        {CARDS.map((card) => {
          const dated = Boolean(card.validity?.valid_from || card.validity?.valid_until);
          return (
            <li key={card.card_id}>
              <Link
                href={`/cards/${card.card_id}`}
                className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-teal-400 hover:shadow-md"
              >
                <span className="font-mono text-xs text-stone-500">{card.card_id}</span>
                <span className="mt-1 text-lg font-bold text-stone-950">{card.title}</span>
                <span className="mt-1 text-sm text-stone-600">{card.source.document}</span>
                <span className="mt-4 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
                    {GRADE_LABEL[card.evidence_grade] ?? card.evidence_grade}
                  </span>
                  <span className="rounded-md bg-stone-100 px-2 py-0.5 font-semibold text-stone-700">
                    {STATUS_LABEL[card.enforcement_status ?? ''] ?? card.enforcement_status ?? '시행 상태 없음'}
                  </span>
                  <span className="rounded-md bg-stone-100 px-2 py-0.5 text-stone-700">
                    {dated ? dateRange(card.validity?.valid_from, card.validity?.valid_until) : '기간 없음'}
                  </span>
                </span>
                <span className="mt-3 text-xs text-stone-500">
                  인용문 {collectQuotes(card).length}개 · 열린 질문 {card.open_questions?.length ?? 0}개 · 추출 {card.extracted_at ?? '없음'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
