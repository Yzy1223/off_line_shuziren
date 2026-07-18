import axios from 'axios'
import fs from 'node:fs'
import path from 'node:path'
import { Configuration, DashscopeApi, Recognition } from 'dashscope-sdk-official'
import { runCommand } from './command.js'

const CANDIDATE_FFMPEG_PATHS = [
  process.env.FFMPEG_PATH,
  path.resolve(process.cwd(), 'resources', 'ffmpeg', 'win-amd64', 'bin', 'ffmpeg.exe'),
  'D:\\duix\\Duix.Avatar\\resources\\app.asar.unpacked\\resources\\ffmpeg\\win-amd64\\bin\\ffmpeg.exe',
  'ffmpeg'
].filter(Boolean)

const CANDIDATE_FFPROBE_PATHS = [
  process.env.FFPROBE_PATH,
  path.resolve(process.cwd(), 'resources', 'ffmpeg', 'win-amd64', 'bin', 'ffprobe.exe'),
  'D:\\duix\\Duix.Avatar\\resources\\app.asar.unpacked\\resources\\ffmpeg\\win-amd64\\bin\\ffprobe.exe',
  'ffprobe'
].filter(Boolean)

function resolveFfmpegPath() {
  for (const candidate of CANDIDATE_FFMPEG_PATHS) {
    if (candidate === 'ffmpeg' || fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('没有找到可用的 FFmpeg，无法对长音频做自动切片。')
}

function resolveFfprobePath() {
  for (const candidate of CANDIDATE_FFPROBE_PATHS) {
    if (candidate === 'ffprobe' || fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('没有找到可用的 FFprobe，无法检测音频时长。')
}

function getDashscopeClient() {
  const apiKey = String(process.env.BAILIAN_API_KEY || '').trim()

  if (!apiKey) {
    throw new Error('未配置百炼 API Key，无法调用 ASR。')
  }

  return new DashscopeApi(
    new Configuration({
      apiKey
    })
  )
}

function getRecognitionClient() {
  const apiKey = String(process.env.BAILIAN_API_KEY || '').trim()

  if (!apiKey) {
    throw new Error('未配置百炼 API Key，无法调用 ASR。')
  }

  return new Recognition(
    new Configuration({
      apiKey
    })
  )
}

function getAudioChoiceText(result) {
  const choice =
    result?.output?.choices?.[0]?.message?.content?.find?.((item) => typeof item?.text === 'string') ||
    result?.output?.choices?.[0]?.message?.content?.[0]

  return typeof choice?.text === 'string' ? choice.text.trim() : ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractDashscopeFileUrl(fileInfo) {
  return (
    fileInfo?.data?.url ||
    fileInfo?.url ||
    fileInfo?.data?.download_url ||
    fileInfo?.download_url ||
    ''
  )
}

function collectRemoteUrls(value, results = new Set()) {
  if (!value) {
    return results
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectRemoteUrls(item, results))
    return results
  }

  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /^https?:\/\//i.test(item) && /url/i.test(key)) {
        results.add(item)
      } else {
        collectRemoteUrls(item, results)
      }
    }
  }

  return results
}

function collectTranscriptParts(value, parts = []) {
  if (!value) {
    return parts
  }

  if (typeof value === 'string') {
    const clean = value.trim()
    if (clean) {
      parts.push(clean)
    }
    return parts
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTranscriptParts(item, parts))
    return parts
  }

  if (typeof value === 'object') {
    const preferredKeys = [
      'text',
      'transcript',
      'transcription',
      'paragraph_text',
      'sentence_text',
      'content',
      'display_text'
    ]

    for (const key of preferredKeys) {
      if (key in value) {
        collectTranscriptParts(value[key], parts)
      }
    }

    for (const item of Object.values(value)) {
      if (typeof item === 'object') {
        collectTranscriptParts(item, parts)
      }
    }
  }

  return parts
}

function dedupeParts(parts) {
  const seen = new Set()
  const result = []

  for (const part of parts) {
    if (!seen.has(part)) {
      seen.add(part)
      result.push(part)
    }
  }

  return result
}

async function fetchTranscriptFromUrls(urls) {
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        timeout: 120000
      })
      const parts = dedupeParts(collectTranscriptParts(response.data))

      if (parts.length > 0) {
        return {
          transcript: parts.join('\n'),
          transcriptUrl: url,
          transcriptPayload: response.data
        }
      }
    } catch (error) {
      continue
    }
  }

  return {
    transcript: '',
    transcriptUrl: '',
    transcriptPayload: null
  }
}

function inferAudioFormat(audioPath) {
  const ext = path.extname(audioPath || '').toLowerCase().replace('.', '')
  return ext || 'wav'
}

