import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { Configuration, DashscopeApi } from 'dashscope-sdk-official'

const RUNTIME_ROOT = path.resolve(process.cwd(), 'runtime')
const PUBLISH_ROOT = path.join(RUNTIME_ROOT, 'publish')
const ACCOUNT_ROOT = path.join(PUBLISH_ROOT, 'accounts')
const JOB_ROOT = path.join(PUBLISH_ROOT, 'jobs')
const PROFILE_ROOT = path.join(PUBLISH_ROOT, 'profiles')

const PLATFORM_CONFIG = {
  douyin: {
    key: 'douyin',
    label: '抖音',
    badge: 'DY',
    loginUrl: 'https://www.douyin.com/',
    publishUrl: 'https://creator.douyin.com/creator-micro/content/upload'
  },
  xiaohongshu: {
    key: 'xiaohongshu',
    label: '小红书',
    badge: 'XHS',
    loginUrl: 'https://www.xiaohongshu.com/',
    publishUrl: 'https://creator.xiaohongshu.com/publish/publish'
  }
}

const ACTIVE_BROWSER_SESSIONS = new Map()
const ACTIVE_PUBLISH_TASKS = new Map()

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
}

function getAccountPath(accountId) {
  return path.join(ACCOUNT_ROOT, `${accountId}.json`)
}

function getJobPath(jobId) {
  return path.join(JOB_ROOT, `${jobId}.json`)
}

function getProfilePath(accountId) {
  return path.join(PROFILE_ROOT, accountId)
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim()
}

function normalizePlatform(platform) {
  const key = String(platform || '').trim().toLowerCase()

  if (!PLATFORM_CONFIG[key]) {
    throw new Error('暂不支持该平台')
  }

  return key
}

function ensurePlatform(platform) {
  return PLATFORM_CONFIG[normalizePlatform(platform)]
}

