import axios from 'axios'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { extractAudioFromVideo, normalizeVideoToH264 } from './media.js'

const RUNTIME_ROOT = path.resolve(process.cwd(), 'runtime')
const AVATAR_ASSET_ROOT = path.join(RUNTIME_ROOT, 'avatar-assets')
const AVATAR_OUTPUT_ROOT = path.join(RUNTIME_ROOT, 'generated')
const AVATAR_JOB_ROOT = path.join(RUNTIME_ROOT, 'avatar-jobs')
const LOCAL_TTS_BASE_URL = String(process.env.LOCAL_TTS_BASE_URL || 'http://127.0.0.1:18180').trim()
const LOCAL_AVATAR_BASE_URL = String(process.env.LOCAL_AVATAR_BASE_URL || 'http://127.0.0.1:8383/easy').trim()
const LOCAL_TTS_DATA_ROOT = path.resolve(
  String(process.env.LOCAL_TTS_DATA_ROOT || 'D:\\duix_avatar_data\\voice\\data').trim()
)
const LOCAL_TTS_TRAIN_ROOT = path.join(LOCAL_TTS_DATA_ROOT, 'origin_audio')
const LOCAL_FACE2FACE_TEMP_ROOT = path.resolve(
  String(process.env.LOCAL_FACE2FACE_TEMP_ROOT || 'D:\\duix_avatar_data\\face2face\\temp').trim()
)
const AVATAR_POLL_INTERVAL_MS = Number(process.env.LOCAL_AVATAR_POLL_INTERVAL_MS || 3000)
const AVATAR_POLL_TIMEOUT_MS = Number(process.env.LOCAL_AVATAR_POLL_TIMEOUT_MS || 1800000)
const REUSABLE_JOB_STATUSES = new Set(['queued', 'processing', 'finalizing', 'success'])

function getAssetDir(digitalHumanId) {
  return path.join(AVATAR_ASSET_ROOT, digitalHumanId)
}

function getManifestPath(digitalHumanId) {
  return path.join(getAssetDir(digitalHumanId), 'manifest.json')
}

