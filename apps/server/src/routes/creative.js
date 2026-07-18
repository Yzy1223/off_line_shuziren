import { Router } from 'express'
import { acquireVideoFromInput, ensureCreativeRuntimeDirs, parseDouyinShareText } from '../services/douyin.js'
import { extractAudioFromVideo } from '../services/media.js'
import { uploadFileToOss } from '../services/oss.js'
import { transcribeAudioFile } from '../services/bailian.js'
import { rewriteCopyByRequirement, streamRewriteCopyByRequirement } from '../services/rewrite.js'

const router = Router()

function writeStreamEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`)
}

function initNdjsonStream(res) {
  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

function splitTextForStreaming(text) {
  const cleanText = String(text || '').replace(/\r\n/g, '\n').trim()

  if (!cleanText) {
    return []
  }

  const lines = cleanText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const chunks = []

  for (const line of lines) {
    const sentences = line.match(/[^。！？!?；;，,、]+[。！？!?；;，,、]?/g) || [line]

    for (const sentence of sentences) {
      const unit = sentence.trim()

      if (!unit) {
        continue
      }

      if (unit.length <= 24) {
        chunks.push(unit)
        continue
      }

      for (let index = 0; index < unit.length; index += 24) {
        chunks.push(unit.slice(index, index + 24))
      }
    }
  }

  return chunks.length ? chunks : [cleanText]
}

async function buildCreativeArtifacts({ douyinUrl }) {
  const stages = []
  const asrModel = String(process.env.BAILIAN_ASR_MODEL || '').trim()

  await ensureCreativeRuntimeDirs()
  stages.push({
    key: 'prepare-runtime',
    label: '已准备运行目录'
  })

  const video = await acquireVideoFromInput(douyinUrl)
  stages.push({
    key: 'video-ready',
    label: video.mode === 'local-file' ? '已定位本地视频文件' : '已获取抖音视频',
    value: video.videoPath
  })

  const audio = await extractAudioFromVideo({
    videoPath: video.videoPath
  })
  stages.push({
    key: 'audio-ready',
    label: '已完成音频抽取',
    value: audio.audioPath
  })

  let uploaded = null

  if (asrModel.includes('filetrans')) {
    uploaded = await uploadFileToOss({
      filePath: audio.audioPath,
      folder: 'audio'
    })
    stages.push({
      key: 'oss-ready',
      label: '已上传音频到 OSS',
      value: uploaded.objectKey
    })
  } else {
    stages.push({
      key: 'asr-upload-mode',
      label: '当前 ASR 直接走百炼文件上传通道',
      value: asrModel
    })
  }

  const asr = await transcribeAudioFile({
    audioPath: audio.audioPath,
    fileUrl: uploaded?.signedUrl || ''
  })
  stages.push({
    key: 'asr-ready',
    label: '已完成百炼 ASR 转写',
    value: asr.transcriptPath
  })

  return {
    asr,
    audio,
    uploaded,
    video,
    stages,
    parsed: video.parsed || parseDouyinShareText(douyinUrl)
  }
}

router.post('/parse-link', async (req, res, next) => {
  try {
    const { douyinUrl = '', rewriteRequirement = '' } = req.body || {}
    const result = await buildCreativeArtifacts({ douyinUrl })

    res.status(200).json({
      ok: true,
      message: '原始文案提取完成，已打通视频获取、抽音频和百炼 ASR 链路。',
      sourceCopy: result.asr.transcript,
      rewriteRequirement,
      parsed: result.parsed,
      stages: result.stages,
      artifacts: {
        videoPath: result.video.videoPath,
        audioPath: result.audio.audioPath,
        transcriptPath: result.asr.transcriptPath,
        transcriptUrl: result.asr.transcriptUrl,
        ossObjectKey: result.uploaded?.objectKey || '',
        dashscopeFileId: result.asr.dashscopeFileId || '',
        videoSourceMode: result.video.mode
      }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/parse-link-stream', async (req, res) => {
  initNdjsonStream(res)

  try {
    const { douyinUrl = '', rewriteRequirement = '' } = req.body || {}

    writeStreamEvent(res, {
      type: 'stage',
      percent: 5,
      label: '已提交原始文案提取请求'
    })

    await ensureCreativeRuntimeDirs()
    writeStreamEvent(res, {
      type: 'stage',
      percent: 15,
      label: '已准备运行目录'
    })

    const video = await acquireVideoFromInput(douyinUrl)
    writeStreamEvent(res, {
      type: 'stage',
      percent: 30,
      label: video.mode === 'local-file' ? '已定位本地视频文件' : '已获取抖音视频',
      value: video.videoPath
    })

    const audio = await extractAudioFromVideo({
      videoPath: video.videoPath
    })
    writeStreamEvent(res, {
      type: 'stage',
      percent: 45,
      label: '已完成音频抽取',
      value: audio.audioPath
    })

    const asrModel = String(process.env.BAILIAN_ASR_MODEL || '').trim()
    let uploaded = null

    if (asrModel.includes('filetrans')) {
      uploaded = await uploadFileToOss({
        filePath: audio.audioPath,
        folder: 'audio'
      })
      writeStreamEvent(res, {
        type: 'stage',
        percent: 60,
        label: '已上传音频到 OSS',
        value: uploaded.objectKey
      })
    } else {
      writeStreamEvent(res, {
        type: 'stage',
        percent: 60,
        label: '当前 ASR 直接走百炼文件上传通道',
        value: asrModel
      })
    }

    writeStreamEvent(res, {
      type: 'stage',
      percent: 72,
      label: '百炼 ASR 正在识别音频'
    })

    const asr = await transcribeAudioFile({
      audioPath: audio.audioPath,
      fileUrl: uploaded?.signedUrl || ''
    })

    writeStreamEvent(res, {
      type: 'stage',
      percent: 80,
      label: '已完成百炼 ASR 转写，正在回传原始文案'
    })

    const transcriptChunks = splitTextForStreaming(asr.transcript)

    transcriptChunks.forEach((text, index) => {
      const progressBase = 80
      const progressRange = 18
      const percent = progressBase + Math.round(((index + 1) / transcriptChunks.length) * progressRange)

      writeStreamEvent(res, {
        type: 'delta',
        target: 'sourceCopy',
        text,
        index: index + 1,
        total: transcriptChunks.length,
        percent
      })
    })

    writeStreamEvent(res, {
      type: 'done',
      percent: 100,
      label: '原始口播文案提取完成',
      message: '原始文案提取完成，已打通视频获取、抽音频和百炼 ASR 链路。',
      data: {
        sourceCopy: asr.transcript,
        rewriteRequirement,
        parsed: video.parsed || parseDouyinShareText(douyinUrl),
        stages: [
          {
            key: 'prepare-runtime',
            label: '已准备运行目录'
          },
          {
            key: 'video-ready',
            label: video.mode === 'local-file' ? '已定位本地视频文件' : '已获取抖音视频',
            value: video.videoPath
          },
          {
            key: 'audio-ready',
            label: '已完成音频抽取',
            value: audio.audioPath
          },
          {
            key: asrModel.includes('filetrans') ? 'oss-ready' : 'asr-upload-mode',
            label: asrModel.includes('filetrans') ? '已上传音频到 OSS' : '当前 ASR 直接走百炼文件上传通道',
            value: asrModel.includes('filetrans') ? uploaded?.objectKey || '' : asrModel
          },
          {
            key: 'asr-ready',
            label: '已完成百炼 ASR 转写',
            value: asr.transcriptPath
          }
        ],
        artifacts: {
          videoPath: video.videoPath,
          audioPath: audio.audioPath,
          transcriptPath: asr.transcriptPath,
          transcriptUrl: asr.transcriptUrl,
          ossObjectKey: uploaded?.objectKey || '',
          dashscopeFileId: asr.dashscopeFileId || '',
          videoSourceMode: video.mode
        }
      }
    })
  } catch (error) {
    writeStreamEvent(res, {
      type: 'error',
      percent: 100,
      label: '原始口播文案提取失败',
      message: error.message || '服务端内部错误。'
    })
  } finally {
    res.end()
  }
})

router.post('/rewrite', async (req, res, next) => {
  try {
    const { rewriteRequirement = '', sourceCopy = '' } = req.body || {}
    const result = await rewriteCopyByRequirement({
      rewriteRequirement,
      sourceCopy
    })

    res.status(200).json({
      ok: true,
      message: '已完成文案改写。',
      rewrittenCopy: result.rewrittenCopy,
      model: result.model,
      requestId: result.requestId
    })
  } catch (error) {
    next(error)
  }
})

router.post('/rewrite-stream', async (req, res) => {
  initNdjsonStream(res)

  try {
    const { rewriteRequirement = '', sourceCopy = '' } = req.body || {}

    writeStreamEvent(res, {
      type: 'stage',
      percent: 5,
      label: '已提交文案改写请求'
    })

    writeStreamEvent(res, {
      type: 'stage',
      percent: 25,
      label: '改写模型正在生成文案'
    })

    for await (const event of streamRewriteCopyByRequirement({
      rewriteRequirement,
      sourceCopy
    })) {
      if (event.type === 'delta') {
        writeStreamEvent(res, {
          type: 'delta',
          target: 'rewrittenCopy',
          text: event.text,
          requestId: event.requestId,
          model: event.model
        })
        continue
      }

      if (event.type === 'done') {
        writeStreamEvent(res, {
          type: 'done',
          percent: 100,
          label: '文案改写完成',
          message: '已完成文案改写。',
          data: {
            rewrittenCopy: event.rewrittenCopy,
            model: event.model,
            requestId: event.requestId
          }
        })
      }
    }
  } catch (error) {
    writeStreamEvent(res, {
      type: 'error',
      percent: 100,
      label: '文案改写失败',
      message: error.message || '服务端内部错误。'
    })
  } finally {
    res.end()
  }
})

router.post('/extract-audio', async (req, res, next) => {
  try {
    const { videoPath = '' } = req.body || {}
    const result = await extractAudioFromVideo({ videoPath })

    res.status(200).json({
      ok: true,
      message: '已完成音频抽取。',
      ...result
    })
  } catch (error) {
    next(error)
  }
})

router.use((error, req, res, next) => {
  res.status(500).json({
    ok: false,
    message: error.message || '服务端内部错误。'
  })
})

export default router