function resolveBrowserExecutablePath() {
  const candidates = [
    process.env.PUBLISH_BROWSER_EXECUTABLE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

async function ensurePublishRuntimeDirs() {
  await Promise.all([
    fs.promises.mkdir(ACCOUNT_ROOT, { recursive: true }),
    fs.promises.mkdir(JOB_ROOT, { recursive: true }),
    fs.promises.mkdir(PROFILE_ROOT, { recursive: true })
  ])
}

async function readJsonFile(filePath) {
  const raw = await fs.promises.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

async function writeJsonFile(filePath, payload) {
  await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

async function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  const entries = await fs.promises.readdir(dirPath)
  return entries.filter((entry) => entry.endsWith('.json'))
}

async function listAccountsRaw() {
  await ensurePublishRuntimeDirs()
  const files = await listFiles(ACCOUNT_ROOT)
  const accounts = await Promise.all(files.map((entry) => readJsonFile(path.join(ACCOUNT_ROOT, entry))))

  return accounts.sort((left, right) => {
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
  })
}

async function listJobsRaw() {
  await ensurePublishRuntimeDirs()
  const files = await listFiles(JOB_ROOT)
  const jobs = await Promise.all(files.map((entry) => readJsonFile(path.join(JOB_ROOT, entry))))

  return jobs.sort((left, right) => {
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
  })
}

async function readAccountRaw(accountId) {
  const filePath = getAccountPath(accountId)

  if (!fs.existsSync(filePath)) {
    throw new Error('未找到该账号')
  }

  return readJsonFile(filePath)
}

async function readJobRaw(jobId) {
  const filePath = getJobPath(jobId)

  if (!fs.existsSync(filePath)) {
    throw new Error('未找到该发布任务')
  }

  return readJsonFile(filePath)
}

async function writeAccountRaw(account) {
  await ensurePublishRuntimeDirs()
  return writeJsonFile(getAccountPath(account.accountId), account)
}

async function writeJobRaw(job) {
  await ensurePublishRuntimeDirs()
  return writeJsonFile(getJobPath(job.jobId), job)
}

function hasSavedBrowserProfile(account) {
  const profileDir = normalizeText(account.profileDir) || getProfilePath(account.accountId)
  return fs.existsSync(profileDir)
}

function resolveAccountStatus(account) {
  if (account.forceNeedUpdate) {
    return 'need_update'
  }

  if (normalizeText(account.cookieText) || account.profileReady) {
    return 'available'
  }

  if (hasSavedBrowserProfile(account)) {
    return 'need_update'
  }

  return 'unavailable'
}

function resolveAccountStatusLabel(status) {
  if (status === 'available') {
    return '可用'
  }

  if (status === 'need_update') {
    return '需更新'
  }

  return '不可用'
}

function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10)
}

function countTodayPublishedJobs(jobs, accountId) {
  const today = getTodayDateKey()

  return jobs.filter((job) => {
    return job.accountId === accountId && String(job.createdAt || '').startsWith(today)
  }).length
}

function resolveCookieSummary(account) {
  const cookieText = normalizeText(account.cookieText)

  if (cookieText) {
    return `已录入 ${cookieText.length} 字符`
  }

  if (account.profileReady && !normalizeText(account.accountName)) {
    return '已保存登录态，待识别账号名'
  }

  if (account.profileReady) {
    return '已保存浏览器登录态'
  }

  if (hasSavedBrowserProfile(account)) {
    return '已创建浏览器会话，待校验'
  }

  return '未录入'
}

function serializeAccount(account, jobs = []) {
  const platform = ensurePlatform(account.platform)
  const status = resolveAccountStatus(account)
  const profileDir = normalizeText(account.profileDir) || getProfilePath(account.accountId)

  return {
    accountId: account.accountId,
    platform: platform.key,
    platformLabel: platform.label,
    platformBadge: platform.badge,
    accountName: account.accountName || '',
    accountRemark: account.accountRemark || '',
    status,
    statusLabel: resolveAccountStatusLabel(status),
    hasCookies: Boolean(normalizeText(account.cookieText) || account.profileReady),
    cookieSummary: resolveCookieSummary(account),
    profileDir,
    todayPublishedCount: countTodayPublishedJobs(jobs, account.accountId),
    lastCheckedAt: account.lastCheckedAt || '',
    lastLoginOpenedAt: account.lastLoginOpenedAt || '',
    lastPublishedAt: account.lastPublishedAt || '',
    lastError: account.lastError || '',
    createdAt: account.createdAt || '',
    updatedAt: account.updatedAt || ''
  }
}

function serializePublishJob(job) {
  const platform = ensurePlatform(job.platform)

  return {
    jobId: job.jobId,
    platform: platform.key,
    platformLabel: platform.label,
    accountId: job.accountId,
    accountName: job.accountName || '',
    status: job.status || 'queued',
    statusLabel: job.statusLabel || '',
    progress: Number(job.progress || 0),
    message: job.message || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    browserOpened: Boolean(job.browserOpened),
    publishUrl: job.publishUrl || '',
    videoPath: job.videoPath || '',
    errorMessage: job.errorMessage || '',
    fingerprint: job.fingerprint || '',
    snapshot: {
      title: job.snapshot?.title || '',
      content: job.snapshot?.content || '',
      tagsText: job.snapshot?.tagsText || ''
    }
  }
}

function getDashscopeClient() {
  const apiKey = normalizeText(process.env.BAILIAN_API_KEY)

  if (!apiKey) {
    throw new Error('未配置百炼 API Key，无法生成发布文案')
  }

  return new DashscopeApi(
    new Configuration({
      apiKey
    })
  )
}

function getPublishModel() {
  return normalizeText(process.env.BAILIAN_REWRITE_MODEL || 'qwen3.7-max')
}

function getPlatformPrompt(platformKey) {
  if (platformKey === 'xiaohongshu') {
    return '你是一个小红书短视频发布助手。请根据给定文案生成适合小红书的标题、正文和标签。语言自然，像真人分享，保留转化意图但不要太硬。'
  }

  return '你是一个抖音短视频发布助手。请根据给定文案生成适合抖音的标题、正文和标签。语言要有钩子感，短句清楚，适合短视频发布。'
}

function buildPublishMessages({ platform, accountName, rewriteRequirement, finalCopy }) {
  const requirement =
    normalizeText(rewriteRequirement) || '无额外改写要求，请按“意思接近、重复率低、篇幅接近原文”的原则生成。'

  return [
    {
      role: 'system',
      content: `${getPlatformPrompt(platform)}
请只输出 JSON，不要输出 Markdown，不要解释。JSON 结构必须是 {"title":"","content":"","tags":["",""]}。`
    },
    {
      role: 'user',
      content: `平台：${ensurePlatform(platform).label}
账号名称：${normalizeText(accountName) || '未命名账号'}
改写要求：${requirement}
最终视频口播文案：${normalizeText(finalCopy)}

要求：
1. title 控制在 22 个字以内。
2. content 生成一段适合平台发布的正文。
3. tags 返回 3 到 6 个标签，数组里不要带 #。
4. 只返回 JSON。`
    }
  ]
}

function extractMessageTextFromContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (typeof item?.text === 'string') {
          return item.text
        }

        return ''
      })
      .join('')
  }

  if (typeof content?.text === 'string') {
    return content.text
  }

  return ''
}

