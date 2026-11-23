import { getCard } from '@/lib/data';

/** GET /api/cards/{card_id} — 카드 전체(스키마 0.1-draft) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const card = getCard((await params).id);
  if (!card) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json(card);
}
