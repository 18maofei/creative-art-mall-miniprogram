import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const projectRoot = resolve(root, '..')
const failures = []
let secrets = {}

function fail(message) { failures.push(message) }
function hasPlaceholder(value) {
  return !value || /replace|请|your_|example\.com|REPLACE_WITH/i.test(String(value))
}

try {
  const secretsPath = join(root, '.secrets.json')
  await access(secretsPath)
  secrets = JSON.parse(await readFile(secretsPath, 'utf8'))
  for (const name of ['SESSION_SECRET', 'ADMIN_PASSWORD', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET']) {
    if (hasPlaceholder(secrets[name])) fail(`cloudflare/.secrets.json 未填写 ${name}`)
  }
  if (String(secrets.SESSION_SECRET || '').length < 32) fail('SESSION_SECRET 至少需要 32 个字符')
  // 仅用于首个后台账号的引导登录；首次登录后会转为哈希密码，日常改密仍要求至少 12 位。
  if (String(secrets.ADMIN_PASSWORD || '').length < 8) fail('ADMIN_PASSWORD 至少需要 8 个字符')
} catch (error) {
  if (error.code === 'ENOENT') fail('缺少 cloudflare/.secrets.json，请从 .secrets.example.json 复制并填写')
  else if (error instanceof SyntaxError) fail('cloudflare/.secrets.json 不是有效 JSON')
  else fail(`读取 cloudflare/.secrets.json 失败：${error.message}`)
}

const wrangler = await readFile(join(root, 'wrangler.jsonc'), 'utf8')
if (!/"ALLOW_DEV_AUTH"\s*:\s*"false"/.test(wrangler)) fail('wrangler.jsonc 必须保持 ALLOW_DEV_AUTH=false')
const paymentMode = wrangler.match(/"PAYMENT_MODE"\s*:\s*"([^"]*)"/)?.[1]?.toLowerCase() || ''
const wechatPayEnabled = wrangler.match(/"WECHAT_PAY_ENABLED"\s*:\s*"([^"]*)"/)?.[1]?.toLowerCase() || ''
if (!['disabled', 'wechat'].includes(paymentMode)) fail('PAYMENT_MODE 只能是 disabled 或 wechat')
if (paymentMode === 'disabled' && wechatPayEnabled !== 'false') fail('PAYMENT_MODE=disabled 时 WECHAT_PAY_ENABLED 必须为 false')
if (paymentMode === 'wechat') {
  if (wechatPayEnabled !== 'true') fail('PAYMENT_MODE=wechat 时 WECHAT_PAY_ENABLED 必须为 true')
  for (const name of ['WECHAT_PAY_MCH_ID', 'WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_NOTIFY_URL', 'WECHAT_PAY_PLATFORM_CERT_SERIAL', 'WECHAT_PAY_PLATFORM_CERT_PEM']) {
    if (hasPlaceholder(secrets[name])) fail(`cloudflare/.secrets.json 未填写 ${name}`)
  }
  if (String(secrets.WECHAT_PAY_API_V3_KEY || '').length !== 32) fail('WECHAT_PAY_API_V3_KEY 必须为 32 位')
  if (!/^https:\/\//i.test(String(secrets.WECHAT_PAY_NOTIFY_URL || ''))) fail('WECHAT_PAY_NOTIFY_URL 必须使用 HTTPS')
}
const corsOrigin = wrangler.match(/"CORS_ORIGIN"\s*:\s*"([^"]*)"/)?.[1] || ''
if (!/^https:\/\//i.test(corsOrigin) || corsOrigin === '*' || /REPLACE_WITH_YOUR_ADMIN_DOMAIN/i.test(corsOrigin)) fail('wrangler.jsonc 必须填写真实管理端 HTTPS 来源作为 CORS_ORIGIN')

const miniConfig = await readFile(join(projectRoot, 'miniprogram', 'config.js'), 'utf8')
if (!/apiBaseUrl\s*:\s*['"]https:\/\//.test(miniConfig) || /REPLACE_WITH_YOUR_WORKER_DOMAIN/.test(miniConfig)) fail('miniprogram/config.js 必须填写真实 Worker HTTPS 地址')
if (/demoMode\s*:\s*true/.test(miniConfig)) fail('miniprogram/config.js 不能开启 demoMode')
if (/paymentMode\s*:\s*['"]mock['"]/.test(miniConfig)) fail('miniprogram/config.js 不能使用 mock 支付')
const miniPaymentMode = miniConfig.match(/paymentMode\s*:\s*['"]([^'"]*)['"]/)?.[1]?.toLowerCase() || 'disabled'
if (miniPaymentMode !== paymentMode) fail(`miniprogram/config.js 的 paymentMode (${miniPaymentMode}) 必须与 wrangler.jsonc (${paymentMode}) 一致`)

const projectConfig = await readFile(join(projectRoot, 'project.config.json'), 'utf8')
try {
  if (JSON.parse(projectConfig).setting?.urlCheck !== true) fail('project.config.json 必须开启 setting.urlCheck')
} catch {
  fail('project.config.json 不是有效 JSON')
}

if (failures.length) {
  console.error('生产发布检查未通过：')
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}

console.log('生产发布检查通过：密钥、开发开关、支付模式、CORS 和小程序 HTTPS 地址均已配置。')