function extractGenerationText(result) {
  const outputText = typeof result?.output?.text === 'string' ? result.output.text : ''

  if (outputText) {
    return outputText
  }

  return extractMessageTextFromContent(result?.output?.choices?.[0]?.message?.content)
}

function safeJsonParse(rawText) {
  const text = normalizeText(rawText)

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)

    if (!match) {
      return null
    }

    return JSON.parse(match[0])
  }
}

export async function generatePublishDraft(payload) {
  const platform = ensurePlatform(payload?.platform)
  const sourceCopy = normalizeText(payload?.sourceCopy)
  const rewrittenCopy = normalizeText(payload?.rewrittenCopy)
  const rewriteRequirement = normalizeText(payload?.rewriteRequirement)
  const finalCopy = rewrittenCopy || sourceCopy

  if (!finalCopy) {
    throw new Error('当前没有可用于发布的视频文案')
  }

  const client = getDashscopeClient()
  const result = await client.createGeneration({
    model: getPublishModel(),
    messages: buildPublishMessages({
      platform: platform.key,
      accountName: normalizeText(payload?.accountName),
      rewriteRequirement,
      finalCopy
    }),
    result_format: 'message',
    temperature: 0.85,
    top_p: 0.9,
    max_tokens: 1024,
    enable_thinking: false
  })

  if (result?.code) {
    throw new Error(result.message || result.code)
  }

  const parsed = safeJsonParse(extractGenerationText(result))

  if (!parsed) {
    throw new Error('发布文案生成成功，但返回结果无法解析为 JSON')
  }

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((item) => normalizeText(item).replace(/^#/, '')).filter(Boolean).slice(0, 6)
    : []

  return {
    title: normalizeText(parsed.title).slice(0, 40),
    content: normalizeText(parsed.content),
    tags,
    tagsText: tags.map((tag) => `#${tag}`).join(' '),
    model: getPublishModel(),
    requestId: result?.request_id || ''
  }
}

function launchExternalBrowser(targetUrl) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn('cmd', ['/c', 'start', '', targetUrl], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })

      child.on('error', (error) => {
        reject(error)
      })

      child.unref()
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}

async function updateJob(jobId, patch) {
  const current = await readJobRaw(jobId)
  const nextJob = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  }

  await writeJobRaw(nextJob)
  return nextJob
}

function buildPublishFingerprint({ platform, accountId, videoPath, title, content }) {
  return crypto
    .createHash('sha1')
    .update([platform, accountId, videoPath, title, content].join('||'))
    .digest('hex')
}

async function findReusablePublishJob(fingerprint) {
  const jobs = await listJobsRaw()
  return (
    jobs.find((job) => {
      return (
        job.fingerprint === fingerprint &&
        ['queued', 'running', 'submitted', 'success'].includes(job.status)
      )
    }) || null
  )
}

async function getSessionPage(session) {
  if (session.page && !session.page.isClosed()) {
    return session.page
  }

  const existingPage = session.context.pages().find((page) => !page.isClosed())
  session.page = existingPage || (await session.context.newPage())
  return session.page
}

async function ensureBrowserSession(account) {
  const existingSession = ACTIVE_BROWSER_SESSIONS.get(account.accountId)

  if (existingSession) {
    const page = await getSessionPage(existingSession)
    await page.bringToFront()
    return {
      ...existingSession,
      page
    }
  }

  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error('未找到可用的 Edge/Chrome 浏览器，无法执行自动发布')
  }

  const profileDir = normalizeText(account.profileDir) || getProfilePath(account.accountId)
  await fs.promises.mkdir(profileDir, { recursive: true })

  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=msWebOOUI,msPdfOOUI'
    ]
  })

  const page = context.pages().find((item) => !item.isClosed()) || (await context.newPage())
  const session = {
    accountId: account.accountId,
    profileDir,
    context,
    page
  }

  context.on('close', () => {
    ACTIVE_BROWSER_SESSIONS.delete(account.accountId)
  })

  ACTIVE_BROWSER_SESSIONS.set(account.accountId, session)
  await page.bringToFront()
  return session
}

async function countPlatformCookies(session, platform) {
  const cookies = await session.context.cookies([platform.loginUrl, platform.publishUrl])
  return cookies.filter((cookie) => {
    const domain = String(cookie.domain || '')
    if (platform.key === 'douyin') {
      return domain.includes('douyin.com')
    }

    return domain.includes('xiaohongshu.com')
  }).length
}

