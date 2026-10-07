# 纯粹艺术文化小程序

面向少儿美术机构的完整业务演示项目：微信原生小程序（访客 / 家长 / 教师 / 学生 / 运营 / 超级管理员）+ Fastify + MySQL 后端 + Web 运营管理台。界面参考「知行成长中心」原型的绿色主题（主色 `#16785c`）。

## 架构

```text
微信小程序 (miniprogram/)                Web 运营管理台 (backend/public/admin/)
   │  wx.request                              │  fetch + Bearer Token
   └──────────────┬───────────────────────────┘
                  ▼
        Fastify 5 API (backend/src/)
          routes/ public · account · teacher · admin · dev
          services/ lessons(课时流水) · orders(订单状态机)
                  │  Knex 3
                  ▼
        MySQL 8.4（Docker，127.0.0.1:3307，库 art_studio）
```

## Cloudflare-only 部署（迁移目标）

`cloudflare/` 目录包含不依赖服务器的 Workers 后端：Worker 提供原有 `/api/*` 接口，D1 保存业务数据，R2 保存商品图/作品图，后台管理台作为 Workers Static Assets 提供。`backend/` 保留为本地 Fastify/MySQL 对照环境，不参与 Cloudflare 生产部署。

```text
微信小程序 ──HTTPS──> Cloudflare Worker（API + 管理台）
                         ├─ D1（SQLite 业务表）
                         └─ R2（图片与文件）
```

初始化和本地验证：

```powershell
cd cloudflare
npm install
npx wrangler login
npx wrangler d1 create art-studio
npx wrangler r2 bucket create art-studio-assets
# 将 wrangler.jsonc 的 database_id 替换为实际 ID
npm run db:local
npm run db:seed
npm run dev
```

部署前复制 `cloudflare/.secrets.example.json` 为 `cloudflare/.secrets.json` 并填写四个敏感变量，在 `cloudflare/wrangler.jsonc` 填好管理端 HTTPS 来源，并在 [`miniprogram/config.js`](miniprogram/config.js) 填好 Worker HTTPS 地址，然后在 `cloudflare` 目录执行 `npm run deploy`（代码和密钥会一起发布）。部署命令会先运行生产预检，未填写的占位配置会直接阻止发布。最后在微信公众平台配置 request 合法域名。详细迁移说明见 [`cloudflare/README.md`](cloudflare/README.md)。

离线查看两端 UI 与交互：直接打开 [`ui-interaction-preview.html`](ui-interaction-preview.html)，顶部可以切换小程序端和 Web 管理端。该文件只使用演示数据，不需要启动服务。

## 项目结构

```text
miniprogram/                  微信原生小程序
  app.json                    页面 + tabBar（首页/课程/商城/我的）
  services/api.js             全部后端接口封装（用户端 + 管理端）
  pages/
    identity/                 服务端身份选择（仅显示账号已授权角色）
    home,course,course-detail 访客浏览与课程报名（支付通道由配置决定）
    trial-appointment,trial-appointments 预约试听提交与处理进度
    shop,orders,address       周边商城、订单、收货地址
    parent/,leave/            家长工作台、请假申请
    lesson-ledger/            家长按孩子查询课时流水
    teacher/,student/         教师/学生工作台（考勤、反馈与作品）
    admin*/                   小程序管理端（总览/订单/商品/排课/报名/监护/运营）
backend/
  migrations/                 Knex 迁移（含角色/权限目录，全部表结构以此为准）
  src/
    server.js                 入口（CORS、路由装配、静态管理台）
    knex.js / auth.js         数据库连接、HMAC 会话与 scrypt 密码
    routes/ services/         业务路由与课时/订单核心逻辑
    seed.js                   幂等种子数据（可重复执行）
  public/admin/               Web 运营管理台（登录、仪表盘、身份权限、学员/排课/请假/作品/公告/订单等）
docker-compose.yml            MySQL 8.4 + Adminer
docs/                         早期 SQL 设计文档（以 migrations/ 为准）
```

## 本地启动

> Windows 下目录名含中文，docker compose 必须加 `-p art-studio` 指定项目名。

