#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""项目自检：跑完输出「通过 / 失败 / 待确认」三栏，退出码 0 = 全过。"""

from __future__ import annotations

import os
import sys

results: list[tuple[str, str, str]] = []


def add(status: str, item: str, note: str = "") -> None:
    results.append((status, item, note))


def main() -> int:
    # ① 骨架完整性
    for f in ("README.md",):
        add("通过" if os.path.exists(f) else "失败", f"文件 {f}", "存在" if os.path.exists(f) else "缺失")

    # ② 验收标准是否填了（占位符还在就是没填）
    try:
        text = open("README.md", encoding="utf-8").read()
        filled = "（一句话" not in text and "（明确不做" not in text
        add("通过" if filled else "待确认", "README 目标/非目标已填", "" if filled else "还是占位符")
    except OSError:
        add("失败", "读 README", "打不开")

    # ③ 在这里加项目自己的检查
    # add("通过", "示例检查", "……")

    ok = sum(1 for s, _, _ in results if s == "通过")
    bad = sum(1 for s, _, _ in results if s == "失败")
    pend = sum(1 for s, _, _ in results if s == "待确认")
    for s, i, n in results:
        print(f"[{s}] {i} {n}")
    print(f"\n结论：通过 {ok} / 失败 {bad} / 待确认 {pend}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
