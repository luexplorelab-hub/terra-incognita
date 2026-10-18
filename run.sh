#!/usr/bin/env bash
# 每日 discovery 运行入口（定时任务与手动运行都走这里）
#
#   ./run.sh            按今天日期跑一次；当日报告已存在且校验通过 → 跳过
#   ./run.sh --force    忽略「当日已产出」检查，强制重跑（调试 / 补跑用）
set -euo pipefail
cd "$(dirname "$0")"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

TODAY="$(date +%F)"
LOG="logs/${TODAY}.log"
REPORT="reports/${TODAY}.md"
LOCKDIR="logs/.run.lock"

mkdir -p logs reports

fail() { echo "run: $*" | tee -a "$LOG" >&2; }

# ---------- 守卫 1：尚未完成 /setup ----------
# profile.md 是本地文件（不进版本库）：不存在、或还是占位符，都视为未配置。
if [[ ! -f profile.md ]]; then
  fail "找不到 profile.md（本地偏好文件）"
  fail "请在本项目目录打开 opencode，执行 /setup 完成首次配置后再运行"
  exit 2
fi
if grep -q "SETUP_REQUIRED" profile.md 2>/dev/null; then
  fail "profile.md 还是占位符（检测到 SETUP_REQUIRED）"
  fail "请在本项目目录打开 opencode，执行 /setup 完成首次配置后再运行"
  exit 2
fi

# ---------- 守卫 2：并发锁（跨平台；macOS 无 flock，用 mkdir 原子锁）----------
# 场景：launchd 睡眠后补跑与当日正常触发撞车、手动重跑与定时任务撞车。
acquire_lock() {
  if mkdir "$LOCKDIR" 2>/dev/null; then
    echo $$ > "$LOCKDIR/pid"
    return 0
  fi
  local holder=""
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
    return 1
  fi
  fail "发现陈旧锁（持有进程 ${holder:-未知} 已不存在），清理后重试"
  rm -rf "$LOCKDIR"
  if mkdir "$LOCKDIR" 2>/dev/null; then
    echo $$ > "$LOCKDIR/pid"
    return 0
  fi
  return 1
}
if ! acquire_lock; then
  fail "另一个运行正在进行中，本次跳过"
  exit 0
fi
trap 'rm -rf "$LOCKDIR"' EXIT

# ---------- 守卫 3：同日幂等（当日报告已存在且通过校验 → 跳过）----------
# 只在报告「完好」时跳过；上一次跑坏留下的残报告仍会重跑。
if (( ! FORCE )) && [[ -f "$REPORT" ]] && scripts/verify_report.sh "$TODAY" >/dev/null 2>&1; then
  fail "$REPORT 已存在且校验通过，跳过本次运行（要强制重跑用 ./run.sh --force）"
  exit 0
fi

PROMPT="读 profile.md 与 seen.md，按 AGENT.md 的流程搜索 A 股与港股候选，产出当日报告到 reports/${TODAY}.md，并把新候选去重后追加到 seen.md。"

# 本次运行起点标记：产物断言要求报告 mtime 不早于它，防止上一次残留文件骗过校验
START_MARKER="$(mktemp)"
trap 'rm -rf "$LOCKDIR"; rm -f "$START_MARKER"' EXIT

# 一次运行算成功 = opencode 退出码 0 **且** 产物断言通过（缺一即视为失败，进入重试）
run_once() {
  local rc=0
  # --standalone：每次运行起私有服务，避免复用「可能缓存了旧配置」的共享后台服务
  # （实测：共享服务会拿旧配置跑，导致 agents/模型设置不生效）
  opencode run --standalone --agent discovery --dangerously-skip-permissions "$PROMPT" 2>&1 | tee -a "$LOG" || rc=$?

  # 判据是「产物」而不是退出码：opencode 常在「报告已经写完」之后才以非零码退出
  # （实测：websearch 被取消等工具错误会让它 exit 1，但报告与 seen.md 都已完整落盘）。
  # 若以退出码判失败去重试，会白跑一整轮检索、并把 seen.md 重复追加一遍。
  if scripts/verify_report.sh "$TODAY" "$START_MARKER" 2>&1 | tee -a "$LOG"; then
    if (( rc != 0 )); then
      fail "warn: opencode 退出码 ${rc}，但产物校验通过 → 视为成功，不重试"
    fi
    return 0
  fi
  if (( rc != 0 )); then
    fail "opencode exited with ${rc}（模型 / 服务端错误），且产物校验未通过"
  else
    fail "opencode 正常退出但产物断言未通过（模型多半只打印未落盘）"
  fi
  return 1
}

# 瞬时错误与产物缺失统一重试（最多 3 次，间隔 60s）
attempt=1
max_attempts=3
while true; do
  if run_once; then
    break
  fi
  if (( attempt >= max_attempts )); then
    fail "discovery failed after ${max_attempts} attempts（原因见上方 run: / verify FAIL 行）"
    exit 1
  fi
  attempt=$((attempt + 1))
  fail "attempt $((attempt - 1)) failed, retrying in 60s (attempt ${attempt}/${max_attempts})..."
  sleep 60
done

echo "run OK: ${REPORT}（候选段 $(grep -cE '^### ' "$REPORT") 个）" | tee -a "$LOG"

# 重新生成静态看板（best-effort：失败只告警，不影响报告产出与提交）
if ! python3 scripts/gen_dashboard.py 2>&1 | tee -a "$LOG"; then
  fail "warn: dashboard.html 生成失败（不影响报告产出）"
fi

# 自动提交当日报告与去重记忆（仅当确有改动；best-effort）
if git rev-parse --git-dir >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain -- reports seen.md)" ]]; then
    if git add reports seen.md && git commit -m "report: ${TODAY} 候选发现" 2>&1 | tee -a "$LOG"; then
      :
    else
      fail "warn: git 提交失败（报告已产出，不影响使用）"
    fi
  fi
fi
