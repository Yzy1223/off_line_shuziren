import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3010/api'
})

function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3010/api'
}

async function streamNdjson(path, payload, onEvent) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  })

  if (!response.ok || !response.body) {
    const fallbackMessage = `请求失败，状态码 ${response.status}`
    throw new Error(fallbackMessage)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()

      if (!trimmed) {
        continue
      }

      const event = JSON.parse(trimmed)
      onEvent?.(event)

      if (event.type === 'error') {
        throw new Error(event.message || '流式请求失败')
      }
    }
  }

  const rest = buffer.trim()

  if (rest) {
    const event = JSON.parse(rest)
    onEvent?.(event)

    if (event.type === 'error') {
      throw new Error(event.message || '流式请求失败')
    }
  }
}

export async function submitCreativeBrief(payload) {
  const { data } = await api.post('/creative/parse-link', payload)
  return data
}

export async function streamCreativeBrief(payload, onEvent) {
  return streamNdjson('/creative/parse-link-stream', payload, onEvent)
}

export async function rewriteCopy(payload) {
  const { data } = await api.post('/creative/rewrite', payload)
  return data
}

export async function streamRewriteCopy(payload, onEvent) {
  return streamNdjson('/creative/rewrite-stream', payload, onEvent)
}

export async function fetchDigitalHumanAssets() {
  const { data } = await api.get('/avatar/models')
  return data
}

export async function uploadDigitalHumanAsset({ file, name }) {
  const query = new URLSearchParams({
    name,
    fileName: file?.name || 'upload.mp4'
  })

  const { data } = await api.post(`/avatar/train?${query.toString()}`, file, {
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 1800000
  })

  return data
}

export async function submitAvatarGeneration(payload) {
  const { data } = await api.post('/avatar/generate', payload, {
    timeout: 1800000
  })
  return data
}

export async function fetchAvatarJob(jobId) {
  const { data } = await api.get(`/avatar/jobs/${jobId}`)
  return data
}

export async function fetchPublishPlatforms() {
  const { data } = await api.get('/publish/platforms')
  return data
}

export async function fetchPublishAccounts(platform = '') {
  const { data } = await api.get('/publish/accounts', {
    params: platform ? { platform } : {}
  })
  return data
}

export async function savePublishAccount(payload) {
  const { data } = await api.post('/publish/accounts', payload)
  return data
}

export async function checkPublishAccount(accountId) {
  const { data } = await api.post(`/publish/accounts/${accountId}/check`)
  return data
}

export async function openPublishLogin(payload) {
  const { data } = await api.post('/publish/accounts/open-login', payload)
  return data
}

export async function deletePublishAccount(accountId) {
  const { data } = await api.delete(`/publish/accounts/${accountId}`)
  return data
}

export async function fetchPublishJobs() {
  const { data } = await api.get('/publish/jobs')
  return data
}

export async function submitPublishJob(payload) {
  const { data } = await api.post('/publish/jobs', payload, {
    timeout: 1800000
  })
  return data
}

export async function generatePublishDraft(payload) {
  const { data } = await api.post('/publish/draft', payload, {
    timeout: 1800000
  })
  return data
}
