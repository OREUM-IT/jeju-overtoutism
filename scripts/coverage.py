"""장소 유형마다 규제 카드와 수집 대상의 커버리지를 계산한다.

사용법:
    python scripts/coverage.py            표를 출력한다
    python scripts/coverage.py --write    data/coverage.json을 다시 쓴다
    python scripts/coverage.py --check    data/coverage.json이 지금 자료와 같은지 본다(다르면 종료 코드 1)

읽는 것:
    data/place-types.json                 유형 정의, 유형별 수집 대상 ID와 후보
    data/cards/*.json                     규제 카드(place_types, 근거로 쓴 문서 ID)
    data/udo-regulation-sources.csv       우도 수집 대상 목록
    data/jeju-regulation-sources.csv      제주 전역 수집 대상 목록
    data/udo-collection-manifest.csv      조문 수집 결과
    data/jeju-collection-manifest.csv     조문 수집 결과

수집 대상 한 건의 상태(유형마다 따로 정한다):
    in_card     그 유형의 카드가 근거 문서로 쓴다
    text_only   원문은 받았거나 읽었으나 그 유형의 카드가 쓰지 않는다
    missing     원문이 없다(명칭만 관측했거나 2차 자료만 있다)

"전역"이라고 적으면 빠진 규제가 없는 것으로 읽힌다. 이 표는 무엇이 빠져 있는지를 보이려고 만든다.
기간이 끝났는지는 날짜에 따라 달라지므로 여기에 넣지 않는다(scripts/tools.py list_expiring).
"""

import argparse
import csv
import io
import json
import sys
from pathlib import Path

OUT = Path("data/coverage.json")
LISTS = (("udo", "data/udo-regulation-sources.csv"), ("jeju", "data/jeju-regulation-sources.csv"))
MANIFESTS = ("data/udo-collection-manifest.csv", "data/jeju-collection-manifest.csv")
TEXT_READ = {"provision_read", "official_record"}


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def used_ids(node, found):
    """카드가 근거로 든 문서 ID(source_id, src)를 모은다."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("source_id", "src") and isinstance(value, str):
                found.add(value)
            else:
                used_ids(value, found)
    elif isinstance(node, list):
        for value in node:
            used_ids(value, found)
    return found


def build():
    problems = []
    definition = json.loads(Path("data/place-types.json").read_text(encoding="utf-8"))
    type_ids = [t["id"] for t in definition["types"]]
    if len(set(type_ids)) != len(type_ids):
        problems.append("유형 ID가 겹침")

    sources = {}
    for name, path in LISTS:
        for row in read_csv(path):
            if row["id"] in sources:
                problems.append(f"수집 대상 ID가 두 목록에 겹침: {row['id']}")
            sources[row["id"]] = {"id": row["id"], "name": row["name"], "list": name,
                                  "doc_type": row["doc_type"], "check_status": row["check_status"]}
    collected = {row["source_id"] for path in MANIFESTS for row in read_csv(path) if row["status"] == "ok"}

    cards = []
    for path in sorted(Path("data/cards").glob("*.json")):
        card = json.loads(path.read_text(encoding="utf-8"))
        types = card.get("place_types") or []
        if not types:
            problems.append(f"{card['card_id']}: place_types가 없음")
        for type_id in types:
            if type_id not in type_ids:
                problems.append(f"{card['card_id']}: 없는 유형 {type_id}")
        cards.append({"card_id": card["card_id"], "title": card["title"], "place_types": types,
                      "evidence_grade": card.get("evidence_grade"), "used": used_ids(card, set())})

    candidate_status = set(definition["candidate_status"])
    assigned = set()
    rows = []
    for place_type in definition["types"]:
        own_cards = [c for c in cards if place_type["id"] in c["place_types"]]
        used = set().union(*[c["used"] for c in own_cards]) if own_cards else set()
        items = []
        for source_id in place_type["source_ids"]:
            source = sources.get(source_id)
            if not source:
                problems.append(f"{place_type['id']}: 수집 대상 목록에 없는 ID {source_id}")
                continue
            assigned.add(source_id)
            if source_id in used:
                status = "in_card"
            elif source_id in collected or source["check_status"] in TEXT_READ:
                status = "text_only"
            else:
                status = "missing"
            items.append({"id": source_id, "name": source["name"], "list": source["list"],
                          "doc_type": source["doc_type"], "status": status})
        for candidate in place_type.get("candidates", []):
            if candidate["status"] not in candidate_status:
                problems.append(f"{place_type['id']}: 정해지지 않은 후보 상태 {candidate['status']}")
        counts = {"cards": len(own_cards),
                  "cards_verified": sum(1 for c in own_cards if c["evidence_grade"] == "verified"),
                  "in_card": sum(1 for i in items if i["status"] == "in_card"),
                  "text_only": sum(1 for i in items if i["status"] == "text_only"),
                  "missing": sum(1 for i in items if i["status"] == "missing"),
                  "candidates": len(place_type.get("candidates", []))}
        rows.append({"id": place_type["id"], "name": place_type["name"],
                     "cards": [c["card_id"] for c in own_cards], "sources": items,
                     "candidates": place_type.get("candidates", []), "counts": counts})

    unassigned = [{"id": s["id"], "name": s["name"], "list": s["list"]}
                  for s in sources.values() if s["id"] not in assigned]
    result = {
        "schema_version": "0.1-draft",
        "generated_by": "scripts/coverage.py",
        "inputs": ["data/place-types.json", "data/cards/*.json", *[p for _, p in LISTS], *MANIFESTS],
        "status_meaning": {
            "in_card": "그 유형의 카드가 근거 문서로 쓴다",
            "text_only": "원문은 받았거나 읽었으나 그 유형의 카드가 쓰지 않는다",
            "missing": "원문이 없다",
        },
        "totals": {"types": len(rows), "cards": len(cards), "sources": len(sources),
                   "sources_assigned": len(assigned), "sources_unassigned": len(unassigned)},
        "types": rows,
        "unassigned": unassigned,
    }
    return result, problems


def render(result):
    return json.dumps(result, ensure_ascii=False, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    result, problems = build()
    for problem in problems:
        print(f"자료 문제: {problem}", file=out)
    text = render(result)
    if args.write and not problems:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        print(f"{OUT} 씀", file=out)
    stale = False
    if args.check:
        stale = not OUT.exists() or OUT.read_text(encoding="utf-8") != text
        print("data/coverage.json이 지금 자료와 다름. --write로 다시 쓴다" if stale else "data/coverage.json이 지금 자료와 같음", file=out)

    totals = result["totals"]
    print(f"유형 {totals['types']}개 | 카드 {totals['cards']}건 | 수집 대상 {totals['sources']}건"
          f"(유형에 넣은 것 {totals['sources_assigned']}, 넣지 않은 것 {totals['sources_unassigned']})", file=out)
    print("  카드(검수) | 카드가 씀 | 원문만 | 원문 없음 | 후보 | 유형", file=out)
    for row in result["types"]:
        c = row["counts"]
        print(f"  {c['cards']:>4}({c['cards_verified']})   | {c['in_card']:>8} | {c['text_only']:>5} | {c['missing']:>8} |"
              f" {c['candidates']:>3} | {row['name']}", file=out)
    out.flush()
    return 1 if problems or stale else 0


if __name__ == "__main__":
    sys.exit(main())
