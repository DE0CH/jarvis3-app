#!/usr/bin/env python3
"""Fail when a recorded simulator frame is blank.

Usage: check-frames.py <dir> [<dir> …]  (every *.png under them: the screenshots the Maestro flows
take at each step)

A blank frame (a white or black screen with nothing drawn, the usual sign of a native route that
mounted without its content) has almost every pixel the colour of the background. A real screen,
even the sparse first screen (a greeting and the composer), has visibly more. Pure standard
library: the macOS runner's python has no imaging package.
"""
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from collections import Counter
from pathlib import Path

# share of pixels that differ from the most common colour; a screen with a line of text and a
# button is well above this, a blank one is below it
MIN_INK = 0.004
SAMPLE_STEP = 1 if shutil.which("sips") else 3  # the sips copy is small: every pixel


def decode(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, width = 8, b"", 0
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        chunk = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or ctype not in (2, 6) or interlace:
                raise ValueError(f"unsupported PNG (depth {depth}, colour type {ctype})")
            bpp = 3 if ctype == 2 else 4
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(height):
        f = raw[i]
        line = bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 255
        rows.append(line)
        prev = line
    return width, height, bpp, rows


def small(path: Path, tmp: Path) -> Path:
    """A copy at most 300 px on its long side (macOS sips), so the pure-Python decode is quick."""
    if not shutil.which("sips"):
        return path
    out = tmp / path.name
    done = subprocess.run(["sips", "-Z", "300", str(path), "--out", str(out)], capture_output=True)
    return out if done.returncode == 0 and out.exists() else path


def ink(path: Path) -> float:
    width, height, bpp, rows = decode(path)
    counts = Counter()
    for y in range(0, height, SAMPLE_STEP):
        row = rows[y]
        for x in range(0, width, SAMPLE_STEP):
            o = x * bpp
            # coarse colour buckets, so antialiasing noise on a blank screen doesn't count as ink
            counts[(row[o] >> 4, row[o + 1] >> 4, row[o + 2] >> 4)] += 1
    total = sum(counts.values())
    return 1 - counts.most_common(1)[0][1] / total


def main() -> int:
    roots = [Path(arg) for arg in sys.argv[1:]]
    # the flows' own takeScreenshot frames (Maestro also saves step screenshots of optional checks)
    frames = sorted(
        f for root in roots for f in root.rglob("*.png") if f.parent.name == "takeScreenshot"
    )
    if not frames:
        print(f"no frames under {' '.join(map(str, roots))}")
        return 1
    blank = []
    tmp = Path(tempfile.mkdtemp())
    for frame in frames:
        try:
            share = ink(small(frame, tmp))
        except ValueError as e:
            print(f"skip {frame}: {e}")
            continue
        print(f"{share:.4f}  {frame}")
        if share < MIN_INK:
            blank.append(frame)
    if blank:
        print("BLANK frames:", *[str(f) for f in blank], sep="\n  ")
        return 1
    print(f"{len(frames)} frames, none blank")
    return 0


if __name__ == "__main__":
    sys.exit(main())
