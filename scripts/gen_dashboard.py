#!/usr/bin/env python3
"""生成自包含的 dashboard.html（零依赖，双击即可打开）。

数据来源：
  reports/*.md  候选（认知距离 / 关键词 / 来源链接）、检索窗口与说明行
  seen.md       已收录候选（去重记忆，含认知距离）
  <系统调度器>  「下次自动运行」时间（best-effort；读不到就不显示）

设计原则：所有数量、百分比、日均、分布都在这里算好，不交给模型。
"""
from __future__ import annotations

import json
import plistlib
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
SEEN = ROOT / "seen.md"
TEMPLATE = Path(__file__).resolve().parent / "dashboard_template.html"
DASHBOARD_JS = Path(__file__).resolve().parent / "dashboard.js"
OUT = ROOT / "dashboard.html"

LABEL = "terra-incognita.discovery"          # 与 install-schedule.sh 保持一致
WINDOW_REPORTS = 7                   # 概览页统计用的报告日窗口

DIST_KEYS = ["圈内", "圈边", "圈外"]
DIST_COLORS = {"圈内": "#26C281", "圈边": "#FFB54D", "圈外": "#FFFFFF"}

# 来源归类：一手披露 / 财经网站（其余归「其它」）
SRC_ONE = ("cninfo.com.cn", "sse.com.cn", "szse.cn", "bse.cn", "hkexnews.hk",
           "csrc.gov.cn", "stats.gov.cn", "gov.cn")
SRC_MEDIA = ("eastmoney.com", "sina.com", "10jqka.com.cn", "cls.cn", "yicai.com",
             "stcn.com", "cnstock.com", "21jingji.com", "hexun.com", "jrj.com.cn")

CAND_HEAD = re.compile(
    r"^###\s*(\d+)\.\s*(.+?)（((?:[A-Za-z]{0,2})?[0-9]{4,6}(?:\.[A-Za-z]{2})?)）\s*·\s*认知距离：\s*(圈内|圈边|圈外)")
SEEN_ROW = re.compile(
    r"^\|\s*((?:[A-Za-z]{0,2})?[0-9]{4,6}(?:\.[A-Za-z]{2})?)\s*\|\s*(.+?)\s*\|\s*(\S+)\s*\|\s*(圈内|圈边|圈外)\s*\|")

# 交易所后缀（含 Yahoo 风格别名）
EX_ALIAS = {"SS": "SH", "SHA": "SH", "SHG": "SH", "ZHE": "SZ", "SZA": "SZ", "SHE": "SZ", "SHZ": "SZ"}
EX_NAMES = {"SH": "上交所", "SZ": "深交所", "BJ": "北交所", "HK": "港交所"}


def infer_exchange(code: str) -> str | None:
    """由代码前缀确定性推断交易所（仅在未写后缀 / 后缀不合法时使用）。

    上交所 600/601/603/605（主板）、688（科创板）、900（沪 B）
    深交所 000/001/002/003（主板）、300/301（创业板）、200（深 B）
    北交所 430 / 8xxxxx / 920
    港交所 4–5 位数字
    """
    if len(code) == 6:
        if code.startswith("920"):
            return "BJ"       # 北交所新代码段（先于 9 开头判断）
        if code.startswith("900"):
            return "SH"       # 沪 B
        if code[0] == "6":
            return "SH"
        if code[0] in "023":
            return "SZ"
        if code[0] in "48":
            return "BJ"
        return None
    if len(code) <= 5 and code.isdigit():
        return "HK"
    return None


