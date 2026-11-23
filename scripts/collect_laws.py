"""수집 대상 목록의 법령과 조례를 국가법령정보 OPEN API로 받아 조문 단위로 저장한다.

사용법:
    python scripts/collect_laws.py [--only L01,O01] [--delay 1.2]

읽는 것:
    .env                              LAW_OC(필수), LAW_REFERER(선택)
    data/udo-regulation-sources.csv   doc_type이 법률·대통령령·조례인 행

쓰는 것:
    .local/raw/laws/<source_id>.json        API 응답 원문. Git에 넣지 않는다
    .local/provisions/<source_id>.jsonl     조문 한 건이 한 줄
    data/udo-collection-manifest.csv        수집 결과 요약. 원문은 없다

지키는 것:
    - 요청 사이에 간격을 둔다. 과도한 호출은 이용 제한 사유다.
    - 응답에 인증키가 섞여 오므로(상세링크 항목) 저장 전에 지운다.
    - 오류는 HTTP 상태가 아니라 본문의 result·msg로 온다. 본문을 검사한다.
    - 이름이 정확히 같은 현행 문서만 받는다. 비슷한 이름으로 대신하지 않는다.
    - 법령은 시행일 기준(eflaw)으로 오늘 시행 중인 판본을 받는다. 공포일 기준(law)은
      공포됐지만 아직 시행 전인 판본을 돌려줄 수 있다.
    - 표준 라이브러리만 쓰고 www.law.go.kr 외에는 호출하지 않는다.
"""

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.law.go.kr/DRF/"
TARGETS = {"법률": "eflaw", "대통령령": "eflaw", "조례": "ordin"}
JEJU = "제주특별자치도"
MANIFEST_FIELDS = [
    "source_id", "name", "doc_type", "status", "matched_name", "mst", "doc_id",
    "effective_date", "promulgation_date", "promulgation_no", "revision_type",
    "articles", "addenda", "annexes", "listed_effective", "effective_matches_list",
    "raw_sha256", "retrieved_at", "note",
]


class ApiError(Exception):
    pass


def read_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def squash(text):
    return re.sub(r"\s+", "", text or "")


def as_list(value):
    if value is None or value == "":
        return []
    return value if isinstance(value, list) else [value]


def as_text(value):
    if isinstance(value, list):
        return "".join(as_text(v) for v in value)
    if isinstance(value, dict):
        return as_text(value.get("content", ""))
    return str(value) if value is not None else ""


def iso_date(yyyymmdd):
    s = as_text(yyyymmdd).strip()
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if re.fullmatch(r"\d{8}", s) else s


class Client:
    def __init__(self, oc, referer, delay):
        self.oc, self.delay, self.calls = oc, delay, 0
        self.headers = {"User-Agent": "Mozilla/5.0"}
        if referer:
            self.headers["Referer"] = referer

    def get(self, endpoint, **params):
        query = {"OC": self.oc, "type": "JSON", **params}
        url = BASE + endpoint + "?" + "&".join(
            f"{k}={urllib.parse.quote(str(v))}" for k, v in query.items())
        request = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
        except Exception as error:  # 주소에 인증키가 있으므로 예외 문구를 그대로 내보내지 않는다
            raise ApiError(f"요청 실패({type(error).__name__})") from None
        finally:
            self.calls += 1
            time.sleep(self.delay)
        text = raw.decode("utf-8", errors="replace").replace(self.oc, "***")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise ApiError("JSON이 아닌 응답") from None
        if isinstance(data, dict) and set(data) == {"result", "msg"}:
            raise ApiError(f"{data['result']} {data['msg']}")
        return data, text


