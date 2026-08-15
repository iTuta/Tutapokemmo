# QQ 明雷报点推送

常驻脚本：监听 pokemoyu.com 的明雷报点，发现新明雷时推送消息。支持两种通道：

- 微信（推荐，个人即可）：企业微信群机器人 webhook，零门槛。
- QQ：通过你自己的 QQ 开放平台机器人推送到指定群（需要企业/个人主体审核，视平台政策而定）。

## 使用前提

1. 微信通道：企业微信里建群 → 群设置 → 群机器人 → 添加机器人 → 复制 Webhook 地址，填到 `config.json` 的 `wechatWebhook`。个人即可，不需要企业资质。
2. QQ 通道：在 QQ 开放平台创建好机器人（群聊机器人），拿到 `AppID` 和 `AppSecret`（机器人开发设置里），把机器人拉进目标群（沙箱阶段需先在开放平台「沙箱配置」里把该群设为沙箱测试群）。
3. 本机或服务器能联网访问 pokemoyu.com 和 QQ 官方接口。

## 配置

编辑 `config.json`：

- `wechatWebhook`：微信通道填企业微信群机器人的 Webhook 地址；填了就走微信，其它 QQ 配置可忽略。
- `appId` / `appSecret`：QQ 通道的机器人凭证；未填 `wechatWebhook` 时必填。
- `sandbox`：`true` 表示沙箱环境（未发布时用），正式发布后改成 `false`。
- `groupOpenid`：目标群，可留空。留空时把机器人拉进群，或在群里 @机器人 发送「绑定」，脚本会自动写入。
- `onlyValuable`：`true` 时只推「有价值」的明雷。
- `regions`：只推指定地区，例如 `["合众", "神奥"]`；留空表示全部。
- `monsterIds`：只推指定宝可梦 id，例如 `[176, 328]`；留空表示全部。
- `pollIntervalMs`：轮询间隔，默认 15000（15 秒）。

## 运行

```bash
node scripts/qq-push/index.js          # 常驻运行（推荐用开机自启或计划任务）
node scripts/qq-push/index.js --once   # 定时模式（cron / GitHub Actions / 外部调度）：每轮推送当前活跃明雷，最新报点为主报，附其他活跃清单（中文地点）
node scripts/qq-push/index.js --test   # 发送一条测试消息验证通道
```

## 说明

- 已推送过的报点记录在 `seen.json`，重启不会重复推送；发送失败会进入 `pending.json` 自动重试。
- 定时模式（`--once`）：每轮推送一次当前活跃明雷 —— 最新报点作主报（完整详情），其余按消失时间排序附后，地点显示为中文（映射自 `search-data.js`）。
- 头目报点：消息末尾附「头目报点」区块（格式同主报，数据源 `alpha-pings` 接口）；无活跃头目时显示上一次头目的出现时间与结束时间。
- 推送内容不含外链，避免触发 QQ 消息限制。
- 频控：群聊主动消息每个群每天最多 1000 条，明雷推送远用不满。
