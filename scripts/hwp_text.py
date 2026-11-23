"""HWP(5.x)와 HWPX 파일에서 글과 표를 텍스트로 꺼낸다. 표준 라이브러리만 쓴다.

사용법:
    python scripts/hwp_text.py <파일.hwp 또는 .hwpx>

출력 형식:
    - 문단은 한 줄씩.
    - 표는 행마다 "| 칸 | 칸 |" 한 줄. 칸 안의 여러 문단은 " / "로 잇는다.
    - 병합된 칸은 한 번만 나온다. 행·열 병합 정보는 버린다.
    - 표 안의 표는 바깥 칸의 글로 편다.

한계:
    - 그림, 수식, 글상자 안의 글, 머리말·꼬리말, 각주는 다루지 않거나 순서가 다를 수 있다.
    - 배포용(열람 제한) 문서와 암호가 걸린 문서는 읽지 못한다.
    - 표의 행·열 위치는 칸 머리 정보에서 읽는다. 값이 이상하면 칸을 한 줄씩 늘어놓는다.
"""

import io
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from xml.etree import ElementTree

TAG_PARA_HEADER, TAG_PARA_TEXT, TAG_CTRL_HEADER, TAG_LIST_HEADER = 66, 67, 71, 72
CTRL_TABLE = b" lbt"
ENDOFCHAIN, FREESECT = 0xFFFFFFFE, 0xFFFFFFFF


class HwpError(Exception):
    pass


def clean(text):
    return re.sub(r"[ \t ]+", " ", text).strip()


def table_lines(cells):
    """{(행, 열): [문단, ...]}을 행별 한 줄로 만든다."""
    rows = {}
    for (row, col), paragraphs in cells.items():
        rows.setdefault(row, {})[col] = " / ".join(p for p in (clean(x) for x in paragraphs) if p)
    return ["| " + " | ".join(rows[r][c] for c in sorted(rows[r])) + " |" for r in sorted(rows)]


# ---------- HWP 5.x: 복합 파일(CFB) 읽기 ----------

class CompoundFile:
    def __init__(self, data):
        if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            raise HwpError("HWP 5 복합 파일이 아니다")
        self.data = data
        self.sector = 1 << struct.unpack_from("<H", data, 30)[0]
        self.mini_sector = 1 << struct.unpack_from("<H", data, 32)[0]
        (fat_count, dir_start, _, self.mini_cutoff, minifat_start, minifat_count,
         difat_start, difat_count) = struct.unpack_from("<IIIIIIII", data, 44)
        difat = list(struct.unpack_from("<109I", data, 76))
        guard = 0
        while difat_start not in (ENDOFCHAIN, FREESECT) and guard < 10000:
            block = self._sector(difat_start)
            entries = struct.unpack(f"<{self.sector // 4}I", block)
            difat.extend(entries[:-1])
            difat_start = entries[-1]
            guard += 1
        self.fat = []
        for sid in difat[:fat_count]:
            if sid in (ENDOFCHAIN, FREESECT):
                continue
            self.fat.extend(struct.unpack(f"<{self.sector // 4}I", self._sector(sid)))
        directory = self._chain(dir_start)
        self.entries = []
        for offset in range(0, len(directory), 128):
            raw = directory[offset:offset + 128]
            if len(raw) < 128:
                break
            name_len = struct.unpack_from("<H", raw, 64)[0]
            name = raw[:max(name_len - 2, 0)].decode("utf-16-le", errors="replace")
            kind = raw[66]
            left, right, child = struct.unpack_from("<III", raw, 68)
            start = struct.unpack_from("<I", raw, 116)[0]
            size = struct.unpack_from("<Q", raw, 120)[0]
            self.entries.append((name, kind, left, right, child, start, size))
        root = self.entries[0]
        self.mini_stream = self._chain(root[5])[:root[6]]
        minifat_raw = self._chain(minifat_start) if minifat_count else b""
        self.minifat = list(struct.unpack(f"<{len(minifat_raw) // 4}I", minifat_raw)) if minifat_raw else []
        self.paths = {}
        self._walk(root[4], "")

    def _sector(self, sid):
        start = (sid + 1) * self.sector
        return self.data[start:start + self.sector]

    def _chain(self, sid):
        out, guard = [], 0
        while sid not in (ENDOFCHAIN, FREESECT) and sid < len(self.fat) and guard < 1000000:
            out.append(self._sector(sid))
            sid = self.fat[sid]
            guard += 1
        return b"".join(out)

    def _mini_chain(self, sid, size):
        out, guard = [], 0
        while sid not in (ENDOFCHAIN, FREESECT) and sid < len(self.minifat) and guard < 1000000:
            start = sid * self.mini_sector
            out.append(self.mini_stream[start:start + self.mini_sector])
            sid = self.minifat[sid]
            guard += 1
        return b"".join(out)[:size]

    def _walk(self, index, prefix, depth=0):
        if index in (FREESECT, ENDOFCHAIN) or index >= len(self.entries) or depth > 200:
            return
        name, kind, left, right, child, _, _ = self.entries[index]
        self._walk(left, prefix, depth + 1)
        path = prefix + name
        self.paths[path] = index
        if kind in (1, 5):
            self._walk(child, path + "/", depth + 1)
        self._walk(right, prefix, depth + 1)

    def read(self, path):
        index = self.paths.get(path)
        if index is None:
            return None
        _, _, _, _, _, start, size = self.entries[index]
        if size < self.mini_cutoff:
            return self._mini_chain(start, size)
        return self._chain(start)[:size]


