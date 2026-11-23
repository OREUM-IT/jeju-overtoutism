"""수집한 조문·별표·고시공고와 규제 카드에서 질문과 관련된 것을 찾는다.

사용법:
    python scripts/search.py "우도에 렌터카 가져가도 되나"
    python scripts/search.py "제주특별법 제355조"
    python scripts/search.py "오름 야영" --type notice --top 5
    python scripts/search.py "렌터카 등록 제한" --date 2029-01-01
    python scripts/search.py --check data/search-checks.json

찾는 대상:
    card       data/cards/*.json                 규제 카드
    provision  .local/provisions/*.jsonl          법령·조례 조문
    annex      .local/annexes/**                  별표
    notice     .local/notices/*.txt               고시·공고(본문과 첨부)

방식:
    - 낱말을 글자 두 개씩 겹쳐 자른 조각(바이그램)으로 BM25 점수를 매긴다. 형태소 분석기를 쓰지 않는다.
    - "법령 이름 + 제○조" 꼴의 질문은 그 조문을 먼저 보여 준다.
    - 카드, 조문, 별표, 고시·공고를 종류마다 따로 순위를 매겨 보여 준다.
    - 카드는 --date(기본 오늘) 기준으로 기간이 끝났는지 알려 준다.
    - 고시·공고는 최근 것을 조금 앞세운다.

한계:
    - 뜻이 같아도 글자가 다르면 못 찾는다("해루질"로는 "비어업인"을 못 찾는다).
      data/search-aliases.json의 바꿔 쓰기 목록으로 일부만 보완한다.
    - 순위가 높다고 그 조문이 그 규제의 근거인 것은 아니다. 찾는 도구이지 판정하는 도구가 아니다.
    - 표준 라이브러리만 쓰고 네트워크를 호출하지 않는다.
"""

import argparse
import csv
import io
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

LOCAL = Path(".local")
TYPES = ("card", "provision", "annex", "notice")
TITLE_WEIGHT = 3
K1, B = 1.4, 0.6
PER_TYPE = {"provision": 5, "annex": 3, "notice": 5}
ALIAS_WEIGHT = 0.4  # 바꿔 쓴 말은 원래 질문의 말보다 약하게 센다
CARD_COVERAGE = 0.25  # 질문의 말 가운데 이만큼(희귀한 말일수록 크게 침)이 카드에 있어야 카드를 보여 준다
RECENCY_PER_YEAR = 0.03  # 고시·공고는 최근 것을 조금 앞세운다. 같은 규제의 공고가 해마다 이어지기 때문이다
# 질문에서 뜻이 없는 말. 문서 쪽에는 적용하지 않는다
QUERY_STOP = {"해도", "되나", "되나요", "되는지", "가능", "가능한가", "가능한지", "있나", "있나요", "있는지", "할", "수",
              "하나", "하나요", "어떻게", "무엇", "뭐", "대해", "관련", "알려줘", "알려", "인가", "인가요", "인지", "때"}


def normalize(text):
    return unicodedata.normalize("NFKC", text or "").lower()


def tokens(text):
    """낱말마다 바이그램을 만든다. 한 글자짜리 낱말은 그대로 둔다."""
    out = []
    for word in re.findall(r"[0-9a-z가-힣]+", normalize(text)):
        if len(word) <= 2:
            out.append(word)
        else:
            out.extend(word[i:i + 2] for i in range(len(word) - 1))
    return out


