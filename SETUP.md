# 首次使用（SETUP）

未知之地每天自动帮你找出 **3–5 只“圈外”的 A 股 / 港股候选**，并生成一份带出处的报告和一个看板。
配置只需要做一次，大约 5 分钟。

## 前置条件

1. 已安装 [opencode](https://opencode.ai) **v2 或更高**（本项目使用 v2 的配置格式）。
   查看版本：`opencode --version`。
2. **登录过一个模型服务商**（二选一，任选其一即可）：
   - 启动后登录（推荐）：`opencode` 起来后，在界面里输入 `/connect`，选一个服务商完成登录；
   - 启动前登录：在终端跑 `opencode auth login`，按提示选服务商。
   opencode **不登录也能启动**。登录是为了能用模型：没登录时 `/setup` 里的模型列表会是空的。
3. Windows 用户还需要 Git Bash，并把它的路径写进环境变量 `OPENCODE_GIT_BASH_PATH`。
4. 本项目已下载到本地（就是当前目录）。

## 用哪家的模型都行

未知之地不绑定 opencode 自家的模型服务，它只记 `provider/model`，用**你已登录的任何服务商**都可以：

| 类型 | 例子 | 登录方式 |
| --- | --- | --- |
| 订阅型 | **GitHub Copilot**、OpenCode Go | `/connect`（Copilot 走设备码 OAuth，用你的订阅额度） |
| API key | Anthropic（Claude）、OpenAI、Google Gemini、xAI、OpenRouter | `/connect` 或 `opencode auth login <provider>` |
| 云平台 | Azure OpenAI、Amazon Bedrock、Google Vertex | API key / Azure CLI / AWS 配置 / ADC |
| 本地模型 | Ollama、LM Studio、vLLM | 起服务后自动发现，无需登录 |
| 自建网关 | 任何 OpenAI 兼容端点 | 在配置里加自定义 provider |

`/setup` 里的模型列表来自 `opencode models`，**只会列出你已登录服务商的模型**。所以先登录，再选模型。

## 三步配置

```bash
# 1. 进入项目目录
cd /path/to/terra-incognita

# 2. 打开 opencode（交互界面，不是 opencode run）
opencode

# 3. 在界面里输入斜杠命令，回车
/setup
```

接下来它会**一个问题一个问题**地问你（投资风格、你熟悉哪些行业、想被带到哪些方向、要不要排除什么、
用哪个模型、每天几点跑）。答完它会自动：

- 写好 `profile.md`（你的偏好，之后随时可以手改）
- 把选的模型写进 `.opencode/opencode.json`（本地文件，不入库）
- 装好定时任务（工作日 09:40 或你选的时间）

## 配好之后怎么用

- **立刻跑一次看看**：`./run.sh`（跑完会生成 `reports/今天日期.md` 和 `dashboard.html`）
- **看结果**：用浏览器打开 `dashboard.html`（单文件，双击即可，不需要服务器）
- **之后就不用管了**：到点自动跑，报告和看板会自己更新

## 改运行时间 / 频率

```bash
scripts/install-schedule.sh status                      # 看当前设置
scripts/install-schedule.sh install --time 20:30        # 改成工作日 20:30
scripts/install-schedule.sh install --time 09:40 --days daily   # 改成每天
```

时间写成本机时区。改完用 `status` 确认一下。

## 几个必须知道的点

| 事项 | 说明 |
| --- | --- |
| 需要保持登录状态 | 定时任务是“用户级”任务，macOS 上要求你已登录（合盖睡眠不影响：唤醒后会补跑一次） |
| 机器关着会怎样 | macOS 唤醒后补跑一次；Linux 的 cron 会直接跳过；Windows 默认行为取决于任务设置（见 `docs/schedule.md`） |
| 同一天不会重复产出 | 若当天报告已存在且校验通过，`./run.sh` 会跳过；要强制重跑用 `./run.sh --force` |
| 非交易日 | 休市日照常运行，可能产出“本日无合适候选”的空报告 |
| 报告存在哪 | `reports/YYYY-MM-DD.md`；去重记忆在 `seen.md`（记录已出现过的代码，避免重复推荐） |

## 运行出问题时

```bash
tail -50 logs/$(date +%F).log        # 今天的运行日志
scripts/verify_report.sh $(date +%F) # 检查今天的报告是否完好
```

运行失败会自动重试 3 次（间隔 60 秒）；仍然失败就以非零状态退出，日志里能看到原因。