function getJobPath(jobId) {
  return path.join(AVATAR_JOB_ROOT, `${jobId}.json`)
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`
}

function sanitizeName(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')

  return normalized.slice(0, 60) || fallback
}

function sanitizeFileName(value, fallbackExt = '.mp4') {
  const original = String(value || '').trim()
  const parsed = path.parse(original || `upload${fallbackExt}`)
  const safeName = sanitizeName(parsed.name, 'upload')
  const ext = parsed.ext || fallbackExt
  return `${safeName}${ext}`
}

function ensureBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value)
  }

  return Buffer.alloc(0)
}

function ensureScriptText(value) {
  return String(value || '').trim()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toRuntimeUrl(absolutePath) {
  if (!absolutePath) {
    return ''
  }

  const relativePath = path.relative(RUNTIME_ROOT, absolutePath)

  if (!relativePath || relativePath.startsWith('..')) {
    return ''
  }

  return `/runtime/${relativePath.replace(/\\/g, '/')}`
}

async function ensureAvatarRuntimeDirs() {
  await Promise.all([
    fs.promises.mkdir(AVATAR_ASSET_ROOT, { recursive: true }),
    fs.promises.mkdir(AVATAR_OUTPUT_ROOT, { recursive: true }),
    fs.promises.mkdir(AVATAR_JOB_ROOT, { recursive: true }),
    fs.promises.mkdir(LOCAL_TTS_TRAIN_ROOT, { recursive: true }),
    fs.promises.mkdir(LOCAL_FACE2FACE_TEMP_ROOT, { recursive: true })
  ])
}

async function readJsonFile(targetPath) {
  const raw = await fs.promises.readFile(targetPath, 'utf8')
  return JSON.parse(raw)
}

async function readDigitalHumanAsset(digitalHumanId) {
  const manifestPath = getManifestPath(digitalHumanId)

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`没有找到数字人资产：${digitalHumanId}`)
  }

  return readJsonFile(manifestPath)
}

async function writeDigitalHumanAsset(asset) {
  const manifestPath = getManifestPath(asset.id)
  const nextAsset = {
    ...asset,
    updatedAt: new Date().toISOString()
  }

  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.promises.writeFile(manifestPath, JSON.stringify(nextAsset, null, 2), 'utf8')

  return nextAsset
}

function serializeDigitalHumanAsset(asset) {
  return {
    digitalHumanId: asset.id,
    name: asset.name,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    sourceFileName: asset.sourceFileName || '',
    trainingVideoPreviewUrl: toRuntimeUrl(asset.previewVideoPath),
    trainingVideoPath: asset.previewVideoPath || '',
    referenceAudioPath: asset.referenceAudioAbsolutePath || '',
    referenceText: asset.referenceText || '',
    ttsReferenceAudio: asset.ttsReferenceAudio || '',
    face2faceVideoFileName: asset.face2faceVideoFileName || '',
    errorMessage: asset.errorMessage || '',
    preprocessStatus: asset.preprocessStatus || 'unknown',
    preprocessMessage: asset.preprocessMessage || ''
  }
}

function serializeAvatarJob(job) {
  return {
    jobId: job.jobId,
    digitalHumanId: job.digitalHumanId,
    digitalHumanName: job.digitalHumanName || '',
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    taskCode: job.taskCode || '',
    outputVideoPath: job.outputVideoPath || '',
    outputVideoUrl: toRuntimeUrl(job.outputVideoPath),
    audioPath: job.audioPath || '',
    sourceScriptPath: job.sourceScriptPath || '',
    errorMessage: job.errorMessage || ''
  }
}

function getAssetSortTime(asset) {
  return new Date(asset.updatedAt || asset.createdAt || 0).getTime()
}

function getAssetDedupKey(asset) {
  const name = String(asset?.name || '').trim()
  return name ? `name:${name}` : `id:${String(asset?.digitalHumanId || '').trim()}`
}

function getJobSortTime(job) {
  return new Date(job.updatedAt || job.createdAt || 0).getTime()
}

async function writeAvatarJob(job) {
  const jobPath = getJobPath(job.jobId)
  const nextJob = {
    ...job,
    updatedAt: new Date().toISOString()
  }

  await fs.promises.mkdir(path.dirname(jobPath), { recursive: true })
  await fs.promises.writeFile(jobPath, JSON.stringify(nextJob, null, 2), 'utf8')

  return nextJob
}

async function readAvatarJob(jobId) {
  const jobPath = getJobPath(jobId)

  if (!fs.existsSync(jobPath)) {
    throw new Error(`没有找到生成任务：${jobId}`)
  }

  return readJsonFile(jobPath)
}

async function updateAvatarJob(jobId, patch) {
  const current = await readAvatarJob(jobId)
  return writeAvatarJob({
    ...current,
    ...patch
  })
}

export async function getAvatarJob(jobId) {
  const job = await readAvatarJob(jobId)
  return serializeAvatarJob(job)
}

async function listAvatarJobsRaw() {
  await ensureAvatarRuntimeDirs()

  const entries = await fs.promises.readdir(AVATAR_JOB_ROOT, { withFileTypes: true })
  const jobs = []

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
      continue
    }

    const jobPath = path.join(AVATAR_JOB_ROOT, entry.name)

    try {
      const job = await readJsonFile(jobPath)
      jobs.push(job)
    } catch (error) {
      continue
    }
  }

  return jobs.sort((left, right) => getJobSortTime(right) - getJobSortTime(left))
}

async function findReusableAvatarJob({ digitalHumanId, scriptText }) {
  const jobs = await listAvatarJobsRaw()

  for (const job of jobs) {
    if (job.digitalHumanId !== digitalHumanId) {
      continue
    }

    if (ensureScriptText(job.scriptText) !== scriptText) {
      continue
    }

    if (!REUSABLE_JOB_STATUSES.has(job.status)) {
      continue
    }

    if (job.status === 'success') {
      if (!job.outputVideoPath || !fs.existsSync(job.outputVideoPath)) {
        continue
      }
    }

    return job
  }

  return null
}

export async function listDigitalHumanAssets() {
  await ensureAvatarRuntimeDirs()

  const entries = await fs.promises.readdir(AVATAR_ASSET_ROOT, { withFileTypes: true })
  const assets = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const manifestPath = path.join(AVATAR_ASSET_ROOT, entry.name, 'manifest.json')

    if (!fs.existsSync(manifestPath)) {
      continue
    }

    try {
      const manifest = await readJsonFile(manifestPath)
      assets.push(serializeDigitalHumanAsset(manifest))
    } catch (error) {
      continue
    }
  }

  const sortedAssets = assets.sort((left, right) => {
    return getAssetSortTime(right) - getAssetSortTime(left)
  })

  const latestAssetsByName = new Map()

  for (const asset of sortedAssets) {
    const key = getAssetDedupKey(asset)

    if (!latestAssetsByName.has(key)) {
      latestAssetsByName.set(key, asset)
    }
  }

  return Array.from(latestAssetsByName.values())
}

async function callTtsPreprocess({ relativeAudioPath, format = 'wav', lang = 'zh' }) {
  const { data } = await axios.post(`${LOCAL_TTS_BASE_URL}/v1/preprocess_and_tran`, {
    format,
    reference_audio: relativeAudioPath.replace(/\\/g, '/'),
    lang
  })

  if (data?.code !== 0) {
    throw new Error(data?.msg || 'TTS 参考音频预处理失败')
  }

  if (!data?.asr_format_audio_url) {
    throw new Error('TTS 参考音频预处理成功，但没有返回可复用的 reference_audio')
  }

  if (!String(data?.reference_audio_text || '').trim()) {
    throw new Error('TTS reference_text is missing after preprocess_and_tran')
  }

  return data
}

async function synthesizeAudioByDigitalHuman({ asset, text, taskId }) {
  const audioFileName = `${taskId}.wav`
  const externalAudioPath = path.join(LOCAL_FACE2FACE_TEMP_ROOT, audioFileName)

  const { data } = await axios.post(
    `${LOCAL_TTS_BASE_URL}/v1/invoke`,
    {
      speaker: crypto.randomUUID(),
      text,
      format: 'wav',
      reference_audio: asset.ttsReferenceAudio,
      reference_text: asset.referenceText,
      topP: 0.7,
      max_new_tokens: 1024,
      chunk_length: 100,
      repetition_penalty: 1.2,
      temperature: 0.7,
      need_asr: false,
      streaming: false,
      is_fixed_seed: 0,
      is_norm: 1
    },
    {
      responseType: 'arraybuffer',
      timeout: 1800000
    }
  )

  await fs.promises.writeFile(externalAudioPath, Buffer.from(data))

  return {
    audioFileName,
    externalAudioPath
  }
}

async function submitFace2FaceTask({ audioFileName, videoFileName, taskCode }) {
  const { data } = await axios.post(
    `${LOCAL_AVATAR_BASE_URL}/submit`,
    {
      audio_url: audioFileName,
      video_url: videoFileName,
      code: taskCode,
      chaofen: 0,
      watermark_switch: 0,
      pn: 1
    },
    {
      timeout: 1800000
    }
  )

  if (data?.code !== 10000) {
    throw new Error(data?.msg || '数字人视频任务提交失败')
  }

  return data
}

async function queryFace2FaceTask(taskCode) {
  const { data } = await axios.get(`${LOCAL_AVATAR_BASE_URL}/query`, {
    params: {
      code: taskCode
    },
    timeout: 1800000
  })

  return data
}

function resolveFace2FaceOutputPath(resultFilePath) {
  if (!resultFilePath) {
    throw new Error('数字人服务没有返回输出文件路径')
  }

  const rawPath = String(resultFilePath).trim()

  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
    return rawPath
  }

  const normalizedRelativePath = rawPath.replace(/^[/\\]+/, '')
  const tempCandidatePath = path.join(LOCAL_FACE2FACE_TEMP_ROOT, normalizedRelativePath)

  if (fs.existsSync(tempCandidatePath)) {
    return tempCandidatePath
  }

  const basenameCandidatePath = path.join(LOCAL_FACE2FACE_TEMP_ROOT, path.basename(normalizedRelativePath))

  if (fs.existsSync(basenameCandidatePath)) {
    return basenameCandidatePath
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath
  }

  return tempCandidatePath
}

async function pollFace2FaceUntilDone({ jobId, taskCode }) {
  const deadline = Date.now() + AVATAR_POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const statusResult = await queryFace2FaceTask(taskCode)

    if ([9999, 10002, 10003].includes(statusResult?.code)) {
      throw new Error(statusResult?.msg || '数字人服务返回失败状态')
    }

    if (statusResult?.code === 10000) {
      const taskState = Number(statusResult?.data?.status || 0)
      const rawProgress = Number(statusResult?.data?.progress || 0)
      const progress = Number.isFinite(rawProgress) ? Math.max(20, Math.min(99, rawProgress)) : 20
      const message = statusResult?.data?.msg || '数字人服务处理中'

      await updateAvatarJob(jobId, {
        status: taskState === 2 ? 'finalizing' : 'processing',
        progress,
        stage: taskState === 2 ? 'finalizing' : 'face2face',
        message
      })

      if (taskState === 2) {
        return statusResult
      }

      if (taskState === 3) {
        throw new Error(message || '数字人视频生成失败')
      }
    }

    await sleep(AVATAR_POLL_INTERVAL_MS)
  }

  throw new Error('数字人视频生成超时，请稍后重试')
}

export async function trainDigitalHumanFromUpload({ fileBuffer, originalFileName, displayName }) {
  await ensureAvatarRuntimeDirs()

  const safeFileName = sanitizeFileName(originalFileName, '.mp4')
  const extension = path.extname(safeFileName) || '.mp4'
  const digitalHumanId = createId('dh')
  const assetName = sanitizeName(displayName, safeFileName.replace(extension, ''))
  const assetDir = getAssetDir(digitalHumanId)
  const createdAt = new Date().toISOString()
  const uploadBuffer = ensureBuffer(fileBuffer)

  if (!uploadBuffer.length) {
    throw new Error('没有收到训练视频文件内容')
  }

  let asset = await writeDigitalHumanAsset({
    id: digitalHumanId,
    name: assetName,
    status: 'processing',
    createdAt,
    updatedAt: createdAt,
    sourceFileName: safeFileName
  })

  try {
    const sourceDir = path.join(assetDir, 'source')
    const previewDir = path.join(assetDir, 'preview')
    const audioDir = path.join(assetDir, 'audio')
    const sourceVideoPath = path.join(sourceDir, safeFileName)
    const previewVideoPath = path.join(previewDir, 'training.mp4')
    const previewAudioPath = path.join(audioDir, 'reference.wav')
    const externalVideoFileName = `${digitalHumanId}.mp4`
    const externalVideoPath = path.join(LOCAL_FACE2FACE_TEMP_ROOT, externalVideoFileName)
    const externalAudioRelativePath = `origin_audio/${digitalHumanId}.wav`
    const externalAudioAbsolutePath = path.join(LOCAL_TTS_TRAIN_ROOT, `${digitalHumanId}.wav`)

    await Promise.all([
      fs.promises.mkdir(sourceDir, { recursive: true }),
      fs.promises.mkdir(previewDir, { recursive: true }),
      fs.promises.mkdir(audioDir, { recursive: true })
    ])

    await fs.promises.writeFile(sourceVideoPath, uploadBuffer)
    await normalizeVideoToH264({
      inputPath: sourceVideoPath,
      outputPath: previewVideoPath
    })
    await extractAudioFromVideo({
      videoPath: previewVideoPath,
      outputPath: previewAudioPath
    })

    await Promise.all([
      fs.promises.copyFile(previewVideoPath, externalVideoPath),
      fs.promises.copyFile(previewAudioPath, externalAudioAbsolutePath)
    ])

    const preprocess = await callTtsPreprocess({
      relativeAudioPath: externalAudioRelativePath,
      format: 'wav',
      lang: 'zh'
    })

    asset = await writeDigitalHumanAsset({
      ...asset,
      status: 'ready',
      previewVideoPath,
      sourceVideoPath,
      referenceAudioPreviewPath: previewAudioPath,
      referenceAudioRelativePath: externalAudioRelativePath,
      referenceAudioAbsolutePath: externalAudioAbsolutePath,
      face2faceVideoFileName: externalVideoFileName,
      face2faceVideoPath: externalVideoPath,
      referenceText: String(preprocess.reference_audio_text || '').trim(),
      ttsReferenceAudio: preprocess.asr_format_audio_url,
      preprocessStatus: 'ready',
      preprocessMessage: '已完成参考音频规范化，内部 ASR 文本不参与后续业务链路。'
    })

    return {
      message: '数字人训练素材已处理完成，可以在创作页使用这个 digitalHumanId 生成视频。',
      asset: serializeDigitalHumanAsset(asset)
    }
  } catch (error) {
    await writeDigitalHumanAsset({
      ...asset,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      preprocessStatus: 'failed'
    })
    throw error
  }
}

async function runAvatarGenerationJob(jobId) {
  try {
    const job = await readAvatarJob(jobId)
    const asset = await readDigitalHumanAsset(job.digitalHumanId)
    const taskCode = crypto.randomUUID()

    await updateAvatarJob(jobId, {
      status: 'processing',
      progress: 5,
      stage: 'tts',
      taskCode,
      digitalHumanName: asset.name,
      message: '正在合成语音'
    })

    const synthesized = await synthesizeAudioByDigitalHuman({
      asset,
      text: job.scriptText,
      taskId: jobId
    })

    await updateAvatarJob(jobId, {
      progress: 12,
      stage: 'tts',
      audioPath: synthesized.externalAudioPath,
      message: '语音合成完成，正在提交数字人任务'
    })

    await submitFace2FaceTask({
      audioFileName: synthesized.audioFileName,
      videoFileName: asset.face2faceVideoFileName,
      taskCode
    })

    await updateAvatarJob(jobId, {
      progress: 18,
      stage: 'face2face',
      message: '数字人任务已提交，正在等待服务返回真实进度'
    })

    const finalStatus = await pollFace2FaceUntilDone({
      jobId,
      taskCode
    })

    const resultFilePath = resolveFace2FaceOutputPath(finalStatus?.data?.result)
    const outputVideoPath = path.join(AVATAR_OUTPUT_ROOT, `${jobId}.mp4`)

    await fs.promises.copyFile(resultFilePath, outputVideoPath)

    await updateAvatarJob(jobId, {
      status: 'success',
      progress: 100,
      stage: 'done',
      message: '数字人口播视频生成完成',
      outputVideoPath
    })
  } catch (error) {
    await updateAvatarJob(jobId, {
      status: 'failed',
      stage: 'failed',
      message: '数字人口播视频生成失败',
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function submitAvatarVideoJob(payload) {
  const digitalHumanId = String(payload?.digitalHumanId || '').trim()
  const sourceCopy = ensureScriptText(payload?.sourceCopy)
  const rewrittenCopy = ensureScriptText(payload?.rewrittenCopy)
  const finalScript = rewrittenCopy || sourceCopy

  if (!digitalHumanId) {
    throw new Error('请先输入 digitalHumanId')
  }

  if (!finalScript) {
    throw new Error('没有可用于合成的视频文案')
  }

  await ensureAvatarRuntimeDirs()

  const asset = await readDigitalHumanAsset(digitalHumanId)

  if (asset.status !== 'ready') {
    throw new Error(`数字人 ${digitalHumanId} 当前状态为 ${asset.status}，暂时不能生成视频`)
  }

  const reusableJob = await findReusableAvatarJob({
    digitalHumanId,
    scriptText: finalScript
  })

  if (reusableJob) {
    const message = reusableJob.status === 'success'
      ? '检测到同一个数字人和同一文案的历史成功任务，已直接复用已有成片。'
      : '检测到同一个数字人和同一文案已有进行中的任务，已直接复用旧任务。'

    return {
      message,
      job: serializeAvatarJob(reusableJob)
    }
  }

  const jobId = createId('gen')
  const sourceScriptPath = path.join(AVATAR_OUTPUT_ROOT, `${jobId}.txt`)

  await fs.promises.writeFile(sourceScriptPath, finalScript, 'utf8')

  const job = await writeAvatarJob({
    jobId,
    digitalHumanId,
    digitalHumanName: asset.name,
    status: 'queued',
    progress: 0,
    stage: 'queued',
    message: '已创建生成任务，等待后端执行',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceScriptPath,
    scriptText: finalScript,
    outputVideoPath: '',
    taskCode: '',
    audioPath: '',
    errorMessage: ''
  })

  void runAvatarGenerationJob(jobId)

  return {
    message: '数字人生成任务已创建，前端可以开始轮询真实进度。',
    job: serializeAvatarJob(job)
  }
}