def normalize_code(raw: str) -> tuple[str, str | None]:
    """把各种写法归一成 (代码, 交易所)。写法宽容，交易所可推断。

    支持：600519 / 600519.SH / 600519.sh / SH600519 / 600519.SS(Yahoo) /
          00700 / 0700.HK / HK00700 / 920019
    """
    s = re.sub(r"\s+", "", raw or "").strip()
    if not s:
        return "", None
    ex = None
    m = re.match(r"^(\d{4,6})(?:\.([A-Za-z]{2,3}))?$", s)          # 600519 / 600519.SH
    if m:
        code, suf = m.group(1), (m.group(2) or "").upper()
    elif (m := re.match(r"^([A-Za-z]{2,3})[.:]?(\d{4,6})$", s)):    # SH600519 / HK.00700
        code, suf = m.group(2), m.group(1).upper()
    else:
        return s, None
    if suf:
        ex = EX_ALIAS.get(suf, suf)
        if ex not in EX_NAMES:
            ex = None
    if ex is None:
        ex = infer_exchange(code)
    if ex == "HK":
        code = code.zfill(5)                                        # 港股按 5 位补零
    return f"{code}.{ex}" if ex else code, ex


def field(body: str, label: str) -> str:
    """取「- 标签：值」单行字段的值。"""
    m = re.search(rf"^-\s*{re.escape(label)}：\s*(.*)$", body, re.M)
    return m.group(1).strip() if m else ""


def source_block(body: str) -> str:
    """取「信息来源」字段的整块（含其下的缩进子项）。"""
    lines, out, on = body.splitlines(), [], False
    for ln in lines:
        if re.match(r"^-\s*信息来源：", ln):
            on = True
            rest = re.sub(r"^-\s*信息来源：\s*", "", ln).strip()
            if rest:
                out.append(rest)
            continue
        if on:
            if re.match(r"^-\s*\S+：", ln):        # 到下一个字段即结束
                break
            out.append(ln)
    return "\n".join(out)


# 链接里不该出现空格与成对括号；显式排除，避免把「（说明）」并进 URL
URL_RE = re.compile(r"https?://[^\s（）()<>「」【】“”]+")


def parse_sources(block: str) -> list[dict]:
    """解析信息来源，兼容两种写法：

    - 规范写法（AGENT.md 要求）：「- 标题： https://…」
    - 退化写法（模型偶尔写成）：「- https://…（说明）」——取括号里的说明当标题
    """
    srcs, seen_urls = [], set()
    for ln in block.splitlines():
        ln = ln.strip().lstrip("-*").strip()
        if not ln:
            continue
        for m in URL_RE.finditer(ln):
            u = m.group(0).rstrip("。，,;；、")
            if u in seen_urls:
                continue
            seen_urls.add(u)
            before = ln[: m.start()].strip().rstrip("：:，, ")
            after = ln[m.end():].strip().strip("（）()［］[]【】").rstrip("：:，, ")
            title = (before or after)[:40]
            srcs.append({"t": title or u, "u": u})
    return srcs


def parse_candidates(md: str) -> list[dict]:
    """解析「## 当日候选」下的每个候选块。"""
    out: list[dict] = []
    for part in re.split(r"^### ", md, flags=re.M)[1:]:
        head, _, body = part.partition("\n")
        m = CAND_HEAD.match("### " + head)
        if not m:
            continue
        code, ex = normalize_code(m.group(3))
        out.append({
            "no": int(m.group(1)),
            "name": m.group(2).strip(),
            "code": code,
            "ex": ex,
            "market": EX_NAMES.get(ex, ""),
            "distance": m.group(4),
            "sector": field(body, "领域/赛道"),
            "logic": field(body, "一句话逻辑"),
            "keyword": field(body, "关键词"),
            "trigger": field(body, "触发事件") or field(body, "触发信号"),
            "sources": parse_sources(source_block(body)),
            "pref": (field(body, "对应你的哪条偏好") or field(body, "对应 profile 的哪条偏好")
                 or field(body, "对应 profile 哪条偏好")),
            "why": (field(body, "为什么算“陌生/发散”") or field(body, "为什么算「陌生/发散」")
                    or field(body, "为什么算陌生 / 发散")),
            "risk": field(body, "风险提示"),
        })
    return out


