# 参与开发

欢迎报告问题、改进乐评质量、扩充有来源的歌曲资料，以及完善界面和部署流程。

## 开发环境

需要 Node.js 24+。从仓库创建分支后运行：

```sh
npm ci
npm run setup
npm run db:local
npm run build
npm run dev
```

没有 API Key 也可以打开 `http://127.0.0.1:8787/?demo=1` 查看示例。真实 Spotify / Kimi 配置只放在本地 `.dev.vars`；本地连接 Spotify 时先设置至少 16 位 `ADMIN_PASSWORD` 并从页面登录。

前端开发可同时运行 `npm run dev:ui`，Vite 会将 `/api` 请求代理到本地 Worker。提交前运行：

```sh
npm run format
npm run format:check
npm test
npm run build
```

单元测试使用内存 SQLite 和模拟外部接口，不需要真实密钥，也不消耗 Kimi 额度。`check-model`、`generate-local` 和 Telegram 测试脚本会访问真实服务，请按需执行。

## 修改约定

- 指标由程序计算，模型负责音乐解读。不要把模型猜测当作测量数据。
- 不认识的歌曲可以返回未知；没有可核对资料就省略 Fun Fact。
- 所有生成和身份限制必须在 Worker 校验，不能只禁用前端按钮。
- 数据结构变更新增 `migrations/` 文件，不修改已在生产执行的迁移；保证迁移执行后旧代码短时间仍可工作。
- 报告问题时附上预期行为、实际行为和复现步骤。日志要删除令牌、邮箱及听歌历史等私人信息。
- 不提交 `.dev.vars`、`.env.production.local`、`.wrangler`、真实报告或数据库文件。

Pull request 会运行检查，但不会获得生产 Secrets，也不会部署生产环境。合并进 `main` 后由 GitHub Actions 部署。

## 许可证

提交贡献表示你同意贡献以本项目的 MIT License 发布。
