<div align="center">

# 🎧 No Taste Today

**把你的 Spotify 听歌记录，变成一份有观点的 AI 乐评刊物。**

[![CI](https://github.com/MuelNova/noTaste/actions/workflows/deploy.yml/badge.svg)](https://github.com/MuelNova/noTaste/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[功能](#-功能) · [快速开始](#-快速开始) · [部署](#-cloudflare-部署) · [配置](#-配置) · [参与贡献](#-参与开发与许可证)

</div>

---

## 📖 这是什么？

No Taste Today 是一份**面向读者的个人音乐刊物**：它读取你的 Spotify 听歌记录，生成有观点的 AI 乐评、曲风画像、歌曲故事和推荐。

每份报告是一个**结构化对象**，分别驱动乐评、曲风、时段、发现、歌曲故事、推荐和跨期变化——而不是把一篇文章硬拆成栏目。

> **定位说明**：这是供单个站点主人使用的项目，访客阅读同一份手记，不是多用户 Spotify 托管平台。

## ✨ 功能

- 📰 **多周期报告**：日报、周报、月报和历史浏览，支持跨期品味变化对比
- 🧩 **结构化栏目**：Taste Comment、风格画像、时段／年代分布、发现、Fun Fact、歌曲推荐，分别驱动对应栏目；统计由程序计算，编辑内容由模型统一返回
- 🔍 **真实推荐链接**：用 Spotify 搜索核对推荐，核对通过才显示；主人可反馈"喜欢 / 不合口味 / 听过了"
- 📤 **分享手记**：复制本期直达链接、保存 1080 × 1350 封面图片，公开手记附本期二维码；支持时可调用系统分享。图片在浏览器生成，不调用模型；私人手记和本地示例仅分享图片
- 🔐 **安全登录**：Cloudflare Access 邮箱登录、共享三小时生成冷却、刷新令牌 AES-GCM 加密存储
- 🔔 **故障提醒**：Spotify 授权故障通过 Telegram 通知主人
- 🛠️ **友好开发体验**：本地示例模式开箱即用，GitHub Actions 自动检查并部署

## 🚀 快速开始

需要 **Node.js 24+** 和 npm。真实模式还需要 Spotify Developer 应用与可用的 Kimi API。

```sh
git clone https://github.com/MuelNova/noTaste.git
cd noTaste
npm ci
npm run setup
# 填写 .dev.vars 中 Spotify 与 Kimi 配置，并将 ADMIN_PASSWORD 改为自己的长口令
npm run build
npm run db:local
npm run dev
```

打开 <http://127.0.0.1:8787>，先在设置里用管理口令登录，再连接 Spotify、生成报告。

**注意事项**：

- Spotify 应用后台登记的 Redirect URI 必须是 `http://127.0.0.1:8787/api/auth/spotify/callback`，只申请 `user-read-recently-played` 权限
- `npm run setup` 会复制配置模板并生成加密密钥；示例 `ADMIN_PASSWORD` 必须改为自己的至少 16 位口令
- 本地已保存的 Spotify 授权继续有效；未设置 `ADMIN_PASSWORD` 时可查看本地数据，但生成仍受当天／三小时限制，连接 Spotify 仍需验证主人身份
- `TOKEN_ENCRYPTION_KEY` 必须持久保存——替换它会使旧令牌不可读，需要重新授权
- 不要提交 `.dev.vars` 或 `.wrangler`

### 🎭 示例模式

不想配置密钥？本地访问 `/?demo=1` 即可体验完整界面：

- 示例仅本地开发可见；生产环境隐藏入口、忽略 demo 参数并关闭示例接口
- 示例反馈只保存在浏览器，真实反馈写入 D1
- 示例歌曲链接为 Spotify 搜索链接；真实推荐必须匹配到歌曲后才显示

## ⚙️ 配置

| 变量                                            | 说明                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`   | Spotify 应用配置                                                                                                       |
| `KIMI_API_KEY` / `KIMI_BASE_URL` / `KIMI_MODEL` | 可指定自己的兼容接口和模型，默认 Moonshot 接口；密钥永远不进入前端                                                     |
| `APP_URL`                                       | 网页的完整 origin，不带路径                                                                                            |
| `TIMEZONE`                                      | 日期与统计时区，默认 `Australia/Perth`                                                                                 |
| `ADMIN_PASSWORD`                                | 可选备用管理口令，启用时至少 16 位；不使用可留空                                                                       |
| `TOKEN_ENCRYPTION_KEY`                          | 32 字节密钥的 Base64，`npm run setup` 会生成                                                                           |
| `PUBLIC_REPORTS`                                | 默认 `false`。设为 `true` 才开放报告给访客；公开站点访客可在共享冷却限制内生成当天日报，Spotify 授权和反馈仍属于管理端 |

## ☁️ Cloudflare 部署

推荐使用已配置好的 GitHub Actions 流程，一次性配置见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。下面是手动部署说明。

项目默认采用 **Workers Static Assets + Worker + D1 + Queues**：前端与接口同域，减少跨域认证配置。若必须单独用 Pages，静态产物是 `dist/`，需另外配置同域 `/api/*` 路由——不能直接把只有静态页面的 Pages 部署当作完整后台。

1. `npx wrangler login`，登录自己的 Cloudflare 账号
2. `npx wrangler d1 create taste-db`，将返回的 `database_id` 填入 `wrangler.jsonc`
3. `npm run db:remote`，创建远程数据表；首次部署再运行 `npx wrangler queues create no-taste-reports` 创建报告队列
4. 在 `wrangler.jsonc` 的 `vars` 中设置生产环境 `APP_URL`、`TIMEZONE`、`PUBLIC_REPORTS`、`KIMI_BASE_URL`、`KIMI_MODEL`；`.dev.vars` 中的本地配置不会自动成为生产配置
5. 用 `npx wrangler secret put NAME` 配置上述 Spotify / Kimi 密钥、`TOKEN_ENCRYPTION_KEY`，以及需要的 Telegram 配置（`ADMIN_PASSWORD` 可选）。使用与本地隔离的生产加密密钥
6. 按下方步骤配置 Cloudflare Access 邮箱登录，并将 `CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`、`OWNER_EMAIL` 写入 `wrangler.jsonc` 的 `vars`
7. 在 `wrangler.jsonc` 中配置正式域名：`"routes": [{ "pattern": "你的域名", "custom_domain": true }]`，并设置 `"workers_dev": false`、`"preview_urls": false`；`APP_URL` 应为同一域名的 HTTPS origin。然后运行 `npm run deploy`
8. Spotify 后台添加生产 HTTPS 回调地址 `https://你的域名/api/auth/spotify/callback`，生产管理端登录后授权一次

> ⏰ **Cron 说明**：默认 `30 17 * * *`（UTC），对应珀斯次日 01:30。每日生成昨天的报告；当地周一生成上周，每月 1 日生成上月。改时区时须同步检查 Cron 时间。`wrangler dev` 不会自动触发 Cron。实际调用量小，但免费版 CPU/数据库操作限制仍需部署后观察。

远程 D1 和本地 D1 独立，不会自动上传本地令牌。

手动任务通过队列主动触发，没有每分钟检查任务的定时器。小于 64 KB 的任务消息正常处理约消耗 3 次队列操作（写入、读取、删除）；[Queues 免费额度](https://developers.cloudflare.com/queues/platform/pricing/)为每天 10,000 次操作。队列只传任务 ID，报告保存在 D1。

## 🔐 主人身份与生成额度

- 普通模式只能手动生成当地当天的日报；所有访问者共享**三小时冷却**，从最近一次任务启动算起，失败也占用冷却
- 冷却由数据库单条条件写入同时完成判断与任务占用——刷新、换浏览器、并发点击或伪造 force 参数都不能绕过
- 主人通过邮箱验证后，可不限间隔重生成已有报告及历史日／周／月报告；任何人都不能生成未来报告，同一时间只允许一个手动任务
- 历史报告基于已保存记录，无法取回 Spotify 不再返回的历史播放
- Cron 不受手动冷却影响，已完成的自动任务保持幂等

### Cloudflare Access 配置

1. 在 Zero Trust 建立 Self-hosted 应用，仅保护 `你的正式域名/api/admin/login`——不要保护整个网站，否则普通访客也会被要求登录
2. 启用邮箱一次性验证码或自己的身份提供商；Allow 策略只放行你的确切邮箱
3. Worker 配置 `CF_ACCESS_TEAM_DOMAIN=https://你的团队.cloudflareaccess.com`、应用的 `CF_ACCESS_AUD`、`OWNER_EMAIL=你的邮箱`
4. 从页面"主人登录"进入。Worker 验证 Access JWT 的签名、签发者、应用受众、有效期和确切邮箱，再创建 HttpOnly 管理会话。只传邮箱请求头无效；会话不超过 Access 令牌有效期，最多 24 小时
5. 主人登录后才能连接／重新连接 Spotify。OAuth 回调仍会校验主人会话和独立 state，访客无法替换本站的 Spotify 账户；邮箱登录到期不影响后台 Spotify 自动续期

如果没有配置受保护路径，登录接口拒绝请求，**不会降级为不验证身份**。备用管理口令可保持为空。参考 [Cloudflare 官方 JWT 校验说明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。

## 🔔 Telegram 故障提醒

授权刷新失败（包括临时网络错误）、应用凭证被拒绝、保存的授权无法解密时，会尝试通知主人并附登录入口。

- 在 `.dev.vars` 或生产 Worker Secrets 中设置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
- 通过 [BotFather](https://t.me/BotFather) 的 `/newbot` 创建 Bot，先向自己的 Bot 发送 `/start`，再取得该私聊的 chat ID
- 可运行 `node scripts/telegram-setup.mjs` 读取 Bot 的待处理私聊列表（只显示 chat ID 与名字，不打印 token 或消息正文）
- 上线前可运行 `node scripts/telegram-setup.mjs --test` 发送一条测试消息
- 不配置 Telegram 就不发送；密钥只在后台使用

限流与可靠性：D1 原子占用通知记录，持续故障每六小时最多提醒一次；续期成功或重新授权后重置。Telegram 发送失败会记录状态，五分钟后发生下一次故障时可重试，不会吞掉原本的采集错误，也不声称已经送达。没有单独的持续故障探测任务——故障在实际采集／调用 Spotify 时发现。

## 🧠 数据与生成

| 环节        | 说明                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 📥 采集     | 分页拉取 recent，每页 50，最多 8 页，按歌曲 ID + 播放时间去重。页面明确标注已收集记录，不承诺全量历史                                                                                      |
| 🗓️ 周期     | day/week/month 使用本地日期左闭右开区间。进行中的周期先生成预览，结束后可重新生成                                                                                                          |
| 🏷️ 分类     | 只给尚无标签的歌曲做批量分类，每次最多 60 首，标签持久保存；风格和听感是模型推测，不是音频分析，无法识别时标为未知                                                                         |
| 📊 指标     | 程序计算重听、时段、流派加权、年代与歌手集中度，合作歌手均分一次播放                                                                                                                       |
| ✍️ 乐评     | 独立结构化生成，固定 schema，不把统计复述当乐评，不推断用户人格                                                                                                                            |
| 📚 Fun Fact | 首版用 Wikipedia 搜索和摘要作为可回溯资料；只保留引用来源和原文片段校验通过的故事，没有资料就省略。片段校验可以防止捏造引用，不能替代人工事实审查；后续可加入更优先的艺人/制作人采访资料源 |
| 🎵 推荐     | 模型给候选，Spotify 搜索后严格核对歌名和歌手；查不到就少展示，不生成虚构歌曲链接                                                                                                           |
| 🩹 故障     | 播放数据先保存，模型失败时生成部分报告，管理端可重试。单周期任务有互斥及 20 分钟过期回收。任务失败保留错误需手动重试；队列不自动重试，避免重复消耗模型额度                                 |
| 🔌 生成方式 | 手动生成提交到 Cloudflare Queues 后立即返回，关闭页面不影响后台生成；队列按需唤醒 Worker，Cron 仍每天触发一次                                                                              |

## ✅ 验证

```sh
npm test                              # 单元与部署检查
npm run build                         # 类型检查 + 构建
node scripts/check-connections.mjs    # 连接检查
npx tsx scripts/check-model.ts        # 模型冒烟测试
```

- 前两项不调用外部模型
- 连接与模型测试读取本地密钥，但不打印密钥、访问令牌或刷新令牌
- `scripts/generate-local.mjs` 会实际采集并生成日报，消耗模型用量，输出到已忽略的 `test-results/`

## 🗂️ 项目结构

```
├── shared/
│   ├── schema.ts       # 页面报告与模型输出契约
│   └── metrics.ts      # 时区、周期、指标
├── worker/
│   ├── pipeline.ts     # 采集、分类、乐评、资料与推荐核对
│   ├── security.ts     # 令牌加密、管理会话、同源检查
│   └── ...             # 接入层、任务、通知、Spotify 客户端
├── src/main.tsx        # 各 section、历史、反馈和管理入口
├── migrations/         # D1 表结构
└── scripts/            # 设置、连接检查、Telegram 配置等
```

本项目不会自动公开真实报告，也不会自动创建付费 Cloudflare 资源。

## 🤝 参与开发与许可证

- 开发流程和提交约定：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 数据流设计：[DESIGN.md](./DESIGN.md)
- 安全与隐私说明：[SECURITY.md](./SECURITY.md)
- 部署指南：[DEPLOYMENT.md](./DEPLOYMENT.md)

代码使用 [MIT License](./LICENSE)；歌曲、专辑封面和第三方资料的权利仍归各自权利人。
