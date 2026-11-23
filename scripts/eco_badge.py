"""에코투어리즘 테마의 아이템마다 뱃지 단계와 상태를 계산한다.

사용법:
    python scripts/eco_badge.py [--date 2026-11-23] [--json]

읽는 것:
    data/eco/theme.json    테마, 아이템, 아이템이 닿는 규제 카드와 판정
    data/eco/badges.json   뱃지 기준, 단계, 상태
    data/cards/*.json      규제 카드

하는 일:
    1. 자료를 점검한다. 아이템이 가리키는 카드와 항목, 수집 대상 ID가 실제로 있는지,
       뱃지 이름에 관한 주의의 조문 인용이 조문 저장소에 있는지 본다.
    2. 아이템마다 기준(C1~C4)을 채웠는지 보고 단계를 정한다.
    3. 근거 카드의 검수 여부와 기간으로 상태(확인됨·예비·보류·대상 아님)를 정한다.

판정(저촉, 제한 대상 아님 등)은 이 스크립트가 만들지 않는다. theme.json에 사람이 적은 판정을 읽는다.
그 판정이 카드 문언과 맞는지는 검수해야 한다.

규칙:
    - 판정에 "저촉"이 있으면 대상 아님이다.
    - 판정에 "확인 필요"가 있거나, "허가 대상"인데 허가 확인(permit_obtained)이 없으면 C1을 채우지 못한 것이다.
    - 근거 카드가 폐지됐거나, 기간이 기준일보다 앞서 끝났거나, 현재 효력을 확인하지 못한 카드면 보류다.
    - 근거 카드에 검수 전(extracted)인 것이 있으면 가장 좋아도 예비다.
"""

import argparse
import io
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_answer import Evidence, squash  # noqa: E402

STATE_LABEL = {"confirmed": "확인됨", "provisional": "예비", "on_hold": "보류", "not_eligible": "대상 아님"}


def item_ids(node, found):
    if isinstance(node, dict):
        if isinstance(node.get("id"), str):
            found.add(node["id"])
        for value in node.values():
            item_ids(value, found)
    elif isinstance(node, list):
        for value in node:
            item_ids(value, found)
    return found


def validate(theme, badges, evidence):
    problems = []
    subthemes = {s["id"] for s in theme["subthemes"]}
    verdicts = set(theme["verdict_values"])
    criteria = {c["id"] for c in badges["criteria"]}
    types_file = Path("data/place-types.json")
    place_types = {t["id"] for t in json.loads(types_file.read_text(encoding="utf-8"))["types"]} if types_file.exists() else None
    for group, items in (("items", theme["items"]), ("excluded", theme["excluded"])):
        for item in items:
            where = f"{group}/{item['id']}"
            if place_types is not None:
                if not item.get("place_types"):
                    problems.append(f"{where}: 장소 유형(place_types)이 없음")
                for type_id in item.get("place_types", []):
                    if type_id not in place_types:
                        problems.append(f"{where}: 없는 장소 유형 {type_id}")
            if group == "items" and item.get("subtheme") not in subthemes:
                problems.append(f"{where}: 없는 하위 테마 {item.get('subtheme')}")
            if not item.get("regulation_checks"):
                problems.append(f"{where}: 규제 확인 항목이 없음")
            for check in item.get("regulation_checks", []):
                entry = evidence.cards.get(check["card_id"])
                if not entry:
                    problems.append(f"{where}: 없는 카드 {check['card_id']}")
                    continue
                if check["item_id"] not in item_ids(entry["card"], set()):
                    problems.append(f"{where}: 카드 {check['card_id']}에 없는 항목 {check['item_id']}")
                if check["verdict"] not in verdicts:
                    problems.append(f"{where}: 정해지지 않은 판정 값 {check['verdict']}")
            for ref in item.get("source_refs", []):
                if ref not in evidence.sources:
                    problems.append(f"{where}: 수집 대상 목록에 없는 ID {ref}")
            for key in item.get("criteria", {}):
                if key not in criteria:
                    problems.append(f"{where}: 없는 기준 {key}")
            if group == "excluded" and not any(c["verdict"] == "저촉" for c in item.get("regulation_checks", [])):
                problems.append(f"{where}: 제외 목록인데 저촉 판정이 없음")
    notes = []
    for prov in badges["badge"]["naming_caution"]["provisions"]:
        if not evidence.have_provisions:
            notes.append("조문 저장소가 없어 뱃지 이름 주의의 조문 인용을 확인하지 못함")
            break
        text = evidence.provisions.get(prov["provision_id"])
        if text is None:
            problems.append(f"뱃지 이름 주의: 없는 조문 {prov['provision_id']}")
        elif squash(prov["quote"]) not in squash(text):
            problems.append(f"뱃지 이름 주의: 조문 {prov['provision_id']}에 없는 인용문")
    return problems, notes


