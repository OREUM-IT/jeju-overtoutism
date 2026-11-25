"""규제 자료를 읽는 도구를 MCP(Model Context Protocol)로 내놓는다.

사용법:
    python scripts/mcp_server.py          표준 입출력(stdio)으로 말한다. 한 줄에 JSON-RPC 메시지 하나

    MCP를 쓰는 프로그램(Claude Desktop, Claude Code, Langflow 등)의 설정에는 이렇게 적는다.
        {"command": "python", "args": ["scripts/mcp_server.py"], "cwd": "<이 저장소의 폴더>"}

    HTTP로 쓰려면 scripts/agent_server.py를 띄우고 POST /mcp를 부른다(같은 처리 함수를 쓴다).

도구(모두 읽기 전용):
    ask_regulation            질문에 근거 인용과 함께 답한다(모델 없이 카드에서 뽑고 인용을 검사한 답)
    search_regulation_cards   규제 카드 찾기
    get_card_items            카드 한 장에서 인용할 수 있는 항목
    search_provisions         법령·조례 조문 찾기
    get_provision             조문 한 건의 원문
    search_notices            제주도청 고시·공고 찾기
    list_expiring             기간이 끝났거나 곧 끝나는 규제

지키는 것:
    - 파일을 쓰지 않고 네트워크를 부르지 않는다. 표준 출력에는 프로토콜 메시지만 쓴다.
    - 도구의 이름과 인자를 검사한다. 모르는 도구나 틀린 인자는 오류로 답한다.
    - 표준 라이브러리만 쓴다.
"""

import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # noqa: E402

SERVER = {"name": "jeju-regulation", "version": "0.1.0"}
VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
INSTRUCTIONS = ("제주도의 관광 규제를 카드와 수집한 원문에서 찾아 준다. 답할 때는 도구 결과의 인용문을 글자 그대로 근거로 붙인다. "
                "카드를 찾지 못한 것은 규제가 없다는 뜻이 아니다. 카드는 사람의 검수 전일 수 있고, 답은 법률 자문이 아니다.")
MAX_LINE = 64 * 1024
ASK = ("ask_regulation", "질문에 근거 인용과 함께 답한다. 서술마다 인용이 실제로 있는지 검사한 결과다.",
       {"question": ("string", "규제에 관한 질문"), "date": ("string", "기준일 YYYY-MM-DD. 비우면 오늘")}, ["question"])


def tool_list():
    return [{"name": name, "description": description,
             "inputSchema": {"type": "object", "required": required, "additionalProperties": False,
                             "properties": {k: {"type": t, "description": d} for k, (t, d) in props.items()}},
             "annotations": {"readOnlyHint": True, "openWorldHint": False}}
            for name, description, props, required in [ASK] + agent.TOOL_SPECS]


def call_tool(name, args):
    known = {spec[0]: spec for spec in [ASK] + agent.TOOL_SPECS}
    if name not in known:
        raise ValueError(f"없는 도구: {name}")
    if not isinstance(args, dict):
        raise ValueError("arguments는 객체여야 한다")
    extra = set(args) - set(known[name][2])
    missing = [key for key in known[name][3] if not isinstance(args.get(key), str) or not args[key].strip()]
    if extra or missing:
        raise ValueError("인자가 맞지 않는다" + (f". 모르는 인자: {', '.join(sorted(extra))}" if extra else "")
                         + (f". 빠진 인자: {', '.join(missing)}" if missing else ""))
    today = date.today().isoformat()
    if name == "ask_regulation":
        as_of = args.get("date") or today
        date.fromisoformat(as_of)  # 틀린 날짜는 ValueError
        result = agent.ask(args["question"], as_of, "grounded")
        result.pop("trace", None)
        return json.dumps(result, ensure_ascii=False)
    return agent.run_tool(name, args, today)


def reply(message_id, result=None, error=None):
    body = {"jsonrpc": "2.0", "id": message_id}
    if error:
        body["error"] = {"code": error[0], "message": error[1]}
    else:
        body["result"] = result
    return body


def handle(message):
    """JSON-RPC 메시지 하나를 처리한다. 답할 것이 없으면(알림) None."""
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return reply(message.get("id") if isinstance(message, dict) else None, error=(-32600, "Invalid Request"))
    method, params = message["method"], message.get("params") or {}
    if "id" not in message:
        return None
    message_id = message["id"]
    if not isinstance(params, dict):
        return reply(message_id, error=(-32602, "params는 객체여야 한다"))
    if method == "initialize":
        asked = params.get("protocolVersion")
        return reply(message_id, {"protocolVersion": asked if asked in VERSIONS else VERSIONS[0],
                                  "capabilities": {"tools": {"listChanged": False}},
                                  "serverInfo": SERVER, "instructions": INSTRUCTIONS})
    if method == "ping":
        return reply(message_id, {})
    if method == "tools/list":
        return reply(message_id, {"tools": tool_list()})
    if method == "tools/call":
        name = params.get("name")
        if not isinstance(name, str) or name not in {spec[0] for spec in [ASK] + agent.TOOL_SPECS}:
            return reply(message_id, error=(-32602, f"없는 도구: {str(name)[:60]}"))
        try:
            text = call_tool(name, params.get("arguments") or {})
            return reply(message_id, {"content": [{"type": "text", "text": text}], "isError": False})
        except ValueError as error:
            return reply(message_id, {"content": [{"type": "text", "text": f"오류: {error}"}], "isError": True})
        except Exception:  # 내부 오류의 내용은 밖으로 내보내지 않는다
            return reply(message_id, {"content": [{"type": "text", "text": "오류: 도구를 실행하지 못했다"}], "isError": True})
    return reply(message_id, error=(-32601, f"Method not found: {method[:60]}"))


def main():
    os.chdir(Path(__file__).resolve().parent.parent)  # 자료를 저장소 폴더 기준으로 읽는다
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    while True:
        line = stdin.readline(MAX_LINE + 1)
        if not line:
            return 0
        if len(line) > MAX_LINE:
            while line and not line.endswith(b"\n"):  # 너무 긴 줄은 끝까지 버린다
                line = stdin.readline(MAX_LINE)
            response = reply(None, error=(-32600, "메시지가 너무 길다"))
        elif not line.strip():
            continue
        else:
            try:
                response = handle(json.loads(line.decode("utf-8")))
            except (ValueError, UnicodeDecodeError):
                response = reply(None, error=(-32700, "Parse error"))
        if response is not None:
            stdout.write(json.dumps(response, ensure_ascii=False).encode("utf-8") + b"\n")
            stdout.flush()


if __name__ == "__main__":
    sys.exit(main())
