<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Creation Flow</p>
        <h2>爆款拆解到数字人口播</h2>
        <p class="page-subtitle">先提取原始口播文案，再按要求改写，最后选定数字人生成视频并进入矩阵号发布流程。</p>
      </div>
      <t-button variant="outline" theme="danger" @click="handleClear">清除生成</t-button>
    </header>

    <div class="creation-layout">
      <div class="creation-top-row">
        <section class="panel creation-panel">
          <div class="section-head">
            <div>
              <h3>输入区</h3>
              <p class="panel-copy">先填改写要求，再粘贴抖音分享内容、短链 URL，或者本地视频绝对路径。</p>
            </div>
            <span class="status-chip status-chip--soft">Step 1</span>
          </div>

          <label class="field-stack">
            <span class="field-label">改写要求</span>
            <textarea v-model="form.rewriteRequirement" class="plain-textarea" placeholder="请输入改写要求" />
          </label>

          <label class="field-stack">
            <span class="field-label">抖音分享内容或本地视频路径</span>
            <textarea
              v-model="form.douyinUrl"
              class="plain-textarea plain-textarea--tall"
              placeholder="粘贴抖音分享内容、短链 URL，或本地视频绝对路径"
            />
          </label>

          <section class="progress-panel progress-panel--embedded">
            <div class="progress-head">
              <div>
                <h3>文案提取进度</h3>
                <p class="panel-copy">{{ progress.label }}</p>
              </div>
              <strong class="progress-value">{{ progress.percent }}%</strong>
            </div>
            <t-progress :percentage="progress.percent" theme="plump" :status="progress.status" />
            <div class="progress-steps">
              <span :class="{ active: progress.percent >= 5 }">1. 已提交请求</span>
              <span :class="{ active: progress.percent >= 30 }">2. 获取视频</span>
              <span :class="{ active: progress.percent >= 72 }">3. ASR 转写</span>
              <span :class="{ active: progress.percent >= 100 }">4. 文案回填</span>
            </div>
          </section>

          <div class="panel-actions">
            <t-button theme="primary" @click="handleParse">提取原始文案</t-button>
          </div>
        </section>

        <section class="panel creation-panel">
          <div class="section-head">
            <div>
              <h3>文案区</h3>
              <p class="panel-copy">上方是原始口播文案，下方是按你要求生成的新版本。</p>
            </div>
            <span class="status-chip status-chip--soft">Step 2</span>
          </div>

          <label class="field-stack">
            <span class="field-label">原始口播文案</span>
            <textarea
              v-model="form.sourceCopy"
              class="plain-textarea plain-textarea--copy"
              placeholder="提取到的原始口播文案会流式显示在这里"
            />
          </label>

          <div class="panel-actions">
            <t-button variant="outline" @click="handleRewrite">按要求改写</t-button>
          </div>

          <label class="field-stack">
            <span class="field-label">改写后文案</span>
            <textarea
              v-model="form.rewrittenCopy"
              class="plain-textarea plain-textarea--copy"
              placeholder="改写后的文案会流式显示在这里"
            />
          </label>
        </section>

        <section class="panel creation-panel">
          <div class="section-head">
            <div>
              <h3>数字人区</h3>
              <p class="panel-copy">选择一个已训练好的数字人，让它来说改写后的文案。</p>
            </div>
            <div class="header-actions header-actions--compact">
              <span class="status-chip status-chip--soft">Step 3</span>
              <t-button size="small" variant="outline" @click="loadAssets">同步资产</t-button>
            </div>
          </div>

          <label class="field-stack">
            <span class="field-label">digitalHumanId</span>
            <input v-model="form.digitalHumanId" class="plain-input" placeholder="输入训练页生成的 digitalHumanId" />
          </label>

          <div v-if="assets.length" class="chip-list">
            <button
              v-for="asset in assets"
              :key="asset.digitalHumanId"
              type="button"
              class="asset-chip"
              :class="{ 'asset-chip--active': form.digitalHumanId === asset.digitalHumanId }"
              @click="selectAsset(asset.digitalHumanId)"
            >
              {{ asset.name }}
            </button>
          </div>

          <div class="stat-grid">
            <div class="metric-card">
              <span>当前数字人</span>
              <strong>{{ currentAsset?.name || '未选择' }}</strong>
            </div>
            <div class="metric-card">
              <span>数字人状态</span>
              <strong>{{ currentAsset?.status || '未就绪' }}</strong>
            </div>
            <div class="metric-card">
              <span>生成任务状态</span>
              <strong>{{ generation.status }}</strong>
            </div>
          </div>

          <section class="progress-panel progress-panel--embedded">
            <div class="progress-head">
              <div>
                <h3>视频生成进度</h3>
                <p class="panel-copy">{{ generation.message }}</p>
              </div>
              <strong class="progress-value">{{ generation.progress }}%</strong>
            </div>
            <t-progress :percentage="generation.progress" theme="plump" :status="generationProgressStatus" />
            <div class="progress-steps">
              <span :class="{ active: generation.progress >= 5 }">1. TTS 合成</span>
              <span :class="{ active: generation.progress >= 18 }">2. 提交数字人任务</span>
              <span :class="{ active: generation.progress >= 20 }">3. 轮询真实进度</span>
              <span :class="{ active: generation.progress >= 100 }">4. 输出成片</span>
            </div>
          </section>

          <div class="panel-actions">
            <t-button theme="primary" :loading="generating" @click="handleGenerate">生成数字人口播</t-button>
          </div>

          <t-alert theme="info" :message="lastMessage" />
        </section>
      </div>

      <div class="creation-bottom-row">
        <section class="panel creation-panel creation-panel--publish">
          <div class="section-head">
            <div>
              <h3>矩阵号一键发布</h3>
              <p class="panel-copy">先按平台选择账号，再点发布。系统会先弹出一个发布窗口，让你决定用不用 AI 建议。</p>
            </div>
            <span class="status-chip status-chip--soft">Step 4</span>
          </div>

          <div class="publish-platform-grid">
            <article v-for="platform in publishPlatforms" :key="platform.key" class="publish-platform-card">
              <div class="publish-platform-head">
                <div class="publish-platform-title">
                  <span class="platform-badge platform-badge--large">{{ platform.badge }}</span>
                  <div>
                    <strong>{{ platform.label }}</strong>
                    <p>{{ platform.accountCount }} 个账号</p>
                  </div>
                </div>
                <span class="status-chip status-chip--soft">{{ platform.accountCount }} Accounts</span>
              </div>

              <label class="field-stack">
                <span class="field-label">选择账号</span>
                <select v-model="publishSelection[platform.key]" class="plain-select">
                  <option value="">请选择账号</option>
                  <option v-for="account in platform.accounts" :key="account.accountId" :value="account.accountId">
                    {{ account.accountName }} · {{ account.statusLabel }} · 今日 {{ account.todayPublishedCount }} 条
                  </option>
                </select>
              </label>

              <div class="publish-account-summary">
                <template v-if="getSelectedPublishAccount(platform.key)">
                  <div>
                    <span>状态</span>
                    <strong>{{ getSelectedPublishAccount(platform.key)?.statusLabel }}</strong>
                  </div>
                  <div>
                    <span>今天发了几条</span>
                    <strong>{{ getSelectedPublishAccount(platform.key)?.todayPublishedCount }}</strong>
                  </div>
                </template>
                <template v-else>
                  <div>
                    <span>状态</span>
                    <strong>待选择</strong>
                  </div>
                  <div>
                    <span>提示</span>
                    <strong>先去矩阵号管理页录入账号</strong>
                  </div>
                </template>
              </div>

              <div class="panel-actions panel-actions--between">
                <t-button variant="outline" @click="goToMatrixPage">管理账号</t-button>
                <t-button theme="primary" @click="openPublishDialog(platform.key)">发布到{{ platform.label }}</t-button>
              </div>

              <div v-if="latestPublishJobs[platform.key]" class="publish-job-card">
                <div class="job-card-head">
                  <div>
                    <strong>{{ latestPublishJobs[platform.key].accountName }}</strong>
                    <p>{{ formatDateTime(latestPublishJobs[platform.key].updatedAt) }}</p>
                  </div>
                  <span class="account-status-pill" :data-status="latestPublishJobs[platform.key].status">
                    {{ latestPublishJobs[platform.key].statusLabel || latestPublishJobs[platform.key].status }}
                  </span>
                </div>
                <div class="job-progress-line">
                  <div class="job-progress-bar" :style="{ width: `${latestPublishJobs[platform.key].progress || 0}%` }" />
                </div>
                <p class="job-message">{{ latestPublishJobs[platform.key].message }}</p>
                <p v-if="latestPublishJobs[platform.key].errorMessage" class="card-inline-error">
                  {{ latestPublishJobs[platform.key].errorMessage }}
                </p>
              </div>
            </article>
          </div>
        </section>

        <section class="panel creation-panel creation-panel--result">
          <div class="section-head">
            <div>
              <h3>生成效果预览</h3>
              <p class="panel-copy">成片固定显示在这里。为了兼容性，我把视频组件改成了更稳的 source 写法，并保留了直接打开链接入口。</p>
            </div>
            <span class="status-chip status-chip--soft">{{ generationResultLabel }}</span>
          </div>

          <div v-if="generation.outputVideoUrl" class="result-card result-card--fixed">
            <MediaPreviewPlayer :src="toAbsoluteMediaUrl(generation.outputVideoUrl)" variant="landscape" />
            <div class="media-actions">
              <a class="media-link" :href="toAbsoluteMediaUrl(generation.outputVideoUrl)" target="_blank" rel="noreferrer">
                直接打开视频
              </a>
              <p class="result-path">输出文件：{{ generation.outputVideoPath }}</p>
            </div>
          </div>
          <div v-else-if="generation.status === 'failed'" class="empty-state empty-state--media empty-state--error">
            <strong>生成失败</strong>
            <p>{{ generation.errorMessage || generation.message }}</p>
          </div>
          <div v-else class="empty-state empty-state--media">
            <strong>等待生成视频</strong>
            <p>点击上方“生成数字人口播”后，成片会在这里单独展示。</p>
          </div>
        </section>
      </div>
    </div>

    <t-dialog
      v-model:visible="publishDialog.visible"
      :header="publishDialogHeader"
      width="760px"
      confirm-btn="发布"
      cancel-btn="取消"
      @confirm="handleConfirmPublish"
    >
      <div class="publish-dialog-body">
        <div class="publish-dialog-top">
          <div>
            <p class="section-kicker">Publish Draft</p>
            <h3 class="dialog-title">发布前确认标题和文案</h3>
            <p class="panel-copy">文案框可以直接包含正文和标签。点击右上角“使用 AI 建议”后，会自动按平台生成一版。</p>
          </div>
          <t-button theme="primary" variant="outline" :loading="publishDialog.aiLoading" @click="handleGenerateDraft">
            使用 AI 建议
          </t-button>
        </div>

        <label class="field-stack">
          <span class="field-label">标题</span>
          <input v-model="publishDialog.title" class="plain-input" placeholder="请输入发布标题" />
        </label>

        <label class="field-stack">
          <span class="field-label">文案与标签</span>
          <textarea
            v-model="publishDialog.content"
            class="plain-textarea plain-textarea--dialog"
            placeholder="这里填写正文和标签，例如正文换行后跟 #标签1 #标签2"
          />
        </label>

        <t-alert theme="info" :message="publishDialog.message" />
      </div>
    </t-dialog>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import MediaPreviewPlayer from '@/components/MediaPreviewPlayer.vue'
