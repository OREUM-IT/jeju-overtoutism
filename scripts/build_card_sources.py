"""카드가 가리키는 조문 발췌 파일을 조문 저장소에서 다시 만든다.

사용법:
    python scripts/build_card_sources.py

일부 카드는 법령·조례 전체가 아니라 해당 조문만 모은 파일(.local/cards-src/<카드>/<원문>.txt)을
원문으로 가리킨다. 이 파일은 Git에 없으므로, 수집기를 돌린 뒤 이 스크립트로 다시 만든다.

대상: data/cards/*.json의 원문 항목 가운데 local_text가 .local/cards-src/로 시작하고
      provisions(조문 목록)가 있는 것.
입력: .local/provisions/<source_id>.jsonl (scripts/collect_laws.py가 만든다)

조문 내용이 수집 이후 바뀌었으면 발췌 파일의 해시가 카드에 적힌 값과 달라지고,
scripts/check_card_quotes.py가 그것을 알려 준다. 그때는 카드를 다시 검토한다.
"""

import io
import json
import sys
from pathlib import Path


def main():
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    built = problems = 0
    for card_path in sorted(Path("data/cards").glob("*.json")):
        card = json.loads(card_path.read_text(encoding="utf-8"))
        for entry in [card["source"], *card.get("additional_sources", [])]:
            target = entry.get("local_text", "")
            articles = entry.get("provisions")
            if not target.startswith(".local/cards-src/") or not articles:
                continue
            store = Path(".local/provisions", f"{entry['source_id']}.jsonl")
            if not store.exists():
                print(f"조문 저장소 없음: {store} ({card_path.name})", file=out)
                problems += 1
                continue
            by_article = {}
            for line in store.read_text(encoding="utf-8").splitlines():
                record = json.loads(line)
                by_article[record["article"]] = record["text"]
            missing = [a for a in articles if a not in by_article]
            if missing:
                print(f"조문 없음: {entry['source_id']} {missing} ({card_path.name})", file=out)
                problems += 1
                continue
            path = Path(target)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("\n\n".join(by_article[a] for a in articles) + "\n", encoding="utf-8")
            built += 1
    print(f"완료: 발췌 파일 {built}개 작성, 문제 {problems}건", file=out)
    out.flush()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
