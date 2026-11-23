import { todayKst } from '@/lib/format';
import { buildReport, parseAudience } from '@/lib/report';

/** GET /api/report?area=우도&audience=policy|business|traveler */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const area = params.get('area');
  if (area && !['우도', 'udo'].includes(area)) {
    return Response.json({ error: 'unsupported_area', messages: ['시범 지역은 우도뿐입니다.'] }, { status: 400 });
  }
  return Response.json(buildReport(parseAudience(params.get('audience') ?? undefined), todayKst()));
}