import {
  fetchAvatarJob,
  fetchDigitalHumanAssets,
  fetchPublishJobs,
  fetchPublishPlatforms,
  generatePublishDraft,
  streamCreativeBrief,
  streamRewriteCopy,
  submitAvatarGeneration,
  submitPublishJob
} from '@/services/api'

const STORAGE_KEY = 'duix.creation.page.state'

const router = useRouter()

const form = reactive({
  rewriteRequirement: '',
  douyinUrl: '',
  sourceCopy: '',
  rewrittenCopy: '',
  digitalHumanId: ''
})

const generation = reactive({
  jobId: '',
  status: '未开始',
  progress: 0,
  message: '等待发起生成任务',
  outputVideoUrl: '',
  outputVideoPath: '',
  digitalHumanId: '',
  taskCode: '',
  errorMessage: ''
})

const generating = ref(false)
const assets = ref([])
const pollingTimer = ref(null)
const publishJobsTimer = ref(null)
const publishPlatforms = ref([])
const publishJobs = ref([])
const publishSelection = reactive({
  douyin: '',
  xiaohongshu: ''
})

const publishDialog = reactive({
  visible: false,
  platformKey: '',
  title: '',
  content: '',
  message: '发布时会拉起你的浏览器，并继续接入自动填充标题、正文、标签和上传视频。',
  aiLoading: false
})

