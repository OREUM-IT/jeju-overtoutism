/** 카드 안의 모든 "quote" 값을 모은다(scripts/check_card_quotes.py와 같은 규칙). */
export function collectQuotes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const value of node) collectQuotes(value, out);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'quote' && typeof value === 'string') out.push(value);
      else collectQuotes(value, out);
    }
  }
  return out;
}