function isAudioTooLargeError(resultOrMessage) {
  const text =
    typeof resultOrMessage === 'string'
      ? resultOrMessage
      : `${resultOrMessage?.code || ''} ${resultOrMessage?.message || ''} ${resultOrMessage?.status_code || ''}`

  return /file size is too large|multimodal file size is too large|invalidparameter/i.test(text)
}

async function splitAudioForAsr({ audioPath, segmentSeconds = 120 }) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('音频文件不存在，无法切片。')
  }

  const ffmpegPath = resolveFfmpegPath()
  const audioBaseName = path.basename(audioPath, path.extname(audioPath))
  const chunkDir = path.resolve(process.cwd(), 'runtime', 'audio-chunks', `${audioBaseName}-${Date.now()}`)
  const outputPattern = path.join(chunkDir, `${audioBaseName}-%03d.wav`)

  await fs.promises.mkdir(chunkDir, { recursive: true })

  await runCommand(
    ffmpegPath,
    [
      '-y',
      '-i',
      audioPath,
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-reset_timestamps',
      '1',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outputPattern
    ],
    { timeoutMs: 600000 }
  )

  const chunkFiles = (await fs.promises.readdir(chunkDir))
    .filter((fileName) => fileName.toLowerCase().endsWith('.wav'))
    .sort()
    .map((fileName) => path.join(chunkDir, fileName))

  if (chunkFiles.length === 0) {
    throw new Error('长音频自动切片失败，没有生成任何分段文件。')
  }

  return chunkFiles
}

async function getAudioDurationSeconds(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('音频文件不存在，无法检测时长。')
  }

  const ffprobePath = resolveFfprobePath()
  const result = await runCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath
    ],
    { timeoutMs: 120000 }
  )

  const duration = Number.parseFloat(String(result.stdout || '').trim())

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('音频时长检测失败。')
  }

  return duration
}

async function transcribeByRealtimeRecognition({ audioPath, model }) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('本地音频文件不存在，无法调用实时 ASR。')
  }

  const recognizer = getRecognitionClient()
  let result

  try {
    result = await recognizer.call(audioPath, {
      model,
      format: inferAudioFormat(audioPath),
      sampleRate: 16000
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`实时 ASR 链路已触发，但 WebSocket 会话提前关闭：${message}`)
  }

  const parts = dedupeParts(collectTranscriptParts(result))
  const transcript = parts.join('\n')

  if (!transcript) {
    throw new Error('实时 ASR 已返回结果，但暂时没有解析出转写文本。')
  }

  return {
    transcript,
    task: {
      output: result?.output || null,
      request_id: result?.requestId || '',
      status_code: result?.statusCode || 0,
      code: '',
      message: ''
    },
    transcriptUrl: ''
  }
}

async function uploadAudioToDashscope({ audioPath }) {
  const client = getDashscopeClient()
  const uploaded = await client.uploadFile({
    file_path: audioPath,
    purpose: 'assistants',
    description: 'duix-asr-audio'
  })

  const fileId = uploaded?.data?.uploaded_files?.[0]?.file_id

  if (!fileId) {
    throw new Error('百炼文件上传成功，但没有拿到 file_id。')
  }

  let fileInfo = null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    fileInfo = await client.getFile(fileId)

    if (!fileInfo?.code || fileInfo.code !== 'Throttling.RateQuota') {
      break
    }

    await sleep(1000 * (attempt + 1))
  }

  const url = extractDashscopeFileUrl(fileInfo)

  if (!url) {
    if (fileInfo?.code) {
      throw new Error(`百炼文件信息获取失败：${fileInfo.message || fileInfo.code}`)
    }

    throw new Error('百炼文件信息返回成功，但没有拿到音频 URL。')
  }

  return {
    fileId,
    url,
    uploaded,
    fileInfo
  }
}

async function transcribeByQwenAudioFlashSingle({ audioPath, model }) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('本地音频文件不存在，无法调用 qwen3-asr-flash。')
  }

  const client = getDashscopeClient()
  const uploaded = await uploadAudioToDashscope({ audioPath })
  const result = await client.createMultiModalConversation({
    model,
    messages: [
      {
        role: 'system',
        content: [{ text: '请逐字转写音频内容，只输出转写文本，不要补充解释。' }]
      },
      {
        role: 'user',
        content: [{ audio: uploaded.url }]
      }
    ]
  })

  if (result?.code) {
    throw new Error(result.message || result.code)
  }

  const transcript = getAudioChoiceText(result)

  if (!transcript) {
    throw new Error('qwen3-asr-flash 已返回结果，但没有解析出转写文本。')
  }

  return {
    transcript,
    task: {
      output: result?.output || null,
      request_id: result?.request_id || '',
      status_code: result?.status_code || 0,
      code: result?.code || '',
      message: result?.message || ''
    },
    transcriptUrl: uploaded.url,
    dashscopeFileId: uploaded.fileId
  }
}

