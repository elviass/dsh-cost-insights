# DSH Usage Insights / 用量统计

[![CI](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/ci.yml)
[![CodeQL](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml/badge.svg)](https://github.com/elviass/dsh-usage-insights/actions/workflows/codeql.yml)

为 DeepSeek Harness 提供可审计的本地用量、Token、缓存、余额和价格统计。

![中文用量统计界面](docs/images/usage-cost.png)

> 本项目只通过 GitHub Releases 分发。npm 上未加 scope 的
> `dsh-usage-insights` 属于另一位发布者，请勿从 npm 安装，也不要把本仓库发布到 npm。

## 安装

1. 从 [v1.0.0 Release](https://github.com/elviass/dsh-usage-insights/releases/tag/v1.0.0)
   下载 `dsh-usage-insights-1.0.0.tgz` 和 `SHA256SUMS.txt`。
2. 核对压缩包 SHA-256。
3. 使用对应 DSH profile 安装本地压缩包：

   ```console
   dsh plugin --profile web add ./dsh-usage-insights-1.0.0.tgz
   ```

在 GitHub specifier 通过同样的 DSH 双版本安装验证前，文档不会把它列为快捷安装方式。

## 兼容范围

- DeepSeek Harness `>=0.1.0-rc.7 <0.2.0`
- Node.js `^22.19.0 || >=24.0.0`
- Web 客户端

发布候选包需在独立临时 `DSH_HOME` 中分别验证 DSH `0.1.0-rc.7` 和
`0.1.1-rc.2`，不会读取或修改正常的 `%USERPROFILE%\.dsh`。

## 数据与隐私

插件保存数值用量、Provider/模型标识、时间、会话/工作区分组、价格来源元数据，
以及可选的余额快照；不保存提示词、回复正文或原始 API Key。凭据统计只接受明确的
引用字段：`credentialRef`、`apiKeyRef`、`apiKeyEnv`。

联网价格同步只访问 `package.json` 中声明的官方文档主机。OpenRouter 目录地址固定为
官方 HTTPS API，配置字段不能把它改成任意 URL 请求入口。

## 开发与检查

```console
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:coverage
pnpm test:live
pnpm audit
pnpm run release:build
pnpm run release:verify
```

`test:live` 会访问公开价格/文档端点，并逐个报告来源状态。自动化余额测试只使用
fixture/mock，不读取个人账号。

相邻的 `dsh-sandbox`、旧 tgz、数据库、凭据文件和本机原始截图属于维护者本地数据，
不会进入本仓库或发布包。

## 发布策略

`v*` 标签工作流只生成 GitHub Release 资产：`.tgz`、`SHA256SUMS.txt`、SPDX SBOM
和 release notes；没有 npm 发布任务。发布前请执行
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)，贡献规范见
[CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全问题

请使用 GitHub 私密漏洞报告，不要公开提交安全 Issue。详见 [SECURITY.md](SECURITY.md)。

## 许可证

MIT © 2026 elviass
