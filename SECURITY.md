# 安全政策

## 报告漏洞

请用 GitHub 的**私密漏洞报告**提交：仓库的 **Security** 标签页，点 **Report a vulnerability**。
不要在公开 issue 里写漏洞细节。

## 本项目涉及的敏感信息

- opencode 的登录凭证存在**本机全局**（`opencode debug paths db` 可查路径），不在仓库里。
- `profile.md` 与 `.opencode/opencode.json` 已加入 `.gitignore`，不会进版本库。
- 任何时候都不要把 API key、token 写进仓库或 issue。

## 使用时的注意

- `reports/` 与 `seen.md` 记录你的候选与去重历史。**打算把仓库推到公开远端之前，先确认这两项里没有你不想公开的内容**。
- 定时任务以你的用户身份运行，`run.sh` 在产出报告后会自动 `git commit`。公开仓库建议先处理上面两项，或停用自动提交。
