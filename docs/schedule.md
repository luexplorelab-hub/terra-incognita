# 定时任务：各平台差异与注意事项

未知之地靠系统自带的定时任务每天自动运行，不依赖任何外部服务。安装与修改都用同一个脚本：

```bash
scripts/install-schedule.sh status                                   # 查看当前设置
scripts/install-schedule.sh install --time 09:40                     # 工作日（默认）
scripts/install-schedule.sh install --time 20:30 --days daily        # 每天
scripts/install-schedule.sh uninstall                                # 卸载
```

时间一律是**本机时区**。改完建议用 `status` 确认一次（会显示计划时间与下次运行状态）。

## 三平台对照

| | macOS（launchd） | Linux（cron） | Windows（计划任务） |
| --- | --- | --- | --- |
| 安装方式 | 脚本生成 plist 文件到 `~/Library/LaunchAgents/`，再 `launchctl bootstrap` | 脚本把一行带标记注释的 crontab 写进去 | 脚本**只打印命令**，需你在 PowerShell / cmd 里手动执行 |
| 机器睡眠错过时 | **唤醒后自动补跑一次**（多次错过合并成一次） | **直接跳过，不补** | 取决于任务的“错过补跑”设置（见下） |
| 需要登录吗 | 需要（用户级 agent，登录后才会加载） | 不需要 | 取决于 `/RU` 参数；默认当前用户 |
| 关机期间 | 不补跑（只在唤醒时补） | 不补跑 | 取决于“错过补跑”设置 |
| 固定北京时间 | 不支持（launchd 没有 per-job 时区） | 支持：crontab 顶部加 `CRON_TZ=Asia/Shanghai` | 用系统时区 |

## 为什么 macOS 会“补跑”

launchd 的日历型任务在机器睡眠期间错过触发点后，会在**唤醒时补跑一次**（官方文档明确：多次错过会合并为一次）。
这通常是好事：你开盖就能看到当天的报告，而不是静默漏掉一天。

副作用是：如果你**合盖过夜**，第二天早上唤醒时补跑会以“当前日期”落盘，随后当天的正常触发会再跑一次。
未知之地对此已有防护：`run.sh` 在“当天报告已存在**且**校验通过”时会自动跳过，所以不会覆盖掉早上那份好报告。

## Windows 的“错过补跑”

`schtasks` 命令行参数里**没有**“错过补跑”开关。默认行为取决于系统；要显式打开，需要改用 XML 建任务：

```powershell
schtasks /Create /TN terra-incognita-daily /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 09:40 `
  /TR "'C:\Program Files\Git\bin\bash.exe' -lc 'cd /c/path/to/terra-incognita && ./run.sh'" /F
```

（`/F` ＝ 已存在同名任务时直接覆盖，改时间用同一条命令即可。）

想让它像 macOS 那样“错过就补跑”，把 `/Create` 换成 `/Create /XML task.xml`，
并在 XML 的 `<Settings>` 里写入 `<StartWhenAvailable>true</StartWhenAvailable>`。

Windows 还需要 Git Bash，并把它的路径写进环境变量 `OPENCODE_GIT_BASH_PATH`。

## 通用注意事项

- **非交易日**：A 股休市日照样会运行，可能产出“本日无合适候选”的空报告（不做交易日历）。
- **同一天不会重复产出**：当天报告已存在且校验通过时，`run.sh` 跳过；要强制重跑用 `./run.sh --force`。
- **并发安全**：`run.sh` 用文件锁（`logs/.run.lock`）保证同一时间只有一个运行；
  补跑与正常触发撞车时，后到的会跳过而不是并行写同一份报告。
- **失败会重试**：模型或网络瞬时故障会自动重试最多 3 次（间隔 60 秒），仍然失败则以非零状态退出，
  原因写在 `logs/YYYY-MM-DD.log`。
- **改动定时任务不会立刻触发运行**：重装时保持 `RunAtLoad=false`，只有到点才跑。