```powershell
# 1. 启动 MySQL（根目录）
docker compose -p art-studio up -d

# 2. 后端：迁移 + 种子 + 启动
cd backend
npm install
npm run db:migrate
npm run db:seed
npm run dev        # http://127.0.0.1:3000
```

- 健康检查：`http://127.0.0.1:3000/health` → `{"database":"mysql"}`
- Web 管理台：`http://127.0.0.1:3000/admin`
- Adminer 看库：`http://127.0.0.1:8080`（服务器 `mysql`，用户 `art_studio_app` / `change-me-local-only`，库 `art_studio`）

### 默认账号（由 seed 写入）

| 用途 | 账号 | 说明 |
| --- | --- | --- |
| Web 管理台登录 | `画室管理员` / `ZhiXing@Admin2026` | 首次登录后请在「系统设置」改密 |
| 家长演示 | 李女士（userId=1） | 绑定学员乐乐、安安 |
| 教师演示 | 王老师（userId=2） | 负责周六创意美术班 |
| 学生演示 | 小画家（userId=4） | 仅拥有学生端身份 |
| 运营演示 | 运营同学（userId=5） | 可进入运营模块，不可配置身份权限 |

### 登录与鉴权

- 小程序统一走 `wx.login → POST /api/auth/wechat-login → 存 token`，之后所有请求自动携带 `Authorization: Bearer <token>`（8 小时有效）。
- 后端配置了 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 时执行真实 `code2Session`；未配置且 `ALLOW_DEV_AUTH=true` 时（本地开发），登录接口接受 `devOpenid`，小程序据此登录种子账号：家长 `demo-parent-001`、教师 `demo-teacher-001`、学生 `demo-student-001`、运营 `demo-operator-001`、管理员 `demo-admin-001`。
- 身份页只展示服务端会话返回的角色对象；切换角色会由后端校验 `user_roles` 后重新签发绑定 `activeRole` 的令牌。权限由 `role_catalog`、`permission_catalog`、`role_permissions` 和 `user_permissions` 计算，浏览器/小程序缓存不能作为授权依据；用户数据接口（订单/地址/请假等）只能访问本人数据，教师接口要求当前会话为 TEACHER/ADMIN 且只能操作自己班级的课次。

## 在微信开发者工具运行

1. 「导入项目」选择项目根目录 `E:\小程序\创意商城小程序`（不要只选 `miniprogram` 子目录）。线上微信登录必须选择已注册的小程序 AppID：`wxffcb7034e2e168f1`；“无 AppID/游客模式”会导致 `wx.login` 报 `41002 appid missing`。
2. 详情 → 本地设置 → 勾选「不校验合法域名」（后端在 `http://127.0.0.1:3000`）。
3. 先启动后端，再编译小程序。

小程序运行地址和支付开关集中在 [`miniprogram/config.js`](miniprogram/config.js)。发布包默认是线上安全配置：只接受 HTTPS、关闭开发登录和模拟支付。需要本地联调时，参考
[`miniprogram/config.local.example.js`](miniprogram/config.local.example.js) 临时替换配置，联调完成后必须恢复线上配置。
项目配置中的 `setting.urlCheck` 已开启；本地使用 `http://127.0.0.1` 时，只在微信开发者工具「详情 → 本地设置」临时关闭合法域名校验，提交审核前不要关闭。

### 手工验证清单（小程序端）

- [ ] 身份页根据服务端角色动态显示（访客/家长/教师/学生/运营/超级管理员）；多角色账号可切换，单角色账号不显示切换入口
- [ ] 首页显示公告栏、在售课程与作品（来自后端实时数据）
- [ ] 本地开发配置下，课程详情「立即报名」→ 确认弹窗 → 演示支付 → 课时到账 → 跳转订单页
- [ ] 本地开发配置下，商城加购 → 结算取默认地址 → 演示支付 → 订单页出现新订单
- [ ] 订单页：待支付可「去支付/取消」，已发货显示运单号并可「确认收货」
- [ ] 家长端：多孩子课时账户、课程反馈、公告；请假申请提交后出现在历史列表
- [ ] 教师端：切换出勤/请假 → 处理今日考勤（出勤扣 1 课时）→ 发布课堂反馈
- [ ] 管理端小程序页：总览/订单/商品/排课/报名等数据可读可写
- [x] 预约试听：访客提交预约 → 管理台确认/完成/取消 → 登录家长查看处理进度
- [x] 课时流水：家长按孩子查看充值、赠送、扣减、退款和手动调整记录；管理台可查看明细

