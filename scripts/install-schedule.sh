#!/usr/bin/env bash
# 定时任务安装 / 修改 / 查看
#   macOS  → launchd（~/Library/LaunchAgents，渲染生成，不提交机器特定文件）
#   Linux  → crontab（带标记注释，可重复执行）
#   Windows→ 打印 schtasks 命令（Git Bash 下不自动执行，见输出提示）
#
# 用法：
#   scripts/install-schedule.sh {install|uninstall|status} [--time HH:MM] [--days weekdays|daily]
#
#   install    安装；已存在则按新参数重装（幂等）
#   uninstall  卸载
#   status     查看当前配置（含下次运行时间，若可读到）
#   --time     每天运行时间，24 小时制，默认 09:40
#   --days     运行日：weekdays＝周一至周五（默认）；daily＝每天
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="terra-incognita.discovery"
TASKNAME="terra-incognita-daily"
MARKER="# ${LABEL}"

TIME="09:40"
DAYS="weekdays"
ACTION="${1:-}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --time) TIME="${2:-}"; shift 2 ;;
    --days) DAYS="${2:-}"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[[ "$ACTION" =~ ^(install|uninstall|status)$ ]] || usage
[[ "$TIME" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || { echo "时间格式应为 HH:MM（24 小时制），实际：$TIME" >&2; exit 1; }
[[ "$DAYS" =~ ^(weekdays|daily)$ ]] || { echo "--days 只能是 weekdays 或 daily，实际：$DAYS" >&2; exit 1; }

HOUR=$((10#${TIME%%:*}))
MINUTE=$((10#${TIME##*:}))
if [[ "$DAYS" == "daily" ]]; then DAYS_CN="每天"; else DAYS_CN="周一至周五"; fi

OS="$(uname -s)"

# ============================ macOS ============================
PLIST_DST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"

render_plist() {
  local intervals=""
  if [[ "$DAYS" == "daily" ]]; then
    # 不写 Weekday 即为「每天」（launchd 缺省参数视为通配）
    intervals="    <dict><key>Hour</key><integer>${HOUR}</integer><key>Minute</key><integer>${MINUTE}</integer></dict>
"
  else
    local w
    for w in 1 2 3 4 5; do
      intervals+="    <dict><key>Weekday</key><integer>${w}</integer><key>Hour</key><integer>${HOUR}</integer><key>Minute</key><integer>${MINUTE}</integer></dict>
"
    done
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$REPO/logs"
  cat > "$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO}/run.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${REPO}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>StartCalendarInterval</key>
  <array>
${intervals}  </array>

  <key>StandardOutPath</key>
  <string>${REPO}/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${REPO}/logs/launchd.err.log</string>

  <!-- 保持 false：重装/改时间时不会立刻触发一次运行 -->
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
EOF
}

macos_install() {
  render_plist
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST_DST"
  echo "已安装：${PLIST_DST}"
  echo "计划：${DAYS_CN} ${TIME}（本机时区）"
  echo "提示：改时间只需再跑一次「install --time HH:MM」；不要手改 plist（时间写在工作日 5 条记录里，容易漏改）"
}

macos_uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "已卸载：${LABEL}"
}

macos_status() {
  if [[ ! -f "$PLIST_DST" ]]; then
    echo "未安装（$PLIST_DST 不存在）"
    return 0
  fi
  echo "plist：${PLIST_DST}"
  # 用 plistlib 解析（grep 取字段容易踩格式坑）
  python3 - "$PLIST_DST" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as f:
    d = plistlib.load(f)
iv = d.get("StartCalendarInterval") or []
if isinstance(iv, dict):
    iv = [iv]
times = sorted({f"{int(i.get('Hour', 0)):02d}:{int(i.get('Minute', 0)):02d}" for i in iv})
days = sorted(int(i["Weekday"]) for i in iv if "Weekday" in i)
name = {1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 0: "周日", 7: "周日"}
if not days:
    daydesc = "每天"
elif days == [1, 2, 3, 4, 5]:
    daydesc = "周一至周五"
else:
    daydesc = "、".join(name.get(x, str(x)) for x in days)
print(f"计划：{daydesc} " + " / ".join(times))
print(f"执行：{d.get('ProgramArguments', [''])[-1]}")
print(f"RunAtLoad：{d.get('RunAtLoad', False)}（应为 False，否则重装会立刻触发一次运行）")
PY
  echo "--- launchctl ---"
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -iE 'state =|last exit code|next' | head -6 || echo "（未加载到 launchd）"
}

# ============================ Linux ============================
linux_install() {
  local dow
  if [[ "$DAYS" == "daily" ]]; then dow="*"; else dow="1-5"; fi
  local line="${MINUTE} ${HOUR} * * ${dow} cd ${REPO} && ./run.sh >> ${REPO}/logs/cron.log 2>&1"
  # 先删旧行（含标记行），再写入新行；注意每条 cron 行必须以换行结尾
  {
    crontab -l 2>/dev/null | grep -vF "$MARKER" || true
    echo "$MARKER"
    echo "$line"
  } | crontab -
  echo "已安装到 crontab："
  echo "  $line"
  echo "计划：${DAYS_CN} ${TIME}（本机时区；如需固定北京时间可在 crontab 顶部加 CRON_TZ=Asia/Shanghai）"
}

linux_uninstall() {
  { crontab -l 2>/dev/null | grep -vF "$MARKER" || true; } | crontab -
  echo "已从 crontab 卸载"
}

linux_status() {
  echo "--- crontab ---"
  crontab -l 2>/dev/null | grep -A1 -F "$MARKER" || echo "未安装"
}

# ============================ Windows ============================
windows_hint() {
  local days_arg="/SC WEEKLY /D MON,TUE,WED,THU,FRI"
  [[ "$DAYS" == "daily" ]] && days_arg="/SC DAILY"
  cat <<EOF
Windows 下请在「PowerShell / cmd」中手动执行（Git Bash 里不自动安装）：

  schtasks /Create /TN ${TASKNAME} /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST ${TIME} /TR "'C:\\Program Files\\Git\\bin\\bash.exe' -lc 'cd \"$(cygpath -w "$REPO" 2>/dev/null || echo "$REPO")\" && ./run.sh'" /F

（--days daily 时把 ${days_arg} 里的 /D 去掉、用 /SC DAILY）

说明：
  - /F 表示已存在同名任务时直接覆盖（改时间用同一条命令即可）
  - 想要「错过补跑」需要改用 /XML 建任务并写入 <StartWhenAvailable>true</StartWhenAvailable>；
    命令行参数没有对应开关（详见 docs/schedule.md）
  - 查询：schtasks /Query /TN ${TASKNAME} /FO LIST /V
EOF
}

# ============================ 分发 ============================
case "$OS" in
  Darwin)
    case "$ACTION" in
      install)   macos_install ;;
      uninstall) macos_uninstall ;;
      status)    macos_status ;;
    esac
    ;;
  Linux)
    case "$ACTION" in
      install)   linux_install ;;
      uninstall) linux_uninstall ;;
      status)    linux_status ;;
    esac
    ;;
  *)
    case "$ACTION" in
      install)   windows_hint ;;
      uninstall) echo "Windows 卸载：schtasks /Delete /TN ${TASKNAME} /F" ;;
      status)    echo "Windows 查询：schtasks /Query /TN ${TASKNAME} /FO LIST /V" ;;
    esac
    ;;
esac
