// 저장소의 data/ 를 읽어 앱이 쓰는 generated/repo-data.json 을 만든다.
//
// - 원본은 저장소 루트의 data/cards/*.json 과 data/udo-regulation-sources.csv 하나뿐이다.
//   이 파일은 그 사본이며 Git에 넣지 않는다(web/.gitignore).
// - dev·build·test 전에 npm이 자동으로 실행한다(predev, prebuild, pretest).
// - 표준 라이브러리만 쓰고 네트워크를 호출하지 않는다. 같은 입력이면 같은 결과가 나온다.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(webDir, '..', 'data');
const cardsDir = path.join(dataDir, 'cards');
const sourcesCsv = path.join(dataDir, 'udo-regulation-sources.csv');
const outFile = path.join(webDir, 'generated', 'repo-data.json');

function fail(message) {
  console.error(`[sync-data] ${message}`);
  process.exit(1);
}

/** RFC 4180 형식의 CSV를 객체 배열로 바꾼다. 따옴표 안의 쉼표·줄바꿈·"" 를 처리한다. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있습니다');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (!header) return [];
  return body.map((r, index) => {
    if (r.length !== header.length) {
      throw new Error(`${index + 2}번째 줄의 칸 수(${r.length})가 머리글(${header.length})과 다릅니다`);
    }
    return Object.fromEntries(header.map((name, i) => [name, r[i]]));
  });
}

function loadCards() {
  if (!existsSync(cardsDir)) {
    fail(
      `규제 카드 폴더가 없습니다: ${cardsDir}\n` +
        '  Vercel에서 Root Directory를 web으로 두었다면 프로젝트 설정의\n' +
        '  "Include files outside of the Root Directory in the Build Step"을 켜 주세요.',
    );
  }
  const files = readdirSync(cardsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const seen = new Map();
  return files.map((file) => {
    let card;
    try {
      card = JSON.parse(readFileSync(path.join(cardsDir, file), 'utf8'));
    } catch (error) {
      fail(`${file}: JSON을 읽지 못했습니다 (${error.message})`);
    }
    for (const key of ['schema_version', 'card_id', 'title', 'evidence_grade', 'source']) {
      if (!(key in card)) fail(`${file}: 필수 필드 ${key}가 없습니다`);
    }
    if (seen.has(card.card_id)) fail(`${file}: card_id ${card.card_id}가 ${seen.get(card.card_id)}와 겹칩니다`);
    seen.set(card.card_id, file);
    if (`${card.card_id}.json` !== file) {
      console.warn(`[sync-data] 경고: ${file}의 card_id(${card.card_id})가 파일 이름과 다릅니다`);
    }
    return card;
  });
}

function loadSources() {
  if (!existsSync(sourcesCsv)) {
    console.warn(`[sync-data] 경고: 수집 대상 목록이 없습니다: ${sourcesCsv}`);
    return [];
  }
  try {
    return parseCsv(readFileSync(sourcesCsv, 'utf8'));
  } catch (error) {
    fail(`udo-regulation-sources.csv: ${error.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cards = loadCards();
  const sources = loadSources();
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify({ cards, sources }, null, 1)}\n`);
  console.log(`[sync-data] 규제 카드 ${cards.length}건, 수집 대상 ${sources.length}건 → generated/repo-data.json`);
}