> 后端接口链路（开发配置下下单 → 演示支付 → 发货 → 确认收货、请假 → 审批 → 自动 LEAVE 考勤、考勤状态切换回补/扣课、购课 → 课时到账）已用 curl 验证。生产微信支付适配器已接入 Worker，但只有在填写商户参数、平台证书并配置回调域名后才会开放。

## API 一览

### 公共（无鉴权）
- `GET /health`、`GET /api/public/bootstrap`（课程/商品/作品聚合）
- `GET /api/courses`、`/api/products`、`/api/artworks[?kind=ARTWORK|MOMENT]`
- `GET /api/announcements?audience=ALL|PARENT|TEACHER`
- `POST /api/trial-appointments`（访客可提交试听预约，带有效会话时自动关联账号）
- `POST /api/events`（访问埋点）

### 登录
- `POST /api/auth/wechat-login`（body：`code`；返回 token + 角色对象 + 权限，新 openid 自动建号。登录只建立微信 `openid`，不会静默读取昵称或头像）
- `GET /api/auth/me`（按当前令牌重新计算用户、当前角色和权限）
- `POST /api/auth/switch-role`（body：`role`；只允许切换账号已拥有的角色，并签发新令牌）

### 用户端（需 Bearer Token，仅限本人或管理员）
- `PATCH /api/users/profile`（body：`nickname`；使用当前会话更新本人昵称）
- `POST /api/users/profile/avatar`（multipart 字段 `file`，可选 `nickname`；上传用户主动选择的头像到 R2 并更新本人资料）
- `GET /api/users/:id/dashboard`（孩子、课时、课表）
- `GET /api/users/:id/trial-appointments`、`GET /api/users/:id/lesson-ledger[?childId=]`
- `POST /api/orders`（支持 `idempotencyKey`，重复提交复用原订单）、`POST /api/orders/:id/mock-pay`（仅开发环境）、`POST /api/orders/:id/pay`（微信 JSAPI 预支付）、`GET /api/orders/:id/status`、`POST /api/orders/:id/confirm-receipt`、`GET /api/users/:id/orders`
- `POST /api/payments/wechat/notify`（微信支付 V3 回调，验签解密后幂等入账）
- `GET|POST /api/users/:id/addresses`、`PATCH|DELETE /api/users/:id/addresses/:addressId`
- `POST /api/leave-requests`、`GET /api/users/:id/leave-requests`
- `GET /api/users/:id/feedback`（课堂反馈）

### 教师端（需 Bearer Token + TEACHER 角色，考勤/反馈仅限本人班级）
- `GET /api/teacher/:userId/sessions`
- `GET|POST /api/sessions/:id/attendance`（POST 确认考勤，PRESENT 自动扣课、幂等）
- `POST /api/sessions/:id/feedback`（课堂反馈）

### 管理端（Bearer Token；开发环境可选 `X-Admin-User-Id` 头）
- `POST /api/admin/login`、`POST /api/admin/password`
- `GET /api/admin/roles`、`GET /api/admin/permissions`
- `GET|PATCH /api/admin/users/:id/access`（配置多角色和单用户权限覆盖，需要 `identity.manage`）
- `GET /api/admin/overview`、`/analytics`、`/users`、`/orders`、`/courses`、`/products`、`/artworks`、`/resources`
- `PATCH /api/admin/orders/:id`（状态机：待支付→已支付→已发货→已完成，发货需 `trackingNo`，取消自动回补库存）
- `GET|POST /api/admin/children`、`POST /api/admin/children/:id/lessons`（课时调整流水）
- `GET /api/admin/children/:id/lesson-ledger`（查看学员课时流水）
- `GET|PATCH /api/admin/trial-appointments[/:id]`（试听预约列表与状态处理）
- `POST /api/admin/parents`、`/api/admin/guardians`（监护绑定）
- `GET|POST /api/admin/classes`、`POST /api/admin/classes/:id/sessions`、`POST /api/admin/enrollments`
- `GET|PATCH /api/admin/leave-requests[/:id]`（批准后自动写 LEAVE 考勤，不扣课时）
- `GET|POST|PATCH /api/admin/announcements[/:id]`
- `POST /api/admin/skus/:id/stock`、`POST /api/admin/uploads/presign`
- `GET|POST|PATCH|DELETE /api/admin/artworks[/:id]`（作品/教学花絮元数据和 R2 图片管理）

