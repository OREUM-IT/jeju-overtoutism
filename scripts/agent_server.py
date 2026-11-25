"""규제 Agent를 HTTP로 내놓는다.

사용법:
    python scripts/agent_server.py [--host 127.0.0.1] [--port 8790] [--no-auth]

주소:
    GET  /           시험 화면. --no-auth로 띄웠을 때만 있다
    GET  /healthz    살아 있는지만 답한다. 인증 없음
    GET  /readyz     자료(카드, 조문 저장소)와 모델 설정을 읽을 수 있는지. 인증 필요
    POST /v1/ask     질문에 답한다. 인증 필요
                     요청  {"question": "우도에 렌터카 가져가도 되나", "date": "2026-11-24", "mode": "auto"}
                     응답  scripts/agent.py의 ask()가 돌려주는 JSON 그대로
    POST /mcp        MCP(Streamable HTTP, 상태 없음). JSON-RPC 메시지 하나를 받아 JSON으로 답한다. 인증 필요
                     도구는 scripts/mcp_server.py와 같다

설정(.env 또는 환경 변수. 값은 출력하지 않는다):
    AGENT_AUTH_KEY        호출하는 쪽이 Authorization: Bearer <값>으로 보내는 키. 32자 이상
    AGENT_ALLOWED_ORIGIN  브라우저에서 직접 부를 때 허용할 Origin 하나(예: https://oreumit.com). 비우면 브라우저의 호출을 받지 않는다
    AGENT_MAX_CONCURRENT  동시에 처리할 요청 수(기본 2, 1~8). 넘으면 429
    모델 설정은 scripts/agent.py와 같다.

지키는 것:
    - 인증 키가 없으면 시작하지 않는다. --no-auth는 내 컴퓨터(127.0.0.1)에서 시험할 때만 받는다.
    - 요청 본문은 8KB까지, JSON만 받는다. 아무것도 저장하지 않고, 질문은 기록에도 남기지 않는다.
    - Origin 머리글이 있는데 허용한 값이 아니면 받지 않는다(다른 사이트의 화면이 내 컴퓨터의 서버를 부르는 것을 막는다).
      --no-auth일 때는 이 서버의 시험 화면(127.0.0.1, localhost)에서 온 호출만 더 받는다.
    - 읽기만 한다. 답은 자료와 (설정했다면) 모델 주소에서만 나온다.
    - 표준 라이브러리만 쓴다. 밖에 내놓을 때는 앞에 HTTPS와 접근 제어(예: Cloudflare Access)를 둔다.
"""

import argparse
import hmac
import json
import os
import sys
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # noqa: E402
import mcp_server  # noqa: E402

MAX_BODY = 8 * 1024
DRAIN_LIMIT = 64 * 1024
POST_PATHS = ("/v1/ask", "/mcp")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]")
PAGE = Path(__file__).resolve().parent / "agent_page.html"
PAGE_POLICY = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; "
               "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


