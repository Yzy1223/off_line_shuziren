import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './command.js'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi'])
const MEDIACRAWLER_RUNTIME_LIBS = ['stealth.min.js', 'douyin.js']
const MEDIACRAWLER_PROFILE_KEY = 'download-default'
const MEDIACRAWLER_LOCK_FILE_NAMES = ['LOCK', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']
const PYTHON_CANDIDATES = [
  process.env.MEDIACRAWLER_PYTHON,
  process.env.YTDLP_PYTHON,
  'D:\\conda\\envs\\mediacrawler\\python.exe',
  'D:\\conda\\python.exe',
  'python'
].filter(Boolean)

function buildRuntimePath(...parts) {
  return path.resolve(process.cwd(), 'runtime', ...parts)
}

function isExistingVideoFile(filePath) {
  const ext = path.extname(filePath || '').toLowerCase()
  return VIDEO_EXTENSIONS.has(ext) && fs.existsSync(filePath)
}

function toTimestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
}

function asBoolean(value, fallback = false) {
  if (value == null || value === '') {
    return fallback
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase())
}

function findAvailablePython() {
  return PYTHON_CANDIDATES.find((candidate) => candidate === 'python' || fs.existsSync(candidate)) || ''
}

function getMediaCrawlerRoot() {
  const root = String(process.env.MEDIACRAWLER_ROOT || 'D:\\WIKI\\tools\\MediaCrawler').trim()
  return root && fs.existsSync(root) ? root : ''
}

function getMediaCrawlerRuntimeDir() {
  return buildRuntimePath('mediacrawler', 'profiles', MEDIACRAWLER_PROFILE_KEY)
}

function getMediaCrawlerBrowserDataDir(runtimeDir) {
  return path.join(runtimeDir, 'browser_data')
}

async function copyIfNeeded(sourcePath, targetPath) {
  const sourceStat = await fs.promises.stat(sourcePath)
  let shouldCopy = true

  try {
    const targetStat = await fs.promises.stat(targetPath)
    shouldCopy = targetStat.size !== sourceStat.size || targetStat.mtimeMs < sourceStat.mtimeMs
  } catch {
    shouldCopy = true
  }

  if (shouldCopy) {
    await fs.promises.copyFile(sourcePath, targetPath)
  }
}

async function ensureMediaCrawlerRuntime(root) {
  const runtimeDir = getMediaCrawlerRuntimeDir()
  const libsDir = path.join(runtimeDir, 'libs')

  await fs.promises.mkdir(libsDir, { recursive: true })

  await Promise.all(
    MEDIACRAWLER_RUNTIME_LIBS.map(async (fileName) => {
      const sourcePath = path.join(root, 'libs', fileName)
      const targetPath = path.join(libsDir, fileName)

      if (!fs.existsSync(sourcePath)) {
        throw new Error(`MediaCrawler runtime dependency missing: ${sourcePath}`)
      }

      await copyIfNeeded(sourcePath, targetPath)
    })
  )

  return runtimeDir
}

async function cleanupMediaCrawlerLocks(runtimeDir) {
  const browserDataDir = getMediaCrawlerBrowserDataDir(runtimeDir)

  if (!fs.existsSync(browserDataDir)) {
    return
  }

  const candidates = [
    browserDataDir,
    path.join(browserDataDir, 'dy_user_data_dir'),
    path.join(browserDataDir, 'dy_user_data_dir', 'Default')
  ]

  for (const targetDir of candidates) {
    if (!fs.existsSync(targetDir)) {
      continue
    }

    for (const fileName of MEDIACRAWLER_LOCK_FILE_NAMES) {
      const lockPath = path.join(targetDir, fileName)

      try {
        await fs.promises.unlink(lockPath)
      } catch {
        continue
      }
    }
  }
}

function shouldResetPersistentProfile(message) {
  return /ProcessSingleton|Lock file can not be created|Crashpad|TargetClosedError|Connection closed while reading from the driver|拒绝访问|Access is denied/i.test(
    String(message || '')
  )
}

async function resetMediaCrawlerProfile(runtimeDir) {
  const browserDataDir = getMediaCrawlerBrowserDataDir(runtimeDir)

  if (!fs.existsSync(browserDataDir)) {
    return ''
  }

  const backupDir = `${browserDataDir}-backup-${toTimestampId()}`
  await fs.promises.rename(browserDataDir, backupDir)
  return backupDir
}

function hasPersistentProfile(runtimeDir) {
  return fs.existsSync(path.join(getMediaCrawlerBrowserDataDir(runtimeDir), 'dy_user_data_dir'))
}