### 开发辅助（仅非生产环境注册）
- `GET /api/dev/context`（返回演示用 parent/teacher/student/operator/admin userId）

## 核心业务规则

- **课时**：`lesson_ledger` 流水表 + 幂等键。购课支付成功自动充值；考勤 PRESENT 扣 1 次（键 `attend-{sessionId}-{childId}`，重复提交不重复扣）；LEAVE/ABSENT 不扣。
- **订单状态机**：`PENDING_PAYMENT → PAID → SHIPPED → COMPLETED`，支持 `CANCELLED`（回补库存）。退款不能通过后台直接伪标记，必须接入支付渠道退款接口后再开放。
- **订单幂等**：课程报名和商城结算会携带一次性幂等键；服务端按买家和幂等键唯一约束，网络重试不会重复扣库存或创建订单。
- **待支付订单过期**：Worker 每 5 分钟清理超过 30 分钟未支付的订单，并原子回补已锁定的商品库存。
- **请假**：家长仅能对未开始课次申请；管理员批准后系统预写 LEAVE 考勤。
- **试听预约**：公开表单只保存必要联系信息；提交支持幂等键，管理台处理后状态和备注对登录家长可见。

## ⚠️ 生产上线前必须处理

1. **填写并验证真实微信支付**：Worker 已包含微信支付 V3 JSAPI 下单、回调验签解密和幂等入账适配器，但生产默认仍是 `PAYMENT_MODE=disabled`。申请微信支付商户号，配置商户 API 私钥、商户证书序列号、API v3 密钥、微信支付平台证书和 HTTPS 回调地址，完成沙箱/小额实付验证后再把 Worker 与小程序的 `paymentMode` 同时切换为 `wechat`。退款接口仍需单独接入，未接入前不能把订单标为退款。
2. **关闭开发登录**：Cloudflare 的 `ALLOW_DEV_AUTH=false`、`PAYMENT_MODE=disabled`、`WECHAT_PAY_ENABLED=false`，Fastify 生产环境还要设置 `NODE_ENV=production`。真实支付代码上线后再把支付模式切换为 `wechat` 并按支付实现启用开关。这样 `X-Admin-User-Id` / `X-User-Id`、`devOpenid` 和开发接口都不会作为登录依据。
3. **更换密钥与口令**：`SESSION_SECRET`、数据库密码、默认管理员密码全部重置；密钥只放 Cloudflare Secret 或部署环境变量，不进入小程序包、GitHub 或 Notion。
4. **配置微信登录**：在 Cloudflare `.secrets.json` 填入真实 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 后执行部署；新注册用户默认无角色，家长/教师身份需管理员在后台绑定。
5. **配置线上地址**：在项目根目录 `config/release.json` 中填写 Worker HTTPS 地址 `apiBaseUrl` 和管理端来源 `corsOrigin`，运行 `npm run config:sync` 自动同步到 Cloudflare 和小程序配置；不要填 `127.0.0.1`、`localhost` 或占位符。微信公众平台的 request 合法域名也要填写 Worker 域名。
6. **限制管理端跨域**：`config/release.json` 的 `corsOrigin` 应为实际管理端来源；管理台和 API 同域时可直接填写 Worker 管理台地址。
7. **配置用户隐私保护指引**：在微信公众平台填写并审核《用户隐私保护指引》，小程序仅在用户主动点击头像选择、昵称填写和保存资料时处理这些信息；未授权时仍可浏览公开内容。头像永久地址由 Worker 保存到 R2，`AppSecret` 只保存在 Worker Secret。
7. **生产数据初始化**：先执行远程迁移和 `npm run db:bootstrap-admin:remote`，用 `ADMIN_PASSWORD` 首次登录后立即修改管理员资料/密码，再由管理员在后台创建真实课程、商品、班级和账号；`scripts/seed.sql` 只用于演示环境，不要直接把演示账号当作生产账号。