function normalizeDetectedAccountName(value, platform) {
  const text = normalizeText(value).replace(/^@+/, '').replace(/\s+/g, ' ').trim()

  if (!text) {
    return ''
  }

  if (/[=:;{}[\]<>]/.test(text)) {
    return ''
  }

  if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) {
    return ''
  }

  const blocked = new Set([
    platform.label,
    '抖音',
    '小红书',
    '创作者服务中心',
    '创作服务平台',
    'creator',
    'center',
    'portrait',
    'landscape',
    'avatar',
    'default',
    'upload',
    'creatorcenter',
    '发布',
    '上传',
    '活动管理',
    '数据管理',
    '内容管理',
    '评论管理',
    '作品管理',
    '粉丝管理',
    '商品管理',
    '直播管理',
    '达人管理',
    '服务管理',
    '消息',
    '通知',
    '首页',
    '推荐',
    '搜索'
  ])

  if (blocked.has(text) || text.length > 40) {
    return ''
  }

  return text
}

function isLikelyRealAccountName(value, platform) {
  const text = normalizeDetectedAccountName(value, platform)

  if (!text) {
    return false
  }

  if (/管理|服务中心|工作台|活动|数据|内容|作品|评论|商品|直播/.test(text)) {
    return false
  }

  return true
}

function scoreDetectedAccountName(text, platform, selector = '', fieldKey = '') {
  let score = 0

  if (!text) {
    return score
  }

  const selectorText = String(selector || '')
  const isVisibleDomSource =
    selectorText === 'top-area' ||
    selectorText.startsWith('[data-') ||
    selectorText.startsWith('[class*') ||
    selectorText.startsWith('header ') ||
    selectorText.startsWith('aside ') ||
    selectorText.startsWith('[class*="avatar"]')

  if (isVisibleDomSource) {
    score += 10
  } else if (selectorText === 'document.title') {
    score += 2
  } else if (selectorText.startsWith('meta:')) {
    score += 1
  } else if (selectorText.includes(':pattern')) {
    score += 2
  } else if (selectorText.startsWith('localStorage:') || selectorText.startsWith('sessionStorage:')) {
    score += 1
  } else if (selectorText.startsWith('script:')) {
    score -= 6
  }

  const normalizedFieldKey = String(fieldKey || '').toLowerCase()
  if (['nickname', 'nick_name', 'nickname', 'displayname', 'display_name', 'screenname', 'screen_name'].includes(normalizedFieldKey)) {
    score += 14
  } else if (['username', 'user_name', 'accountname', 'account_name', 'authorname', 'author_name'].includes(normalizedFieldKey)) {
    score += 10
  }

  if (text.length >= 2 && text.length <= 20) {
    score += 6
  }

  if (/[\u4e00-\u9fa5A-Za-z0-9_]/.test(text)) {
    score += 4
  }

  if (/官方|旗舰店|直播|穿搭|好物|测评|女装|男装|严选|优选/.test(text)) {
    score += 2
  }

  if (/管理|服务中心|工作台|活动|数据|内容|作品|评论|商品|直播/.test(text)) {
    score -= 10
  }

  if (/^[a-z]+$/.test(text) && !isVisibleDomSource) {
    score -= 12
  }

  if (/^[a-z0-9_-]{2,12}$/.test(text) && !/[\u4e00-\u9fa5]/.test(text) && !isVisibleDomSource) {
    score -= 6
  }

  if (text.includes(platform.label)) {
    score -= 4
  }

  if (/登录|扫码|发布|上传|服务中心|创作|工作台|作者|平台|首页|消息|搜索|草稿|作品/.test(text)) {
    score -= 8
  }

  return score
}