async function transcribeByQwenAudioFlash({ audioPath, model }) {
  const durationSeconds = await getAudioDurationSeconds(audioPath)

  if (durationSeconds <= 120) {
    return transcribeByQwenAudioFlashSingle({ audioPath, model })
  }

  const chunkFiles = await splitAudioForAsr({
    audioPath,
    segmentSeconds: 120
  })

  const chunkResults = []

  for (const chunkPath of chunkFiles) {
    const chunkResult = await transcribeByQwenAudioFlashSingle({
      audioPath: chunkPath,
      model
    })

    chunkResults.push({
      chunkPath,
      ...chunkResult
    })
  }

  const transcript = chunkResults
    .map((item) => item.transcript)
    .filter(Boolean)
    .join('\n')

  if (!transcript) {
    throw new Error('长音频已经切片转写，但没有拿到任何转写文本。')
  }

  return {
    transcript,
    task: {
      status_code: 200,
      code: '',
      message: '',
      request_id: '',
      output: {
        mode: 'chunked',
        duration_seconds: durationSeconds,
        chunk_count: chunkResults.length,
        segments: chunkResults.map((item) => ({
          chunkPath: item.chunkPath,
          transcriptUrl: item.transcriptUrl,
          dashscopeFileId: item.dashscopeFileId
        }))
      }
    },
    transcriptUrl: chunkResults[0]?.transcriptUrl || '',
    dashscopeFileId: chunkResults[0]?.dashscopeFileId || ''
  }
}

function summarizeTaskResult(taskResult) {
  return {
    output: taskResult?.output || null,
    request_id: taskResult?.request_id || '',
    status_code: taskResult?.status_code || 0,
    code: taskResult?.code || '',
    message: taskResult?.message || ''
  }
}

export async function transcribeAudioFile({ audioPath, fileUrl }) {
  const model = String(process.env.BAILIAN_ASR_MODEL || 'qwen3-asr-flash-filetrans').trim()

  if (model === 'qwen3-asr-flash') {
    const qwenResult = await transcribeByQwenAudioFlash({
      audioPath,
      model
    })

    const transcriptDir = path.resolve(process.cwd(), 'runtime', 'transcripts')
    await fs.promises.mkdir(transcriptDir, { recursive: true })

    const transcriptPath = path.join(
      transcriptDir,
      `${path.basename(audioPath || 'transcript', path.extname(audioPath || ''))}.txt`
    )

    await fs.promises.writeFile(transcriptPath, qwenResult.transcript, 'utf8')

    return {
      audioPath,
      fileUrl: qwenResult.transcriptUrl,
      model,
      transcript: qwenResult.transcript,
      transcriptPath,
      transcriptUrl: qwenResult.transcriptUrl,
      dashscopeFileId: qwenResult.dashscopeFileId,
      task: qwenResult.task
    }
  }

  const client = getDashscopeClient()

  if (!model.includes('filetrans')) {
    const realtimeResult = await transcribeByRealtimeRecognition({
      audioPath,
      model
    })

    const transcriptDir = path.resolve(process.cwd(), 'runtime', 'transcripts')
    await fs.promises.mkdir(transcriptDir, { recursive: true })

    const transcriptPath = path.join(
      transcriptDir,
      `${path.basename(audioPath || 'transcript', path.extname(audioPath || ''))}.txt`
    )

    await fs.promises.writeFile(transcriptPath, realtimeResult.transcript, 'utf8')

    return {
      audioPath,
      fileUrl: '',
      model,
      transcript: realtimeResult.transcript,
      transcriptPath,
      transcriptUrl: '',
      task: realtimeResult.task
    }
  }

  if (!fileUrl) {
    throw new Error('没有可供百炼访问的音频 URL。')
  }

  const taskResult = await client.createTranscription({
    model,
    file_urls: [fileUrl]
  })

  if (taskResult?.code) {
    throw new Error(`百炼 ASR 调用失败：${taskResult.message || taskResult.code}`)
  }

  const directParts = dedupeParts(collectTranscriptParts(taskResult))
  const remoteUrls = Array.from(collectRemoteUrls(taskResult))
  const remoteTranscript = await fetchTranscriptFromUrls(remoteUrls)
  const transcript = remoteTranscript.transcript || directParts.join('\n')

  if (!transcript) {
    throw new Error('百炼 ASR 已返回结果，但暂时没有解析出转写文本。')
  }

  const transcriptDir = path.resolve(process.cwd(), 'runtime', 'transcripts')
  await fs.promises.mkdir(transcriptDir, { recursive: true })

  const transcriptPath = path.join(
    transcriptDir,
    `${path.basename(audioPath || 'transcript', path.extname(audioPath || ''))}.txt`
  )

  await fs.promises.writeFile(transcriptPath, transcript, 'utf8')

  return {
    audioPath,
    fileUrl,
    model,
    transcript,
    transcriptPath,
    transcriptUrl: remoteTranscript.transcriptUrl,
    task: summarizeTaskResult(taskResult)
  }
}