const progress = reactive({
  percent: 0,
  label: '等待用户发起请求',
  status: 'active'
})

const lastMessage = ref('这里会显示接口返回信息，方便你随时确认当前跑到了哪一步。')

const currentAsset = computed(() => {
  return assets.value.find((asset) => asset.digitalHumanId === form.digitalHumanId) || null
})

const generationProgressStatus = computed(() => {
  if (generation.status === 'failed') {
    return 'error'
  }

  if (generation.status === 'success') {
    return 'success'
  }

  return 'active'
})

const generationResultLabel = computed(() => {
  if (generation.outputVideoUrl) {
    return 'Ready'
  }

  if (generation.status === 'failed') {
    return 'Failed'
  }

  if (generation.jobId && !['success', 'failed'].includes(generation.status)) {
    return 'Generating'
  }

  return 'Waiting'
})

const latestPublishJobs = computed(() => {
  return publishJobs.value.reduce((map, job) => {
    if (!map[job.platform]) {
      map[job.platform] = job
    }

    return map
  }, {})
})

const publishDialogHeader = computed(() => {
  const platform = publishPlatforms.value.find((item) => item.key === publishDialog.platformKey)
  return platform ? `发布到${platform.label}` : '发布前确认'
})

function toAbsoluteMediaUrl(relativeUrl) {
  if (!relativeUrl) {
    return ''
  }

  if (/^https?:\/\//i.test(relativeUrl)) {
    return relativeUrl
  }

  const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3010/api'
  const origin = baseURL.replace(/\/api\/?$/, '')
  return `${origin}${relativeUrl}`
}