async function extractPlatformAccountName(page, platform) {
  const selectors =
    platform.key === 'douyin'
      ? [
          '[data-e2e*="name"]',
          '[class*="account"] [class*="name"]',
          '[class*="user"] [class*="name"]',
          '[class*="creator"] [class*="name"]',
          'header [class*="name"]',
          'aside [class*="name"]',
          '[class*="avatar"] + div',
          '[class*="avatar"] ~ div'
        ]
      : [
          '[data-testid*="name"]',
          '[class*="account"] [class*="name"]',
          '[class*="user"] [class*="name"]',
          '[class*="creator"] [class*="name"]',
          'header [class*="name"]',
          'aside [class*="name"]',
          '[class*="avatar"] + div',
          '[class*="avatar"] ~ div'
        ]

  const candidates = await page.evaluate((input) => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const pushCandidate = (items, selector, text) => {
      const normalized = String(text || '').replace(/\s+/g, ' ').trim()

      if (!normalized) {
        return
      }

      items.push({
        selector,
        text: normalized
      })
    }

    const items = []

    for (const selector of input.selectors) {
      const elements = Array.from(document.querySelectorAll(selector))

      for (const element of elements) {
        if (!isVisible(element)) {
          continue
        }

        pushCandidate(items, selector, element.textContent || '')
      }
    }

    if (document.title) {
      pushCandidate(items, 'document.title', document.title)
    }

    const metas = Array.from(document.querySelectorAll('meta[property], meta[name]'))

    for (const meta of metas) {
      const key = meta.getAttribute('property') || meta.getAttribute('name') || 'meta'
      pushCandidate(items, `meta:${key}`, meta.getAttribute('content') || '')
    }

    const topAreaElements = Array.from(document.body.querySelectorAll('*')).filter((element) => {
      if (!isVisible(element)) {
        return false
      }

      const rect = element.getBoundingClientRect()
      if (rect.top > 260) {
        return false
      }

      const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || text.length < 2 || text.length > 24) {
        return false
      }

      return true
    })

    for (const element of topAreaElements.slice(0, 120)) {
      pushCandidate(items, 'top-area', element.textContent || '')
    }

    const storages = [
      ['localStorage', window.localStorage],
      ['sessionStorage', window.sessionStorage]
    ]

    for (const [label, storage] of storages) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index)
          const value = key ? storage.getItem(key) : ''

          if (!value || value.length > 5000) {
            continue
          }

          pushCandidate(items, `${label}:${key}`, value)
        }
      } catch {}
    }

    const scripts = Array.from(document.scripts || [])
      .map((script, index) => ({
        selector: `script:${index}`,
        text: (script.textContent || '').slice(0, 20000)
      }))
      .filter((item) => item.text)

    for (const script of scripts) {
      pushCandidate(items, script.selector, script.text)
    }

    return items.slice(0, 220)
  }, { selectors })

  const jsonLikePattern =
    /(?:\"|')?(nickname|nickName|nick_name|userName|user_name|accountName|account_name|displayName|display_name|screenName|screen_name|authorName|author_name)(?:\"|')?[\s:=]+(?:\"|')?([^\"'\n\r,}{]{2,40})/gi

  const expandedCandidates = []

  for (const candidate of candidates) {
    expandedCandidates.push(candidate)

    let match = null
    while ((match = jsonLikePattern.exec(candidate.text))) {
      expandedCandidates.push({
        selector: `${candidate.selector}:pattern`,
        text: match[2],
        fieldKey: match[1]
      })
    }
  }

  const resolved = expandedCandidates
    .map((candidate) => {
      const text = normalizeDetectedAccountName(candidate.text, platform)

      return {
        selector: candidate.selector,
        text,
        fieldKey: candidate.fieldKey || '',
        score: scoreDetectedAccountName(text, platform, candidate.selector, candidate.fieldKey || '')
      }
    })
    .filter((candidate) => candidate.text && candidate.score > 0)
    .sort((left, right) => right.score - left.score)

  for (const candidate of resolved) {
    const text = candidate.text

    if (!text) {
      continue
    }

    if (/登录|扫码|发布|上传|服务中心|创作/.test(text)) {
      continue
    }

    return text
  }

  return ''
}

async function detectPlatformAccountProfile(account) {
  const platform = ensurePlatform(account.platform)
  const session = await ensureBrowserSession(account)
  const page = await getSessionPage(session)
  const candidateUrls =
    platform.key === 'douyin'
      ? [
          platform.loginUrl,
          'https://creator.douyin.com/creator-micro/home',
          platform.publishUrl
        ]
      : [
          platform.loginUrl,
          platform.publishUrl
        ]

  let resolvedAccountName = ''

  for (const url of candidateUrls) {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    })
    await page.waitForTimeout(2500)

    const accountName = await extractPlatformAccountName(page, platform)

    if (isLikelyRealAccountName(accountName, platform)) {
      resolvedAccountName = accountName
      break
    }
  }

  return {
    accountName: resolvedAccountName
  }
}

async function findVisibleLocator(page, selectors, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      const count = await locator.count()

      if (count === 0) {
        continue
      }

      try {
        if (await locator.isVisible()) {
          return locator
        }
      } catch {
        continue
      }
    }

    await page.waitForTimeout(300)
  }

  return null
}

async function clearAndType(page, locator, value) {
  await locator.click({ force: true })
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')

  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase())

  if (tagName === 'input' || tagName === 'textarea') {
    await locator.fill(value)
    return
  }

  await locator.type(value, { delay: 15 })
}

async function uploadVideoFile(page, videoPath) {
  const fileInput = await findVisibleLocator(page, [
    'input[type="file"]',
    '[type="file"]'
  ])

  if (!fileInput) {
    throw new Error('当前页面没有找到可上传视频的文件输入框')
  }

  await fileInput.setInputFiles(videoPath)
}

async function fillTitle(page, title) {
  const locator = await findVisibleLocator(page, [
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    '[contenteditable="true"][data-placeholder*="标题"]'
  ])

  if (!locator) {
    throw new Error('没有找到标题输入框')
  }

  await clearAndType(page, locator, title)
}

