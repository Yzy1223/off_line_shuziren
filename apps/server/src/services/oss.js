import fs from 'node:fs'
import path from 'node:path'
import OSS from 'ali-oss'

function getOssClient() {
  const {
    ALIYUN_OSS_ENDPOINT,
    ALIYUN_OSS_BUCKET,
    ALIYUN_OSS_ACCESS_KEY_ID,
    ALIYUN_OSS_ACCESS_KEY_SECRET
  } = process.env

  if (!ALIYUN_OSS_ENDPOINT || !ALIYUN_OSS_BUCKET || !ALIYUN_OSS_ACCESS_KEY_ID || !ALIYUN_OSS_ACCESS_KEY_SECRET) {
    throw new Error('OSS 配置不完整，无法上传音频到百炼可访问地址。')
  }

  return new OSS({
    endpoint: `https://${ALIYUN_OSS_ENDPOINT}`,
    bucket: ALIYUN_OSS_BUCKET,
    accessKeyId: ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: ALIYUN_OSS_ACCESS_KEY_SECRET,
    secure: true
  })
}

function buildObjectKey(filePath, folder) {
  const prefix = String(process.env.ALIYUN_OSS_PREFIX || 'duix/mvp')
    .replace(/^\/+|\/+$/g, '')
  const normalizedFolder = String(folder || 'audio').replace(/^\/+|\/+$/g, '')
  const fileName = path.basename(filePath)

  return `${prefix}/${normalizedFolder}/${fileName}`
}

export async function uploadFileToOss({ filePath, folder = 'audio' }) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('待上传文件不存在，无法上传到 OSS。')
  }

  const client = getOssClient()
  const objectKey = buildObjectKey(filePath, folder)

  await client.put(objectKey, filePath)

  const signedUrl = client.signatureUrl(objectKey, {
    expires: 3600,
    method: 'GET'
  })

  const bucketDomain = String(process.env.ALIYUN_OSS_BUCKET_DOMAIN || '').trim()
  const publicUrl = bucketDomain ? `https://${bucketDomain}/${objectKey}` : signedUrl

  return {
    objectKey,
    publicUrl,
    signedUrl
  }
}