def evaluate(item, evidence, as_of):
    checks = item["regulation_checks"]
    reasons = []
    if any(c["verdict"] == "저촉" for c in checks):
        return {"level": 0, "state": "not_eligible", "criteria": {}, "reasons": ["판정에 저촉이 있음"]}
    c1 = True
    if any(c["verdict"] == "확인 필요" for c in checks):
        c1 = False
        reasons.append("판정에 '확인 필요'가 있음")
    if any(c["verdict"] == "허가 대상" for c in checks) and not item.get("permit_obtained"):
        c1 = False
        reasons.append("허가 대상인데 허가 확인이 없음")
    on_hold = not c1
    unverified = False
    for card_id in dict.fromkeys(c["card_id"] for c in checks):
        caution = evidence.card_caution(card_id, as_of)
        if caution:
            on_hold = True
            reasons.append(f"근거 카드 주의: {caution} ({card_id})")
        if evidence.cards[card_id]["card"].get("evidence_grade") != "verified":
            unverified = True
    met = {"C1": c1}
    for key in ("C2", "C3", "C4"):
        met[key] = bool(item.get("criteria", {}).get(key, {}).get("met"))
    level = 0
    if c1 and (met["C2"] or met["C3"]):
        level = 1
    if c1 and met["C2"] and met["C3"]:
        level = 2
    if level == 2 and met["C4"]:
        level = 3
    if c1 and level == 0:
        reasons.append("C2와 C3 가운데 채운 것이 없음")
    if on_hold:
        state = "on_hold"
    elif unverified:
        state = "provisional"
        reasons.append("근거 카드가 검수 전")
    else:
        state = "confirmed"
    return {"level": level, "state": state, "criteria": met, "reasons": reasons}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    theme = json.loads(Path("data/eco/theme.json").read_text(encoding="utf-8"))
    badges = json.loads(Path("data/eco/badges.json").read_text(encoding="utf-8"))
    evidence = Evidence()
    problems, notes = validate(theme, badges, evidence)
    level_names = {l["level"]: l["name"] for l in badges["levels"]}
    subtheme_names = {s["id"]: s["name"] for s in theme["subthemes"]}

    rows = []
    for item in theme["items"]:
        result = evaluate(item, evidence, args.date)
        rows.append({"id": item["id"], "name": item["name"], "subtheme": subtheme_names.get(item["subtheme"], ""),
                     "region": item["region"], "level": result["level"], "level_name": level_names[result["level"]],
                     "state": result["state"], "state_label": STATE_LABEL[result["state"]],
                     "criteria": result["criteria"], "reasons": result["reasons"]})

    if args.json:
        print(json.dumps({"as_of": args.date, "problems": problems, "notes": notes, "items": rows},
                         ensure_ascii=False, indent=2), file=out)
    else:
        print(f"기준일 {args.date} | 아이템 {len(rows)}건 | 제외 {len(theme['excluded'])}건 | 자료 문제 {len(problems)}건", file=out)
        for p in problems:
            print(f"  자료 문제: {p}", file=out)
        for n in notes:
            print(f"  참고: {n}", file=out)
        for r in rows:
            marks = " ".join(f"{k}{'O' if v else 'X'}" for k, v in r["criteria"].items())
            print(f"  {r['state_label']:<5} {r['level']}단계 {r['level_name']:<5} [{marks}] {r['name']} ({r['region']})", file=out)
            for reason in r["reasons"]:
                print(f"         - {reason}", file=out)
        counts = {}
        for r in rows:
            counts[r["state_label"]] = counts.get(r["state_label"], 0) + 1
        print(f"상태별: {counts}", file=out)
    out.flush()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
