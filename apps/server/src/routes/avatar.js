import express, { Router } from 'express'
import {
  getAvatarJob,
  listDigitalHumanAssets,
  submitAvatarVideoJob,
  trainDigitalHumanFromUpload
} from '../services/avatar.js'

const router = Router()

router.get('/models', async (req, res, next) => {
  try {
    const assets = await listDigitalHumanAssets()
    res.json({
      ok: true,
      message: '数字人资产列表获取成功。',
      assets
    })
  } catch (error) {
    next(error)
  }
})

router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const job = await getAvatarJob(req.params.jobId)
    res.json({
      ok: true,
      message: '数字人任务状态获取成功。',
      job
    })
  } catch (error) {
    next(error)
  }
})

router.post('/train', express.raw({ type: 'application/octet-stream', limit: '1024mb' }), async (req, res, next) => {
  try {
    const name = String(req.query.name || '')
    const fileName = String(req.query.fileName || req.headers['x-file-name'] || 'upload.mp4')
    const result = await trainDigitalHumanFromUpload({
      fileBuffer: req.body,
      originalFileName: fileName,
      displayName: name
    })

    res.json({
      ok: true,
      ...result
    })
  } catch (error) {
    next(error)
  }
})

router.post('/generate', async (req, res, next) => {
  try {
    const result = await submitAvatarVideoJob(req.body)
    res.status(202).json({
      ok: true,
      ...result
    })
  } catch (error) {
    next(error)
  }
})

router.use((error, req, res, next) => {
  res.status(500).json({
    ok: false,
    message: error.message || '数字人服务处理失败。'
  })
})

export default router
