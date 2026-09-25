#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「北京景点预约提醒」每日运营帖（内容层 Markdown）。

口径：
- 最早可约 = 当天日期 + 提前放票天数 N；若该日不可约，则**回退**到最近的可约日。
  提前量只会变短、不会超过 N —— 那批票本来就在 N 天窗口内，往后顺延会跑到还没放票的日期。
- 不可约的两种情况：
  · open 白名单（如清华/北大 [5,6] 仅周末）→ 白名单外的星期都不可约，优先于 monday_closed；
    用白名单而非 closedDays，是因为工作日都不可约、周末才可约，黑名单表达不了。
  · monday_closed 周一闭馆
- 法定节假日（references/holidays.json）优先覆盖所有闭馆日与开放白名单：
  假期内所有景点按开放处理；例外是 holiday_monday_closed_spots 中的景点，
  人民大会堂即便在法定假期期间也仍是周一闭馆。
- 无需预约景点固定显示「无需预约 / —」
- time_note：预约时间列的附注，渲染为「08:00（仅周末）」（北大专用）
- 可选 --skip-tuesday-groups：中国考古博物馆周二仅团体，落在周二则顺延到周三
"""
import argparse
import json
from datetime import date, timedelta
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parents[1]          # .../<skill>/
# Path(__file__).parents: [0]=scripts, [1]=<skill>, [2]=skills, [3]=.codex, [4]=<project>
PROJECT_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SPOTS = SKILL_DIR / "references" / "spots.json"
DEFAULT_HOLIDAYS = SKILL_DIR / "references" / "holidays.json"
DEFAULT_OUT = PROJECT_ROOT / "产品运营" / "A号运营" / "预约帖"

WEEKDAY = "一二三四五六日"
# 回退上限：最长连续不可约段是「仅周末」的 5 个工作日，取 6 留一步余量
MAX_BACKTRACK = 6


def weekday_cn(d: date) -> str:
    return WEEKDAY[d.weekday()]


def fmt(d: date) -> str:
    return f"{d.month}月{d.day}日"


def flames(n: int) -> str:
    return "🔥" * n


def load_spots(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_holiday_config(path: Path):
    """返回法定节假日日期集合，以及假期中仍按周一闭馆的景点名称集合。"""
    raw = json.loads(path.read_text(encoding="utf-8"))
    dates = set()
    for period in raw.get("periods", []):
        start = date.fromisoformat(period["start"])
        end = date.fromisoformat(period["end"])
        if end < start:
            raise ValueError(f"假期结束日早于开始日: {period}")
        day = start
        while day <= end:
            dates.add(day)
            day += timedelta(days=1)
    return dates, set(raw.get("holiday_monday_closed_spots", []))


def is_open_on(
    spot: dict,
    d: date,
    holiday_dates=None,
    holiday_monday_closed_spots=None,
    skip_tuesday: bool = False,
) -> bool:
    """该日是否可约。法定节假日优先覆盖闭馆日与 open 白名单。"""
    if holiday_dates and d in holiday_dates:
        if d.weekday() == 0 and spot.get("name") in (holiday_monday_closed_spots or set()):
            return False
        return True
    op = spot.get("open")
    if op:
        return d.weekday() in op
    if spot.get("monday_closed") and d.weekday() == 0:
        return False
    if skip_tuesday and spot.get("skip_tuesday") and d.weekday() == 1:
        return False
    return True


def earliest(
    post_date: date,
    spot: dict,
    holiday_dates=None,
    holiday_monday_closed_spots=None,
    skip_tuesday: bool = False,
):
    if not spot.get("bookable"):
        return "无需预约", None
    n = int(spot["n"])
    target = post_date + timedelta(days=n)
    for _ in range(MAX_BACKTRACK):
        if target >= post_date and is_open_on(
            spot,
            target,
            holiday_dates,
            holiday_monday_closed_spots,
            skip_tuesday,
        ):
            return fmt(target), target
        target -= timedelta(days=1)
    # 理论上到不了这里（上限已覆盖最长不可约段），保底返回未回退值
    target = post_date + timedelta(days=n)
    return fmt(target), target


def render_day(
    d: date,
    spots,
    holiday_dates=None,
    holiday_monday_closed_spots=None,
    skip_tuesday: bool = False,
) -> str:
    lines = [
        "# 北京景点预约提醒",
        "",
        f"> **{fmt(d)}（周{weekday_cn(d)}）**",
        "",
        "> · 提前规划 · 轻松出行 ·",
        "",
        "| 景点 | 最早可约 | 预约时间 | 预约难度 |",
        "|---|---|---|---|",
    ]
    for s in spots:
        # 免预约公园曾在旧数据中带「（随到）」后缀，渲染时统一去掉。
        name = s["name"].removesuffix("（随到）")
        val, _ = earliest(
            d,
            s,
            holiday_dates,
            holiday_monday_closed_spots,
            skip_tuesday,
        )
        t = s.get("time", "—") if s.get("bookable") else "—"
        # time_note：预约时间列的附注，渲染成「08:00（仅周末）」；缺省不加括号
        if s.get("bookable") and s.get("time_note"):
            t = f"{t}（{s['time_note']}）"
        lines.append(f"| {name} | {val} | {t} | {flames(s.get('flames', 0))} |")
    lines += ["", "> 收藏这份清单 · 出行不踩雷！", "", "> 热门景点 · 提前预约 · 祝你旅途愉快！"]
    return "\n".join(lines)


def parse_dates(args):
    today = date.today()
    start = None
    if args.start:
        start = date.fromisoformat(args.start)
    if args.end:
        end = date.fromisoformat(args.end)
        if start is None:
            raise SystemExit("--end 需要同时提供 --start")
        return start, end
    if args.days:
        base = start or today
        return base, base + timedelta(days=args.days - 1)
    raise SystemExit("请提供 --start/--end 或 --days")


def main():
    ap = argparse.ArgumentParser(description="生成北京景点预约提醒运营帖 Markdown")
    ap.add_argument("--start", help="起始日期 YYYY-MM-DD")
    ap.add_argument("--end", help="结束日期 YYYY-MM-DD")
    ap.add_argument("--days", type=int, help="从起始日期（缺省今天）起 N 天")
    ap.add_argument("--skip-tuesday-groups", action="store_true",
                    help="考古博物馆周二仅团体时顺延到周三")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录")
    args = ap.parse_args()

    spots = load_spots(DEFAULT_SPOTS)
    holiday_dates, holiday_monday_closed_spots = load_holiday_config(DEFAULT_HOLIDAYS)
    start, end = parse_dates(args)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    day = start
    while day <= end:
        content = render_day(
            day,
            spots,
            holiday_dates,
            holiday_monday_closed_spots,
            args.skip_tuesday_groups,
        )
        fn = f"{day.month:02d}{day.day:02d}_预约帖.md"
        (out / fn).write_text(content + "\n", encoding="utf-8")
        print("wrote", fn)
        day += timedelta(days=1)

    # 汇总
    summary = [f"# 北京景点预约提醒 · 数据汇总（{fmt(start)} ~ {fmt(end)}）", ""]
    day = start
    while day <= end:
        summary += [
            "---",
            "",
            f"## {fmt(day)}（周{weekday_cn(day)}）",
            "",
            render_day(
                day,
                spots,
                holiday_dates,
                holiday_monday_closed_spots,
                args.skip_tuesday_groups,
            ),
            "",
        ]
        day += timedelta(days=1)
    sum_fn = f"预约帖_汇总_{start.month:02d}{start.day:02d}-{end.month:02d}{end.day:02d}.md"
    (out / sum_fn).write_text("\n".join(summary) + "\n", encoding="utf-8")
    print("wrote", sum_fn)


if __name__ == "__main__":
    main()
