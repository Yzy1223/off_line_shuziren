<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Avatar Assets</p>
        <h2>数字人训练素材管理</h2>
        <p class="page-subtitle">
          上传一个本地人物视频并命名，后端会自动完成转码、抽音频、参考文本预处理，并保存成可复用的数字人资产。
        </p>
      </div>
      <div class="status-chip">统一资产：视频 + 音色 + 参考文本</div>
    </header>

    <section class="panel">
      <div class="section-head">
        <div>
          <h3>训练数字人</h3>
          <p class="panel-copy">建议上传单人、正面、说话清楚、背景噪音少的视频。训练成功后，资产卡片会自动出现在下方。</p>
        </div>
        <span class="status-chip status-chip--soft">Train</span>
      </div>

      <div class="field-grid">
        <div class="field-stack">
          <label class="field-label">数字人名称</label>
          <t-input v-model="trainForm.name" placeholder="例如：女装 626A" />
        </div>
        <div class="field-stack">
          <label class="field-label">训练视频</label>
          <label class="upload-box">
            <input class="upload-input" type="file" accept="video/*" @change="handleFileChange" />
            <span>{{ trainForm.file ? trainForm.file.name : '点击选择本地训练视频' }}</span>
          </label>
        </div>
      </div>

      <section class="progress-panel progress-panel--embedded">
        <div class="progress-head">
          <div>
            <h3>训练进度</h3>
            <p class="panel-copy">{{ progress.label }}</p>
          </div>
          <strong class="progress-value">{{ progress.percent }}%</strong>
        </div>
        <t-progress :percentage="progress.percent" theme="plump" :status="progress.status" />
        <div class="progress-steps">
          <span :class="{ active: progress.percent >= 10 }">1. 已接收视频</span>
          <span :class="{ active: progress.percent >= 40 }">2. 转码与抽音频</span>
          <span :class="{ active: progress.percent >= 80 }">3. 参考预处理</span>
          <span :class="{ active: progress.percent >= 100 }">4. 保存资产</span>
        </div>
      </section>

      <div class="panel-actions">
        <t-button theme="primary" :loading="training" @click="handleTrain">开始训练</t-button>
        <t-button variant="outline" @click="loadAssets">刷新资产列表</t-button>
      </div>

      <t-alert theme="info" :message="feedback" />
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <h3>数字人资产卡片</h3>
          <p class="panel-copy">
            训练完成后可以在这里看到预览视频、数字人 ID 和参考文本，创作页会直接复用这些资产。
          </p>
        </div>
        <strong class="asset-count">{{ assets.length }} 个资产</strong>
      </div>

      <div v-if="assets.length" class="asset-grid">
        <article v-for="asset in assets" :key="asset.digitalHumanId" class="asset-card">
          <div v-if="asset.trainingVideoPreviewUrl" class="asset-media">
            <MediaPreviewPlayer :src="toAbsoluteMediaUrl(asset.trainingVideoPreviewUrl)" variant="portrait" />
          </div>

          <div class="asset-body">
            <div class="asset-meta">
              <span class="asset-status" :data-status="asset.status">{{ asset.status }}</span>
              <strong>{{ asset.name }}</strong>
            </div>
            <p class="asset-id">ID: {{ asset.digitalHumanId }}</p>
            <p class="asset-copy">参考文本：{{ asset.referenceText || '等待生成参考文本' }}</p>
            <p v-if="asset.errorMessage" class="asset-error">失败原因：{{ asset.errorMessage }}</p>
          </div>
        </article>
      </div>
      <t-empty v-else description="还没有训练完成的数字人资产" />
    </section>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import MediaPreviewPlayer from '@/components/MediaPreviewPlayer.vue'
import { fetchDigitalHumanAssets, uploadDigitalHumanAsset } from '@/services/api'

const trainForm = reactive({
  name: '',
  file: null
})

const training = ref(false)
const feedback = ref('训练完成后，数字人资产卡片会显示在下方。')
const assets = ref([])

const progress = reactive({
  percent: 0,
  label: '等待上传训练视频',
  status: 'active'
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

function resetProgress(label = '等待上传训练视频') {
  progress.percent = 0
  progress.label = label
  progress.status = 'active'
}

function updateProgress(percent, label, status = 'active') {
  progress.percent = percent
  progress.label = label
  progress.status = status
}

function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || '请求失败'
}

async function loadAssets() {
  try {
    const result = await fetchDigitalHumanAssets()
    assets.value = result.assets || []
  } catch (error) {
    feedback.value = getErrorMessage(error)
  }
}

function handleFileChange(event) {
  const file = event.target.files?.[0] || null
  trainForm.file = file

  if (file && !trainForm.name.trim()) {
    trainForm.name = file.name.replace(/\.[^.]+$/, '')
  }
}

async function handleTrain() {
  if (!trainForm.name.trim()) {
    MessagePlugin.warning('请先填写数字人名称')
    return
  }

  if (!trainForm.file) {
    MessagePlugin.warning('请先选择训练视频')
    return
  }

  training.value = true

  try {
    updateProgress(10, '训练视频已上传，后端正在接收文件')
    const request = uploadDigitalHumanAsset({
      file: trainForm.file,
      name: trainForm.name.trim()
    })
    updateProgress(40, '后端正在转码视频并提取参考音频')
    const result = await request
    updateProgress(80, '后端已完成参考音频预处理')

    feedback.value = result.message || '数字人资产训练完成。'
    updateProgress(100, '数字人资产已保存，可以去创作页使用这个 digitalHumanId', 'success')
    MessagePlugin.success('数字人训练完成')

    trainForm.file = null
    await loadAssets()
  } catch (error) {
    feedback.value = getErrorMessage(error)
    updateProgress(100, '数字人训练失败', 'error')
    MessagePlugin.error(feedback.value)
  } finally {
    training.value = false
  }
}

onMounted(() => {
  resetProgress()
  loadAssets()
})
</script>
