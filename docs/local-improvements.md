# 本地修改与维护

此分支在 `1.0.1` 的基础上整理本地修补，当前版本为 `1.0.1-dsh02.4`。运行中的
DSH profile 需要重新安装本版本后才会生效；clone、提交或修改源码不会变更启动程序、
profile 配置或账本。

从本仓库构建或取得 `dsh-cost-insights-1.0.1-dsh02.4.tgz` 后，安装到对应 profile：

```console
dsh plugin --profile web add ./dsh-cost-insights-1.0.1-dsh02.4.tgz
```

安装后重启 DSH。已有账本仍保存在 `storages/usage-insights/ledger.sqlite`，升级不会
迁移或删除历史数据。

## 1.0.1-dsh02.4 兼容性修正

- DSH 兼容范围由 `>=0.1.0-rc.7 <0.2.0 || 0.2.0-rc.2` 放宽为
  `>=0.1.0-rc.7 <0.3.0-0`，覆盖 `0.2.1-rc.2` 及后续 0.2.x 版本，同时排除
  0.3 预览版。`engines.dsh` 是 DSH 启动时的唯一判定来源，
  `dshhub.compatibility.dsh` 与 peer 依赖保持同一范围。
- DSH 0.2.1 将设置入口从 `aria-haspopup="dialog"` 改为账号菜单。侧栏“今日费用”
  现在先尝试旧版对话框入口，再回退到账号菜单，继续打开“设置 → 用量与费用”。
- 移除 0.2.x 已不再提供的 `@deepseek-ai/dsh-client-runtime` 客户端注入项。
- 版本与兼容范围检查改为跟随 `package.json`，并校验 `engines.dsh`、dshhub 元数据、
  peer 依赖与 Node engine 是否一致，避免下次更新时因硬编码再次失配。

## 保留的功能修补

- Host 与 browser 的 Typert strict codec 改用 `create()`，保留原本的参数与结果 schema。
- 缓存命中单独显示 Token 与费用；既有 `inputCost*` 仍包含缓存读取费，未命中输入费由界面相减取得。总费用与原始调用不改写。
- Token 总计包含输入、缓存读取、缓存写入及输出；推理已包含在输出，不重复累加。
- 今日／本月／全部卡片可点击；本日／近 7 天／近 30 天与日期下拉菜单共用状态。近 7／30 天包含本日，从当地午夜起算；快速切换只采用最后一次请求的响应。

## 验证范围

- 发布元数据、版本一致性、可移植性与敏感信息检查。
- Node.js 语法检查与现有单元测试。
- 在独立临时 `DSH_HOME` 中安装本版本，使用 DSH `0.2.1-rc.2` 启动 Web 界面，
  验证 host 无兼容跳过警告、设置页可打开、侧栏“今日费用”可直接进入
  “设置 → 用量与费用”，且浏览器控制台无错误。