function listVideoFilesRecursive(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return []
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      files.push(...listVideoFilesRecursive(fullPath))
      continue
    }

    if (isExistingVideoFile(fullPath)) {
      files.push(fullPath)
    }
  }

  return files
}

function resolveNewestVideoFile(targetDir) {
  const files = listVideoFilesRecursive(targetDir)

  if (files.length === 0) {
    return ''
  }

  return files
    .map((filePath) => ({
      filePath,
      mtimeMs: fs.statSync(filePath).mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || ''
}

export function parseDouyinShareText(input) {
  const text = String(input || '').trim()
  const urls = text.match(/https?:\/\/[^\s]+/gi) || []
  const shortUrl = urls[0] || ''
  const localPath = text.replace(/^["']|["']$/g, '')

  return {
    rawText: text,
    shortUrl,
    urls,
    localPath: isExistingVideoFile(localPath) ? localPath : '',
    mode: shortUrl ? 'share-url' : 'local-file',
    notes: [
      '优先使用 MediaCrawler 下载抖音视频到本地。',
      '下载链路会复用项目内持久化浏览器登录态。'
    ]
  }
}

export async function ensureCreativeRuntimeDirs() {
  const dirs = [
    buildRuntimePath('downloads'),
    buildRuntimePath('audio'),
    buildRuntimePath('transcripts')
  ]

  await Promise.all(dirs.map((dir) => fs.promises.mkdir(dir, { recursive: true })))

  return {
    downloadsDir: dirs[0],
    audioDir: dirs[1],
    transcriptsDir: dirs[2]
  }
}

function normalizeCommandOutput(stdout, stderr = '') {
  return `${stdout || ''}\n${stderr || ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildYtDlpAttempts(sharedArgs) {
  const attempts = []
  const cookieFile = String(process.env.DOUYIN_COOKIES_FILE || '').trim()
  const browser = String(process.env.DOUYIN_COOKIE_BROWSER || '').trim()

  if (cookieFile) {
    attempts.push({
      name: 'cookies-file',
      args: ['--cookies', cookieFile, ...sharedArgs]
    })
  }

  if (browser) {
    attempts.push({
      name: `browser:${browser}`,
      args: ['--cookies-from-browser', browser, ...sharedArgs]
    })
  }

  if (!browser) {
    attempts.push({
      name: 'edge-cookies',
      args: ['--cookies-from-browser', 'edge', ...sharedArgs]
    })
    attempts.push({
      name: 'chrome-cookies',
      args: ['--cookies-from-browser', 'chrome', ...sharedArgs]
    })
  }

  attempts.push({
    name: 'plain',
    args: sharedArgs
  })

  return attempts
}

function resolveVideoPathFromOutput(lines) {
  for (const line of [...lines].reverse()) {
    if (isExistingVideoFile(line)) {
      return line
    }
  }

  return ''
}

async function downloadWithYtDlp(args) {
  const pythonCommand = findAvailablePython()

  if (!pythonCommand) {
    throw new Error('No available Python interpreter found for yt-dlp.')
  }

  try {
    return await runCommand(pythonCommand, ['-m', 'yt_dlp', ...args], {
      timeoutMs: 600000
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (/No module named yt_dlp/i.test(message)) {
      throw new Error('yt-dlp is not installed in the current Python environment.')
    }

    throw error
  }
}

function buildMediaCrawlerArgs({ scriptPath, shareUrl, saveDir, loginType, cookies, headless }) {
  const args = [
    scriptPath,
    '--platform',
    'dy',
    '--lt',
    loginType,
    '--type',
    'detail',
    '--headless',
    headless ? 'true' : 'false',
    '--save_data_option',
    'jsonl',
    '--save_data_path',
    saveDir,
    '--get_comment',
    'false',
    '--get_sub_comment',
    'false',
    '--crawler_max_notes_count',
    '1',
    '--max_concurrency_num',
    '1',
    '--specified_id',
    shareUrl
  ]

  if (loginType === 'cookie') {
    if (!cookies) {
      throw new Error('MEDIACRAWLER_COOKIES is empty while login type is cookie.')
    }

    args.push('--cookies', cookies)
  }

  return args
}

async function runMediaCrawlerAttempt({
  pythonCommand,
  scriptPath,
  runtimeDir,
  shareUrl,
  saveDir,
  loginType,
  cookies,
  headless
}) {
  await cleanupMediaCrawlerLocks(runtimeDir)

  const result = await runCommand(
    pythonCommand,
    buildMediaCrawlerArgs({
      scriptPath,
      shareUrl,
      saveDir,
      loginType,
      cookies,
      headless
    }),
    {
      cwd: runtimeDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || '1',
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '1',
        MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || '1'
      },
      timeoutMs: 1200000
    }
  )

  const logs = normalizeCommandOutput(result.stdout, result.stderr)
  const videoPath = resolveNewestVideoFile(saveDir)

  if (!videoPath) {
    throw new Error('MediaCrawler finished without producing a video file.')
  }

  return {
    mode: `mediacrawler:${loginType}${headless ? ':headless' : ':headed'}`,
    videoPath,
    downloaderLogs: logs
  }
}

async function downloadWithMediaCrawler(shareUrl, downloadsDir) {
  const root = getMediaCrawlerRoot()
  const pythonCommand = findAvailablePython()

  if (!root) {
    throw new Error('MediaCrawler root directory was not found.')
  }

  if (!pythonCommand) {
    throw new Error('No available Python interpreter found for MediaCrawler.')
  }

  const runtimeDir = await ensureMediaCrawlerRuntime(root)
  const cookies = String(process.env.MEDIACRAWLER_COOKIES || '').trim()
  const scriptPath = path.join(root, 'main.py')
  const saveDir = path.join(downloadsDir, 'mediacrawler', toTimestampId())
  const preferredHeadless = asBoolean(process.env.MEDIACRAWLER_HEADLESS, false)
  const loginPlan = []
  const errors = []
  let profileReset = false

  if (cookies) {
    loginPlan.push({
      loginType: 'cookie',
      headlessAttempts: preferredHeadless ? [true, false] : [false]
    })
  }

  loginPlan.push({
    loginType: 'qrcode',
    headlessAttempts: [false]
  })

  await fs.promises.mkdir(saveDir, { recursive: true })

  for (const plan of loginPlan) {
    for (const headless of plan.headlessAttempts) {
      try {
        return await runMediaCrawlerAttempt({
          pythonCommand,
          scriptPath,
          runtimeDir,
          shareUrl,
          saveDir,
          loginType: plan.loginType,
          cookies,
          headless
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${plan.loginType}:headless=${headless}: ${message}`)

        if (!profileReset && shouldResetPersistentProfile(message)) {
          profileReset = true
          await resetMediaCrawlerProfile(runtimeDir)
          await ensureMediaCrawlerRuntime(root)
        }
      }
    }
  }

  throw new Error(errors.join(' | '))
}

export async function acquireVideoFromInput(input) {
  const parsed = parseDouyinShareText(input)
  const { downloadsDir } = await ensureCreativeRuntimeDirs()

  if (parsed.localPath) {
    return {
      mode: 'local-file',
      parsed,
      sourceUrl: '',
      videoPath: parsed.localPath,
      downloaderLogs: []
    }
  }

  if (!parsed.shortUrl) {
    throw new Error('Please provide a valid Douyin share link or a local video path.')
  }

  const errors = []
  const mediaCrawlerEnabled = asBoolean(process.env.MEDIACRAWLER_ENABLED, true)

  if (mediaCrawlerEnabled && getMediaCrawlerRoot()) {
    try {
      const mediaCrawlerResult = await downloadWithMediaCrawler(parsed.shortUrl, downloadsDir)

      return {
        mode: mediaCrawlerResult.mode,
        parsed,
        sourceUrl: parsed.shortUrl,
        videoPath: mediaCrawlerResult.videoPath,
        downloaderLogs: mediaCrawlerResult.downloaderLogs
      }
    } catch (error) {
      errors.push(`MediaCrawler: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const stamp = toTimestampId()
  const outputTemplate = path.join(downloadsDir, `${stamp}-%(id)s.%(ext)s`)
  const sharedArgs = [
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '--merge-output-format',
    'mp4',
    '--print',
    'after_move:filepath',
    '--output',
    outputTemplate,
    parsed.shortUrl
  ]

  const attempts = buildYtDlpAttempts(sharedArgs)

  for (const attempt of attempts) {
    try {
      const result = await downloadWithYtDlp(attempt.args)
      const lines = normalizeCommandOutput(result.stdout, result.stderr)
      const videoPath = resolveVideoPathFromOutput(lines)

      if (!videoPath) {
        throw new Error('yt-dlp finished without producing a video file.')
      }

      return {
        mode: `yt-dlp:${attempt.name}`,
        parsed,
        sourceUrl: parsed.shortUrl,
        videoPath,
        downloaderLogs: lines
      }
    } catch (error) {
      errors.push(`yt-dlp(${attempt.name}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`Douyin video download failed. ${errors.join(' | ')}`)
}