async function fillContent(page, content) {
  const locator = await findVisibleLocator(page, [
    'textarea[placeholder*="简介"]',
    'textarea[placeholder*="描述"]',
    'textarea[placeholder*="文案"]',
    '[contenteditable="true"][data-placeholder*="简介"]',
    '[contenteditable="true"][data-placeholder*="描述"]',
    '[contenteditable="true"][placeholder*="简介"]',
    '[contenteditable="true"][placeholder*="描述"]'
  ])

  if (!locator) {
    throw new Error('没有找到正文输入框')
  }

  await clearAndType(page, locator, content)
}

async function clickPublishButton(page) {
  const locator = await findVisibleLocator(page, [
    'button:has-text("发布")',
    'div[role="button"]:has-text("发布")',
    'span:has-text("发布")'
  ])

  if (!locator) {
    throw new Error('没有找到发布按钮')
  }

  await locator.click({ force: true })
}

async function waitForPublishSuccess(page, platformKey) {
  const successSelectors =
    platformKey === 'douyin'
      ? [
          'text=发布成功',
          'text=上传成功',
          'text=作品发布成功',
          'text=处理中'
        ]
      : [
          'text=发布成功',
          'text=笔记发布成功',
          'text=发布中',
          'text=审核中'
        ]

  const locator = await findVisibleLocator(page, successSelectors, 12000)
  return Boolean(locator)
}

async function autofillPublishPage(page, platform, payload) {
  await page.goto(platform.publishUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  })

  await page.waitForTimeout(2500)
  await uploadVideoFile(page, payload.videoPath)
  await page.waitForTimeout(3500)

  if (payload.title) {
    await fillTitle(page, payload.title)
  }

  if (payload.content) {
    await fillContent(page, payload.content)
  }

  await page.waitForTimeout(1000)
  await clickPublishButton(page)
  const success = await waitForPublishSuccess(page, platform.key)

  return {
    success
  }
}

async function verifyAccountSession(account) {
  const platform = ensurePlatform(account.platform)
  const session = await ensureBrowserSession(account)
  const cookieCount = await countPlatformCookies(session, platform)
  const profileReady = cookieCount > 0

  return {
    profileDir: session.profileDir,
    cookieCount,
    profileReady,
    forceNeedUpdate: !profileReady,
    lastError: profileReady ? '' : '浏览器登录态还未就绪，请先在打开的浏览器中完成登录'
  }
}