def find_document(client, target, name, doc_type, today):
    """이름이 정확히 같고 오늘 시행 중인 문서 한 건을 찾는다.

    법령은 시행일 기준 목록(eflaw, nw=3)에서 찾는다. 공포일 기준 목록(law)은
    공포됐지만 아직 시행 전인 판본을 돌려줄 수 있다.
    돌려주는 값: (일련번호, 시행일자 8자리 또는 None, 문제 설명)
    """
    wanted = squash(name)
    if target == "eflaw":
        data, _ = client.get("lawSearch.do", target=target, query=name, nw=3, display=100)
        rows = as_list((data.get("LawSearch") or {}).get("law"))
        hits = [r for r in rows if squash(r.get("법령명한글")) == wanted
                and r.get("법령구분명") == doc_type
                and as_text(r.get("시행일자")) <= today]
        if not hits:
            return None, None, f"시행 중인 같은 이름의 법령 없음(검색 결과 {len(rows)}건)"
        latest = max(hits, key=lambda r: as_text(r.get("시행일자")))
        return latest["법령일련번호"], as_text(latest["시행일자"]), ""
    data, _ = client.get("lawSearch.do", target=target, query=name, display=50)
    rows = as_list((data.get("OrdinSearch") or {}).get("law"))
    hits = [r for r in rows if squash(r.get("자치법규명")) == wanted
            and r.get("지자체기관명") == JEJU]
    if not hits:
        return None, None, f"이름이 같은 문서 없음(검색 결과 {len(rows)}건)"
    if len(hits) > 1:
        return None, None, f"이름이 같은 문서가 {len(hits)}건"
    return hits[0]["자치법규일련번호"], None, ""


def parse_law(source_id, data):
    law = data["법령"]
    info = law["기본정보"]
    name = as_text(info.get("법령명_한글"))
    kind = as_text(info.get("법종구분"))
    records = []
    for unit in as_list(law.get("조문", {}).get("조문단위")):
        if unit.get("조문여부") != "조문":
            continue
        number = int(unit["조문번호"])
        branch = int(unit.get("조문가지번호") or 0)
        article = f"제{number}조" + (f"의{branch}" if branch else "")
        paragraphs = []
        for hang in as_list(unit.get("항")):
            items = []
            for ho in as_list(hang.get("호")):
                subitems = [{"no": as_text(m.get("목번호")).strip(), "text": as_text(m.get("목내용")).strip()}
                            for m in as_list(ho.get("목"))]
                items.append({"no": as_text(ho.get("호번호")).strip(),
                              "text": as_text(ho.get("호내용")).strip(), "subitems": subitems})
            paragraphs.append({"no": as_text(hang.get("항번호")).strip(),
                               "text": as_text(hang.get("항내용")).strip(), "items": items})
        parts = [as_text(unit.get("조문내용")).strip()]
        for p in paragraphs:
            parts.append(p["text"])
            for i in p["items"]:
                parts.append(i["text"])
                parts.extend(s["text"] for s in i["subitems"])
        records.append({
            "provision_id": f"{source_id}:{article}", "source_id": source_id, "document": name,
            "doc_type": kind, "article": article, "article_no": number, "branch_no": branch,
            "title": as_text(unit.get("조문제목")), "effective_date": iso_date(unit.get("조문시행일자")),
            "changed": unit.get("조문변경여부") == "Y", "note": as_text(unit.get("조문참고자료")),
            "text": "\n".join(x for x in parts if x), "paragraphs": paragraphs,
        })
    summary = {
        "matched_name": name, "doc_id": as_text(info.get("법령ID")),
        "effective_date": iso_date(info.get("시행일자")), "promulgation_date": iso_date(info.get("공포일자")),
        "promulgation_no": as_text(info.get("공포번호")), "revision_type": as_text(info.get("제개정구분")),
        "addenda": len(as_list(law.get("부칙", {}).get("부칙단위"))),
        "annexes": len(as_list((law.get("별표") or {}).get("별표단위"))),
    }
    return records, summary


def parse_ordinance(source_id, data):
    body = data["LawService"]
    info = body["자치법규기본정보"]
    name = as_text(info.get("자치법규명"))
    effective = iso_date(info.get("시행일자"))
    records = []
    for jo in as_list(body.get("조문", {}).get("조")):
        if jo.get("조문여부") != "Y":
            continue
        code = as_text(as_list(jo.get("조문번호"))[0])
        number, branch = int(code[:4]), int(code[4:] or 0)
        article = f"제{number}조" + (f"의{branch}" if branch else "")
        records.append({
            "provision_id": f"{source_id}:{article}", "source_id": source_id, "document": name,
            "doc_type": "조례", "article": article, "article_no": number, "branch_no": branch,
            "title": as_text(jo.get("조제목")), "effective_date": effective,
            "changed": None, "note": "", "text": as_text(jo.get("조내용")).strip(), "paragraphs": [],
        })
    annexes = as_list((body.get("별표") or {}).get("별표단위"))
    addenda = body.get("부칙") or {}
    summary = {
        "matched_name": name, "doc_id": as_text(info.get("자치법규ID")),
        "effective_date": effective, "promulgation_date": iso_date(info.get("공포일자")),
        "promulgation_no": as_text(info.get("공포번호")), "revision_type": as_text(info.get("제개정정보")),
        "addenda": len(as_list(addenda)) if isinstance(addenda, list) else (1 if addenda else 0),
        "annexes": len(annexes),
    }
    return records, summary