def make_handler(auth_key, origin, slots):
    class Handler(BaseHTTPRequestHandler):
        server_version = "jeju-regulation-agent"
        sys_version = ""
        timeout = 15  # 느리게 보내며 연결을 붙잡는 요청을 끊는다

        def log_message(self, fmt, *args):  # 질문이 기록에 남지 않게 주소와 상태만 적는다
            sys.stderr.write(f"{self.command} {self.path.split('?')[0][:40]} {args[1] if len(args) > 1 else ''}\n")

        def send_json(self, status, body=None):
            data = b"" if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            if body is not None:
                self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if origin and self.headers.get("Origin") == origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def authorized(self):
            if auth_key is None:
                return True
            header = self.headers.get("Authorization", "")
            return header.startswith("Bearer ") and hmac.compare_digest(header[7:].encode(), auth_key.encode())

        def local_host(self):
            # 주소창의 이름이 이 컴퓨터를 가리키는 이름일 때만(다른 이름을 이 컴퓨터로 돌려놓는 수법을 막는다)
            host = self.headers.get("Host", "")
            return host.rsplit(":", 1)[0] in LOCAL_HOSTS

        def origin_allowed(self):
            sent = self.headers.get("Origin")
            if sent is None or (origin and sent == origin):
                return True
            return auth_key is None and self.local_host() and sent == f"http://{self.headers.get('Host', '')}"

        def send_page(self):
            data = PAGE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", PAGE_POLICY)
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            if origin and self.headers.get("Origin") == origin and self.path in POST_PATHS:
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "POST")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Protocol-Version")
                self.send_header("Access-Control-Max-Age", "600")
                self.send_header("Vary", "Origin")
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self.send_json(404, {"error": "not_found"})

        def do_HEAD(self):
            page = self.path == "/" and auth_key is None and self.local_host()
            self.send_response(200 if page or self.path == "/healthz" else 404)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if self.path == "/healthz":
                return self.send_json(200, {"ok": True, "check": "liveness_only"})
            if self.path == "/" and auth_key is None and self.local_host():
                return self.send_page()
            if self.path == "/mcp":  # 상태 없는 서버라 서버가 먼저 보내는 흐름은 없다
                return self.send_json(405, {"error": "method_not_allowed"})
            if self.path != "/readyz":
                return self.send_json(404, {"error": "not_found"})
            if not self.authorized():
                return self.send_json(401, {"error": "unauthorized"})
            evidence = agent.evidence()
            config = agent.model_config()
            self.send_json(200, {"ok": bool(evidence.cards), "cards": len(evidence.cards),
                                 "provisions": len(evidence.provisions), "provisions_available": evidence.have_provisions,
                                 "model_configured": bool(config), "model": config["model"] if config else None,
                                 "auth": auth_key is not None})

        def read_json(self):
            """본문을 읽어 (값, None)이나 (None, (상태, 오류 이름))을 돌려준다.

            거절할 요청도 본문은 (작으면) 먼저 읽어 버린다. 읽지 않은 채 끊으면 보내는 쪽이 답을 받기 전에 연결이 끊긴다.
            """
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                length = -1
            if length < 0 or length > DRAIN_LIMIT:
                self.close_connection = True
                return None, (413, "too_large") if length > 0 else (400, "bad_length")
            raw = self.rfile.read(length)
            if length > MAX_BODY:
                return None, (413, "too_large")
            if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
                return None, (415, "unsupported_media_type")
            try:
                return json.loads(raw.decode("utf-8")), None
            except (ValueError, UnicodeDecodeError):
                return None, (400, "bad_json")

        def do_POST(self):
            body, problem = self.read_json()
            if self.path not in POST_PATHS:
                return self.send_json(404, {"error": "not_found"})
            if not self.origin_allowed():
                return self.send_json(403, {"error": "origin_not_allowed"})
            if not self.authorized():
                return self.send_json(401, {"error": "unauthorized"})
            if problem:
                return self.send_json(problem[0], {"error": problem[1]})
            if not slots.acquire(blocking=False):
                return self.send_json(429, {"error": "busy"})
            try:
                if self.path == "/mcp":
                    response = mcp_server.handle(body)
                    return self.send_json(202) if response is None else self.send_json(200, response)
                if not isinstance(body, dict) or not isinstance(body.get("question"), str):
                    return self.send_json(400, {"error": "question_required"})
                as_of = body.get("date")
                if as_of is not None:
                    try:
                        date.fromisoformat(as_of)
                    except (TypeError, ValueError):
                        return self.send_json(400, {"error": "bad_date"})
                mode = body.get("mode", "auto")
                if mode not in ("auto", "grounded", "model"):
                    return self.send_json(400, {"error": "bad_mode"})
                try:
                    result = agent.ask(body["question"], as_of, mode)
                except ValueError as error:
                    return self.send_json(400, {"error": "bad_request", "message": str(error)})
                self.send_json(200, result)
            except Exception:  # 내부 오류의 내용은 밖으로 내보내지 않는다
                sys.stderr.write("request failed\n")
                self.send_json(500, {"error": "internal"})
            finally:
                slots.release()

    return Handler


def build_server(host, port, auth_key, origin="", concurrent=2):
    return ThreadingHTTPServer((host, port), make_handler(auth_key, origin, threading.BoundedSemaphore(concurrent)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--no-auth", action="store_true", help="인증 없이. 127.0.0.1에서만 받는다")
    args = parser.parse_args()
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    os.chdir(Path(__file__).resolve().parent.parent)  # 자료를 저장소 폴더 기준으로 읽는다
    agent.load_env()
    key = os.environ.get("AGENT_AUTH_KEY", "").strip()
    if args.no_auth:
        if args.host not in ("127.0.0.1", "localhost", "::1"):
            print("--no-auth는 127.0.0.1에서만 쓸 수 있다", file=sys.stderr)
            return 2
        key = None
    elif len(key) < 32:
        print("AGENT_AUTH_KEY가 없거나 32자보다 짧다. .env에 넣거나, 내 컴퓨터에서 시험할 때는 --no-auth를 쓴다", file=sys.stderr)
        return 2
    origin = os.environ.get("AGENT_ALLOWED_ORIGIN", "").strip().rstrip("/")
    try:
        concurrent = max(1, min(8, int(os.environ.get("AGENT_MAX_CONCURRENT", "2") or 2)))
    except ValueError:
        concurrent = 2
    agent.warm_up()  # 자료와 색인을 먼저 읽어 둔다. 읽지 못하면 여기서 멈춘다
    server = build_server(args.host, args.port, key, origin, concurrent)
    config = agent.model_config()
    print(f"규제 Agent: http://{args.host}:{args.port}  인증 {'있음' if key else '없음(시험 화면: 이 주소를 브라우저로 연다)'}  "
          f"모델 {config['model'] if config else '없음(카드에서 뽑아 답함)'}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
