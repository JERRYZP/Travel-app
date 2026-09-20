#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 data/ 下的两份真身同步到 data/seed/（裸数组形态），消除派生物漂移。

背景（2026-09-17 定规）：
- `data/seed/` 是**测试夹具**，不是第四份真身。`admin.seed` 云函数读的是随函数打包的
  `cloudfunctions/reminder/data/*.json`，全仓库没有任何代码 require `data/seed/`。
- 它只被 `test/opendays.test.js` 当作「独立副本」参与一致性断言。既然要参与断言，
  就不能手工维护——历史上 `spots.seed.json` 缺 `audienceTags` 26/26 条无人发现，
  因为该断言的 FIELDS 清单只覆盖 rules 的 8 个字段、从没比过 spots。

⚠️ 形态差异（不是 bug，别「修」）：
    真身   `data/spots.json`      = `{ "spots": [ ... ] }`   ← 云函数/脚本按包装键读取
    夹具   `data/seed/spots.seed.json` = `[ ... ]`            ← 裸数组，直接 forEach
逐字拷贝会把夹具变成对象，`opendays.test.js` 的 `seedRules.forEach` 当场炸。
所以本脚本做的是**拆包装 + 规范化序列化**，比对也是比解析后的内容，不是比字节。

用法：
    python3 scripts/sync-seed-copies.py          # 同步
    python3 scripts/sync-seed-copies.py --check  # 只检查，有漂移则退出码 1
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # Travel-app/
MIRRORS = [
    ("data/spots.json", "spots", "data/seed/spots.seed.json"),
    ("data/rules.json", "rules", "data/seed/rules.seed.json"),
]


def dump(items):
    """与现有 seed 文件同风格：2 空格缩进、中文不转义、末尾换行。"""
    return json.dumps(items, ensure_ascii=False, indent=2) + "\n"


check_only = "--check" in sys.argv
drift, synced = [], []

for src_rel, key, dst_rel in MIRRORS:
    src, dst = ROOT / src_rel, ROOT / dst_rel
    if not src.exists():
        print(f"✗ 真身缺失：{src_rel}", file=sys.stderr)
        sys.exit(2)

    src_doc = json.loads(src.read_text(encoding="utf-8"))
    truth = src_doc[key]                          # 拆包装 → 裸数组
    assert isinstance(truth, list), f"{src_rel} 的 {key} 不是数组"

    current = json.loads(dst.read_text(encoding="utf-8")) if dst.exists() else None
    if current == truth:
        print(f"✓ 已一致：{dst_rel}（{len(truth)} 条）")
        continue

    drift.append(dst_rel)
    if check_only:
        n = len(truth) - len(current) if isinstance(current, list) else None
        hint = f"，条数 {len(current)} → {len(truth)}" if n else ""
        print(f"✗ 漂移：{dst_rel}{hint}", file=sys.stderr)
        continue

    dst.write_text(dump(truth), encoding="utf-8")
    synced.append(dst_rel)
    print(f"→ 已同步：{src_rel}  →  {dst_rel}（{len(truth)} 条，裸数组）")

if check_only and drift:
    print(f"\n共 {len(drift)} 份漂移，跑 `python3 scripts/sync-seed-copies.py` 修复。", file=sys.stderr)
    sys.exit(1)

# 同步后再验一次形态与内容，防止写出结构不对的文件
for src_rel, key, dst_rel in MIRRORS:
    got = json.loads((ROOT / dst_rel).read_text(encoding="utf-8"))
    want = json.loads((ROOT / src_rel).read_text(encoding="utf-8"))[key]
    assert isinstance(got, list), f"{dst_rel} 必须是裸数组，实际是 {type(got).__name__}"
    assert got == want, f"{dst_rel} 内容与真身不符"

print(f"\n完成：{len(MIRRORS) - len(drift)}/{len(MIRRORS)} 份已一致"
      f"{f'，本次同步 {len(synced)} 份' if synced else ''}。形态校验通过（均为裸数组）。")
