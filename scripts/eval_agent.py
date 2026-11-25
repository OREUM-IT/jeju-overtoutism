"""질문 묶음으로 Agent를 돌려, 답이 어디서 나왔고 서술이 얼마나 남았는지 잰다.

사용법:
    python scripts/eval_agent.py [--mode auto|grounded|model] [--date 2026-11-24] [--limit 5] [--json] [--show]

질문은 data/search-checks.json의 질문을 쓴다(기대하는 카드가 적힌 질문은 그 카드가 답에 실렸는지도 본다).
모델을 설정했을 때(.env의 AGENT_MODEL_BASE_URL) 재는 것:
    model       모델의 답이 검사를 통과해 그대로 나간 질문 수
    fallback    모델의 답을 쓰지 못해 카드에서 뽑은 답으로 돌아간 질문 수와 까닭
    kept/blocked  남은 서술과 빠진 서술
파일을 쓰지 않는다. 표준 라이브러리만 쓴다.
"""

import argparse
import io
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import agent  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--mode", default="auto", choices=["auto", "grounded", "model"])
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--show", action="store_true", help="질문마다 남은 서술과 빠진 서술을 보여 준다")
    args = parser.parse_args()
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    os.chdir(Path(__file__).resolve().parent.parent)
    agent.load_env()
    checks = json.loads(Path("data/search-checks.json").read_text(encoding="utf-8"))["checks"]
    if args.limit:
        checks = checks[:args.limit]
    config = agent.model_config()
    rows = []
    for check in checks:
        started = time.time()
        result = agent.ask(check["query"], args.date, args.mode)
        expected = [e[5:] for e in check.get("expect", []) if e.startswith("card:")]
        cited = {b["card_id"] for s in result["statements"] for b in s["basis"] if "card_id" in b}
        rows.append({
            "question": check["query"], "mode": result["mode"], "fallback_reason": result["fallback_reason"],
            "facts": sum(1 for s in result["statements"] if s["kind"] == "fact"),
            "unknowns": sum(1 for s in result["statements"] if s["kind"] == "unknown"),
            "blocked": len(result["verification"]["blocked"]),
            "expected_card_cited": (all(card in cited for card in expected) if expected else None),
            "model_calls": sum(1 for t in result["trace"] if t["step"] == "model"),
            "tool_calls": sum(1 for t in result["trace"] if t["step"] == "tool"),
            "seconds": round(time.time() - started, 1),
            "statements": result["statements"], "blocked_statements": result["verification"]["blocked"],
        })
        row = rows[-1]
        if not args.json:
            hit = {True: "O", False: "X", None: "-"}[row["expected_card_cited"]]
            print(f"{row['mode']:8} 사실 {row['facts']:2} 확인필요 {row['unknowns']:2} 뺌 {row['blocked']:2} 카드 {hit} "
                  f"모델 {row['model_calls']}회 {row['seconds']:5.1f}초  {row['question']}"
                  + (f"  ← {row['fallback_reason']}" if row["fallback_reason"] else ""), file=out)
            if args.show:
                for item in row["statements"]:
                    print(f"      [{item['kind']}] {item['text'][:110]}", file=out)
                for item in row["blocked_statements"]:
                    print(f"      [뺌] {item['text'][:80]} ← {'; '.join(item['problems'])[:90]}", file=out)
            out.flush()
    total = len(rows)
    by_model = sum(1 for r in rows if r["mode"] == "model")
    with_expect = [r for r in rows if r["expected_card_cited"] is not None]
    summary = {
        "date": args.date, "model": config["model"] if config else None, "questions": total,
        "answered_by_model": by_model, "fell_back": sum(1 for r in rows if r["fallback_reason"]),
        "facts_kept": sum(r["facts"] for r in rows), "statements_blocked": sum(r["blocked"] for r in rows),
        "expected_card_cited": f"{sum(1 for r in with_expect if r['expected_card_cited'])}/{len(with_expect)}",
        "seconds_total": round(sum(r["seconds"] for r in rows), 1),
    }
    if args.json:
        print(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2), file=out)
    else:
        print(json.dumps(summary, ensure_ascii=False), file=out)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
