import { CARDS, dataAsOf } from '@/lib/data';
import { collectQuotes } from '@/lib/quotes';

export const dynamic = 'force-static';

/** GET /api/cards — 카드 요약 목록(Agent 도구 search_regulation_cards에 대응) */
export function GET() {
  return Response.json({
    as_of: dataAsOf(),
    cards: CARDS.map((card) => ({
      card_id: card.card_id,
      title: card.title,
      schema_version: card.schema_version,
      evidence_grade: card.evidence_grade,
      enforcement_status: card.enforcement_status ?? null,
      obligation_type: card.obligation_type ?? null,
      target_area: card.target_area?.value ?? null,
      validity: { valid_from: card.validity?.valid_from ?? null, valid_until: card.validity?.valid_until ?? null },
      source: { document: card.source.document, url: card.source.url ?? null, retrieved_at: card.source.retrieved_at ?? null },
      quote_count: collectQuotes(card).length,
      open_question_count: card.open_questions?.length ?? 0,
    })),
  });
}