function formatDateTime(value) {
  if (!value) {
    return '未记录'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '未记录'
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getSelectedPublishAccount(platformKey) {
  const platform = publishPlatforms.value.find((item) => item.key === platformKey)

  if (!platform) {
    return null
  }

  return platform.accounts.find((account) => account.accountId === publishSelection[platformKey]) || null
}

function savePageState() {
  if (typeof window === 'undefined') {
    return
  }

  const snapshot = {
    form: { ...form },
    generation: { ...generation },
    progress: { ...progress },
    publishSelection: { ...publishSelection },
    lastMessage: lastMessage.value
  }

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

function restorePageState() {
  if (typeof window === 'undefined') {
    return
  }

  const raw = window.sessionStorage.getItem(STORAGE_KEY)

  if (!raw) {
    return
  }

  try {
    const snapshot = JSON.parse(raw)
    Object.assign(form, snapshot.form || {})
    Object.assign(generation, snapshot.generation || {})
    Object.assign(progress, snapshot.progress || {})
    Object.assign(publishSelection, snapshot.publishSelection || {})
    lastMessage.value = snapshot.lastMessage || lastMessage.value
  } catch (error) {
    window.sessionStorage.removeItem(STORAGE_KEY)
  }
}

function clearPageState() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(STORAGE_KEY)
}

function resetFormState() {
  form.rewriteRequirement = ''
  form.douyinUrl = ''
  form.sourceCopy = ''
  form.rewrittenCopy = ''
  form.digitalHumanId = ''
  publishSelection.douyin = ''
  publishSelection.xiaohongshu = ''
}

function resetProgress(label = '等待用户发起请求') {
  progress.percent = 0
  progress.label = label
  progress.status = 'active'
}

function updateProgress(percent, label, status = 'active') {
  progress.percent = percent
  progress.label = label
  progress.status = status
}

function appendText(field, text) {
  if (!text) {
    return
  }

  form[field] = `${form[field]}${text}`
}

function stopPolling() {
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }
}

function resetGenerationState() {
  generation.jobId = ''
  generation.status = '未开始'
  generation.progress = 0
  generation.message = '等待发起生成任务'
  generation.outputVideoUrl = ''
  generation.outputVideoPath = ''
  generation.digitalHumanId = ''
  generation.taskCode = ''
  generation.errorMessage = ''
}

function applyJobState(job) {
  generation.jobId = job.jobId || generation.jobId
  generation.status = job.status || generation.status
  generation.progress = Number(job.progress || 0)
  generation.message = job.message || generation.message
  generation.outputVideoUrl = job.outputVideoUrl || generation.outputVideoUrl
  generation.outputVideoPath = job.outputVideoPath || generation.outputVideoPath
  generation.digitalHumanId = job.digitalHumanId || generation.digitalHumanId
  generation.taskCode = job.taskCode || generation.taskCode
  generation.errorMessage = job.errorMessage || ''
}

function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || '请求失败'
}