def records(stream):
    pos, end = 0, len(stream)
    while pos + 4 <= end:
        header = struct.unpack_from("<I", stream, pos)[0]
        pos += 4
        tag, level, size = header & 0x3FF, (header >> 10) & 0x3FF, (header >> 20) & 0xFFF
        if size == 0xFFF:
            if pos + 4 > end:
                break
            size = struct.unpack_from("<I", stream, pos)[0]
            pos += 4
        yield tag, level, stream[pos:pos + size]
        pos += size


def para_text(data):
    out, i, n = [], 0, len(data) // 2
    units = struct.unpack(f"<{n}H", data[:n * 2])
    while i < n:
        ch = units[i]
        if ch >= 32:
            out.append(ch)
            i += 1
        elif ch in (10, 13):
            out.append(10)
            i += 1
        elif ch in (0, 24, 25, 26, 27, 28, 29, 30, 31):
            i += 1
        else:  # 8칸을 차지하는 제어 문자
            if ch == 9:
                out.append(9)
            i += 8
    return struct.pack(f"<{len(out)}H", *out).decode("utf-16-le", errors="ignore")


def hwp5_text(data):
    cfb = CompoundFile(data)
    header = cfb.read("FileHeader")
    if not header or not header.startswith(b"HWP Document File"):
        raise HwpError("FileHeader가 없다")
    flags = struct.unpack_from("<I", header, 36)[0]
    if flags & 0x2:
        raise HwpError("암호가 걸린 문서")
    if flags & 0x4:
        raise HwpError("배포용 문서")
    compressed = bool(flags & 0x1)
    lines, tables, section = [], 0, 0
    while True:
        stream = cfb.read(f"BodyText/Section{section}")
        if stream is None:
            break
        if compressed:
            try:
                stream = zlib.decompress(stream, -15)
            except zlib.error as error:
                raise HwpError(f"압축 해제 실패: {error}") from None
        table = None

        def flush():
            nonlocal table, tables
            if table is None:
                return
            cells = table["cells"]
            sane = cells and all(r < 5000 and c < 500 for r, c in cells)
            if sane:
                lines.extend(table_lines(cells))
            else:
                for paragraphs in table["order"]:
                    lines.extend(p for p in (clean(x) for x in paragraphs) if p)
            tables += 1
            table = None

        for tag, level, payload in records(stream):
            if table is not None and level <= table["level"] and tag in (TAG_PARA_HEADER, TAG_CTRL_HEADER):
                flush()
            if tag == TAG_CTRL_HEADER and payload[:4] == CTRL_TABLE and table is None:
                table = {"level": level, "cells": {}, "order": [], "current": None}
            elif tag == TAG_LIST_HEADER and table is not None and level == table["level"] + 1:
                col, row = struct.unpack_from("<HH", payload, 8) if len(payload) >= 12 else (0xFFFF, 0xFFFF)
                key = (row, col)
                bucket = table["cells"].setdefault(key, [])
                table["order"].append(bucket)
                table["current"] = bucket
            elif tag == TAG_PARA_TEXT:
                for piece in para_text(payload).split("\n"):
                    if table is not None and table["current"] is not None:
                        table["current"].append(piece)
                    elif clean(piece):
                        lines.append(clean(piece))
        flush()
        section += 1
    if section == 0:
        raise HwpError("BodyText가 없다")
    return "\n".join(lines), tables


