"""Agent가 부를 읽기 전용 도구. 결과를 JSON으로 내놓는다.

사용법:
    python scripts/tools.py search_regulation_cards --query "우도 렌터카" [--date 2026-11-23]
    python scripts/tools.py get_card --id udo-vehicle-restriction-2026-715
    python scripts/tools.py search_provisions --query "자연휴식년제" [--top 5]
    python scripts/tools.py get_provision --id L01:제355조
    python scripts/tools.py search_notices --query "우도 운행제한"
    python scripts/tools.py list_expiring [--date 2026-11-23] [--days 90]

docs/01 4절의 도구 초안과 docs/10 7절의 API 계약에 대응한다.

    search_regulation_cards   GET /api/cards 와 같은 목적. 질문으로 카드를 찾는다
    get_card                  GET /api/cards/{card_id}
    search_provisions         조문 원문 검색
    get_provision             조문 한 건의 원문, 시행일, 문서 이름
    search_notices            고시·공고 검색
    list_expiring             기간이 끝났거나 곧 끝나는 규제, "별도 고시일까지"인 규제

판정(check_regulation_fit)은 여기에 없다. 지금은 web/lib/checks/에 카드별 규칙으로 있다.

모든 도구는 읽기만 한다. 파일을 쓰지 않고 네트워크를 호출하지 않는다.
조문과 고시·공고는 .local/에 수집한 원문이 있어야 나온다.
"""

import argparse
import io
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import search as engine  # noqa: E402

_INDEX = None


def index():
    global _INDEX
    if _INDEX is None:
        _INDEX = engine.Index(engine.load_documents())
    return _INDEX


def aliases():
    path = Path("data/search-aliases.json")
    return json.loads(path.read_text(encoding="utf-8")).get("aliases", {}) if path.exists() else {}


def card_summary(card, as_of):
    validity = card.get("validity") or {}
    end = validity.get("valid_until")
    return {
        "card_id": card["card_id"], "title": card.get("title", ""), "evidence_grade": card.get("evidence_grade", ""),
        "enforcement_status": card.get("enforcement_status", ""),
        "valid_from": validity.get("valid_from"), "valid_until": end, "until": validity.get("until", ""),
        "period_ended": bool(end and end < as_of), "status_note": card.get("status_note", ""),
        "source_document": card["source"].get("document", ""),
    }


def load_card(card_id):
    path = Path("data/cards", f"{card_id}.json")
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def search_regulation_cards(query, as_of):
    extra = engine.expand(query, aliases())
    hits = index().search(query, {"card"}, 5, extra, engine.CARD_COVERAGE)
    cards = []
    for score, doc in hits:
        card = load_card(doc["id"].split(":", 1)[1])
        cards.append({**card_summary(card, as_of), "score": round(score, 2)})
    return {"query": query, "as_of": as_of, "added_terms": extra, "cards": cards,
            "note": "" if cards else "관련된 카드를 찾지 못했다. 카드가 없다는 것이 규제가 없다는 뜻은 아니다."}


def get_card(card_id):
    card = load_card(card_id)
    return card if card else {"error": "not_found", "card_id": card_id}


def search_sources(query, kind, top):
    extra = engine.expand(query, aliases())
    direct = [d["id"] for d in engine.direct_lookup(query, index().docs)] if kind == "provision" else []
    rows = []
    for score, doc in index().search(query, {kind}, top, extra):
        row = {"id": doc["id"], "title": doc["title"], "score": round(score, 2),
               "snippet": engine.snippet(doc, query + " " + extra)}
        row.update({k: v for k, v in doc["meta"].items() if k in ("effective_date", "date", "document", "article")})
        rows.append(row)
    result = {"query": query, "added_terms": extra, "results": rows}
    if kind == "provision":
        result["direct"] = direct
    if not any(d["type"] == kind for d in index().docs):
        result["note"] = "수집한 원문이 없다. 수집기를 먼저 돌려야 한다."
    return result


def get_provision(provision_id):
    for doc in index().docs:
        if doc["type"] == "provision" and doc["id"] == provision_id:
            return {"provision_id": provision_id, **doc["meta"], "text": doc["text"]}
    return {"error": "not_found", "provision_id": provision_id}


def list_expiring(as_of, days):
    horizon = (date.fromisoformat(as_of) + timedelta(days=days)).isoformat()
    items = []
    for path in sorted(Path("data/cards").glob("*.json")):
        card = json.loads(path.read_text(encoding="utf-8"))
        validity = card.get("validity") or {}
        targets = [("", validity.get("valid_until"), validity.get("until", ""), card.get("enforcement_status", ""))]
        targets += [(i.get("name", ""), i.get("valid_until"), i.get("until", ""), i.get("status", ""))
                    for i in card.get("instances", [])]
        for name, end, until, status in targets:
            label = card["title"] + (f" - {name}" if name else "")
            if status in ("repealed", "lifted"):
                continue
            if end and end < as_of:
                items.append({"card_id": card["card_id"], "what": label, "valid_until": end, "state": "ended",
                              "action": "기간이 끝났다. 후속 고시·공고를 확인한다"})
            elif end and end <= horizon:
                items.append({"card_id": card["card_id"], "what": label, "valid_until": end, "state": "ending_soon",
                              "action": f"{days}일 안에 끝난다. 연장 고시·공고를 확인한다"})
            elif not end and until and (name or not card.get("instances")):
                items.append({"card_id": card["card_id"], "what": label, "valid_until": None, "state": "until_notice",
                              "action": f"{until}. 해제나 변경 고시가 나왔는지 확인한다"})
    order = {"ended": 0, "ending_soon": 1, "until_notice": 2}
    items.sort(key=lambda x: (order[x["state"]], x["valid_until"] or ""))
    return {"as_of": as_of, "days": days, "items": items}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tool", choices=["search_regulation_cards", "get_card", "search_provisions", "get_provision",
                                         "search_notices", "list_expiring"])
    parser.add_argument("--query", default="")
    parser.add_argument("--id", default="")
    parser.add_argument("--top", type=int, default=5)
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()

    if args.tool == "search_regulation_cards":
        result = search_regulation_cards(args.query, args.date)
    elif args.tool == "get_card":
        result = get_card(args.id)
    elif args.tool == "search_provisions":
        result = search_sources(args.query, "provision", args.top)
    elif args.tool == "search_notices":
        result = search_sources(args.query, "notice", args.top)
    elif args.tool == "get_provision":
        result = get_provision(args.id)
    else:
        result = list_expiring(args.date, args.days)
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2), file=out)
    out.flush()
    return 1 if isinstance(result, dict) and result.get("error") else 0


if __name__ == "__main__":
    sys.exit(main())
