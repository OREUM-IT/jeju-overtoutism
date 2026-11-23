// generated/repo-data.json이 저장소의 data/를 빠짐없이 옮겼는지 본다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
// @ts-expect-error 타입 선언이 없는 .mjs 스크립트
import { parseCsv } from '../scripts/sync-data.mjs';
import { CARDS, SOURCES } from '../lib/data';
import { collectQuotes } from '../lib/quotes';

const dataDir = path.resolve(__dirname, '..', '..', 'data');

describe('저장소 data/ 동기화', () => {
  it('data/cards의 카드 파일을 모두 읽는다', () => {
    const files = readdirSync(path.join(dataDir, 'cards')).filter((f) => f.endsWith('.json'));
    assert.equal(CARDS.length, files.length);
    for (const file of files) {
      const card = JSON.parse(readFileSync(path.join(dataDir, 'cards', file), 'utf8'));
      assert.deepEqual(
        CARDS.find((c) => c.card_id === card.card_id),
        card,
        `${file}이 그대로 옮겨지지 않았다`,
      );
    }
  });

  it('카드의 인용문 수가 docs/05 1절의 표와 같다', () => {
    const count = (id: string) => collectQuotes(CARDS.find((c) => c.card_id === id)).length;
    assert.equal(count('udo-vehicle-restriction-2026-715'), 33);
    assert.equal(count('jeju-absolute-conservation-area'), 72);
  });

  it('수집 대상 목록을 모두 읽고 ID가 겹치지 않는다', () => {
    const lines = readFileSync(path.join(dataDir, 'udo-regulation-sources.csv'), 'utf8').trim().split('\n');
    assert.equal(SOURCES.length, parseCsv(lines.join('\n')).length);
    assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
    assert.ok(SOURCES.every((s) => s.id && s.name && s.check_status));
  });
});

describe('CSV 읽기', () => {
  it('따옴표 안의 쉼표·줄바꿈·겹따옴표, CRLF, BOM을 처리한다', () => {
    const rows = parseCsv('﻿id,name,note\r\nA,"가, 나","첫 줄\n둘째 줄"\r\nB,"따옴표 ""안""",\r\n');
    assert.deepEqual(rows, [
      { id: 'A', name: '가, 나', note: '첫 줄\n둘째 줄' },
      { id: 'B', name: '따옴표 "안"', note: '' },
    ]);
  });

  it('칸 수가 머리글과 다르면 오류', () => {
    assert.throws(() => parseCsv('a,b\n1,2,3\n'), /칸 수/);
  });
});
