"""제주특별자치도(본청)의 현행 자치법규 목록을 받아 저장한다.

사용법:
    python scripts/list_ordinances.py [--delay 1.2]

조례 이름을 추측해서 받으면 빠지는 조례가 생긴다. 전체 목록을 먼저 받고 거기서 고른다.

쓰는 것:
    data/jeju-ordinance-list.csv   이름, 종류, 분야, 시행일, 공포번호, 일련번호. 본문은 없다

지키는 것: scripts/collect_laws.py와 같다. 인증키는 .env에서 읽고 응답에서 지운다.
"""

import argparse
import csv
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect_laws import JEJU, ApiError, Client, as_list, iso_date, read_env  # noqa: E402

FIELDS = ["name", "kind", "field", "effective_date", "promulgation_no", "revision_type", "mst", "doc_id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", type=Path, default=Path(".env"))
    parser.add_argument("--out", type=Path, default=Path("data/jeju-ordinance-list.csv"))
    parser.add_argument("--delay", type=float, default=1.2)
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

    env = read_env(args.env)
    if not env.get("LAW_OC"):
        print(".env에 LAW_OC가 없다", file=out)
        return 2
    client = Client(env["LAW_OC"], env.get("LAW_REFERER", ""), max(args.delay, 0.5))

    rows, page, total = [], 1, None
    try:
        while True:
            data, _ = client.get("lawSearch.do", target="ordin", query=JEJU, display=100, page=page)
            root = data.get("OrdinSearch") or {}
            total = int(root.get("totalCnt") or 0)
            batch = as_list(root.get("law"))
            rows.extend(batch)
            print(f"  {page}쪽: {len(batch)}건, 누적 {len(rows)}/{total}", file=out)
            if not batch or len(rows) >= total:
                break
            page += 1
    except ApiError as error:
        print(f"중단: {error}", file=out)
        return 1

    own = [r for r in rows if r.get("지자체기관명") == JEJU]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for r in sorted(own, key=lambda x: x.get("자치법규명", "")):
            writer.writerow({
                "name": r.get("자치법규명", ""), "kind": r.get("자치법규종류", ""),
                "field": r.get("자치법규분야명", ""), "effective_date": iso_date(r.get("시행일자")),
                "promulgation_no": r.get("공포번호", ""), "revision_type": r.get("제개정구분명", ""),
                "mst": r.get("자치법규일련번호", ""), "doc_id": r.get("자치법규ID", ""),
            })
    kinds = {}
    for r in own:
        kinds[r.get("자치법규종류", "")] = kinds.get(r.get("자치법규종류", ""), 0) + 1
    print(f"완료: 검색 {len(rows)}건 중 본청 {len(own)}건 저장, 종류 {kinds}, API 호출 {client.calls}회", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