def parse_meta(md: str) -> dict:
    """解析报告头部的检索窗口与说明行。"""
    meta = {"window": "", "note": "", "stats": {}}
    for line in md.splitlines():
        s = line.strip()
        if not s.startswith(">"):
            continue
        body = s.lstrip("> ").strip()
        if body.startswith("检索窗口"):
            meta["window"] = body
        elif body.startswith("说明"):
            meta["note"] = body
    meta["stats"] = parse_stats(meta["note"])
    return meta


def parse_stats(note: str) -> dict:
    """从说明行里取本次运行的实际计数（模型如实上报）。"""
    s = {"opened": None, "retry": None, "hit": None, "search": None, "breakdown": None}
    if m := re.search(r"打开网页\s*(\d+)\s*次", note):
        s["opened"] = int(m.group(1))
    if m := re.search(r"(?:换入口)?重试\s*(\d+)\s*次", note):
        s["retry"] = int(m.group(1))
    if m := re.search(r"找到候选信息的约\s*(\d+)\s*次", note):
        s["hit"] = int(m.group(1))
    if m := re.search(r"关键词搜索\s*(\d+)\s*次", note):
        s["search"] = int(m.group(1))
    # 可选：模型给出按来源类型的拆分（一手公告 12 次、财经网站 6 次）
    bd = {}
    for key, pat in (("公告", r"一手[^0-9]{0,6}(\d+)\s*次"), ("财经网站", r"财经网站[^0-9]{0,6}(\d+)\s*次")):
        if m := re.search(pat, note):
            bd[key] = int(m.group(1))
    if bd:
        s["breakdown"] = bd
    return s


def classify_source(url: str) -> str:
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    if any(d in host for d in SRC_ONE):
        return "一手披露"
    if any(d in host for d in SRC_MEDIA):
        return "财经网站"
    return "其它"


def parse_seen() -> list[dict]:
    if not SEEN.exists():
        return []
    rows = []
    for line in SEEN.read_text(encoding="utf-8").splitlines():
        m = SEEN_ROW.match(line)
        if m:
            code, ex = normalize_code(m.group(1))
            rows.append({"code": code, "ex": ex, "market": EX_NAMES.get(ex, ""),
                         "name": m.group(2), "first_seen": m.group(3), "distance": m.group(4)})
    return rows


def read_schedule() -> dict | None:
    """best-effort 读回定时任务配置：macOS launchd / Linux crontab。"""
    plist = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    if plist.exists():
        try:
            d = plistlib.loads(plist.read_bytes())
            iv = d.get("StartCalendarInterval") or []
            if isinstance(iv, dict):
                iv = [iv]
            times = sorted({f"{int(i.get('Hour', 0)):02d}:{int(i.get('Minute', 0)):02d}" for i in iv})
            days = sorted({int(i["Weekday"]) for i in iv if "Weekday" in i})
            if not days:
                daydesc = "每天"
            elif days == [1, 2, 3, 4, 5]:
                daydesc = "工作日"
            else:
                name = {1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 0: "周日", 7: "周日"}
                daydesc = "、".join(name.get(x, str(x)) for x in days)
            return {"days": daydesc, "time": " / ".join(times),
                    "text": f"{daydesc} {' / '.join(times)}"}
        except Exception:
            return None
    try:
        out = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            if LABEL in line:
                m = re.match(r"^(\S+)\s+(\S+)\s+\S+\s+\S+\s+(\S+)\s", line)
                if m:
                    minute, hour, dow = m.group(1), int(m.group(2)), m.group(3)
                    daydesc = "每天" if dow == "*" else ("工作日" if dow == "1-5" else dow)
                    return {"days": daydesc, "time": f"{hour:02d}:{int(minute):02d}",
                            "text": f"{daydesc} {hour:02d}:{int(minute):02d}"}
    except Exception:
        pass
    return None


def pct(n: int, total: int) -> int:
    return round(n * 100 / total) if total else 0


