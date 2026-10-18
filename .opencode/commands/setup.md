---
description: 首次使用配置（访谈生成 profile.md、选模型、设定时任务）
agent: setup
subagent: false
---

开始首次配置访谈。

先读 `SETUP_AGENT.md` 的流程，然后按它一步步问我（一次一个问题）。
本机的登录状态与可用模型列表：

!`opencode auth list`

!`opencode models`

如果 `profile.md` 已存在且不是占位符（没有 `SETUP_REQUIRED` 标记），先告诉我"检测到已有配置，是否覆盖"，等我确认再继续。