function selectAsset(digitalHumanId) {
  form.digitalHumanId = digitalHumanId
}

function handleClear() {
  stopPolling()
  generating.value = false
  resetFormState()
  resetGenerationState()
  resetProgress()
  lastMessage.value = '这里会显示接口返回信息，方便你随时确认当前跑到了哪一步。'
  clearPageState()
  MessagePlugin.success('已清除当前创作内容')
}

async function loadAssets() {
  try {
    const result = await fetchDigitalHumanAssets()
    assets.value = result.assets || []

    if (!form.digitalHumanId && assets.value.length) {
      form.digitalHumanId = assets.value[0].digitalHumanId
    }
  } catch (error) {
    lastMessage.value = getErrorMessage(error)
  }
}

async function loadPublishPlatforms() {
  try {
    const result = await fetchPublishPlatforms()
    publishPlatforms.value = result.platforms || []
  } catch (error) {
    lastMessage.value = getErrorMessage(error)
  }
}

async function loadPublishJobs() {
  try {
    const result = await fetchPublishJobs()
    publishJobs.value = result.jobs || []
  } catch (error) {
    lastMessage.value = getErrorMessage(error)
  }
}

async function pollGenerationJob(jobId) {
  try {
    const result = await fetchAvatarJob(jobId)
    const job = result.job

    applyJobState(job)
    lastMessage.value = job.message || lastMessage.value

    if (job.status === 'success') {
      generating.value = false
      stopPolling()
      MessagePlugin.success('数字人口播生成完成')
      return
    }

    if (job.status === 'failed') {
      generating.value = false
      stopPolling()
      lastMessage.value = job.errorMessage || job.message || '数字人口播生成失败'
      MessagePlugin.error(lastMessage.value)
    }
  } catch (error) {
    generating.value = false
    stopPolling()
    lastMessage.value = getErrorMessage(error)
    MessagePlugin.error(lastMessage.value)
  }
}

function startPolling(jobId) {
  stopPolling()
  pollingTimer.value = window.setInterval(() => {
    pollGenerationJob(jobId)
  }, 3000)
}

function startPublishJobsPolling() {
  stopPublishJobsPolling()
  publishJobsTimer.value = window.setInterval(() => {
    loadPublishJobs()
  }, 4000)
}

function stopPublishJobsPolling() {
  if (publishJobsTimer.value) {
    clearInterval(publishJobsTimer.value)
    publishJobsTimer.value = null
  }
}

async function handleParse() {
  try {
    form.sourceCopy = ''
    updateProgress(5, '已提交原始文案提取请求')

    await streamCreativeBrief(
      {
        rewriteRequirement: form.rewriteRequirement,
        douyinUrl: form.douyinUrl
      },
      (event) => {
        if (event.type === 'stage') {
          updateProgress(event.percent || progress.percent, event.label || progress.label)
          return
        }

        if (event.type === 'delta') {
          appendText('sourceCopy', event.text)
          updateProgress(
            event.percent || Math.min(progress.percent + 2, 98),
            event.total ? `正在回传原始文案 ${event.index}/${event.total}` : '正在回传原始文案'
          )
          return
        }

        if (event.type === 'done') {
          form.sourceCopy = event.data?.sourceCopy || form.sourceCopy
          lastMessage.value = event.message || '已完成原始文案提取'
          updateProgress(100, event.label || '原始口播文案提取完成', 'success')
        }
      }
    )

    MessagePlugin.success('已提取原始文案')
  } catch (error) {
    lastMessage.value = getErrorMessage(error)
    updateProgress(100, '原始口播文案提取失败', 'error')
    MessagePlugin.error(lastMessage.value)
  }
}

async function handleRewrite() {
  try {
    form.rewrittenCopy = ''
    updateProgress(5, '已提交文案改写请求')

    await streamRewriteCopy(
      {
        rewriteRequirement: form.rewriteRequirement,
        sourceCopy: form.sourceCopy
      },
      (event) => {
        if (event.type === 'stage') {
          updateProgress(event.percent || progress.percent, event.label || progress.label)
          return
        }

        if (event.type === 'delta') {
          appendText('rewrittenCopy', event.text)
          updateProgress(Math.min(progress.percent + 3, 92), '改写文案正在流式生成')
          return
        }

        if (event.type === 'done') {
          form.rewrittenCopy = event.data?.rewrittenCopy || form.rewrittenCopy
          lastMessage.value = event.message || '已完成文案改写'
          updateProgress(100, event.label || '文案改写完成', 'success')
        }
      }
    )

    MessagePlugin.success('已完成文案改写')
  } catch (error) {
    lastMessage.value = getErrorMessage(error)
    updateProgress(100, '文案改写失败', 'error')
    MessagePlugin.error(lastMessage.value)
  }
}

