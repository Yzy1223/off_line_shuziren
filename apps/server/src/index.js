import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import creativeRouter from './routes/creative.js'
import avatarRouter from './routes/avatar.js'
import publishRouter from './routes/publish.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({
  path: path.resolve(__dirname, '..', '.env')
})

const app = express()
const port = Number(process.env.PORT || 3010)

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))
app.use('/runtime', express.static(path.resolve(process.cwd(), 'runtime')))

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'duix-mvp-server',
    date: new Date().toISOString()
  })
})

app.use('/api/creative', creativeRouter)
app.use('/api/avatar', avatarRouter)
app.use('/api/publish', publishRouter)

app.listen(port, () => {
  console.log(`Duix MVP server listening on http://127.0.0.1:${port}`)
})
