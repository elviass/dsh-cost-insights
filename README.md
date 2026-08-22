# DSH Usage Insights / 用量统计

[English](README.en.md)

[![CI](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml)
[![CodeQL](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml)

面向 DeepSeek Harness 的本地用量与费用分析插件，提供 Token、缓存、API 余额和模型价格统计。

![中文用量统计界面](docs/images/usage-cost.png)

## 主要功能

- 按对话、工作区、模型、API 提供商、用途和日期范围查看用量与费用。
- 通过折线图、分布图和 365 天热力图分析 Token、费用及模型使用情况。
- 统计输入、缓存写入、输出、缓存命中率和调用次数。
- 同步支持来源的模型价格与汇率，美元价格同时换算显示人民币。
- 显示支持接口的 API 余额；DeepSeek 官方调用可区分高峰价与低谷价。
- 扩展 DSH 原有的对话统计栏和侧边栏，不替换原界面。
- 自动跟随 DSH 的中文/英文语言以及浅色/深色主题。

## 安装

1. 从 [v1.0.0](https://github.com/elviass/dsh-usage-insights/releases/tag/v1.0.0) 下载 `dsh-usage-insights-1.0.0.tgz`。
2. 如需校验文件，同时下载 `SHA256SUMS.txt` 并核对 SHA-256。
3. 使用对应 DSH profile 安装下载的压缩包：

   ```console
   dsh plugin --profile web add ./dsh-usage-insights-1.0.0.tgz
   ```

> 本项目只通过 GitHub Releases 分发。npm 上未加 scope 的 `dsh-usage-insights`
> 属于另一位发布者，与本项目无关，请勿从 npm 安装。

## 使用方法

安装并启动 DSH 后，在“设置 → 用量统计”中查看完整页面。对话输入区下方会显示当前
模型价格、当前对话费用和支持接口的余额；侧边栏会显示今日总花费。

“更多 → 关于”中连续点击版本号 7 次，可以导出经过脱敏处理的诊断日志。

## 兼容范围

- DeepSeek Harness `>=0.1.0-rc.7 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`
- DSH Web 客户端

v1.0.0 已在独立临时 `DSH_HOME` 中通过 DSH `0.1.0-rc.7` 和 `0.1.1-rc.2`
安装验证，不会读取或修改正常的 `%USERPROFILE%\.dsh`。

## 数据与隐私

插件在本地保存数值用量、API 提供商与模型标识、时间、对话/工作区分组、价格来源
元数据和可选余额快照；不保存提示词、回复正文或原始 API Key。

联网同步仅访问 `package.json` 中声明的价格、汇率和余额接口。诊断日志会移除凭据、
提示词、回复正文及本地数据库内容。如发现安全问题，可使用 GitHub 的私密漏洞报告。

## 许可证

MIT © 2026 elviass
