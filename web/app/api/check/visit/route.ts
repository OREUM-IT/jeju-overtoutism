import { invalid, readJson } from '@/lib/api';
import { checkVisit, parseVisit } from '@/lib/checks/udo-visit';
import { todayKst } from '@/lib/format';
import { fromJson, type ParamGetter } from '@/lib/params';

function run(get: ParamGetter) {
  const today = todayKst();
  const { input, errors } = parseVisit(get, today);
  if (!get('mode')) errors.unshift('이동수단(mode)을 고르세요.');
  if (!input || errors.length > 0) return invalid(errors);
  return Response.json(checkVisit(input, today));
}

/** POST /api/check/visit — 본문: { date, mode, fuel, operator, seats, rental, companion[], stay, long_term, approval } */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(['JSON 객체를 보내 주세요.']);
  return run(fromJson(body));
}

/** GET /api/check/visit?mode=... — 화면의 검색 매개변수와 같다 */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return run((key) => {
    const values = params.getAll(key);
    return values.length === 0 ? undefined : values.length === 1 ? values[0] : values;
  });
}

