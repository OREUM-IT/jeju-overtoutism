"""규제 카드의 인용문이 원문 텍스트에 그대로 있는지 검사한다.

사용법:
    python scripts/check_card_quotes.py <카드.json> [--write-hash]

- 카드 안의 모든 "quote" 값을 모아, 공백을 모두 지운 뒤 원문의 부분 문자열인지 본다.
- 원문은 카드의 source.local_text와 additional_sources[].local_text에서 읽는다.
- 인용문이 어느 원문의 것인지는 그 인용문을 감싼 가장 가까운 "src" 값으로 정한다.
  "src"가 없으면 source.source_id의 원문으로 본다.
- 각 원문의 text_sha256이 원문 파일의 해시와 같은지도 본다.
- --write-hash는 원문 해시를 카드에 적는다(원문을 처음 연결할 때만 쓴다).
- 표준 라이브러리만 쓰고 네트워크를 호출하지 않는다.

통과는 "인용문이 그 원문에 있다"는 뜻일 뿐이다. 요약(summary)이 인용문의
뜻을 바르게 옮겼는지는 사람이 검수한다.
"""

import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path


def squash(text: str) -> str:
    """공백을 모두 지운다. 변환본의 줄바꿈 위치가 원본과 달라도 비교할 수 있게 한다."""
    return re.sub(r"\s+", "", text)


def collect_quotes(node, path, src):
    """카드 전체를 훑어 (경로, 인용문, 원문 ID)를 모은다."""
    if isinstance(node, dict):
        src = node.get("src", src)
        for key, value in node.items():
            child = f"{path}.{key}"
            if key == "quote" and isinstance(value, str):
                yield child, value, src
            else:
                yield from collect_quotes(value, child, src)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from collect_quotes(value, f"{path}[{index}]", src)


def source_entries(card):
    """카드가 가리키는 원문 항목을 모두 돌려준다. 첫 항목이 기본 원문이다."""
    return [card["source"], *card.get("additional_sources", [])]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("card", type=Path)
    parser.add_argument("--write-hash", action="store_true")
    args = parser.parse_args()

    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    card = json.loads(args.card.read_text(encoding="utf-8"))

    failures = []
    texts = {}
    for entry in source_entries(card):
        source_id = entry["source_id"]
        path = Path(entry["local_text"])
        if not path.exists():
            print(f"원문 파일이 없다: {path}", file=out)
            out.flush()
            return 2
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        texts[source_id] = squash(raw.decode("utf-8"))
        recorded = entry.get("text_sha256")
        if args.write_hash:
            entry["text_sha256"] = digest
            print(f"해시 기록 {source_id}: {digest}", file=out)
        elif recorded is None:
            failures.append(f"{source_id}: text_sha256이 비어 있다")
        elif recorded != digest:
            failures.append(f"{source_id}: 원문 해시 불일치(카드 {recorded} / 파일 {digest})")

    if args.write_hash:
        args.card.write_text(
            json.dumps(card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    primary = card["source"]["source_id"]
    quotes = list(collect_quotes(card, "$", primary))
    per_source = {}
    for path, quote, src in quotes:
        per_source[src] = per_source.get(src, 0) + 1
        if src not in texts:
            failures.append(f"{path}: 연결되지 않은 원문 {src}")
        elif not quote.strip():
            failures.append(f"{path}: 빈 인용문")
        elif squash(quote) not in texts[src]:
            failures.append(f"{path}: {src} 원문에 없음 -> {quote}")

    counts = ", ".join(f"{src} {n}개" for src, n in per_source.items())
    print(f"인용문 {len(quotes)}개 검사({counts}), 실패 {len(failures)}개", file=out)
    for failure in failures:
        print(f"  실패: {failure}", file=out)
    out.flush()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