function splitContentAndTags(rawContent = '') {
  const content = normalizeText(rawContent)
  const tags = content.match(/#[^\s#]+/g) || []
  return {
    content,
    tagsText: tags.join(' ')
  }
}

async function runPublishJob(jobId, payload) {
  const task = (async () => {
    const platform = ensurePlatform(payload.platform)
    const account = await readAccountRaw(payload.accountId)

    try {
      await updateJob(jobId, {
        status: 'running',
        statusLabel: '浏览器启动中',
        progress: 15,
        message: '正在拉起浏览器会话'
      })

      const verification = await verifyAccountSession(account)

      if (!verification.profileReady) {
        await writeAccountRaw({
          ...account,
          profileDir: verification.profileDir,
          profileReady: false,
          forceNeedUpdate: true,
          lastCheckedAt: new Date().toISOString(),
          lastError: verification.lastError,
          updatedAt: new Date().toISOString()
        })

        throw new Error('该账号还没有完成浏览器登录，请先点击“打开登录页”完成登录，再重新发布')
      }

      await updateJob(jobId, {
        status: 'running',
        statusLabel: '准备发布页',
        progress: 38,
        browserOpened: true,
        message: '已连上账号浏览器会话，正在进入发布页'
      })

      const session = await ensureBrowserSession(account)
      const page = await getSessionPage(session)
      await page.bringToFront()

      await updateJob(jobId, {
        status: 'running',
        statusLabel: '自动填充中',
        progress: 60,
        message: '正在上传视频并填写标题、文案、标签'
      })

      const result = await autofillPublishPage(page, platform, payload)

      const nextAccount = {
        ...account,
        profileDir: session.profileDir,
        profileReady: true,
        forceNeedUpdate: false,
        lastCheckedAt: new Date().toISOString(),
        lastPublishedAt: new Date().toISOString(),
        lastError: '',
        updatedAt: new Date().toISOString()
      }

      await writeAccountRaw(nextAccount)

      await updateJob(jobId, {
        status: result.success ? 'success' : 'submitted',
        statusLabel: result.success ? '发布成功' : '已自动点击发布',
        progress: 100,
        browserOpened: true,
        message: result.success
          ? '已完成自动发布'
          : '已自动点击发布按钮，请在浏览器里确认平台最终提示'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const latestAccount = await readAccountRaw(payload.accountId).catch(() => null)

      if (latestAccount) {
        await writeAccountRaw({
          ...latestAccount,
          forceNeedUpdate: /登录/.test(message) ? true : latestAccount.forceNeedUpdate,
          lastError: message,
          updatedAt: new Date().toISOString()
        })
      }

      await updateJob(jobId, {
        status: 'failed',
        statusLabel: '发布失败',
        progress: 100,
        browserOpened: true,
        message: '自动发布失败',
        errorMessage: message
      })
    }
  })()

  ACTIVE_PUBLISH_TASKS.set(jobId, task)
  task.finally(() => {
    ACTIVE_PUBLISH_TASKS.delete(jobId)
  })
}

export async function listPublishPlatforms() {
  const [accounts, jobs] = await Promise.all([listAccountsRaw(), listJobsRaw()])
  const accountsByPlatform = accounts.reduce((map, account) => {
    const key = account.platform
    map[key] = map[key] || []
    map[key].push(serializeAccount(account, jobs))
    return map
  }, {})

  return Object.values(PLATFORM_CONFIG).map((platform) => ({
    ...platform,
    accountCount: (accountsByPlatform[platform.key] || []).length,
    accounts: accountsByPlatform[platform.key] || []
  }))
}

export async function listPlatformAccounts({ platform = '' } = {}) {
  const [items, jobs] = await Promise.all([listAccountsRaw(), listJobsRaw()])
  const filtered = platform ? items.filter((item) => item.platform === normalizePlatform(platform)) : items
  return filtered.map((item) => serializeAccount(item, jobs))
}

export async function savePlatformAccount(payload) {
  const platform = ensurePlatform(payload?.platform)
  const accountId = normalizeText(payload?.accountId) || createId('acct')
  const current = fs.existsSync(getAccountPath(accountId)) ? await readAccountRaw(accountId) : null
  const now = new Date().toISOString()
  const incomingCookies = normalizeText(payload?.cookieText)
  const profileDir = current?.profileDir || getProfilePath(accountId)

  const nextAccount = {
    accountId,
    platform: platform.key,
    accountName: normalizeText(payload?.accountName) || current?.accountName || '',
    accountRemark:
      payload?.accountRemark == null ? current?.accountRemark || '' : normalizeText(payload?.accountRemark),
    cookieText: incomingCookies || current?.cookieText || '',
    profileDir,
    profileReady: current?.profileReady || false,
    forceNeedUpdate: payload?.forceNeedUpdate === true ? true : current?.forceNeedUpdate || false,
    lastCheckedAt: current?.lastCheckedAt || '',
    lastLoginOpenedAt: current?.lastLoginOpenedAt || '',
    lastPublishedAt: current?.lastPublishedAt || '',
    lastError: '',
    createdAt: current?.createdAt || now,
    updatedAt: now
  }

  await writeAccountRaw(nextAccount)
  const jobs = await listJobsRaw()
  return serializeAccount(nextAccount, jobs)
}

export async function deletePlatformAccount(accountId) {
  const filePath = getAccountPath(accountId)

  if (ACTIVE_BROWSER_SESSIONS.has(accountId)) {
    const session = ACTIVE_BROWSER_SESSIONS.get(accountId)
    ACTIVE_BROWSER_SESSIONS.delete(accountId)
    await session?.context?.close?.().catch(() => {})
  }

  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath)
  }
}

export async function checkPlatformAccount(accountId) {
  const account = await readAccountRaw(accountId)
  const verification = await verifyAccountSession(account)
  let detectedProfile = {
    accountName: ''
  }

  if (verification.profileReady) {
    detectedProfile = await detectPlatformAccountProfile(account).catch(() => ({
      accountName: ''
    }))
  }

  const currentAccountName = isLikelyRealAccountName(account.accountName, ensurePlatform(account.platform))
    ? account.accountName
    : ''
  const resolvedAccountName = detectedProfile.accountName || currentAccountName || ''
  const resolvedLastError =
    verification.lastError ||
    (verification.profileReady && !resolvedAccountName ? '已识别登录态，但暂未自动识别到平台账号名，可稍后再检查一次。' : '')

  const nextAccount = {
    ...account,
    accountName: resolvedAccountName,
    profileDir: verification.profileDir,
    profileReady: verification.profileReady,
    forceNeedUpdate: verification.forceNeedUpdate,
    lastCheckedAt: new Date().toISOString(),
    lastError: resolvedLastError,
    updatedAt: new Date().toISOString()
  }

  await writeAccountRaw(nextAccount)
  const jobs = await listJobsRaw()
  return serializeAccount(nextAccount, jobs)
}

export async function openPlatformLogin(payload) {
  const platform = ensurePlatform(payload?.platform)
  let accountId = normalizeText(payload?.accountId)
  let account = null

  if (!accountId) {
    const now = new Date().toISOString()
    accountId = createId('acct')
    account = await writeAccountRaw({
      accountId,
      platform: platform.key,
      accountName: '',
      accountRemark: normalizeText(payload?.accountRemark),
      cookieText: normalizeText(payload?.cookieText),
      profileDir: getProfilePath(accountId),
      profileReady: false,
      forceNeedUpdate: true,
      lastCheckedAt: '',
      lastLoginOpenedAt: now,
      lastPublishedAt: '',
      lastError: '请在浏览器中完成扫码登录，完成后回到这里点“检查状态”识别账号信息。',
      createdAt: now,
      updatedAt: now
    })
  } else {
    account = await readAccountRaw(accountId)
  }

  const session = await ensureBrowserSession(account)
  const page = await getSessionPage(session)
  await page.goto(platform.loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  })
  await page.bringToFront()

  const nextAccount = {
    ...account,
    profileDir: session.profileDir,
    lastLoginOpenedAt: new Date().toISOString(),
    lastError: '请在浏览器中完成扫码登录，完成后回到这里点“检查状态”识别账号信息。',
    updatedAt: new Date().toISOString()
  }

  await writeAccountRaw(nextAccount)
  const jobs = await listJobsRaw()
  return serializeAccount(nextAccount, jobs)
}

