// API 응답 공통 모양. docs/07 7절의 Agent 연동 계약 초안을 따른다.

export function invalid(messages: string[]) {
  return Response.json({ error: 'invalid_input', messages }, { status: 400 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