# ---------- HWPX: ZIP 안의 XML 읽기 ----------

def local(tag):
    return tag.rsplit("}", 1)[-1]


def run_text(node):
    out = [node.text or ""]
    for child in node:
        name = local(child.tag)
        if name == "tab":
            out.append("\t")
        elif name == "lineBreak":
            out.append("\n")
        out.append(child.tail or "")
    return "".join(out)


def hwpx_paragraph(paragraph, lines, counter, flat):
    """문단 하나를 lines에 더한다. flat이면 표를 칸 글로 편다."""
    buffer = []

    def flush():
        text = clean("".join(buffer))
        buffer.clear()
        for piece in text.split("\n"):
            if clean(piece):
                lines.append(clean(piece))

    for run in paragraph:
        if local(run.tag) != "run":
            continue
        for item in run:
            name = local(item.tag)
            if name == "t":
                buffer.append(run_text(item))
            elif name == "tbl":
                flush()
                counter[0] += 1
                cells = {}
                for row_index, tr in enumerate(x for x in item if local(x.tag) == "tr"):
                    for col_index, tc in enumerate(x for x in tr if local(x.tag) == "tc"):
                        cell_lines = []
                        for sub in tc.iter():
                            if local(sub.tag) == "subList":
                                for p in sub:
                                    if local(p.tag) == "p":
                                        hwpx_paragraph(p, cell_lines, counter, True)
                                break
                        cells[(row_index, col_index)] = cell_lines
                if flat:
                    for cell_lines in cells.values():
                        lines.extend(cell_lines)
                else:
                    lines.extend(table_lines(cells))
    flush()


def hwpx_text(data):
    lines, counter = [], [0]
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = sorted((n for n in archive.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)),
                       key=lambda n: int(re.search(r"\d+", n).group()))
        if not names:
            raise HwpError("Contents/section*.xml이 없다")
        for name in names:
            root = ElementTree.fromstring(archive.read(name))
            for paragraph in root:
                if local(paragraph.tag) == "p":
                    hwpx_paragraph(paragraph, lines, counter, False)
    return "\n".join(lines), counter[0]


def extract(data):
    """(텍스트, 표 개수, 형식)을 돌려준다."""
    if data[:4] == b"PK\x03\x04":
        text, tables = hwpx_text(data)
        return text, tables, "hwpx"
    text, tables = hwp5_text(data)
    return text, tables, "hwp"


def main():
    out = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    if len(sys.argv) != 2:
        print(__doc__, file=out)
        out.flush()
        return 2
    try:
        text, tables, kind = extract(Path(sys.argv[1]).read_bytes())
    except (HwpError, zipfile.BadZipFile, ElementTree.ParseError, struct.error) as error:
        print(f"읽지 못함: {error}", file=out)
        out.flush()
        return 1
    print(text, file=out)
    print(f"\n[{kind}, 글자 {len(text)}, 표 {tables}]", file=out)
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
