# GitHub 自动部署

目标仓库：`MuelNova/noTaste`。正式地址：`https://taste.nova.gal`。

## 一次性账号配置

1. 本机终端运行 `gh auth login --hostname github.com --git-protocol https --web`，用 MuelNova 登录。授权应包含推送工作流所需的 workflow scope；若推送时提示缺少权限，可运行 `gh auth refresh -h github.com -s workflow`。
2. Cloudflare 个人资料 → API Tokens → Create Token：使用 Edit Cloudflare Workers 模板，补充 Account → D1 → Edit。仅选部署所在账号和 `nova.gal`。发布新 Worker、静态资源与自定义域名需要 Workers Scripts 编辑、Workers Routes 编辑和 Zone 读取权限；模板如显示账号读取，也保留。无需授予 Access 策略编辑权限。
3. 把令牌填入被 Git 忽略的 `.dev.vars`：`CLOUDFLARE_API_TOKEN="..."`。不要提交文件或粘贴到聊天。
4. 设置 `CLOUDFLARE_ACCOUNT_ID` 和 `APP_URL` 环境变量后运行 `node scripts/prepare-cloudflare.mjs`，创建或复用 D1 数据库 `taste-db` 和队列 `no-taste-reports`，并生成本地 `.env.production.local`（含独立生产密钥）。已有生产配置不会自动更换密钥。也可以手动准备文件，格式见下方。
5. 运行 `node scripts/configure-github.mjs MuelNova/noTaste`，把配置上传为 GitHub Repository Variables / 加密 Secrets。命令只输出字段名，不输出值。可以加 `--dry-run` 检查待上传的字段名。
6. 推送 `main`，在 GitHub → Actions 查看 `Check and deploy`。也可以在 Actions 中手动 Run workflow。
7. 在 Spotify 应用设置里添加 `https://taste.nova.gal/api/auth/spotify/callback`。网站首次上线后，先通过 Cloudflare Access 主人登录，再连接一次 Spotify。不会自动迁移本地授权或听歌记录。

生产配置本地文件 `.env.production.local` 至少包含：

```dotenv
CLOUDFLARE_ACCOUNT_ID="你的账号 ID"
D1_DATABASE_ID="远程 D1 数据库 UUID"
D1_DATABASE_NAME="taste-db"
APP_URL="https://taste.nova.gal"
PUBLIC_REPORTS="true"
TOKEN_ENCRYPTION_KEY="独立生成并长期保存的 32 字节 Base64 密钥"
```

其他配置从 `.dev.vars` 读取：Spotify、Kimi、Access 团队域名/AUD/主人邮箱、Telegram。生产加密密钥只在首次配置时生成，重新运行配置脚本不会自动创建或更换密钥。不要丢失这个文件；改密钥会使 D1 里的旧授权不可读。

## 自动化行为

- Pull request：安装锁定依赖、运行测试、构建前端、编译检查 Worker；不读取生产密钥、不操作远程 D1。
- 没有设置 `D1_DATABASE_ID` 时跳过发布，便于 Fork 后先运行检查。配置完成后手动 Run workflow 或推送新提交即可。
- Push main / 手动运行 main：检查通过后，生成生产配置、应用待执行 D1 迁移、同时发布 Worker/静态资源/Secrets，最后检测 `/api/status` 和生产禁用示例。
- 正式部署串行执行，部署中不被新提交取消，避免数据库迁移中断。
- 应用密钥只进入 GitHub 加密 Secrets、临时部署密钥文件和 Cloudflare Secret binding；不进入浏览器构建、代码库或构建产物。临时文件在任务结束时清理。
- 禁用 `workers.dev` 和预览域名，使用正式域名；不修改现有 Cloudflare Access 应用或策略。
- 切换到生产后仍保留每日一次 Cron（UTC 17:30，UTC+8 次日 01:30），生成前一天日报。
- 手动生成通过 Queues 主动唤醒 Worker，无任务时不轮询。首次部署前创建 `no-taste-reports`；已有项目升级可运行 `npx wrangler queues create no-taste-reports`，后续部署自动绑定生产者和消费者。
- 队列每批一条、并发一，失败不自动重试；页面提交成功后可关闭。
- 数据库迁移先于代码发布。迁移应向后兼容；失败时流程停止，不自动回滚数据库。

## GitHub 配置位置

仓库 → Settings → Secrets and variables → Actions。

| 类型      | 字段                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets   | CLOUDFLARE_API_TOKEN、SPOTIFY_CLIENT_ID、SPOTIFY_CLIENT_SECRET、KIMI_API_KEY、TOKEN_ENCRYPTION_KEY、TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID                                 |
| Variables | CLOUDFLARE_ACCOUNT_ID、D1_DATABASE_ID、D1_DATABASE_NAME、APP_URL、PUBLIC_REPORTS、TIMEZONE、KIMI_BASE_URL、KIMI_MODEL、CF_ACCESS_TEAM_DOMAIN、CF_ACCESS_AUD、OWNER_EMAIL |

工作流使用 `production` environment；没有额外限制时会自动部署。若给该环境设置人工审核，则需要在 Actions 页面批准后才发布。

CI 不调用 Kimi，也不触发真实报告生成。首次部署后无 Spotify 授权时，网站显示尚未连接；这不算部署失败。

参考：[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。
