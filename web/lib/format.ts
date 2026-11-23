/** 오늘 날짜(KST, YYYY-MM-DD). */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** YYYY-MM-DD 형식이고 실제로 있는 날짜인지. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 100000 → "10만원", 12500 → "12,500원" */
export function won(amount: number): string {
  if (amount >= 10000 && amount % 10000 === 0) return `${(amount / 10000).toLocaleString('ko-KR')}만원`;
  return `${amount.toLocaleString('ko-KR')}원`;
}

/** 50000, 90000 → "5~9만원" */
export function wonRange(min: number, max: number): string {
  if (min % 10000 === 0 && max % 10000 === 0) return `${min / 10000}~${max / 10000}만원`;
  return `${won(min)}~${won(max)}`;
}

export function dateRange(from: string | null | undefined, until: string | null | undefined): string {
  if (!from && !until) return '기간 없음';
  return `${from ?? '…'} ~ ${until ?? '…'}`;
}

/** "3의2" → "제3호의2", "7" → "제7호" */
export function itemNo(no: string): string {
  const [main, branch] = no.split('의');
  return branch ? `제${main}호의${branch}` : `제${main}호`;
}

export function shortHash(hash: string | undefined): string {
  return hash ? `${hash.slice(0, 12)}…` : '없음';
}
