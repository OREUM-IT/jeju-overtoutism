"""수집해 둔 법령·조례 응답에서 별표를 찾아 텍스트로 저장한다.

사용법:
    python scripts/collect_annexes.py [--only O01,O17] [--delay 1.0] [--refresh]

먼저 scripts/collect_laws.py를 돌려 .local/raw/laws/에 응답이 있어야 한다.

읽는 것:
    .local/raw/laws/<source_id>.json   법령 API 응답

쓰는 것:
    .local/raw/annexes/<source_id>/<별표키>.<hwp|hwpx>   내려받은 원본. Git에 넣지 않는다
    .local/annexes/<source_id>/<별표키>.txt               꺼낸 텍스트
    data/udo-annex-manifest.csv                           별표별 요약. 원문은 없다

고르는 기준:
    - 제목이 "[별표"로 시작하는 것만 받는다. "[별지 ... 서식]"은 신청서 양식이라 받지 않는다.
    - 제목에 "삭제"가 있는 것은 받지 않는다.
    - 응답에 별표 내용이 글로 들어 있으면(법령) 파일을 받지 않고 그 글을 쓴다.

지키는 것:
    - 파일은 www.law.go.kr에서만 받는다. 요청 사이에 간격을 둔다.
    - 이미 받은 파일은 다시 받지 않는다(--refresh로 다시 받는다).
    - 받은 파일은 실행하지 않고 scripts/hwp_text.py로 글만 꺼낸다.
"""

import argparse
import csv
import hashlib
import io
import json
import struct
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hwp_text import HwpError, extract  # noqa: E402

FIELDS = ["source_id", "annex_key", "annex_no", "title", "origin", "file_type", "bytes",
          "raw_sha256", "text_chars", "tables", "status", "note"]
ALLOWED_HOST = "www.law.go.kr"


def as_list(value):
    if value is None or value == "":
        return []
    return value if isinstance(value, list) else [value]


def as_text(value):
    if isinstance(value, list):
        return "\n".join(as_text(v) for v in value)
    return str(value) if value is not None else ""


def annexes_of(data):
    """응답에서 (제목, 키, 번호, 내용 글, 파일 주소, 파일 형식)을 꺼낸다."""
    if "법령" in data:
        units = as_list((data["법령"].get("별표") or {}).get("별표단위"))
        for unit in units:
            number = as_text(unit.get("별표번호")).lstrip("0") or "0"
            branch = as_text(unit.get("별표가지번호")).lstrip("0")
            kind = as_text(unit.get("별표구분"))
            title = as_text(unit.get("별표제목")).strip()
            label = f"[{kind} {number}{'의' + branch if branch else ''}] {title}"
            yield label, as_text(unit.get("별표키")), number, as_text(unit.get("별표내용")).strip(), "", ""
    else:
        units = as_list((data["LawService"].get("별표") or {}).get("별표단위"))
        for unit in units:
            yield (as_text(unit.get("별표제목")).strip(), as_text(unit.get("별표키")),
                   as_text(unit.get("별표번호")).lstrip("0") or "0",
                   as_text(unit.get("별표내용")).strip(), as_text(unit.get("별표첨부파일명")),
                   as_text(unit.get("별표첨부파일구분")).lower())


def wanted(title):
    return title.startswith("[별표") and "삭제" not in title


def download(url):
    parts = urllib.parse.urlsplit(url)
    if parts.hostname != ALLOWED_HOST:
        raise ValueError(f"허용하지 않는 주소: {parts.hostname}")
    secure = urllib.parse.urlunsplit(("https", parts.netloc, parts.path, parts.query, ""))
    request = urllib.request.Request(secure, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--local", type=Path, default=Path(".local"))
    parser.add_argument("--manifest", type=Path, default=Path("data/udo-annex-manifest.csv"))
    parser.add_argument("--only", default="", help="쉼표로 구분한 source_id. 요약 파일은 쓰지 않는다")
    parser.add_argument("--prefix", default="", help="이 글자로 시작하는 source_id만. 요약 파일을 쓴다")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

    only = {x.strip() for x in args.only.split(",") if x.strip()}
    results, downloads, skipped_forms = [], 0, 0
    for raw_path in sorted((args.local / "raw" / "laws").glob("*.json")):
        source_id = raw_path.stem
        if only and source_id not in only:
            continue
        if args.prefix and not source_id.startswith(args.prefix):
            continue
        data = json.loads(raw_path.read_text(encoding="utf-8"))
        for title, key, number, content, url, file_type in annexes_of(data):
            if not wanted(title):
                skipped_forms += 1
                continue
            row = dict.fromkeys(FIELDS, "")
            row.update(source_id=source_id, annex_key=key, annex_no=number, title=title)
            text_path = args.local / "annexes" / source_id / f"{key}.txt"
            text_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                if content:
                    text, tables = content, ""
                    row.update(origin="api_text", file_type="text", bytes=len(content.encode("utf-8")),
                               raw_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest())
                else:
                    file_path = args.local / "raw" / "annexes" / source_id / f"{key}.{file_type or 'bin'}"
                    file_path.parent.mkdir(parents=True, exist_ok=True)
                    if args.refresh or not file_path.exists():
                        file_path.write_bytes(download(url))
                        downloads += 1
                        time.sleep(max(args.delay, 0.5))
                    blob = file_path.read_bytes()
                    text, tables, detected = extract(blob)
                    row.update(origin="file", file_type=detected, bytes=len(blob),
                               raw_sha256=hashlib.sha256(blob).hexdigest())
                text_path.write_text(text + "\n", encoding="utf-8")
                row.update(text_chars=len(text), tables=tables, status="ok" if text.strip() else "empty")
            except (HwpError, zipfile.BadZipFile, ElementTree.ParseError, struct.error, ValueError) as error:
                row.update(status="unreadable", note=str(error)[:120])
            except Exception as error:
                row.update(status="error", note=type(error).__name__)
            results.append(row)
            print(f"{source_id:>4} {row['status']:<10} 글자 {str(row['text_chars']):>6} 표 {str(row['tables']):>3} "
                  f"{row['file_type']:<5} {title[:60]}" + (f"  [{row['note']}]" if row["note"] else ""), file=out)

    if not only:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        with args.manifest.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(results)
    ok = sum(r["status"] == "ok" for r in results)
    print(f"완료: 별표 {ok}/{len(results)}건 텍스트 저장, 내려받기 {downloads}회, "
          f"받지 않은 서식·삭제 항목 {skipped_forms}건", file=out)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