async function handleGenerate() {
  if (!form.digitalHumanId.trim()) {
    MessagePlugin.warning('请先输入 digitalHumanId')
    return
  }

  generating.value = true
  resetGenerationState()

  try {
    const result = await submitAvatarGeneration({
      digitalHumanId: form.digitalHumanId,
      rewriteRequirement: form.rewriteRequirement,
      sourceCopy: form.sourceCopy,
      rewrittenCopy: form.rewrittenCopy
    })

    const job = result.job
    applyJobState(job)
    lastMessage.value = result.message || '数字人生成任务已创建'

    startPolling(job.jobId)
    await pollGenerationJob(job.jobId)
  } catch (error) {
    generating.value = false
    generation.status = 'failed'
    generation.message = '数字人口播生成失败'
    generation.errorMessage = getErrorMessage(error)
    lastMessage.value = generation.errorMessage
    MessagePlugin.error(lastMessage.value)
  }
}

function goToMatrixPage() {
  router.push('/matrix-accounts')
}

function openPublishDialog(platformKey) {
  const accountId = publishSelection[platformKey]

  if (!generation.outputVideoPath) {
    MessagePlugin.warning('请先生成数字人口播视频')
    return
  }

  if (!accountId) {
    MessagePlugin.warning('请先选择发布账号')
    return
  }

  publishDialog.visible = true
  publishDialog.platformKey = platformKey
  publishDialog.title = ''
  publishDialog.content = ''
  publishDialog.message = '你可以手动填写标题和文案，也可以点击右上角“使用 AI 建议”生成一版。'
}

async function handleGenerateDraft() {
  publishDialog.aiLoading = true

  try {
    const account = getSelectedPublishAccount(publishDialog.platformKey)
    const result = await generatePublishDraft({
      platform: publishDialog.platformKey,
      accountName: account?.accountName || '',
      rewriteRequirement: form.rewriteRequirement,
      sourceCopy: form.sourceCopy,
      rewrittenCopy: form.rewrittenCopy
    })

    publishDialog.title = result.draft?.title || ''
    publishDialog.content = [result.draft?.content || '', result.draft?.tagsText || ''].filter(Boolean).join('\n')
    publishDialog.message = result.message || '已生成 AI 建议，你可以继续微调后再发布。'
    MessagePlugin.success('已生成 AI 建议')
  } catch (error) {
    publishDialog.message = getErrorMessage(error)
    MessagePlugin.error(publishDialog.message)
  } finally {
    publishDialog.aiLoading = false
  }
}

async function handleConfirmPublish() {
  try {
    const platformKey = publishDialog.platformKey
    const accountId = publishSelection[platformKey]

    const result = await submitPublishJob({
      platform: platformKey,
      accountId,
      videoPath: generation.outputVideoPath,
      sourceCopy: form.sourceCopy,
      rewrittenCopy: form.rewrittenCopy,
      rewriteRequirement: form.rewriteRequirement,
      title: publishDialog.title,
      content: publishDialog.content,
      tagsText: ''
    })

    publishDialog.visible = false
    lastMessage.value = result.message || '发布任务已创建'
    MessagePlugin.success('浏览器发布页已打开')
    await Promise.all([loadPublishPlatforms(), loadPublishJobs()])
  } catch (error) {
    publishDialog.message = getErrorMessage(error)
    MessagePlugin.error(publishDialog.message)
  }
}

watch(
  [
    () => ({ ...form }),
    () => ({ ...generation }),
    () => ({ ...progress }),
    () => ({ ...publishSelection }),
    () => lastMessage.value
  ],
  () => {
    savePageState()
  },
  {
    deep: true
  }
)

onMounted(() => {
  restorePageState()
  loadAssets()
  loadPublishPlatforms()
  loadPublishJobs()
  startPublishJobsPolling()

  if (generation.jobId && !['success', 'failed'].includes(generation.status)) {
    generating.value = true
    startPolling(generation.jobId)
    void pollGenerationJob(generation.jobId)
  }
})

onBeforeUnmount(() => {
  stopPolling()
  stopPublishJobsPolling()
})
</script>