def dist_rows(counter: Counter) -> list[dict]:
    total = sum(counter.values())
    return [{"k": k, "n": counter.get(k, 0), "pct": pct(counter.get(k, 0), total), "c": DIST_COLORS[k]}
            for k in DIST_KEYS]


def source_breakdown(cands: list[dict], stats: dict) -> list[dict]:
    """本次运行的来源构成：优先用「说明」行给出的类型拆分；否则按候选引用的链接域名归类。"""
    bd = dict(stats.get("breakdown") or {})
    if not bd:
        c = Counter(classify_source(s["u"]) for k in cands for s in k["sources"])
        bd = {"公告": c.get("一手披露", 0), "财经网站": c.get("财经网站", 0)}
    if stats.get("retry"):
        bd["失败重试"] = stats["retry"]
    bd = {k: v for k, v in bd.items() if v}
    total = sum(bd.values()) or 1
    return [{"k": k, "n": v, "pct": pct(v, total)} for k, v in bd.items()]


def build() -> dict:
    reports = []
    for p in sorted(REPORTS_DIR.glob("*.md"), reverse=True):
        md = p.read_text(encoding="utf-8")
        meta = parse_meta(md)
        cands = parse_candidates(md)
        log = ROOT / "logs" / f"{p.stem}.log"
        run_ok = log.exists() and "run OK" in log.read_text(encoding="utf-8", errors="ignore")
        reports.append({"date": p.stem, "window": meta["window"], "note": meta["note"],
                        "stats": meta["stats"], "cands": cands, "n": len(cands),
                        "dist": dist_rows(Counter(c["distance"] for c in cands)),
                        "sources": source_breakdown(cands, meta["stats"]),
                        "run_ok": run_ok})

    seen = parse_seen()
    # 只看最近 N 个「有产出的报告日」参与概览统计
    win = reports[:WINDOW_REPORTS]

    daily = [{"d": r["date"][5:], "date": r["date"], "n": r["n"]} for r in reversed(win)]
    win_total = sum(r["n"] for r in win)

    dist_cum = dist_rows(Counter(s["distance"] for s in seen))
    dist_win = dist_rows(Counter(c["distance"] for r in win for c in r["cands"]))
    dist_today = dist_rows(Counter(c["distance"] for c in (reports[0]["cands"] if reports else [])))

    # 关注方向：按「领域/赛道」的大行业部分分组（赛道字段已约束为「大行业 / 细分环节」）
    prof_counter: Counter = Counter()
    for r in win:
        for c in r["cands"]:
            head = re.split(r"[／/·—-]", c["sector"])[0].strip() if c["sector"] else "未分类"
            prof_counter[head or "未分类"] += 1
    prof = [{"k": k, "n": n} for k, n in prof_counter.most_common(8)]

    # 来源构成：优先用说明行给的类型拆分；否则按候选引用的链接域名归类（逐份报告计算）
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "today": reports[0]["date"] if reports else None,
        "reports": reports,
        "daily": daily,
        "window_days": len(win),
        "window_total": win_total,
        "window_avg": round(win_total / len(win), 1) if win else 0,
        "seen": seen,
        "dist_cum": dist_cum,
        "dist_win": dist_win,
        "dist_today": dist_today,
        "prof": prof,
        "prof_total": win_total,
        "schedule": read_schedule(),
    }


def main() -> int:
    for p in (TEMPLATE, DASHBOARD_JS):
        if not p.exists():
            print(f"缺少文件：{p}", file=sys.stderr)
            return 1
    data = build()
    html = (TEMPLATE.read_text(encoding="utf-8")
            .replace("__DATA__", json.dumps(data, ensure_ascii=False))
            .replace("__JS__", DASHBOARD_JS.read_text(encoding="utf-8")))
    OUT.write_text(html, encoding="utf-8")
    print(f"generated {OUT.name}（{len(data['reports'])} 份报告 / {len(data['seen'])} 条已收录）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
