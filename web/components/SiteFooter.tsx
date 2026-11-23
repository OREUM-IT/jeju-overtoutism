import Link from 'next/link';
import { CARDS, dataAsOf } from '@/lib/data';

export function SiteFooter() {
  const asOf = dataAsOf();
  const verified = CARDS.filter((card) => card.evidence_grade === 'verified').length;
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-8 text-sm leading-relaxed text-stone-600">
        <p>
          <strong className="text-stone-800">법률 자문이 아닙니다.</strong> 판정은 규제 카드의 문언을 옮긴 것이며, 최종 확인은 소관 기관에
          하세요.
        </p>
        <p>
          정보 기준일: 규제 카드 추출 {asOf.card_extracted_at ?? '없음'} · 원문 수집 {asOf.source_retrieved_at ?? '없음'}. 그 뒤의 개정·공고는
          반영하지 않았습니다.
        </p>
        <p>
          시범 지역 우도 · 규제 카드 {CARDS.length}건(검수 완료 {verified}건) ·{' '}
          <Link href="/cards" className="link">
            카드 보기
          </Link>
        </p>
      </div>
    </footer>
  );
}
