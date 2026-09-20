#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 data/spots.json + data/rules.json（唯一真身）导出「全量景点表」的 Excel 版本。

与 `scripts/export-spots-table.py`（Markdown 版）同源同口径，但按 Excel 的用法重排：
数据表 + 开票时间聚类表分 Sheet，列宽/冻结/筛选/条件着色都设好，可直接当运营台账用。

口径与 skill `travel-app-spot-data` 一致：
- 难度标签 ≥4 极难约 / =3 较难约 / ≤2 容易约（TAG-RULE-001）
- 分层 S = 需预约且 ≥4；A = 需预约且 ≤3；B = 免预约
- 可约日与 time.isOpenOn 同语义：openDays 非空为白名单，否则看 closedDays
"""
import datetime
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent          # Travel-app/
TOKYO = datetime.timezone(datetime.timedelta(hours=8))  # 全系统按北京时间 GMT+8
TODAY = datetime.datetime.now(TOKYO).date()
EXPORT_DATE = TODAY.isoformat()
OUT_PATH = ROOT / "产品运营" / f"{TODAY.strftime('%m%d')}全量景点信息表.xlsx"

spots = json.loads((ROOT / "data/spots.json").read_text(encoding="utf-8"))["spots"]
rules = {r["spotId"]: r for r in json.loads((ROOT / "data/rules.json").read_text(encoding="utf-8"))["rules"]}

# 规则 2：导出前比对部署副本，不一致时以 data/ 为准并报警（不静默）
def _check_deploy_copy(name):
    src = ROOT / "data" / name
    dst = ROOT / "cloudfunctions" / "reminder" / "data" / name
    if dst.exists() and src.read_bytes() != dst.read_bytes():
        print(f"[警告] {name} 与 cloudfunctions/reminder/data/ 部署副本不一致，本表以 data/ 为准；"
              f"请同步部署副本（改 data/ 时必须同步）。", file=sys.stderr)
        return True
    return False


DEPLOY_DRIFT = [_check_deploy_copy("spots.json"), _check_deploy_copy("rules.json")]

DAY_CN = {"monday": "周一", "tuesday": "周二", "wednesday": "周三",
          "thursday": "周四", "friday": "周五", "saturday": "周六", "sunday": "周日"}
ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKEND = {"saturday", "sunday"}
WEEKDAY_SET = {"monday", "tuesday", "wednesday", "thursday", "friday"}


def openable_text(rule):
    """可约日文案。与 time.isOpenOn 同语义，禁止自行 includes。"""
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
    if set(closed) == WEEKDAY_SET:
        return "仅周末"
    return "、".join(DAY_CN[d] for d in closed) + "闭馆"


def difficulty_label(score, reservation):
    if reservation is False:
        return "—（不渲染）"
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
    return "🔶 强提醒" if spot.get("difficultyScore", 0) >= 3 else "🔵 弱提醒"


def monday_closed(rule):
    if not rule:
        return "—"
    if (rule.get("openDays") or []):
        return "仅周末开放" if set(rule["openDays"]) == WEEKEND else "白名单外不可约"
    return "✅" if "monday" in (rule.get("closedDays") or []) else "❌"


def monday_note(rule):
    """周一列的补充说明：园中园 / 白名单 / 其他闭馆日。"""
    if not rule:
        return ""
    if rule.get("openDays"):
        return "仅周末可约"
    closed = [d for d in ORDER if d in (rule.get("closedDays") or []) and d != "monday"]
    notes = []
    if rule.get("closedDaysNote"):
        notes.append("仅园中园")
    if closed:
        notes.append("、".join(DAY_CN[d] for d in closed) + "闭馆")
    return "；".join(notes)


rows = []
for s in spots:
    r = rules.get(s["spotId"], {})
    is_b = s.get("reservationRequired") is False
    rows.append({
        "name": s["name"],
        "category": s.get("category", ""),
        "score": s.get("difficultyScore"),
        "label": difficulty_label(s.get("difficultyScore", 0), s.get("reservationRequired")),
        "tier": tier(s),
        "reservation": "✅ 需预约" if not is_b else "❌ 免预约",
        # B 层的 closedDays/releaseTime 是免预约前的残留值（App 不读取），不当作规则展示
        "openable": "—（不进提醒）" if is_b else openable_text(r),
        "advance": f'{r["advanceDays"]}天' if r.get("advanceDays") and not is_b else "—",
        "release": "—（不进提醒）" if is_b else release_text(r),
        "remind": remind_text(s, r),
        "monday": "—（不进提醒）" if is_b else monday_closed(r),
        "monday_note": "" if is_b else monday_note(r),
        "checked": r.get("lastCheckedDate") or "⚠️ 未核验",
        "notice": (r.get("specialNotice") or "").strip(),
        "notice_until": r.get("specialNoticeUntil") or "",
    })

# 行序：S → A → B；层内难度分降序
rows.sort(key=lambda x: ({"S": 0, "A": 1, "B": 2}[x["tier"]], -(x["score"] or 0)))
for i, x in enumerate(rows, 1):
    x["no"] = i

# 数据风险：未核验景点 + 已过期公告
unverified = [x["name"] for x in rows if x["checked"].startswith("⚠️")]
expired_list = [
    f"{x['name']}（生效至 {x['notice_until']}，已过期）"
    for x in rows
    if x["notice"] and x["notice_until"] and x["notice_until"] < EXPORT_DATE
]

# ---------- 样式 ----------
HEAD_FILL = PatternFill("solid", fgColor="1F2937")
HEAD_FONT = Font(color="FFFFFF", bold=True, size=11)
TITLE_FONT = Font(bold=True, size=14)
META_FONT = Font(color="6B7280", size=10)
THIN = Side(style="thin", color="D1D5DB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CENTER = Alignment(horizontal="center", vertical="center")
LEFT_WRAP = Alignment(horizontal="left", vertical="center", wrap_text=True)
TIER_FILL = {
    "S": PatternFill("solid", fgColor="FEE2E2"),
    "A": PatternFill("solid", fgColor="FEF3C7"),
    "B": PatternFill("solid", fgColor="E5E7EB"),
}

wb = Workbook()

# ================= Sheet 1：全量景点表 =================
ws = wb.active
ws.title = "全量景点表"

HEADERS = ["#", "景点", "类别", "难度分", "难度标签", "分层", "是否预约", "可约日",
           "提前放票", "开票时间", "提醒属性", "周一闭馆", "周一备注", "核验日期"]
WIDTHS = [4, 24, 8, 7, 11, 6, 10, 16, 9, 14, 16, 10, 14, 12]

ws.append([f"全量景点表（北京 · 预约规则）"])
ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(HEADERS))
ws.cell(1, 1).font = TITLE_FONT
ws.cell(1, 1).alignment = Alignment(horizontal="left", vertical="center")
ws.row_dimensions[1].height = 26

n_s = sum(1 for x in rows if x["tier"] == "S")
n_a = sum(1 for x in rows if x["tier"] == "A")
n_b = sum(1 for x in rows if x["tier"] == "B")
LATEST_CHECKED = max([r.get("lastCheckedDate") for r in rules.values() if r.get("lastCheckedDate")] or ["—"])
ws.append([f"数据基准：data/spots.json + data/rules.json（最新核验日期 {LATEST_CHECKED}）｜ 导出日期：{EXPORT_DATE} ｜ "           f"共 {len(rows)} 个景点（S {n_s} ｜ A {n_a} ｜ B {n_b}）"])
ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(HEADERS))
ws.cell(2, 1).font = META_FONT
ws.cell(2, 1).alignment = Alignment(horizontal="left", vertical="center")

ws.append(["本表由数据文件直接导出，改数据后重跑 scripts/export-spots-xlsx.py，勿手工编辑数值。"])
ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=len(HEADERS))
ws.cell(3, 1).font = META_FONT
ws.cell(3, 1).alignment = Alignment(horizontal="left", vertical="center")

HEAD_ROW = 5
ws.append([])                       # 第 4 行留白
ws.append(HEADERS)                  # 第 5 行表头
for c, (h, w) in enumerate(zip(HEADERS, WIDTHS), 1):
    cell = ws.cell(HEAD_ROW, c, h)
    cell.fill, cell.font, cell.alignment, cell.border = HEAD_FILL, HEAD_FONT, CENTER, BORDER
    ws.column_dimensions[get_column_letter(c)].width = w
ws.row_dimensions[HEAD_ROW].height = 22

for x in rows:
    ws.append([x["no"], x["name"], x["category"], x["score"], x["label"], x["tier"],
               x["reservation"], x["openable"], x["advance"], x["release"],
               x["remind"], x["monday"], x["monday_note"], x["checked"]])

LASTM = 0
for i in range(HEAD_ROW + 1, HEAD_ROW + 1 + len(rows)):
    LASTM = i
    for c in range(1, len(HEADERS) + 1):
        cell = ws.cell(i, c)
        cell.border = BORDER
        cell.alignment = LEFT_WRAP if c in (2, 8, 11, 13) else CENTER
    ws.cell(i, 6).fill = TIER_FILL[ws.cell(i, 6).value]
    if str(ws.cell(i, 14).value).startswith("⚠️"):
        ws.cell(i, 14).font = Font(color="B45309", bold=True)
    if str(ws.cell(i, 11).value).startswith("⚠️"):
        ws.cell(i, 11).font = Font(color="B45309", bold=True)
    if ws.cell(i, 6).value == "B":
        for c in range(1, len(HEADERS) + 1):
            ws.cell(i, c).font = Font(color="6B7280")
        ws.cell(i, 6).font = Font(color="6B7280", bold=True)

ws.freeze_panes = f"A{HEAD_ROW + 1}"      # 冻结表头
ws.auto_filter.ref = f"A{HEAD_ROW}:{get_column_letter(len(HEADERS))}{LASTM}"

# ================= Sheet 2：按开票时间聚类 =================
ws2 = wb.create_sheet("按开票时间聚类")
ws2.append(["按开票时间聚类（仅需预约项 S / A 层）"])
ws2.merge_cells(start_row=1, start_column=1, end_row=1, end_column=3)
ws2.cell(1, 1).font = TITLE_FONT
ws2.cell(1, 1).alignment = Alignment(horizontal="left", vertical="center")
ws2.row_dimensions[1].height = 26

adv = [x for x in rows if x["tier"] in ("S", "A")]
clusters = {}
for x in adv:
    key = x["release"].split(" / ")[0] if x["release"] and not x["release"].startswith("—") else "无放票时刻"
    clusters.setdefault(key, []).append(x["name"])

ws2.append([])
ws2.append(["时刻", "景点数", "景点"])
for c, w in enumerate([10, 8, 60], 1):
    cell = ws2.cell(3, c)
    cell.fill, cell.font, cell.alignment, cell.border = HEAD_FILL, HEAD_FONT, CENTER, BORDER
    ws2.column_dimensions[get_column_letter(c)].width = w
ws2.row_dimensions[3].height = 22

ordered = sorted([k for k in clusters if k != "无放票时刻"]) + \
          (["无放票时刻"] if "无放票时刻" in clusters else [])
for key in ordered:
    names = clusters[key]
    ws2.append([key, len(names), "、".join(names)])
    i = ws2.max_row
    for c in range(1, 4):
        ws2.cell(i, c).border = BORDER
        ws2.cell(i, c).alignment = LEFT_WRAP if c == 3 else CENTER

foot = [f"仅覆盖需预约项（S / A 层 {len(adv)} 个），B 层免预约不进提醒流程。",
        "军博（中国人民革命军事博物馆）每日三场放票 08:00 / 17:00 / 20:00，此处归入首场 08:00。"]
for t in foot:
    ws2.append([t])
    ws2.merge_cells(start_row=ws2.max_row, start_column=1, end_row=ws2.max_row, end_column=3)
    ws2.cell(ws2.max_row, 1).font = META_FONT
    ws2.cell(ws2.max_row, 1).alignment = Alignment(horizontal="left", vertical="center")

# ================= Sheet 3：口径说明 =================
ws3 = wb.create_sheet("口径说明")
ws3.column_dimensions["A"].width = 100
NOTES = [
    ("口径说明", TITLE_FONT),
    ("", None),
    ("难度标签：由 spots 云函数 computeDifficultyLabel 生成（TAG-RULE-001）——难分 ≥4 极难约；=3 较难约；≤2 容易约。B 层不渲染难度标签。", None),
    (f"分层：S = 需预约且难度 ≥4（{n_s} 个）；A = 需预约且难度 ≤3（{n_a} 个）；B = 免预约（{n_b} 个）。", None),
    ("提醒属性：强提醒 = 需预约且难度 ≥3；弱提醒 = 需预约且难度 ≤2；"
     "不可提醒 = 需预约但无放票时刻（随买随用）；不进提醒 = B 层免预约。", None),
    ("可约日与 App 的 time.isOpenOn 同语义：openDays 非空时为白名单（仅这些星期可约），"
     "否则看 closedDays（这些星期不可约），缺省即全年开放。", None),
    ("　· 仅周末（清华、北大）：平时工作日不可约、周末可约；寒暑假等假期会改为每天开放，以学校公告为准。", None),
    ("　· 周一闭馆（故宫、国博、人大堂等）：法定节假日通常除外。", None),
    ("周一闭馆列：✅ = 周一闭馆；❌ = 周一正常开放；仅园中园 = 公园本体开放、闭馆只针对园中园（天坛祈年殿、北海琼华岛），"
     "不得据此报「周一闭馆」，属假提醒。", None),
    ("B 层括号数据：B 层（免预约）的开票时间 / 提前放票是 rules.json 残留值，因 reservationRequired=false 不参与提醒计算，"
     "UI 也不展示，本表统一置为「—（不进提醒）」。", None),
    ("核验日期：lastCheckedDate，为空表示尚未二次核实，App 内显示「尚未复核，以官方为准」；本表标 ⚠️。", None),
    ("公告自动过期：specialNotice 必须配 specialNoticeUntil，过期后不再下发到 App；详见「临时公告」Sheet。", None),
    ("", None),
    ("## 数据风险", Font(bold=True, size=12)),
    (f"· 未二次核实（lastCheckedDate 为空）：{'、'.join(unverified) if unverified else '无'}。", None),
    (f"· 过期公告（specialNoticeUntil 早于导出日期，App 已不再下发）："
     f"{'；'.join(expired_list) if expired_list else '无'}。", None),
    (f"· 数据副本一致性：{'⚠️ 检测到 data/ 与 cloudfunctions/reminder/data/ 部署副本不一致，本表以 data/ 为准，需同步部署副本。' if any(DEPLOY_DRIFT) else 'data/ 与 cloudfunctions/reminder/data/ 部署副本一致。'}", None),
    ("", None),
    ("放票规则随季节、节假日、临时施工调整，出行前请以各官方渠道当日公示为准。", Font(color="B45309")),
]
for text, font in NOTES:
    ws3.append([text])
    if font:
        ws3.cell(ws3.max_row, 1).font = font
    ws3.cell(ws3.max_row, 1).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

# ================= Sheet 4：临时公告 =================
ws4 = wb.create_sheet("临时公告")
for c, (h, w) in enumerate(zip(["景点", "公告内容", "生效至"], [24, 80, 16]), 1):
    cell = ws4.cell(1, c, h)
    cell.fill, cell.font, cell.alignment, cell.border = HEAD_FILL, HEAD_FONT, CENTER, BORDER
    ws4.column_dimensions[get_column_letter(c)].width = w
ws4.row_dimensions[1].height = 22

notices = [x for x in rows if x["notice"]]
if notices:
    for x in notices:
        ws4.append([x["name"], x["notice"], x["notice_until"] or "（无到期日，长期有效）"])
        i = ws4.max_row
        for c in range(1, 4):
            ws4.cell(i, c).border = BORDER
            ws4.cell(i, c).alignment = LEFT_WRAP if c == 2 else CENTER
else:
    ws4.append(["（当前无生效中的临时公告）", "", ""])

ws4.append([])
ws4.append(["公告由 specialNoticeUntil 控制自动过期，过期的公告不会再下发到 App（time.activeNoticeOf），无需人工清理。"
            "新增公告务必一并填 specialNoticeUntil（YYYY-MM-DD），否则视为长期有效。"])
ws4.merge_cells(start_row=ws4.max_row, start_column=1, end_row=ws4.max_row, end_column=3)
ws4.cell(ws4.max_row, 1).font = META_FONT
ws4.cell(ws4.max_row, 1).alignment = Alignment(horizontal="left", vertical="center")

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT_PATH)

# ---------- 自查 ----------
latest = max([r.get("lastCheckedDate") for r in rules.values() if r.get("lastCheckedDate")] or ["—"])
covered = sorted({n for names in clusters.values() for n in names})
expected = sorted(x["name"] for x in adv)
assert len(rows) == len(spots), f"行数 {len(rows)} != spots.json 条数 {len(spots)}"
assert covered == expected, f"聚类表漏项/重复：{set(expected) ^ set(covered)}"
assert sum(len(v) for v in clusters.values()) == len(adv), "聚类表条目数不符"
assert not any(x["tier"] == "B" for x in adv), "B 层混入聚类表"

print(f"saved: {OUT_PATH}")
print(f"共 {len(rows)} 行（S {n_s} / A {n_a} / B {n_b}）；聚类覆盖 {len(adv)} 个需预约景点；"
      f"最新核验日期 {latest}；公告 {len(notices)} 条")
print("自查通过：行数 / 聚类覆盖 / 层级归属 全部吻合")
