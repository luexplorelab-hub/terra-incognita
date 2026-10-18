#!/usr/bin/env bash
# 产物断言：确认当日报告真的落盘且格式正确。任一硬校验失败即 exit 1，由 run.sh 触发重试。
#
# 用法：
#   scripts/verify_report.sh <YYYY-MM-DD> [start-marker]
#     <date>         要校验的报告日期
#     [start-marker] 可选：本次运行起点的临时文件（mktemp 生成）。
#                    给定时要求报告 mtime 不早于它（秒级比较），防止上一次残留文件骗过校验。
#
# 退出码：0 = 通过；1 = 任一硬校验失败。
# seen.md 未更新只告警、不失败（同日重跑同一批候选属正常）。
set -euo pipefail
cd "$(dirname "$0")/.."

DATE="${1:?usage: verify_report.sh <YYYY-MM-DD> [start-marker]}"
MARKER="${2:-}"
REPORT="reports/$DATE.md"
SEEN="seen.md"

fail() { echo "verify FAIL: $*" >&2; exit 1; }

[[ -s "$REPORT" ]] || fail "$REPORT 不存在或为空"

if [[ -n "$MARKER" ]]; then
  [[ -f "$MARKER" ]] || fail "marker 文件不存在：$MARKER"
  # 仅当 marker 严格晚于报告才判失败（mtime 比较为秒级，同秒视为通过）
  if [[ "$MARKER" -nt "$REPORT" ]]; then
    fail "$REPORT 未在本次运行中更新（mtime 早于运行起点），疑似旧文件"
  fi
fi

FIRST_LINE="$(grep -m1 -v '^[[:space:]]*$' "$REPORT")"
[[ "$FIRST_LINE" == "# 候选发现 ${DATE}"* ]] || fail "报告首个标题应为「# 候选发现 ${DATE}」，实际：$FIRST_LINE"

if ! grep -qE '^### ' "$REPORT" && ! grep -q '本日无合适候选' "$REPORT"; then
  fail "报告既无候选段（###）也无「本日无合适候选」声明"
fi

grep -qE 'https?://' "$REPORT" || fail "报告中没有任何来源链接（http/https）"

# 代码写法（软校验，只告警）：建议形如 600519.SH / 000001.SZ / 430047.BJ / 00700.HK。
# 看板侧会按代码前缀容错推断市场，所以这里不失败——避免为格式问题白跑 2 次重试。
BAD=""
while IFS= read -r line; do
  [[ "$line" == "### "* ]] || continue
  code="$(printf '%s' "$line" | sed -nE 's/^###[[:space:]]*[0-9]+\.[[:space:]]*[^（]*（([^）]+)）.*/\1/p')"
  if [[ -z "$code" ]]; then
    BAD+="  · 未找到代码：${line}"$'\n'
  elif ! printf '%s' "$code" | grep -qE '^[0-9]{4,6}\.(SH|SZ|BJ|HK)$'; then
    BAD+="  · 代码缺少规范后缀：${code}（应为 600519.SH / 000001.SZ / 430047.BJ / 00700.HK）"$'\n'
  fi
done < "$REPORT"
if [[ -n "$BAD" ]]; then
  echo "verify WARN: 候选代码写法不规范（看板会按前缀容错推断；建议写成 600519.SH / 00700.HK 形式）：" >&2
  printf '%s' "$BAD" >&2
fi

# 来源行格式（软校验，只告警）：应为「- 标题： 链接」，链接写在行尾
BADSRC=""
while IFS= read -r line; do
  [[ "$line" == *"http"* ]] || continue
  [[ "$line" =~ ^[[:space:]]*- ]] || continue
  if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*https?:// ]]; then
    BADSRC+="  · 链接写在了标题前面：$(printf '%s' "$line" | cut -c1-70)"$'\n'
    continue
  fi
  rest="$(printf '%s' "$line" | sed -nE 's/.*https?:\/\/[^[:space:]]+//p')"
  rest="${rest//[[:space:]]/}"
  if [[ -n "$rest" ]]; then
    BADSRC+="  · 链接后面还有文字：$(printf '%s' "$line" | cut -c1-70)"$'\n'
  fi
done < "$REPORT"
if [[ -n "$BADSRC" ]]; then
  echo "verify WARN: 来源行格式不规范（应为「- 标题： 链接」，链接在行尾）：" >&2
  printf '%s' "$BADSRC" >&2
fi

if [[ -n "$MARKER" ]] && [[ ! "$SEEN" -nt "$MARKER" ]]; then
  echo "verify WARN: $SEEN 未在本次运行中更新（若同日重跑同一批候选属正常）"
fi

echo "verify OK: ${REPORT}（标题/候选段/来源链接齐全$([[ -n "$MARKER" ]] && echo "，且晚于运行起点")）"
