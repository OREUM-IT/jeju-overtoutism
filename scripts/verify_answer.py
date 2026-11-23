"""답변이나 보고서의 서술이 근거를 갖고 있는지, 인용이 실제로 있는지 검사한다.

사용법:
    python scripts/verify_answer.py <답변.json> [--date 2026-11-23] [--json]
    python scripts/verify_answer.py --self-check data/verify-samples.json

입력 형식은 docs/10 7절의 보고서 응답과 같다(web/lib/report.ts의 Statement).
JSON 어디에 있든 아래 모양의 객체를 서술로 보고 검사한다.

    { "kind": "fact" | "unknown" | "measure" | "meta",
      "text": "...",
      "basis": [ { "card_id": "...", "item_id": "...", "quote": "..." | null, ... },
                 { "provision_id": "L01:제355조", "quote": "..." } ],
      "source_refs": [ "N07", ... ] }

검사하는 것:
    1. 근거 존재     사실(fact) 서술에는 인용문이 있는 근거나 수집 대상 ID가 하나 이상 있어야 한다.
    2. 인용 대상     card_id는 data/cards에, source_refs는 수집 대상 목록에, provision_id는 조문 저장소에 있어야 한다.
    3. 인용문 일치   카드 인용문은 그 카드에 적힌 인용문과 같아야 하고, 조문 인용문은 그 조문에 있어야 한다.
    4. 수치          서술의 숫자(두 자리 이상)는 인용한 카드·조문·수집 대상 항목에 있어야 한다.
    5. 시행 상태     폐지됐거나 기간이 끝난 카드를 근거로 든 사실 서술에는 경고를 붙인다.

1~4를 어긴 사실 서술은 "차단"이다. 사실이 아닌 서술(unknown, measure)과 5번은 "경고"다.
source_refs에는 수집 대상 ID 말고 data/의 CSV 파일 이름(예: udo-regulation-sources.csv)도 쓸 수 있다.
그 경우 그 파일의 행 수와 값별 건수가 숫자의 근거가 된다.
kind가 "meta"인 서술은 자료의 상태(카드 몇 건이 검수 전인지 등)를 말하는 것으로 보고 인용을 검사하지 않는다.
조문 저장소(.local/provisions)가 없으면 조문 인용은 확인하지 못했다고 알리고 건너뛴다.

통과는 "근거가 실제로 있다"는 뜻일 뿐이다. 서술이 근거의 뜻을 바르게 옮겼는지는 보지 못한다.
"""

import argparse
import csv
import io
import json
import re
import sys
from datetime import date
from pathlib import Path


def squash(text):
    return re.sub(r"\s+", "", text or "")


REFERENCE_NUMBER = re.compile(r"제\s*\d+\s*(?:조|항|호|목)(?:\s*의\s*\d+)?")


def digit_groups(text, skip_references=False):
    """두 자리 이상의 숫자를 모은다. skip_references면 '제25조' 같은 조문 번호는 뺀다."""
    text = text or ""
    if skip_references:
        text = REFERENCE_NUMBER.sub(" ", text)
    return {g.replace(",", "") for g in re.findall(r"\d[\d,]*", text) if len(g.replace(",", "")) >= 2}


def collect(node, key):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key and isinstance(v, str):
                yield v
            else:
                yield from collect(v, key)
    elif isinstance(node, list):
        for item in node:
            yield from collect(item, key)


class Evidence:
    def __init__(self):
        self.cards = {}
        for path in sorted(Path("data/cards").glob("*.json")):
            card = json.loads(path.read_text(encoding="utf-8"))
            self.cards[card["card_id"]] = {
                "card": card, "quotes": {squash(q) for q in collect(card, "quote")},
                "digits": digit_groups(json.dumps(card, ensure_ascii=False))}
        self.sources = {}
        for path in sorted(Path("data").glob("*regulation-sources.csv")):
            with path.open(encoding="utf-8", newline="") as handle:
                for row in csv.DictReader(handle):
                    self.sources[row["id"]] = digit_groups(" ".join(row.values()))
        # 자료 파일 자체를 가리키는 근거(예: udo-regulation-sources.csv). 행 수와 값별 건수를 숫자 근거로 준다.
        self.datasets = {}
        for path in sorted(Path("data").glob("*.csv")):
            with path.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            counts = {str(len(rows))}
            for column in (rows[0].keys() if rows else []):
                tally = {}
                for row in rows:
                    tally[row[column]] = tally.get(row[column], 0) + 1
                if len(tally) <= 12:
                    counts |= {str(n) for n in tally.values()}
            self.datasets[path.name] = {c for c in counts if len(c) >= 2}
        self.datasets["cards"] = {str(len(self.cards))} if len(self.cards) >= 10 else set()
        self.provisions = {}
        self.have_provisions = Path(".local/provisions").exists()
        if self.have_provisions:
            for path in Path(".local/provisions").glob("*.jsonl"):
                for line in path.read_text(encoding="utf-8").splitlines():
                    record = json.loads(line)
                    self.provisions[record["provision_id"]] = record["text"]

    def card_caution(self, card_id, as_of):
        card = self.cards[card_id]["card"]
        validity = card.get("validity") or {}
        status = card.get("enforcement_status", "")
        if status == "repealed":
            return "폐지된 규제"
        if validity.get("valid_until") and validity["valid_until"] < as_of:
            return f"기간이 {validity['valid_until']}에 끝남"
        if validity.get("valid_from") and validity["valid_from"] > as_of:
            return f"{validity['valid_from']}부터 시행"
        # 기간이 정해진 카드는 기간 안이면 주의를 붙이지 않는다(docs/10 4.2절 3번과 같은 규칙).
        if status == "unconfirmed" and not validity.get("valid_until"):
            return "현재 효력을 확인하지 못한 카드"
        return ""