def collect_one(client, row, out, today):
    source_id, name, doc_type = row["id"], row["name"], row["doc_type"]
    target = TARGETS[doc_type]
    result = dict.fromkeys(MANIFEST_FIELDS, "")
    result.update(source_id=source_id, name=name, doc_type=doc_type,
                  listed_effective=row.get("observed_effective", ""))
    mst, ef_yd, problem = find_document(client, target, name, doc_type, today)
    if not mst:
        result.update(status="not_found", note=problem)
        return result
    if target == "eflaw":
        data, text = client.get("lawService.do", target=target, MST=mst, efYd=ef_yd)
    else:
        data, text = client.get("lawService.do", target=target, MST=mst)
    records, summary = (parse_law if target == "eflaw" else parse_ordinance)(source_id, data)
    if summary["effective_date"].replace("-", "") > today:
        result.update(summary, status="not_in_force", mst=mst, note="받은 판본의 시행일이 오늘 이후")
        return result
    raw_path = out / "raw" / "laws" / f"{source_id}.json"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(text, encoding="utf-8")
    prov_path = out / "provisions" / f"{source_id}.jsonl"
    prov_path.parent.mkdir(parents=True, exist_ok=True)
    with prov_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    listed = result["listed_effective"]
    result.update(summary, status="ok", mst=mst, articles=len(records),
                  raw_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
                  retrieved_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  effective_matches_list=("" if not listed else str(listed == summary["effective_date"]).lower()))
    if not records:
        result.update(status="empty", note="조문이 0건")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env", type=Path, default=Path(".env"))
    parser.add_argument("--sources", type=Path, default=Path("data/udo-regulation-sources.csv"))
    parser.add_argument("--out", type=Path, default=Path(".local"))
    parser.add_argument("--manifest", type=Path, default=Path("data/udo-collection-manifest.csv"))
    parser.add_argument("--only", default="", help="쉼표로 구분한 source_id. 비우면 전부")
    parser.add_argument("--delay", type=float, default=1.2, help="요청 사이 간격(초)")
    args = parser.parse_args()

    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    env = read_env(args.env)
    if not env.get("LAW_OC"):
        print(".env에 LAW_OC가 없다", file=out)
        return 2
    client = Client(env["LAW_OC"], env.get("LAW_REFERER", ""), max(args.delay, 0.5))

    with args.sources.open(encoding="utf-8", newline="") as handle:
        rows = [r for r in csv.DictReader(handle) if r["doc_type"] in TARGETS]
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    if only:
        rows = [r for r in rows if r["id"] in only]

    today = datetime.now().strftime("%Y%m%d")
    results = []
    for row in rows:
        try:
            result = collect_one(client, row, args.out, today)
        except ApiError as error:
            result = dict.fromkeys(MANIFEST_FIELDS, "")
            result.update(source_id=row["id"], name=row["name"], doc_type=row["doc_type"],
                          status="error", note=str(error))
        results.append(result)
        print(f"{result['source_id']:>4} {result['status']:<9} 조문 {str(result['articles']):>4} "
              f"시행 {result['effective_date'] or '-':<10} {result['name']}"
              + (f"  [{result['note']}]" if result["note"] else ""), file=out)
        if result["status"] == "error" and "검증에 실패" in result["note"]:
            print("인증 단계에서 막혔다. IP·도메인 등록과 LAW_REFERER를 확인한다. 중단.", file=out)
            break

    if not only:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        with args.manifest.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=MANIFEST_FIELDS)
            writer.writeheader()
            writer.writerows(results)
    ok = sum(r["status"] == "ok" for r in results)
    print(f"완료: {ok}/{len(results)}건 수집, 조문 {sum(int(r['articles'] or 0) for r in results)}건, "
          f"API 호출 {client.calls}회" + ("" if not only else " (일부만 실행해 요약 파일은 쓰지 않음)"), file=out)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
