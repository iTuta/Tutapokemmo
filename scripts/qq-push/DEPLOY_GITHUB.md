# GitHub Actions 云端推送（免费，无需电脑常开）

> **重要**：GitHub 的 `schedule` cron 只是「尽力而为」，`*/5` 会被排队延迟（实测间隔可达
> 13~21 分钟）。想要每 5 分钟稳定推送，请按 [DEPLOY_CRON.md](DEPLOY_CRON.md) 配置外部 cron
> 触发 `workflow_dispatch`（立即执行、不排队），`schedule` 保留作兜底。

把明雷推送放到 GitHub 的免费定时任务里：每 5 分钟检查一次报点，有新明雷就发到企业微信群。
电脑关机、Codex 关闭都不影响。

## 工作方式

- 工作流文件：`.github/workflows/swarm-push.yml`（定时每 5 分钟 + 可手动触发）。
- 推送脚本：`scripts/qq-push/index.js --once`（定时模式：每轮推送当前活跃明雷，最新报点为主报，附其他活跃清单与头目报点，地点为中文）。
- 已推送记录：`scripts/qq-push/seen.json` 保存在仓库里，由工作流自动提交回仓库，避免重复推送。
- Webhook 密钥：存在 GitHub 的加密 Secret 里，不会出现在代码或仓库文件中。

## 部署步骤

1. 注册/登录 GitHub，新建一个私有仓库（New repository，Private），
   **不要勾选**自动生成 README/.gitignore 等初始化文件（保持仓库为空）。
2. 在项目目录里执行（把仓库地址换成你的）：

   ```bash
   git init
   git add .
   git commit -m "init: 明雷报点推送"
   git branch -M main
   git remote add origin https://github.com/你的用户名/你的仓库名.git
   git push -u origin main
   ```

3. 打开仓库 → Settings → Secrets and variables → Actions → New repository secret：
   - Name：`WECHAT_WEBHOOK`
   - Value：你的企业微信群机器人 Webhook 地址
4. 可选过滤（Settings → Secrets and variables → Actions → Variables 新增）：
   - `SWARM_ONLY_VALUABLE=true`：只推有价值的明雷
   - `SWARM_REGIONS=合众,神奥`：只推指定地区
   - `SWARM_MONSTER_IDS=176,328`：只推指定宝可梦
5. 回到 Actions 页面，选择「明雷报点推送」工作流 → Run workflow 手动跑一次测试；
   也可以在仓库里直接打开日志确认运行成功。
6. 去企业微信群确认收到当前明雷后，就全部完成。之后每 5 分钟自动运行，无需任何操作。

## 排错

- 工作流运行失败，日志提示 `missing WECHAT_WEBHOOK`：Secret 没配置或名字拼错。
- 日志有 `微信推送失败`：webhook 地址失效（机器人被删除），重新添加后更新 Secret。
- 报点延迟：GitHub 定时任务会被排队延迟，明雷持续 20～25 分钟基本不会漏，但想每 5 分钟准时推送请用 [DEPLOY_CRON.md](DEPLOY_CRON.md) 的外部 cron 方案。
- 手动触发找不到工作流：确认已经 push 到默认分支（main），且 `.github/workflows/swarm-push.yml` 在仓库里。
