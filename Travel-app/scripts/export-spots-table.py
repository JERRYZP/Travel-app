#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 data/spots.json + data/rules.json（真身）导出「景点信息表」Markdown。

字段全部由脚本从数据推导，不手写，避免表和代码漂移。
可约日与 App 的 time.isOpenOn 同语义：openDays 非空 → 白名单，否则 closedDays 黑名单。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # Travel-app/
OUT_PATH = ROOT / "产品运营" / "0911全量景点信息表.md"
spots = json.loads((ROOT / "data/spots.json").read_text(encoding="utf-8"))["spots"]
rules = {r["spotId"]: r for r in json.loads((ROOT / "data/rules.json").read_text(encoding="utf-8"))["rules"]}

DAY_CN = {"monday": "周一", "tuesday": "周二", "wednesday": "周三",
          "thursday": "周四", "friday": "周五", "saturday": "周六", "sunday": "周日"}
ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKEND = {"saturday", "sunday"}
WEEKDAY_SET = {"monday", "tuesday", "wednesday", "thursday", "friday"}


def openable_text(rule):
    """可约日文案。与 time.isOpenOn 同语义。"""
    if not rule:
        return "—"
    open_days = rule.get("openDays") or []
    if open_days:
        ds = [d for d in ORDER if d in open_days]
        if set(ds) == WEEKEND:
            return "仅周末"
        return "仅 " + "、".join(DAY_CN[d] for d in ds)
    closed = [d for d in ORDER if d in (rule.get("closedDays") or [])]
    if not closed:
        return "全年开放"
    # 周一~周五全闭 = 实际只剩周末（用 closedDays 表达的白名单）
    if set(closed) == WEEKDAY_SET:
        return "仅周末"
    return "、".join(DAY_CN[d] for d in closed) + "闭馆"


def difficulty_label(score, reservation):
    if reservation is False:
        return "—（B 层不渲染）"
    if score >= 4:
        return "🔴 极难约"
    if score == 3:
        return "🟠 较难约"
    return "🟢 容易约"


def tier(spot):
    if spot.get("reservationRequired") is False:
        return "B"
    return "S" if spot.get("difficultyScore", 0) >= 4 else "A"


def release_text(rule):
    if not rule:
        return "—"
    times = rule.get("releaseTimes") or ([rule["releaseTime"]] if rule.get("releaseTime") else [])
    if not times:
        return "— 无放票时刻"
    return " / ".join(times)


def remind_text(spot, rule):
    if spot.get("reservationRequired") is False:
        return "不进提醒"
    if not rule or not rule.get("releaseTime"):
        return "⚠️ 不可提醒（随买随用）"
    strong = spot.get("difficultyScore", 0) >= 3
    return "🔶 强提醒" if strong else "🔵 弱提醒"


rows = []
for s in spots:
    r = rules.get(s["spotId"], {})
    is_b = s.get("reservationRequired") is False
    rows.append({
        "name": s["name"],
        "score": s.get("difficultyScore"),
        "label": difficulty_label(s.get("difficultyScore", 0), s.get("reservationRequired")),
        "tier": tier(s),
        "reservation": "✅ 需预约" if not is_b else "❌ 免预约",
        # B 层的 closedDays/releaseTime 可能是免预约前的残留值（App 不读取），不当作实时规则展示
        "openable": "—（不进提醒）" if is_b else openable_text(r),
        "advance": f'{r["advanceDays"]} 天' if r.get("advanceDays") and not is_b else "—",
        "release": "—（不进提醒）" if is_b else release_text(r),
        "remind": remind_text(s, r),
        "checked": r.get("lastCheckedDate") or "⚠️ 未核验",
        "notice": (r.get("specialNotice") or "").strip(),
        "notice_until": r.get("specialNoticeUntil") or "",
    })

# 排序：S → A → B，同层按难度分降序
rows.sort(key=lambda x: ({"S": 0, "A": 1, "B": 2}[x["tier"]], -(x["score"] or 0)))
for i, x in enumerate(rows, 1):
    x["no"] = i

head = [
    "# 全量景点信息表（北京 · 预约规则）",
    "",
    f"> 数据来源：`Travel-app/data/spots.json`（难度 / 是否预约）+ `data/rules.json`（放票规则 / 可约日 / 核验日期）",
    f"> 导出日期：2026-09-11 ｜ 共 {len(rows)} 个景点"
    f"（S {sum(1 for x in rows if x['tier']=='S')} ｜ A {sum(1 for x in rows if x['tier']=='A')} ｜ B {sum(1 for x in rows if x['tier']=='B')}）",
    "> **本表由数据文件直接导出，改数据后重跑生成即可，勿手工编辑数值。**",
    "",
    "## 全量景点表",
    "",
    "| # | 景点 | 难度分 | 难度标签 | 分层 | 是否预约 | **可约日** | 提前放票 | 开票时间 | 提醒属性 | 核验日期 |",
    "|---|------|-------|---------|------|---------|-----------|---------|---------|---------|---------|",
]
for x in rows:
    head.append(
        f"| {x['no']} | {x['name']} | {x['score']} | {x['label']} | **{x['tier']}** | {x['reservation']} "
        f"| {x['openable']} | {x['advance']} | {x['release']} | {x['remind']} | {x['checked']} |"
    )

seen_notice = [x for x in rows if x["notice"]]
head += ["", "## 临时公告", ""]
if seen_notice:
    for x in seen_notice:
        until = x["notice_until"] or "（无到期日，长期有效）"
        head.append(f"- **{x['name']}**：{x['notice']} — 生效至 **{until}**")
else:
    head.append("（当前无生效中的临时公告）")
head += [
    "",
    "> 公告由 `specialNoticeUntil` 控制自动过期：过期的公告**不会**再下发到 App（`time.activeNoticeOf`），",
    "> 因此不需要人工清理。新增公告时务必一并填 `specialNoticeUntil`（YYYY-MM-DD），否则视为长期有效。",
    "> 曾出过的问题：毛主席纪念堂的闭馆公告有效期只写在自由文本里，8/31 已到期却在 App 上继续显示了 11 天（2026-09-11 修复）。",
]

unverified = [x["name"] for x in rows if x["checked"].startswith("⚠️")]
head += [
    "",
    "## 口径说明",
    "",
    "- **可约日**与 App 的 `time.isOpenOn` 同语义：`openDays` 非空时为白名单（仅这些星期可约），否则看 `closedDays`（这些星期不可约），缺省即全年开放。",
    "  - **仅周末**：清华、北大 —— 平时工作日（周一至周五）不可约，周末可约；寒暑假等假期会改为每天开放，以学校公告为准。",
    "  - **周一闭馆**：人大堂、故宫、国博等；法定节假日通常除外。",
    "- **分层**：S = 需预约且难度 ≥4；A = 需预约且难度 ≤3；B = 免预约（不进提醒流程）。",
    "- **提醒属性**：强提醒 = 需预约且难度 ≥3；弱提醒 = 需预约且难度 ≤2；不可提醒 = 需预约但无放票时刻。",
    "- **核验日期**：`lastCheckedDate`，为空表示尚未二次核实，App 内显示「尚未复核，以官方为准」；本表标 ⚠️。",
    f"  - 未核验（{len(unverified)} 个）：{'、'.join(unverified)}",
    "",
    "> 放票规则随季节、节假日、临时施工调整，出行前请以各官方渠道当日公示为准。",
]

out = "\n".join(head) + "\n"
(ROOT / "产品运营" / "0911全量景点信息表.md").write_text(out, encoding="utf-8")
print(out)
