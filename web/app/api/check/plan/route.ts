import { invalid, readJson } from '@/lib/api';
import { checkPlan, parsePlan } from '@/lib/checks/conservation-plan';
import { todayKst } from '@/lib/format';
import { fromJson, type ParamGetter } from '@/lib/params';

function run(get: ParamGetter) {
  const { input, errors } = parsePlan(get);
  if (!get('activity')) errors.unshift('기획 유형(activity)을 고르세요.');
  if (!input || errors.length > 0) return invalid(errors);
  return Response.json(checkPlan(input, todayKst()));
}

/** POST /api/check/plan — 본문: { activity, actor, location } */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid(['JSON 객체를 보내 주세요.']);
  return run(fromJson(body));
}

/** GET /api/check/plan?activity=... */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return run((key) => params.get(key) ?? undefined);
}
