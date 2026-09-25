import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cloudflareRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const projectRoot = resolve(cloudflareRoot, '..')
const configPath = join(projectRoot, 'config', 'release.json')
const wranglerPath = join(cloudflareRoot, 'wrangler.jsonc')
const miniConfigPath = join(projectRoot, 'miniprogram', 'config.js')

function requiredString(config, name) {
  const value = String(config[name] ?? '').trim()
  if (!value) throw new Error(`config/release.json 缺少 ${name}`)
  return value.replace(/\/+$/, '')
}

const config = JSON.parse(await readFile(configPath, 'utf8'))
const publicConfig = {
  apiBaseUrl: requiredString(config, 'apiBaseUrl'),
  corsOrigin: requiredString(config, 'corsOrigin'),
  institutionName: requiredString(config, 'institutionName'),
  allowDevAuth: config.allowDevAuth === true,
  paymentMode: String(config.paymentMode || 'disabled').toLowerCase(),
  wechatPayEnabled: config.wechatPayEnabled === true,
  demoMode: config.demoMode === true,
  allowInsecureHttp: config.allowInsecureHttp === true
}

if (!['disabled', 'wechat'].includes(publicConfig.paymentMode)) {
  throw new Error('config/release.json 的 paymentMode 只能是 disabled 或 wechat')
}

const wrangler = JSON.parse(await readFile(wranglerPath, 'utf8'))
wrangler.vars = {
  ...(wrangler.vars || {}),
  ALLOW_DEV_AUTH: String(publicConfig.allowDevAuth),
  PAYMENT_MODE: publicConfig.paymentMode,
  WECHAT_PAY_ENABLED: String(publicConfig.wechatPayEnabled),
  CORS_ORIGIN: publicConfig.corsOrigin,
  INSTITUTION_NAME: publicConfig.institutionName
}
await writeFile(wranglerPath, `${JSON.stringify(wrangler, null, 2)}\n`, 'utf8')

const miniConfig = `/**\n * 此文件由 config/release.json 自动生成。请修改集中配置后运行 npm run config:sync。\n * 这里只包含会进入小程序包的公开参数，禁止放入 AppSecret、支付私钥等凭据。\n */\nmodule.exports = {
  apiBaseUrl: ${JSON.stringify(publicConfig.apiBaseUrl)},
  institutionName: ${JSON.stringify(publicConfig.institutionName)},
  demoMode: ${String(publicConfig.demoMode)},
  allowInsecureHttp: ${String(publicConfig.allowInsecureHttp)},
  paymentMode: ${JSON.stringify(publicConfig.paymentMode)}
}\n`
await writeFile(miniConfigPath, miniConfig, 'utf8')

console.log('已同步 config/release.json -> cloudflare/wrangler.jsonc、miniprogram/config.js')