export async function listPublishJobs() {
  const jobs = await listJobsRaw()
  return jobs.map(serializePublishJob)
}

export async function getPublishJob(jobId) {
  const job = await readJobRaw(jobId)
  return serializePublishJob(job)
}

export async function submitPublishJob(payload) {
  const platform = ensurePlatform(payload?.platform)
  const accountId = normalizeText(payload?.accountId)
  const videoPath = normalizeText(payload?.videoPath)
  const title = normalizeText(payload?.title)
  const sourceCopy = normalizeText(payload?.sourceCopy)
  const rewrittenCopy = normalizeText(payload?.rewrittenCopy)
  const rewriteRequirement = normalizeText(payload?.rewriteRequirement)
  const contentParts = splitContentAndTags(payload?.content)
  const inputTagsText = normalizeText(payload?.tagsText) || contentParts.tagsText
  const content = contentParts.content
  const finalCopy = rewrittenCopy || sourceCopy

  if (!accountId) {
    throw new Error('请先选择发布账号')
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error('当前没有可发布的视频成片')
  }

  if (!finalCopy) {
    throw new Error('当前没有可用于发布的视频文案')
  }

  const account = await readAccountRaw(accountId)

  if (account.platform !== platform.key) {
    throw new Error('所选账号与平台不匹配')
  }

  let draft = null

  if (!title || !content) {
    draft = await generatePublishDraft({
      platform: platform.key,
      accountName: account.accountName,
      rewriteRequirement,
      sourceCopy,
      rewrittenCopy
    })
  }

  const resolvedTitle = title || draft?.title || ''
  const resolvedContent = content || [draft?.content || '', inputTagsText || draft?.tagsText || ''].filter(Boolean).join('\n')
  const resolvedTagsText = inputTagsText || draft?.tagsText || ''
  const fingerprint = buildPublishFingerprint({
    platform: platform.key,
    accountId,
    videoPath,
    title: resolvedTitle,
    content: resolvedContent
  })

  const reusableJob = await findReusablePublishJob(fingerprint)

  if (reusableJob) {
    return serializePublishJob(reusableJob)
  }

  const now = new Date().toISOString()
  const jobId = createId('publish')
  const snapshot = {
    title: resolvedTitle,
    content: resolvedContent,
    tagsText: resolvedTagsText,
    model: draft?.model || '',
    requestId: draft?.requestId || ''
  }

  const job = await writeJobRaw({
    jobId,
    platform: platform.key,
    accountId,
    accountName: account.accountName,
    status: 'queued',
    statusLabel: '任务排队中',
    progress: 5,
    message: '发布任务已创建，正在准备浏览器自动化',
    createdAt: now,
    updatedAt: now,
    browserOpened: false,
    publishUrl: platform.publishUrl,
    videoPath,
    errorMessage: '',
    fingerprint,
    snapshot
  })

  void runPublishJob(job.jobId, {
    platform: platform.key,
    accountId,
    videoPath,
    title: resolvedTitle,
    content: resolvedContent,
    tagsText: resolvedTagsText
  })

  return serializePublishJob(job)
}
