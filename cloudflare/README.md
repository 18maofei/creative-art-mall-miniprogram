# Cloudflare 后端迁移

这里是拾色画室的 Cloudflare-only 后端：Workers API + D1 + R2。

## 运行时

- `src/index.js`：保留现有小程序 API 路径的 Worker 入口。
- `migrations/`：D1 SQLite 迁移，按原 MySQL 业务表转换；`0006_identity_permissions.sql` 建立角色/权限目录和覆盖权限表，`0011_trials_and_ledger.sql` 增加试听预约和试听/流水权限。
- `public/`：后台管理台静态资源目录。
- `wrangler.jsonc`：D1、R2 和静态资源绑定配置。

## 初始化 Cloudflare 资源

```powershell
npm install
npx wrangler login
npx wrangler d1 create art-studio
npx wrangler r2 bucket create art-studio-assets
```

把 `wrangler.jsonc` 中 `database_id` 替换成 `wrangler d1 create` 返回的 ID，然后执行：

```powershell
npx wrangler d1 migrations apply art-studio --local
npx wrangler d1 execute art-studio --local --file=scripts/seed.sql
npx wrangler dev
```

生产环境只执行迁移和管理员初始化，不要直接导入演示数据：

```powershell
npm run db:remote
npm run db:bootstrap-admin:remote
```

管理员初始化脚本只创建 `画室管理员` 的 `ADMIN` 角色，不创建课程、商品或演示账号。部署完成后使用 `.secrets.json` 中的 `ADMIN_PASSWORD` 登录一次，随后在管理台修改管理员资料和密码。

## 集中配置、密钥与部署

公开发布配置统一维护在项目根目录的 `config/release.json`，同步脚本会把它写入
`cloudflare/wrangler.jsonc` 和 `miniprogram/config.js`。日常只修改这个文件，不要分别
编辑两个生成文件：

```json
{
  "apiBaseUrl": "https://你的Worker域名",
  "corsOrigin": "https://你的管理端域名",
  "institutionName": "拾色画室",
  "allowDevAuth": false,
  "paymentMode": "disabled",
  "wechatPayEnabled": false,
  "demoMode": false,
  "allowInsecureHttp": false
}
```

同步配置：

```powershell
npm run config:sync
```

`config/release.json` 只能放公开地址和开关，不能放 AppSecret、会话密钥、管理员密码、
支付私钥或 R2 凭据。

部署需要的敏感变量集中在本地 `cloudflare/.secrets.json`。仓库只保留
`.secrets.example.json`，真实文件已加入 `.gitignore`，不要提交到 GitHub、Notion
或聊天记录。

先复制示例文件并填写自己的值：

```powershell
Copy-Item .secrets.example.json .secrets.json
notepad .secrets.json
```

文件格式如下，键名不要修改：

```json
{
  "SESSION_SECRET": "至少 32 位随机字符串",
  "ADMIN_PASSWORD": "管理员初始密码",
  "WECHAT_APP_ID": "微信小程序 AppID",
  "WECHAT_APP_SECRET": "微信小程序 AppSecret",
  "WECHAT_PAY_MCH_ID": "微信支付商户号（PAYMENT_MODE=wechat 时必填）",
  "WECHAT_PAY_SERIAL_NO": "商户 API 证书序列号",
  "WECHAT_PAY_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n商户 API 证书私钥\\n-----END PRIVATE KEY-----",
  "WECHAT_PAY_API_V3_KEY": "32 位 API v3 密钥",
  "WECHAT_PAY_NOTIFY_URL": "https://你的域名/api/payments/wechat/notify",
  "WECHAT_PAY_PLATFORM_CERT_SERIAL": "微信支付平台证书序列号",
  "WECHAT_PAY_PLATFORM_CERT_PEM": "-----BEGIN CERTIFICATE-----\\n微信支付平台证书\\n-----END CERTIFICATE-----"
}
```

填写完成后，在 `cloudflare` 目录执行：

```powershell
npm run deploy
```

该命令等价于 `npx wrangler deploy --secrets-file .secrets.json`，会把代码和密钥一起提交到同一个 Worker 部署版本。也可以先检查打包内容：

```powershell
npm run deploy:dry
```

`npm run deploy` 和 `npm run deploy:dry` 会先自动执行 `npm run config:sync`，再执行
`npm run preflight:production`。任何占位域名、通配 CORS、缺失密钥或开发支付配置都会阻止发布。

Cloudflare 会在部署时校验四个必填密钥。部署后首次使用 `ADMIN_PASSWORD` 登录会自动写入哈希，之后可在管理台修改密码。

当前账号已经创建并迁移了远程 D1 `art-studio` 和 R2 `art-studio-assets`；Worker 源码需要在你确认后从本机执行部署。生产密钥只在本机 `.secrets.json` 和 Cloudflare 加密 Secret 中保存。

生产环境的 `wrangler.jsonc` 已默认设置 `ALLOW_DEV_AUTH=false`、`PAYMENT_MODE=disabled`、`WECHAT_PAY_ENABLED=false`。不要把 `.dev.vars` 上传到 Cloudflare；本地开发才使用 `.dev.vars` 中的 `ALLOW_DEV_AUTH=true`、`PAYMENT_MODE=mock`。Worker 的 `mock-pay` 路由在生产配置下返回 404，创建订单接口也会在支付通道未配置时返回 503，不会把演示支付带到线上。订单创建支持 `idempotencyKey`，重复请求会复用原订单并避免重复扣库存；定时任务每 5 分钟释放超过 30 分钟未支付的订单库存。管理台可在「试听预约」跟进家长预约，在「作品管理」上传图片到 R2，绑定学员并发布为课程作品或教学花絮；家长端可查询课时流水和试听处理进度。

发布小程序前，确认 `config/release.json` 的 `apiBaseUrl` 是已部署 Worker 的 HTTPS
自定义域名。同步后的 `miniprogram/config.js` 只允许出现公开地址和开关，不能放
`WECHAT_APP_SECRET`、微信支付商户密钥、R2 Access Key 等敏感信息；微信小程序后台还需要
把该域名加入 request 合法域名。

Worker 已包含微信支付 V3 JSAPI 下单、回调验签解密和幂等入账适配器，但生产默认仍保持 `PAYMENT_MODE=disabled`。正式开放报名和商城付款前，必须填写商户 API 私钥、商户证书序列号、API v3 密钥、平台证书和 HTTPS 回调地址，并完成微信侧配置与小额实付验证，再将 Worker 与小程序的 `paymentMode` 同时切换为 `wechat`。退款仍未接入支付渠道，不能仅通过修改订单字段伪造退款。

## 身份与权限

用户可以同时拥有 `parent`、`teacher`、`student`、`operator`、`admin` 多个身份。登录响应中的 `roles`、`currentRole` 和 `permissions` 是唯一的页面显示依据；`/api/auth/switch-role` 会重新签发绑定当前身份的令牌。Web 管理台的「身份与权限」页面只允许具备 `identity.manage` 的后台会话访问，所有业务 API 仍会在 Worker 端再次校验角色和权限。

## 数据迁移说明

原后端使用 MySQL/Knex；D1 使用 SQLite 语义，不能直接运行原来的 Knex migration。这里的 SQL 已将 `ENUM`、`DATETIME`、`JSON`、自增主键等类型转换为 SQLite 等价写法。现有数据需要先导出，再按字段映射导入；演示环境可以直接执行 seed 脚本建立样例数据。