def strings(node, keys):
    """카드에서 지정한 키의 글을 모두 모은다."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in keys and isinstance(value, str):
                yield value
            elif key in keys and isinstance(value, list):
                yield from (v for v in value if isinstance(v, str))
            else:
                yield from strings(value, keys)
    elif isinstance(node, list):
        for item in node:
            yield from strings(item, keys)


def load_documents():
    docs = []
    for path in sorted(Path("data/cards").glob("*.json")):
        card = json.loads(path.read_text(encoding="utf-8"))
        body = " ".join(strings(card, {"summary", "target_activity", "acts", "name", "scope", "value", "method", "violation"}))
        validity = card.get("validity") or {}
        docs.append({"id": f"card:{card['card_id']}", "type": "card", "title": card.get("title", ""), "text": body,
                     "meta": {"status": card.get("enforcement_status", ""), "valid_from": validity.get("valid_from"),
                              "valid_until": validity.get("valid_until"), "until": validity.get("until", ""),
                              "grade": card.get("evidence_grade", ""), "file": path.as_posix(),
                              "instances": [{"name": i.get("name"), "status": i.get("status"), "valid_until": i.get("valid_until")}
                                            for i in card.get("instances", [])]}})
    for path in sorted((LOCAL / "provisions").glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            docs.append({"id": r["provision_id"], "type": "provision", "title": f"{r['document']} {r['article']} {r['title']}",
                         "text": r["text"], "meta": {"document": r["document"], "article": r["article"],
                                                     "effective_date": r["effective_date"], "doc_type": r["doc_type"]}})
    for manifest in sorted(Path("data").glob("*annex-manifest.csv")):
        with manifest.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                path = LOCAL / "annexes" / row["source_id"] / f"{row['annex_key']}.txt"
                if path.exists():
                    docs.append({"id": f"{row['source_id']}:별표:{row['annex_key']}", "type": "annex", "title": row["title"],
                                 "text": path.read_text(encoding="utf-8"), "meta": {"source_id": row["source_id"]}})
    seen = set()
    for manifest in sorted(Path("data").glob("*notice-manifest.csv")):
        with manifest.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                path = LOCAL / "notices" / f"{row['notice_id']}.txt"
                if row["notice_id"] in seen or not path.exists():
                    continue
                seen.add(row["notice_id"])
                docs.append({"id": f"notice:{row['notice_id']}", "type": "notice",
                             "title": f"{row['kind']} 제{row['gosi_no']}호 {row['title']}", "text": path.read_text(encoding="utf-8"),
                             "meta": {"date": row["date"], "kind": row["kind"], "gosi_no": row["gosi_no"], "dept": row["dept"]}})
    return docs


class Index:
    def __init__(self, docs):
        self.docs = docs
        self.counts, self.lengths, df = [], [], Counter()
        for doc in docs:
            terms = Counter(tokens(doc["title"]) * TITLE_WEIGHT + tokens(doc["text"]))
            self.counts.append(terms)
            self.lengths.append(sum(terms.values()))
            df.update(terms.keys())
        self.avg = {t: (sum(l for l, d in zip(self.lengths, docs) if d["type"] == t)
                        / max(1, sum(1 for d in docs if d["type"] == t))) for t in TYPES}
        n = len(docs)
        self.idf = {term: math.log(1 + (n - f + 0.5) / (f + 0.5)) for term, f in df.items()}

    def search(self, query, types, top, extra="", coverage=0.0):
        words = [w for w in re.findall(r"[0-9a-z가-힣]+", normalize(query)) if w not in QUERY_STOP]
        terms = Counter()
        for term, count in Counter(tokens(" ".join(words))).items():
            terms[term] += count
        for term in set(tokens(extra)):
            if term not in terms:
                terms[term] = ALIAS_WEIGHT
        total = sum(self.idf.get(term, 0.0) * weight for term, weight in terms.items()) or 1.0
        scored = []
        for index, doc in enumerate(self.docs):
            if doc["type"] not in types:
                continue
            counts, length, score, matched = self.counts[index], self.lengths[index], 0.0, 0.0
            for term, weight in terms.items():
                tf = counts.get(term, 0)
                if tf:
                    norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * length / self.avg[doc["type"]]))
                    score += self.idf[term] * norm * weight
                    matched += self.idf[term] * weight
            if score > 0 and matched / total >= coverage:
                if doc["type"] == "notice" and doc["meta"].get("date"):
                    score *= 1 + RECENCY_PER_YEAR * max(0, int(doc["meta"]["date"][:4]) - 2016)
                scored.append((score, index))
        scored.sort(reverse=True)
        return [(score, self.docs[index]) for score, index in scored[:top]]


def expand(query, aliases):
    """질문에 든 일상어에 대응하는 법령 용어를 돌려준다."""
    return " ".join(" ".join(words) for key, words in aliases.items() if normalize(key) in normalize(query))


def direct_lookup(query, docs):
    """'법령 이름 + 제○조(의○)' 꼴이면 그 조문을 돌려준다."""
    match = re.search(r"제\s*(\d+)\s*조(?:\s*의\s*(\d+))?", query)
    if not match:
        return []
    article = f"제{int(match.group(1))}조" + (f"의{int(match.group(2))}" if match.group(2) else "")
    name = normalize(query[:match.start()]).replace(" ", "")
    name = name.replace("제주특별법", "제주특별자치도설치및국제자유도시조성을위한특별법")
    hits = [d for d in docs if d["type"] == "provision" and d["meta"]["article"] == article
            and name and name in normalize(d["meta"]["document"]).replace(" ", "")]
    hits.sort(key=lambda d: len(d["meta"]["document"]))
    return hits[:3]


def card_note(meta, as_of):
    parts = [f"상태 {meta['status']}", f"등급 {meta['grade']}"]
    if meta["valid_until"]:
        ended = meta["valid_until"] < as_of
        parts.append(f"기간 ~{meta['valid_until']}" + (" (지남: 후속 공고를 확인하기 전에는 단정하지 않는다)" if ended else ""))
    elif meta["until"]:
        parts.append(meta["until"])
    for inst in meta["instances"]:
        end = inst.get("valid_until")
        flag = " (지남)" if end and end < as_of else ""
        parts.append(f"{inst['name']}: {inst['status']}" + (f" ~{end}{flag}" if end else ""))
    return " | ".join(parts)


def snippet(doc, query, width=110):
    text = re.sub(r"\s+", " ", doc["text"])
    words = [w for w in re.findall(r"[0-9a-z가-힣]{2,}", normalize(query))]
    low = normalize(text)
    positions = [low.find(w) for w in words if low.find(w) >= 0]
    start = max(0, min(positions) - 20) if positions else 0
    return ("…" if start else "") + text[start:start + width] + ("…" if start + width < len(text) else "")


def run_query(index, query, aliases, types, top, as_of):
    extra = expand(query, aliases)
    expanded = query + " " + extra
    result = {"query": query, "added_terms": extra, "direct": [], "cards": [], "sources": []}
    if "provision" in types:
        result["direct"] = [{"id": d["id"], "title": d["title"], "effective_date": d["meta"]["effective_date"]}
                            for d in direct_lookup(query, index.docs)]
    if "card" in types:
        for score, doc in index.search(query, {"card"}, 3, extra, CARD_COVERAGE):
            result["cards"].append({"id": doc["id"], "title": doc["title"], "score": round(score, 2),
                                    "note": card_note(doc["meta"], as_of), "file": doc["meta"]["file"]})
    for kind in ("provision", "annex", "notice"):
        if kind not in types:
            continue
        # 종류마다 따로 순위를 매긴다. 조문과 공고는 쓰임이 달라 한 줄로 세우면 한쪽이 묻힌다
        for score, doc in index.search(query, {kind}, top or PER_TYPE[kind], extra):
            entry = {"id": doc["id"], "type": doc["type"], "title": doc["title"], "score": round(score, 2),
                     "snippet": snippet(doc, expanded)}
            entry.update({k: v for k, v in doc["meta"].items() if k in ("effective_date", "date")})
            result["sources"].append(entry)
    return result


def print_result(result, out):
    print(f"질문: {result['query']}" + (f"  (덧붙인 말: {result['added_terms']})" if result["added_terms"] else ""), file=out)
    if result["direct"]:
        print("조문 바로 찾기:", file=out)
        for d in result["direct"]:
            print(f"  {d['id']}  {d['title']}  (조문 시행일 {d['effective_date']})", file=out)
    if not result["cards"]:
        print("규제 카드: 관련된 카드를 찾지 못함", file=out)
    else:
        print("규제 카드:", file=out)
        for c in result["cards"]:
            print(f"  [{c['score']:>6}] {c['id']}  {c['title']}", file=out)
            print(f"           {c['note']}", file=out)
    labels = {"provision": "조문", "annex": "별표", "notice": "고시·공고"}
    for kind, label in labels.items():
        rows = [s for s in result["sources"] if s["type"] == kind]
        if not rows:
            continue
        print(f"{label}:", file=out)
        for s in rows:
            when = s.get("effective_date") or s.get("date") or ""
            print(f"  [{s['score']:>6}] {s['id']}  {s['title'][:70]}" + (f"  ({when})" if when else ""), file=out)
            print(f"           {s['snippet']}", file=out)


def run_checks(index, path, aliases, as_of, out):
    checks = json.loads(path.read_text(encoding="utf-8"))["checks"]
    passed = 0
    for check in checks:
        result = run_query(index, check["query"], aliases, TYPES, 0, as_of)
        found = [x["id"] for x in result["direct"]] + [c["id"] for c in result["cards"]] + [s["id"] for s in result["sources"]]
        ok = all(any(f == e or f.startswith(e) for f in found) for e in check["expect"])
        passed += ok
        missing = [e for e in check["expect"] if not any(f == e or f.startswith(e) for f in found)]
        print(f"  {'통과' if ok else '실패'}  {check['query']}" + (f"  (못 찾음: {missing})" if missing else ""), file=out)
    print(f"점검 질문 {len(checks)}개 중 {passed}개 통과", file=out)
    return passed == len(checks)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("query", nargs="?")
    parser.add_argument("--type", action="append", choices=TYPES, help="찾을 대상. 여러 번 쓸 수 있다")
    parser.add_argument("--top", type=int, default=0, help="종류마다 보여 줄 건수. 기본은 조문 5, 별표 3, 고시·공고 5")
    parser.add_argument("--date", default=date.today().isoformat(), help="카드의 기간을 판단할 기준일")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--aliases", type=Path, default=Path("data/search-aliases.json"))
    parser.add_argument("--check", type=Path, help="점검 질문 파일을 돌린다")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    docs = load_documents()
    if not any(d["type"] != "card" for d in docs):
        print("수집한 원문이 없다. 수집기를 먼저 돌린다. 카드만 찾는다.", file=out)
    index = Index(docs)
    aliases = json.loads(args.aliases.read_text(encoding="utf-8")).get("aliases", {}) if args.aliases.exists() else {}
    status = 0
    if args.check:
        counts = Counter(d["type"] for d in docs)
        print(f"색인: 카드 {counts['card']}, 조문 {counts['provision']}, 별표 {counts['annex']}, 고시·공고 {counts['notice']}", file=out)
        status = 0 if run_checks(index, args.check, aliases, args.date, out) else 1
    elif args.query:
        result = run_query(index, args.query, aliases, tuple(args.type or TYPES), args.top, args.date)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2), file=out)
        else:
            print_result(result, out)
    else:
        parser.print_help(out)
        status = 2
    out.flush()
    return status


if __name__ == "__main__":
    sys.exit(main())
