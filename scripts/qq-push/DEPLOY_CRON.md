# 外部 cron 定时触发 GitHub 工作流（推荐，绕开 GH cron 排队延迟）

GitHub Actions 的 `schedule`（cron）只是「尽力而为」，`*/5` 这种高频定时会被排队延迟
（实测间隔可达 13~21 分钟甚至更久）。可靠做法：把「定时」搬到 GitHub 之外，
用外部免费 cron 服务每 5 分钟调一次 GitHub 的 `workflow_dispatch` 接口 ——
该接口触发后**立即执行**，不排队。

当前仓库已**移除** GitHub 自带 `schedule`，仅由外部 cron 触发，避免两条通道
撞车导致重复报点。若外部 cron 失效则推送会中断，需自行留意 cron-job.org 的任务状态。

## 结构

```
cron-job.org（每 5 分钟）
   └─ POST https://api.github.com/repos/iTuta/Tutapokemmo/actions/workflows/swarm-push.yml/dispatches
        ├─ Headers: Authorization: Bearer <你的 PAT>
        │           Accept: application/vnd.github+json
        ├─ Content-Type: application/json
        └─ Body: {"ref":"main"}
              ↓
      GitHub 立即运行 .github/workflows/swarm-push.yml
              ↓
      node scripts/qq-push/index.js --once → 微信推送
```

## 第一步：生成 GitHub PAT（仅需一次）

1. 打开 https://github.com/settings/tokens （GitHub → Settings → Developer settings → Personal access tokens）。
2. 推荐 **Fine-grained**：Repository access 选 `iTuta/Tutapokemmo`，Permissions → Actions 设为 **Read and write**。
   简单起见也可以用 **Classic** token，勾选 `repo` 权限。
3. 生成后**立即复制保存**（只显示一次）。注意：不要把 token 提交到仓库。

## 第二步：cron-job.org 建 job（免费）

1. 注册 https://cron-job.org → 登录。
2. Create cronjob：
   - **Title**：`pokemmo swarm-push`
   - **URL**：`https://api.github.com/repos/iTuta/Tutapokemmo/actions/workflows/swarm-push.yml/dispatches`
   - **Request method**：`POST`
   - **Post data**（或 Request body，JSON 格式）：
     ```json
     {"ref":"main"}
     ```
   - **Headers**（如果界面提供）：
     ```
     Authorization: Bearer <你的PAT>
     Accept: application/vnd.github+json
     Content-Type: application/json
     ```
     若界面不提供自定义 Header，就用 cron-job.org 的 "HTTP Basic Auth" 之外的方式，
     或换用 EasyCron / UptimeRobot 等支持自定义 Header 的服务。
   - **Execution schedule**：`*/5 * * * *`（每 5 分钟）
3. 保存后先手动点一次 **Run**，去 GitHub 仓库 Actions 页面确认新运行出现且成功。

## 手动触发测试

不带任何调度，手动触发一次（把 `<PAT>` 换成你的）：

```bash
curl -X POST https://api.github.com/repos/iTuta/Tutapokemmo/actions/workflows/swarm-push.yml/dispatches \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main"}'
```

## 排错

- 返回 `401`：token 无效或已过期 → 重新生成。
- 返回 `403`：token 权限不足 → 确认有 Actions Read/Write（或 classic `repo`）。
- 返回 `404`：仓库名 / 工作流文件名写错，或 token 无权访问该仓库。
- 触发了但没收到微信：去 GitHub Actions 运行日志看 `node scripts/qq-push/index.js --once`
  那一步的输出（环境变量 `WECHAT_WEBHOOK` 来自仓库 Secrets，需在
  Settings → Secrets and variables → Actions 里配置）。
- 想换频率：改 cron 表达式即可；GitHub 接口对单仓库 dispatch 有速率限制，5 分钟一次远低于上限。