def statements(node, path="$"):
    """JSON 전체에서 서술 객체를 찾는다."""
    if isinstance(node, dict):
        if isinstance(node.get("text"), str) and "kind" in node and ("basis" in node or "source_refs" in node):
            yield path, node
        for key, value in node.items():
            yield from statements(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from statements(value, f"{path}[{index}]")


def check_statement(statement, evidence, as_of):
    problems, warnings, material, grounded = [], [], set(), False
    for item in statement.get("basis") or []:
        quote = item.get("quote")
        if "card_id" in item:
            entry = evidence.cards.get(item["card_id"])
            if not entry:
                problems.append(f"없는 카드: {item['card_id']}")
                continue
            material |= entry["digits"]
            if quote:
                if squash(quote) in entry["quotes"]:
                    grounded = True
                else:
                    problems.append(f"카드 {item['card_id']}에 없는 인용문: {quote[:40]}")
            caution = evidence.card_caution(item["card_id"], as_of)
            if caution and statement.get("kind") == "fact":
                warnings.append(f"근거 카드 주의({item['card_id']}): {caution}")
        elif "provision_id" in item:
            if not evidence.have_provisions:
                warnings.append(f"조문 저장소가 없어 확인하지 못함: {item['provision_id']}")
                continue
            text = evidence.provisions.get(item["provision_id"])
            if text is None:
                problems.append(f"없는 조문: {item['provision_id']}")
                continue
            material |= digit_groups(text)
            if quote:
                if squash(quote) in squash(text):
                    grounded = True
                else:
                    problems.append(f"조문 {item['provision_id']}에 없는 인용문: {quote[:40]}")
        else:
            problems.append("근거 항목에 card_id나 provision_id가 없음")
    for ref in statement.get("source_refs") or []:
        if ref in evidence.sources:
            material |= evidence.sources[ref]
            grounded = True
        elif ref in evidence.datasets:
            material |= evidence.datasets[ref]
            grounded = True
        else:
            problems.append(f"수집 대상 목록에 없는 ID: {ref}")
    if statement.get("kind") == "meta":
        return "pass", [], ["자료 상태에 관한 서술이라 인용을 검사하지 않음"] if not grounded else []
    if statement.get("kind") == "fact" and not grounded:
        problems.append("사실 서술인데 인용문이 있는 근거나 수집 대상 ID가 없음")
    missing = sorted(digit_groups(statement["text"], skip_references=True) - material)
    if missing:
        problems.append(f"근거에 없는 숫자: {', '.join(missing)}")
    warnings = list(dict.fromkeys(warnings))
    if statement.get("kind") == "fact":
        return ("blocked" if problems else "pass"), problems, warnings
    return "pass", [], list(dict.fromkeys(warnings + problems))  # 사실이 아닌 서술의 문제는 경고로만 알린다


def verify(data, evidence, as_of):
    results = []
    for path, statement in statements(data):
        verdict, problems, warnings = check_statement(statement, evidence, as_of)
        results.append({"path": path, "kind": statement.get("kind"), "text": statement["text"],
                        "verdict": verdict, "problems": problems, "warnings": warnings})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("answer", nargs="?", type=Path)
    parser.add_argument("--date", default=date.today().isoformat(), help="시행 상태를 판단할 기준일")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-check", type=Path, help="기대 결과가 적힌 견본 파일로 검사기 자체를 점검한다")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    evidence = Evidence()

    if args.self_check:
        samples = json.loads(args.self_check.read_text(encoding="utf-8"))["samples"]
        ok = 0
        for sample in samples:
            verdict, problems, warnings = check_statement(sample["statement"], evidence, sample.get("date", args.date))
            got = "warn" if verdict == "pass" and warnings else verdict
            good = got == sample["expect"]
            ok += good
            print(f"  {'맞음' if good else '틀림'}  기대 {sample['expect']:<7} 결과 {got:<7} {sample['name']}", file=out)
            if not good:
                print(f"         문제 {problems} 경고 {warnings}", file=out)
        print(f"견본 {len(samples)}개 중 {ok}개가 기대와 같음", file=out)
        out.flush()
        return 0 if ok == len(samples) else 1

    if not args.answer:
        parser.print_help(out)
        out.flush()
        return 2
    results = verify(json.loads(args.answer.read_text(encoding="utf-8")), evidence, args.date)
    blocked = [r for r in results if r["verdict"] == "blocked"]
    warned = [r for r in results if r["warnings"]]
    if args.json:
        print(json.dumps({"as_of": args.date, "statements": len(results), "blocked": len(blocked),
                          "warned": len(warned), "results": results}, ensure_ascii=False, indent=2), file=out)
    else:
        kinds = {}
        for r in results:
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        print(f"서술 {len(results)}개({kinds}) | 차단 {len(blocked)}개 | 경고 {len(warned)}개 | 기준일 {args.date}", file=out)
        for r in blocked:
            print(f"  차단 [{r['kind']}] {r['text'][:70]}", file=out)
            for p in r["problems"]:
                print(f"        - {p}", file=out)
        for r in warned:
            print(f"  경고 [{r['kind']}] {r['text'][:70]}", file=out)
            for w in r["warnings"]:
                print(f"        - {w}", file=out)
        if not evidence.have_provisions:
            print("  참고: 조문 저장소(.local/provisions)가 없어 조문 인용은 확인하지 않았다.", file=out)
    out.flush()
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
