import repoData from '@/generated/repo-data.json';
import type { RegulationCard, SourceRow } from './types';

// generated/repo-data.json은 scripts/sync-data.mjs가 저장소의 data/에서 만든다.
// 앱은 이 사본만 읽는다. 수집기·Agent가 서면 같은 모양을 HTTP로 받게 바꾼다(docs/07 7절).
const data = repoData as unknown as { cards: RegulationCard[]; sources: SourceRow[] };

export const CARDS: readonly RegulationCard[] = data.cards;
export const SOURCES: readonly SourceRow[] = data.sources;

export const UDO_VEHICLE_CARD_ID = 'udo-vehicle-restriction-2026-715';
export const CONSERVATION_CARD_ID = 'jeju-absolute-conservation-area';

export function getCard(id: string): RegulationCard | undefined {
  return CARDS.find((card) => card.card_id === id);
}

export function requireCard(id: string): RegulationCard {
  const card = getCard(id);
  if (!card) throw new Error(`규제 카드가 없습니다: ${id}`);
  return card;
}

export function getSource(id: string): SourceRow | undefined {
  return SOURCES.find((row) => row.id === id);
}

/** 카드들 가운데 가장 늦은 날짜. 정보 기준일 표시에 쓴다. */
export function latest(values: (string | null | undefined)[]): string | null {
  const dates = values.filter((v): v is string => typeof v === 'string' && v.length > 0).sort();
  return dates.at(-1) ?? null;
}

export function dataAsOf() {
  return {
    card_extracted_at: latest(CARDS.map((card) => card.extracted_at)),
    source_retrieved_at: latest(
      CARDS.flatMap((card) => [card.source.retrieved_at, ...(card.additional_sources ?? []).map((s) => s.retrieved_at)]),
    ),
    sources_observed_on: latest(SOURCES.map((row) => row.observed_on)),
  };
}
