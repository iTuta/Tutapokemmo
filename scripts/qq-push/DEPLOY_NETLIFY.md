# Netlify 云端推送（无需电脑常开）

把明雷推送搬到 Netlify 云端定时运行：每 2 分钟检查一次报点，有新明雷就发到企业微信群。
电脑关机、Codex 关闭都不影响。

## 新增的文件

- `netlify/functions/swarm-push/swarm-push.js`：定时推送函数（每 2 分钟一次）。
- `netlify/functions/swarm-test/swarm-test.js`：手动测试函数。
- `netlify/functions/_data/monster-names.js`：宝可梦中文名数据（由构建脚本生成）。
- `package.json`：声明云端存储依赖 `@netlify/blobs`。
- `scripts/build-swarm-names.js`：重新生成中文名数据的脚本。

## 部署步骤

1. 网站必须是「连接 Git 仓库」方式部署（Netlify Drop 拖拽部署不支持函数）。
   如果现在是用拖拽上传的，需要先把项目推到 GitHub，再到 Netlify 里用
   “Add new site → Import an existing project” 连接该仓库。
2. 在 Netlify 站点后台：Site configuration → Environment variables，添加：
   - `WECHAT_WEBHOOK`：你的企业微信群机器人 Webhook 地址（必填，密钥不要写进代码/仓库）。
   - 可选：`SWARM_ONLY_VALUABLE=true` 只推有价值的明雷；
     `SWARM_REGIONS=合众,神奥` 只推指定地区；
     `SWARM_MONSTER_IDS=176,328` 只推指定宝可梦；
     `SWARM_TEST_TOKEN=随便一个长字符串` 用来保护测试接口。
3. 把代码推送到仓库，Netlify 会自动构建部署。
4. 部署完成后，打开 Netlify 的 Functions 页面：
   - 应该能看到 `swarm-push`，带有 `Scheduled` 标记，并显示下次执行时间。
   - 点进函数 → `Run now` 立即跑一次，然后去企业微信群看是否收到当前明雷。
   - 也可以用 `swarm-test` 测试：访问
     `https://你的站点域名/.netlify/functions/swarm-test?token=你的SWARM_TEST_TOKEN`。
5. 确认收到消息后，就无需任何操作，之后每 2 分钟自动检查并推送。

## 排错

- Functions 页面没有 Scheduled 标记：确认是 git 部署，且函数在 `netlify/functions` 目录。
- 日志报 `missing WECHAT_WEBHOOK`：环境变量没配好，或配置后没重新部署。
- 日志报微信推送失败：检查 webhook 地址是否仍然有效（机器人是否被删除）。
- 想改检查频率：修改 `swarm-push.js` 里 `config.schedule`（cron 表达式，UTC 时间）。

## 数据说明

- 已推送记录存在 Netlify Blobs（站点级存储），跨部署保留，不会重复推送。
- 记录只保留 2 天，之后自动清理。
