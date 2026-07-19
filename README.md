# 拾色画室小程序

基于提供的“知行成长中心”原型实现的微信原生小程序第一版，包含访客课程/商城、家长课时与排课、教师考勤扣课演示，以及轻量 Node.js 后端骨架。

## 为什么选 Node.js

- 小程序 API、管理后台和后端可统一使用 JavaScript/TypeScript，开发和维护成本低。
- Fastify 比传统大型 Java 框架更适合 `2核2G` 的第一期单体部署。
- 生产环境使用 MySQL 保存用户、课时流水、订单和考勤；课时扣减必须在数据库事务中执行。

建议上线技术栈：`Node.js 24 + Fastify + MySQL 8 + Nginx + 对象存储`。不要把商品图片、孩子作品图放在服务器本地。

## 当前实现

- 访客：首页、课程报名、周边商城、个人服务入口。
- 家长：下一节课、课时余额、课表、请假与课程反馈演示。
- 教师：学生考勤切换、请假不扣课、出勤扣课演示。
- 后端：健康检查、初始化数据、订单创建和考勤扣课接口。

## 项目结构

```text
miniprogram/              微信原生小程序源码
  pages/                  首页、课程、商城、家长、教师、个人中心
  services/api.js         本地模拟数据与后端请求开关
backend/                  Fastify 后端
  src/server.js           API 入口
docs/mysql-schema.sql     课时流水 MySQL 表设计
project.config.json       微信开发者工具项目配置
```

## 在微信开发者工具运行

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本目录：`E:\小程序\创意商城小程序`。
3. AppID 暂时可选择测试号；机构完成注册后，在 `project.config.json` 中替换为真实 AppID。
4. 编译后可从首页进入课程、商城、家长和教师入口。第一版使用本地模拟数据，不依赖后端即可预览。

## 启动后端

```powershell
cd E:\小程序\创意商城小程序\backend
npm.cmd install
npm.cmd run dev
```

健康检查：`http://127.0.0.1:3000/health`。

当前已提供的接口：

- `GET /health`：服务健康检查。
- `GET /api/bootstrap`：演示数据。
- `POST /api/attendance/confirm`：确认考勤并生成扣课流水。
- `POST /api/orders`：创建待支付订单。

## 演示模式与生产模式

当前 `miniprogram/app.js` 中的 `demoMode` 为 `true`，因此微信开发者工具可直接预览，不会请求后端。正式联调时将其改为 `false`，并把 `apiBaseUrl` 改为实际已备案的 HTTPS 域名。

待服务器和域名准备后，将 `miniprogram/app.js` 的 `demoMode` 改为 `false`，并填写已备案 HTTPS 域名；再在小程序后台配置“request 合法域名”。

## 还不能直接上线的外部能力

- 微信登录：需要真实 AppID 和后端 `code2Session` 接口。
- 小程序订阅消息：需要模板与家长授权。
- 微信支付：需要同主体商户号、证书和支付回调接口。
- 图片上传：需要对象存储 Bucket 与上传授权接口。
- 生产数据库：按 `docs/mysql-schema.sql` 扩展表结构并完成迁移。
