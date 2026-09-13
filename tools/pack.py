#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
怪物难度调节器 · 打包脚本
=============================================================================
把 DifficultyTuner_BP/ 打包成 DifficultyTuner.mcpack（.mcpack 本质就是改名的 zip）。

用法：
    python tools/pack.py

无需任何第三方依赖，只用 Python 标准库。路径全部相对本脚本解析，
因此无论从哪个目录调用都能正确工作。
=============================================================================
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

# ── 路径解析：<repo_root>/tools/pack.py ──────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "DifficultyTuner_BP"
OUT_FILE = REPO_ROOT / "DifficultyTuner.mcpack"

# 打包时跳过的文件 / 目录（相对 SRC_DIR）
EXCLUDE_DIRS = {"__pycache__", ".git", ".vscode"}
EXCLUDE_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}
EXCLUDE_SUFFIXES = {".pyc", ".log", ".bak", ".tmp"}


def should_skip(path: Path) -> bool:
    if path.name in EXCLUDE_FILES:
        return True
    if path.suffix.lower() in EXCLUDE_SUFFIXES:
        return True
    return any(part in EXCLUDE_DIRS for part in path.parts)


def collect(root: Path) -> list[Path]:
    if not root.is_dir():
        raise SystemExit(f"[ERROR] 找不到行为包目录: {root}")
    return sorted(
        p for p in root.rglob("*") if p.is_file() and not should_skip(p)
    )


def main() -> int:
    files = collect(SRC_DIR)

    if not files:
        raise SystemExit(f"[ERROR] {SRC_DIR} 里没有可打包的文件")

    manifest = SRC_DIR / "manifest.json"
    if not manifest.is_file():
        raise SystemExit("[ERROR] 缺少 manifest.json —— 这不是一个合法的行为包目录")

    # 先构建到临时文件，成功后再替换，避免打包中途失败留下半个包
    tmp = OUT_FILE.with_suffix(OUT_FILE.suffix + ".tmp")

    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            # 以行为包目录为根，游戏才能正确读取 manifest.json
            arcname = path.relative_to(SRC_DIR).as_posix()
            zf.write(path, arcname)

    tmp.replace(OUT_FILE)

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"[OK] 已生成 {OUT_FILE.name}  ({len(files)} 个文件, {size_kb:.1f} KB)")
    for path in files:
        print(f"     + {path.relative_to(SRC_DIR).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
