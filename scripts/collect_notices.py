"""제주특별자치도 고시·공고 게시판에서 제목으로 찾은 게시물을 받아 텍스트로 저장한다.

사용법:
    python scripts/collect_notices.py [--title 우도 --title 보전지역] [--since 2016-01-01]

대상: https://www.jeju.go.kr/news/news/law/jeju2.htm (2016-01-01 이후의 고시·공고)
      2016년 이전 자료는 다른 시스템에 있고 이 스크립트는 다루지 않는다.

쓰는 것:
    .local/raw/notices/<id>.json           게시물 상세 응답. 담당자 정보가 있어 Git에 넣지 않는다
    .local/raw/notices/<id>/<n>.<hwp|hwpx>  첨부 원본
    .local/notices/<id>.txt                 본문과 첨부에서 꺼낸 글
    data/udo-notice-manifest.csv            게시물별 요약. 본문과 담당자 정보는 없다

동작:
    - 게시판은 한 번에 2년까지만 조회한다. 기간을 2년씩 나눠 끝까지 넘긴다.
    - 목록은 찾은 것을 모두 요약에 적는다.
    - 상세와 첨부는 제목이 --detail-pattern에 맞고 --exclude-pattern에 맞지 않는 것만 받는다.
      입찰·모집 공고와 생물권보전지역 상표 공고까지 받지 않기 위해서다.
    - 첨부는 HWP·HWPX만 받아 scripts/hwp_text.py로 글을 꺼낸다. 다른 형식은 이름만 적는다.
    - 요청 사이에 간격을 둔다. www.jeju.go.kr 외에는 호출하지 않는다.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import struct
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hwp_text import HwpError, extract  # noqa: E402

BASE = "https://www.jeju.go.kr"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": BASE + "/news/news/law/jeju2.htm",
           "X-Requested-With": "XMLHttpRequest"}
KINDS = {"N": "고시", "A": "공고", "P": "입법예고", "E": "기타"}
BOARD_START = date(2016, 1, 1)
WINDOW_DAYS = 729
DEFAULT_PATTERN = r"운행|통행|제한|금지|보전지역|보전지구|도립공원|보호구역|휴식년|입도|반입|총량|지정|해제"
DEFAULT_EXCLUDE = r"생물권보전지역|입찰|견적|모집|선정|위탁|채용|평가결과|공모"
FIELDS = ["notice_id", "gosi_no", "kind", "title", "dept", "date", "keywords", "detail",
          "attachments", "extracted", "text_chars", "text_sha256", "status", "note"]


class Board:
    def __init__(self, delay):
        self.delay, self.calls = delay, 0

    def _open(self, path, params):
        url = BASE + path + "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read()
        finally:
            self.calls += 1
            time.sleep(self.delay)

    def json(self, path, **params):
        data = json.loads(self._open(path, params).decode("utf-8", errors="replace"))
        if data.get("error"):
            raise RuntimeError(str(data.get("errormsg") or "게시판 오류")[:100])
        return data

    def file(self, fid, index, name):
        return self._open("/tool/sido/file.jsp", {"mode": "download", "fid": fid, "index": index, "name": name})


def windows(since, until):
    start = max(since, BOARD_START)
    while start <= until:
        end = min(start + timedelta(days=WINDOW_DAYS), until)
        yield start, end
        start = end + timedelta(days=1)


def search(board, keyword, since, until, out):
    found = []
    for start, end in windows(since, until):
        page = 1
        while True:
            data = None
            for attempt in (1, 2):  # 한 번 실패하면 잠시 쉬고 한 번 더 한다
                try:
                    data = board.json("/tool/sido/api.jsp", act="index", page=page, conTitle=keyword,
                                      conIfmStdt=start.isoformat(), conIfmEnddt=end.isoformat(),
                                      conIfmStdt_Date=start.strftime("%Y%m%d"),
                                      conIfmEnddt_Date=end.strftime("%Y%m%d"))
                    break
                except Exception as error:
                    print(f"  '{keyword}' {start}~{end} {page}쪽 실패({type(error).__name__}), 시도 {attempt}", file=out)
                    time.sleep(5)
            if data is None:
                print(f"  '{keyword}' {start}~{end}: {page}쪽부터 건너뜀", file=out)
                break
            rows = data.get("gosis") or []
            found.extend(rows)
            pages = int((data.get("query") or {}).get("pages") or 1)
            if page >= pages or not rows:
                break
            page += 1
        print(f"  '{keyword}' {start}~{end}: 누적 {len(found)}건", file=out)
    return found


def fetch_detail(board, row, local):
    notice_id = f"{row['gb']}_{row['no']}"
    view = board.json("/tool/sido/api.jsp", act="view", gb=row["gb"], no=row["no"])
    gosi = view.get("gosi") or {}
    raw_path = local / "raw" / "notices" / f"{notice_id}.json"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(json.dumps(view, ensure_ascii=False, indent=1), encoding="utf-8")

    parts = [f"{KINDS.get(row['gb'], row['gb'])} 제{row['gosiNo']}호", row["title"],
             f"게재일 {row['date']} | {row['dept']}", "", (gosi.get("content") or "").strip()]
    files = gosi.get("gosiFiles") or []
    extracted, notes = 0, []
    if files:
        fid = board.json("/tool/sido/gosi.jsp", act="fid", no=row["gosiNo"], title=row["title"],
                         date=row["date"].replace("-", "")).get("fid")
        for index, item in enumerate(files):
            name = item.get("fname") or f"첨부 {index + 1}"
            extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            parts += ["", f"[첨부 {index + 1}] {name}"]
            if extension not in ("hwp", "hwpx"):
                notes.append(f"첨부 {index + 1}은 {extension or '알 수 없는'} 형식이라 받지 않음")
                continue
            if not fid:
                notes.append("첨부 식별자를 얻지 못함")
                continue
            file_path = local / "raw" / "notices" / notice_id / f"{index}.{extension}"
            file_path.parent.mkdir(parents=True, exist_ok=True)
            if not file_path.exists():
                file_path.write_bytes(board.file(fid, index, name))
            try:
                text, _, _ = extract(file_path.read_bytes())
                parts.append(text)
                extracted += 1
            except (HwpError, zipfile.BadZipFile, ElementTree.ParseError, struct.error) as error:
                notes.append(f"첨부 {index + 1}을 읽지 못함: {str(error)[:60]}")
    text = "\n".join(parts).strip() + "\n"
    text_path = local / "notices" / f"{notice_id}.txt"
    text_path.parent.mkdir(parents=True, exist_ok=True)
    text_path.write_text(text, encoding="utf-8")
    return {"detail": "y", "attachments": len(files), "extracted": extracted, "text_chars": len(text),
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "status": "ok" if not notes else "partial", "note": "; ".join(notes)[:200]}


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--title", action="append", help="제목 검색어. 여러 번 쓸 수 있다. 기본: 우도")
    parser.add_argument("--since", default="2016-01-01")
    parser.add_argument("--detail-pattern", default=DEFAULT_PATTERN, help="상세를 받을 제목의 정규식")
    parser.add_argument("--exclude-pattern", default=DEFAULT_EXCLUDE, help="상세를 받지 않을 제목의 정규식")
    parser.add_argument("--local", type=Path, default=Path(".local"))
    parser.add_argument("--manifest", type=Path, default=Path("data/udo-notice-manifest.csv"))
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--list-only", action="store_true", help="목록만 받고 상세는 받지 않는다")
    parser.add_argument("--from-manifest", type=Path, default=None,
                        help="이미 받은 요약 파일. 주면 게시판 검색을 건너뛰고 상세만 받는다. "
                             "그 파일에서 이미 정상으로 받은 게시물은 다시 받지 않는다")
    parser.add_argument("--refresh", action="store_true", help="이미 받은 게시물도 다시 받는다")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

    board = Board(max(args.delay, 0.5))
    keywords = args.title or ["우도"]
    since, until = date.fromisoformat(args.since), date.today()
    pattern = re.compile(args.detail_pattern)
    exclude = re.compile(args.exclude_pattern) if args.exclude_pattern else None

    notices = {}
    if args.from_manifest:
        # 이미 받은 목록에서 시작한다. 게시판 검색을 다시 하지 않는다.
        codes = {name: code for code, name in KINDS.items()}
        with args.from_manifest.open(encoding="utf-8", newline="") as handle:
            for item in csv.DictReader(handle):
                gb, no = item["notice_id"].split("_", 1)
                row = {"gb": gb or codes.get(item["kind"], ""), "no": no, "gosiNo": item["gosi_no"],
                       "title": item["title"], "dept": item["dept"], "date": item["date"]}
                notices[item["notice_id"]] = {"row": row, "keywords": item["keywords"].split(";"),
                                              "previous": item}
        print(f"  목록 파일에서 {len(notices)}건을 읽음", file=out)
    else:
        for keyword in keywords:
            for row in search(board, keyword, since, until, out):
                notice_id = f"{row['gb']}_{row['no']}"
                entry = notices.setdefault(notice_id, {"row": row, "keywords": []})
                if keyword not in entry["keywords"]:
                    entry["keywords"].append(keyword)

    results = []
    for notice_id, entry in sorted(notices.items(), key=lambda kv: kv[1]["row"]["date"], reverse=True):
        row = entry["row"]
        result = dict.fromkeys(FIELDS, "")
        result.update(notice_id=notice_id, gosi_no=row["gosiNo"], kind=KINDS.get(row["gb"], row["gb"]),
                      title=row["title"], dept=row["dept"], date=row["date"],
                      keywords=";".join(entry["keywords"]), detail="n", status="listed")
        previous = entry.get("previous") or {}
        if previous.get("detail") == "y" and previous.get("status") in ("ok", "partial") and not args.refresh:
            # 이미 받은 것은 다시 받지 않는다. 실패한 것만 다시 시도하게 된다.
            result.update({k: previous.get(k, "") for k in FIELDS})
        elif (not args.list_only and pattern.search(row["title"])
                and not (exclude and exclude.search(row["title"]))):
            try:
                result.update(fetch_detail(board, row, args.local))
            except Exception as error:
                result.update(status="error", note=f"{type(error).__name__}: {str(error)[:80]}")
            print(f"{result['date']} {result['kind']} {result['gosi_no']:<10} {result['status']:<8} "
                  f"첨부 {result['attachments'] or 0}/{result['extracted'] or 0} 글자 {result['text_chars'] or 0:>6} "
                  f"{result['title'][:54]}" + (f"  [{result['note']}]" if result["note"] else ""), file=out)
        results.append(result)

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    with args.manifest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(results)
    detailed = [r for r in results if r["detail"] == "y"]
    print(f"완료: 목록 {len(results)}건, 상세 {len(detailed)}건(정상 {sum(r['status'] == 'ok' for r in detailed)}건), "
          f"요청 {board.calls}회", file=out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
