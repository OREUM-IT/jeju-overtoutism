# 제주 그린체크(가칭) 화면 시안

[서비스 기획(docs/07)](../docs/07-service-plan.md)을 따라 만든 Next.js 앱이다. 저장소의 규제 카드(`data/cards/*.json`)를 읽어 여행자·사업자·정책 담당자에게 판정과 근거를 보여 준다.

**시안이다.** 두 카드 모두 검수 전(`extracted`)이므로 최종 판정은 모두 "확인 필요"로 나오고, 카드 문언에 따른 예비 판정을 함께 보인다. 판정은 법률 자문이 아니다.

## 화면

| 경로 | 화면 | 쓰는 카드 |
|---|---|---|
| `/` | 홈: 독자 선택, 지금 아는 것과 모르는 것, 판정 값 | 전체 |
| `/check` | ① 방문 전 체크(여행자) | 우도 차량 운행제한 |
| `/plan` | ② 기획 점검(사업자) | 절대보전지역 행위제한 |
| `/report` | ③ 지역 진단 보고서. `?audience=policy\|business\|traveler`, 인쇄·PDF | 전체 + 수집 대상 목록 |
| `/cards`, `/cards/{card_id}` | 규제 카드 목록·상세(인용문, 원문 위치, 기간, 열린 질문, 원본 JSON) | 전체 |

판정 화면은 검색 매개변수로 상태를 나타낸다. 주소를 그대로 공유할 수 있고, 자바스크립트가 없어도 폼 제출로 같은 결과가 나온다.

```
/check?date=2026-06-15&mode=rental_car&fuel=combustion&operator=outside&companion=child7
/plan?activity=deck&actor=private&location=unknown
```

## API

[docs/07 7절](../docs/07-service-plan.md)의 Agent 연동 계약을 시험 구현한 것이다. 수집기·Agent가 생기면 같은 모양으로 바꿔 끼운다.

| 엔드포인트 | 내용 |
|---|---|
| `GET /api/cards` | 카드 요약 목록 |
| `GET /api/cards/{card_id}` | 카드 전체 |
| `POST /api/check/visit` | 방문 전 체크. 본문 `{ date, mode, fuel, operator, seats, rental, companion[], stay, long_term, approval }` |
| `POST /api/check/plan` | 기획 점검. 본문 `{ activity, actor, location }` |
| `GET /api/report?area=우도&audience=policy` | 보고서 JSON |

```bash
curl -s -X POST http://localhost:3000/api/check/visit -H 'content-type: application/json' -d '{"date":"2026-06-15","mode":"charter_bus","operator":"outside","seats":15}'
```

## 실행

Node.js 20.9 이상이 필요하다.

```bash
cd web
npm install
npm run dev
```

`dev`·`build`·`test` 전에 `scripts/sync-data.mjs`가 저장소의 `data/`를 읽어 `generated/repo-data.json`을 만든다(Git에 넣지 않는다). 원본은 `data/` 하나뿐이다.

## 시험

```bash
npm test
```

단위 시험(`tests/`)은 판정 규칙을 docs/05 5절의 예시 표와 맞춰 보고, 판정·보고서가 내놓는 인용문이 모두 카드에 글자 그대로 있는지, 카드를 검수(`verified`)하면 최종 판정이 풀리는지 본다.

```bash
npm run build
npm run test:e2e
```

화면 시험(`e2e/`)은 빌드 결과를 `next start`로 띄워 데스크톱·휴대폰 크기에서 확인한다. Playwright 1.63 브라우저가 필요하다.

## Vercel 배포

1. Vercel에서 이 저장소를 가져온다(Import Project).
2. **Root Directory**를 `web`으로 둔다. Framework Preset은 Next.js로 잡힌다.
3. **Include files outside of the Root Directory in the Build Step**을 켜 둔다(기본값). 빌드가 `../data`를 읽기 때문이다. 꺼져 있으면 `sync-data`가 이유를 알리고 멈춘다.
4. 환경 변수는 필요 없다. 외부 API를 부르지 않는다.

## 구조

```
web/
  app/                 화면과 API(App Router)
  components/          판정 결과, 보고서, 폼 부품
  lib/verdict.ts       판정 값과 최종 판정 규칙(docs/07 4절)
  lib/checks/          카드별 판정 규칙(우도 운행제한, 절대보전지역)
  lib/report.ts        지역 진단 보고서(독자 3종)
  scripts/sync-data.mjs  data/ → generated/repo-data.json
  tests/  e2e/         단위 시험, 화면 시험
```
