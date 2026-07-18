import { Router } from 'express'
import {
  checkPlatformAccount,
  deletePlatformAccount,
  generatePublishDraft,
  getPublishJob,
  listPlatformAccounts,
  listPublishJobs,
  listPublishPlatforms,
  openPlatformLogin,
  savePlatformAccount,
  submitPublishJob
} from '../services/publish.js'

const router = Router()

router.get('/platforms', async (req, res, next) => {
  try {
    const platforms = await listPublishPlatforms()
    res.json({
      ok: true,
      platforms
    })
  } catch (error) {
    next(error)
  }
})

router.get('/accounts', async (req, res, next) => {
  try {
    const accounts = await listPlatformAccounts({
      platform: String(req.query.platform || '')
    })

    res.json({
      ok: true,
      accounts
    })
  } catch (error) {
    next(error)
  }
})

router.post('/accounts', async (req, res, next) => {
  try {
    const account = await savePlatformAccount(req.body || {})
    res.json({
      ok: true,
      message: '账号已保存',
      account
    })
  } catch (error) {
    next(error)
  }
})

router.post('/accounts/:accountId/check', async (req, res, next) => {
  try {
    const account = await checkPlatformAccount(req.params.accountId)
    res.json({
      ok: true,
      message: '账号状态已刷新',
      account
    })
  } catch (error) {
    next(error)
  }
})

router.post('/accounts/open-login', async (req, res, next) => {
  try {
    const result = await openPlatformLogin(req.body || {})
    res.json({
      ok: true,
      message: '浏览器登录页已打开',
      result
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/accounts/:accountId', async (req, res, next) => {
  try {
    await deletePlatformAccount(req.params.accountId)
    res.json({
      ok: true,
      message: '账号已删除'
    })
  } catch (error) {
    next(error)
  }
})

router.post('/draft', async (req, res, next) => {
  try {
    const draft = await generatePublishDraft(req.body || {})
    res.json({
      ok: true,
      message: '已生成平台发布建议',
      draft
    })
  } catch (error) {
    next(error)
  }
})

router.get('/jobs', async (req, res, next) => {
  try {
    const jobs = await listPublishJobs()
    res.json({
      ok: true,
      jobs
    })
  } catch (error) {
    next(error)
  }
})

router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const job = await getPublishJob(req.params.jobId)
    res.json({
      ok: true,
      job
    })
  } catch (error) {
    next(error)
  }
})

router.post('/jobs', async (req, res, next) => {
  try {
    const job = await submitPublishJob(req.body || {})
    res.status(202).json({
      ok: true,
      message: '发布任务已创建',
      job
    })
  } catch (error) {
    next(error)
  }
})

router.use((error, req, res, next) => {
  res.status(500).json({
    ok: false,
    message: error.message || '发布服务处理失败'
  })
})

export default router
