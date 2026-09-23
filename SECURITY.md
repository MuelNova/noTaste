# 安全与隐私

本项目是单个站点主人的听歌日记。访客不会获得 Spotify 授权，也不能替换主人的账户。

请勿在公开 Issue、Pull Request 或日志中粘贴 API Token、Spotify refresh token、加密密钥或真实数据库。报告安全问题时优先使用仓库提供的私密安全报告入口；如果尚未启用，请先联系维护者约定私密渠道。

部署时需要：

- 用 Cloudflare Access 策略仅允许主人的完整邮箱访问 `/api/admin/login`。
- 长期保存生产 `TOKEN_ENCRYPTION_KEY`，丢失或更换后需要重新连接 Spotify。
- 使用最小范围的 Cloudflare 部署令牌，并保存到 GitHub Actions Secrets。
- 根据需要选择 `PUBLIC_REPORTS`。公开报告会包含歌曲、播放次数和时段等听歌信息。

匿名生成的三小时共享冷却只限制模型调用，不替代针对大规模请求的网络防护。代码中的模拟测试不能代替正式域名的首次登录与回调联调。
