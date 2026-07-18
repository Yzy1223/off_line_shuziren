import fs from 'node:fs'
import path from 'node:path'
import { runCommand } from './command.js'

const CANDIDATE_FFMPEG_PATHS = [
  process.env.FFMPEG_PATH,
  path.resolve(process.cwd(), 'resources', 'ffmpeg', 'win-amd64', 'bin', 'ffmpeg.exe'),
  'D:\\duix\\Duix.Avatar\\resources\\app.asar.unpacked\\resources\\ffmpeg\\win-amd64\\bin\\ffmpeg.exe',
  'ffmpeg'
].filter(Boolean)

function resolveFfmpegPath() {
  for (const candidate of CANDIDATE_FFMPEG_PATHS) {
    if (candidate === 'ffmpeg' || fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('没有找到可用的 FFmpeg，请在 apps/server/.env 中补充 FFMPEG_PATH。')
}

function buildAudioPath(videoPath) {
  const fileName = path.basename(videoPath, path.extname(videoPath))
  return path.resolve(process.cwd(), 'runtime', 'audio', `${fileName}.wav`)
}

export async function normalizeVideoToH264({ inputPath, outputPath }) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('视频文件不存在，无法转码。')
  }

  if (!outputPath) {
    throw new Error('没有提供转码输出路径。')
  }

  const ffmpegPath = resolveFfmpegPath()

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

  await runCommand(
    ffmpegPath,
    [
      '-y',
      '-i',
      inputPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputPath
    ],
    { timeoutMs: 600000 }
  )

  return {
    inputPath,
    outputPath,
    ffmpegPath
  }
}

export async function extractAudioFromVideo({ videoPath, outputPath }) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error('视频文件不存在，无法抽取音频。')
  }

  const ffmpegPath = resolveFfmpegPath()
  const audioPath = outputPath || buildAudioPath(videoPath)

  await fs.promises.mkdir(path.dirname(audioPath), { recursive: true })

  await runCommand(
    ffmpegPath,
    ['-y', '-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', audioPath],
    { timeoutMs: 600000 }
  )

  return {
    videoPath,
    audioPath,
    ffmpegPath
  }
}
