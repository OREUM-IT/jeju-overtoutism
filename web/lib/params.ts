// 화면의 검색 매개변수와 API의 JSON 본문을 같은 방식으로 읽는다.

export type ParamGetter = (key: string) => string | string[] | undefined;

export function fromSearchParams(params: Record<string, string | string[] | undefined>): ParamGetter {
  return (key) => params[key];
}

export function fromJson(body: unknown): ParamGetter {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return (key) => {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'boolean') return value ? '1' : '0';
    return String(value);
  };
}

export function first(get: ParamGetter, key: string): string | undefined {
  const value = get(key);
  return Array.isArray(value) ? value[0] : value;
}

export function all(get: ParamGetter, key: string): string[] {
  const value = get(key);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function flag(get: ParamGetter, key: string): boolean {
  const value = first(get, key);
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function labelOf<T extends string>(options: readonly Option<T>[], value: T | undefined | ''): string {
  return options.find((o) => o.value === value)?.label ?? '';
}

/** 값이 보기 가운데 하나인지 본다. 빈 값이면 fallback, 틀린 값이면 오류를 남긴다. */
export function pick<T extends string>(
  options: readonly Option<T>[],
  raw: string | undefined,
  name: string,
  errors: string[],
  fallback?: T,
): T | undefined {
  if (raw === undefined || raw === '') return fallback;
  const found = options.find((o) => o.value === raw);
  if (!found) {
    errors.push(`${name} 값(${raw})이 보기에 없습니다.`);
    return fallback;
  }
  return found.value;
}
