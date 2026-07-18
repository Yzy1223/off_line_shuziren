<template>
  <section class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Matrix Hub</p>
        <h2>矩阵号管理</h2>
        <p class="page-subtitle">
          先选择平台，再点击接入账号，用浏览器扫码登录。登录完成后，系统会自动识别平台真实账号名并保存登录态；备注只是你内部管理这个号用的。
        </p>
      </div>
      <div class="header-actions">
        <t-button variant="outline" @click="loadPlatforms">刷新状态</t-button>
        <t-button theme="primary" @click="startCreateAccount">新增接入</t-button>
      </div>
    </header>

    <div class="matrix-layout">
      <aside class="panel matrix-sidebar">
        <div class="sidebar-section">
          <span class="section-kicker">平台切换</span>
          <div class="platform-menu">
            <button
              v-for="platform in platforms"
              :key="platform.key"
              type="button"
              class="platform-menu-item"
              :class="{ 'platform-menu-item--active': selectedPlatform === platform.key }"
              @click="selectPlatform(platform.key)"
            >
              <div>
                <strong>{{ platform.label }}</strong>
                <p>{{ platform.accountCount }} 个账号</p>
              </div>
              <span class="platform-badge">{{ platform.badge }}</span>
            </button>
          </div>
        </div>

        <div class="sidebar-section">
          <span class="section-kicker">接入设置</span>
          <div class="matrix-form">
            <label class="field-stack">
              <span class="field-label">平台</span>
              <select v-model="accountForm.platform" class="plain-select">
                <option v-for="platform in platforms" :key="platform.key" :value="platform.key">
                  {{ platform.label }}
                </option>
              </select>
            </label>

            <label class="field-stack">
              <span class="field-label">备注</span>
              <input
                v-model="accountForm.accountRemark"
                class="plain-input"
                placeholder="例如：女装主号 / 测试号 / 小红书穿搭号"
              />
            </label>

            <label class="field-stack">
              <span class="field-label">可选 Cookies</span>
              <textarea
                v-model="accountForm.cookieText"
                class="plain-textarea plain-textarea--cookies"
                placeholder="这里可以手动粘贴 cookies，也可以留空。更推荐直接点“接入账号”，用浏览器扫码登录并自动保存登录态。"
              />
            </label>

            <div class="panel-actions">
              <t-button theme="primary" :loading="saving" @click="handleOpenLoginFromForm">接入账号</t-button>
              <t-button v-if="accountForm.accountId" variant="outline" :loading="saving" @click="handleSaveAccount">
                保存备注
              </t-button>
              <t-button variant="outline" @click="resetAccountForm">清空表单</t-button>
            </div>
          </div>
        </div>
      </aside>

      <div class="matrix-main">
        <section class="panel panel--compact">
          <div class="section-head">
            <div>
              <h3>{{ currentPlatformLabel }}账号台账</h3>
              <p class="panel-copy">
                平台真实账号名会在登录后自动识别；这里展示每个号的登录态、备注、最近登录时间、最近发布状态和今天发了几条。
              </p>
            </div>
            <span class="status-chip status-chip--soft">{{ currentAccounts.length }} 个账号</span>
          </div>

          <div v-if="currentAccounts.length" class="matrix-account-grid">
            <article v-for="account in currentAccounts" :key="account.accountId" class="matrix-account-card">
              <div class="matrix-account-head">
                <div>
                  <div class="matrix-account-title">
                    <strong>{{ account.accountName || '待识别账号' }}</strong>
                    <span class="inline-badge">{{ account.platformBadge }}</span>
                  </div>
                  <p class="matrix-account-note">{{ account.accountRemark || '未填写备注' }}</p>
                </div>
                <span class="account-status-pill" :data-status="account.status">{{ account.statusLabel }}</span>
              </div>

              <dl class="matrix-account-meta">
                <div>
                  <dt>今天发了几条</dt>
                  <dd>{{ account.todayPublishedCount }}</dd>
                </div>
                <div>
                  <dt>登录态 / 会话</dt>
                  <dd>{{ account.cookieSummary }}</dd>
                </div>
                <div>
                  <dt>最近登录</dt>
                  <dd>{{ formatDateTime(account.lastLoginOpenedAt) }}</dd>
                </div>
                <div>
                  <dt>最近发布</dt>
                  <dd>{{ formatDateTime(account.lastPublishedAt) }}</dd>
                </div>
              </dl>

              <p v-if="account.lastError" class="card-inline-error">{{ account.lastError }}</p>

              <div class="panel-actions matrix-actions">
                <t-button size="small" variant="outline" @click="editAccount(account)">编辑备注</t-button>
                <t-button size="small" variant="outline" @click="handleCheckAccount(account.accountId)">检查状态</t-button>
                <t-button size="small" theme="primary" variant="outline" @click="handleOpenLogin(account)">重新登录</t-button>
                <t-button size="small" theme="danger" variant="outline" @click="handleDeleteAccount(account.accountId)">删除</t-button>
              </div>
            </article>
          </div>
          <div v-else class="empty-state">
            <strong>{{ currentPlatformLabel }}还没有接入账号</strong>
            <p>先在左侧选择平台，可选填备注，然后点击“接入账号”扫码登录。账号名会由系统登录后自动识别。</p>
          </div>
        </section>

        <section class="panel panel--compact">
          <div class="section-head">
            <div>
              <h3>最近发布记录</h3>
              <p class="panel-copy">这里会显示每次发布任务的进度、状态和错误信息，方便你回看每个账号当天的动作。</p>
            </div>
            <span class="status-chip status-chip--soft">{{ publishJobs.length }} 条任务</span>
          </div>

          <div v-if="publishJobs.length" class="job-list">
            <article v-for="job in publishJobs.slice(0, 8)" :key="job.jobId" class="job-card">
              <div class="job-card-head">
                <div>
                  <strong>{{ job.platformLabel }} / {{ job.accountName || '待识别账号' }}</strong>
                  <p>{{ formatDateTime(job.createdAt) }}</p>
                </div>
                <span class="account-status-pill" :data-status="job.status">{{ job.statusLabel || job.status }}</span>
              </div>
              <div class="job-progress-line">
                <div class="job-progress-bar" :style="{ width: `${job.progress || 0}%` }" />
              </div>
              <p class="job-message">{{ job.message || '等待任务状态' }}</p>
              <p v-if="job.errorMessage" class="card-inline-error">{{ job.errorMessage }}</p>
            </article>
          </div>
          <div v-else class="empty-state empty-state--short">
            <strong>还没有发布记录</strong>
            <p>创作页发起发布后，这里就会开始累计每个平台、每个账号的任务记录。</p>
          </div>
        </section>

        <t-alert theme="info" :message="feedback" />
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  checkPublishAccount,
  deletePublishAccount,
  fetchPublishJobs,
  fetchPublishPlatforms,
  openPublishLogin,
  savePublishAccount
} from '@/services/api'

const platforms = ref([])
const publishJobs = ref([])
const selectedPlatform = ref('douyin')
const saving = ref(false)
const publishJobsTimer = ref(null)
const feedback = ref('这里先管理矩阵号账号和浏览器登录态。账号名会在登录后自动识别。')

const accountForm = reactive({
  accountId: '',
  platform: 'douyin',
  accountRemark: '',
  cookieText: ''
})

const currentPlatform = computed(() => {
  return platforms.value.find((platform) => platform.key === selectedPlatform.value) || null
})

const currentPlatformLabel = computed(() => {
  return currentPlatform.value?.label || '当前平台'
})

const currentAccounts = computed(() => {
  return currentPlatform.value?.accounts || []
})

function getErrorMessage(error) {
  return error?.response?.data?.message || error?.message || '请求失败'
}

function formatDateTime(value) {
  if (!value) {
    return '未记录'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '未记录'
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function resetAccountForm() {
  accountForm.accountId = ''
  accountForm.platform = selectedPlatform.value || 'douyin'
  accountForm.accountRemark = ''
  accountForm.cookieText = ''
}

function startCreateAccount() {
  resetAccountForm()
}

function editAccount(account) {
  accountForm.accountId = account.accountId
  accountForm.platform = account.platform
  accountForm.accountRemark = account.accountRemark
  accountForm.cookieText = ''
}

function selectPlatform(platformKey) {
  selectedPlatform.value = platformKey

  if (!accountForm.accountId) {
    accountForm.platform = platformKey
  }
}

async function loadPlatforms() {
  try {
    const result = await fetchPublishPlatforms()
    platforms.value = result.platforms || []

    if (!platforms.value.find((platform) => platform.key === selectedPlatform.value) && platforms.value.length) {
      selectedPlatform.value = platforms.value[0].key
    }
  } catch (error) {
    feedback.value = getErrorMessage(error)
  }
}

async function loadPublishJobs() {
  try {
    const result = await fetchPublishJobs()
    publishJobs.value = result.jobs || []
  } catch (error) {
    feedback.value = getErrorMessage(error)
  }
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

async function handleSaveAccount() {
  if (!accountForm.accountId) {
    MessagePlugin.warning('请先接入账号，再保存备注')
    return null
  }

  saving.value = true

  try {
    const result = await savePublishAccount({
      accountId: accountForm.accountId,
      platform: accountForm.platform,
      accountRemark: accountForm.accountRemark,
      cookieText: accountForm.cookieText
    })

    feedback.value = result.message || '备注已保存'
    MessagePlugin.success(feedback.value)
    const savedAccount = result.account || null
    resetAccountForm()
    await loadPlatforms()
    return savedAccount
  } catch (error) {
    feedback.value = getErrorMessage(error)
    MessagePlugin.error(feedback.value)
    return null
  } finally {
    saving.value = false
  }
}

async function handleCheckAccount(accountId) {
  try {
    const result = await checkPublishAccount(accountId)
    feedback.value = result.message || '账号状态已刷新'
    MessagePlugin.success(feedback.value)
    await loadPlatforms()
  } catch (error) {
    feedback.value = getErrorMessage(error)
    MessagePlugin.error(feedback.value)
  }
}

async function handleOpenLogin(account) {
  try {
    const result = await openPublishLogin({
      platform: account.platform,
      accountId: account.accountId
    })

    feedback.value = result.message || '该账号的浏览器登录页已打开'
    MessagePlugin.success('浏览器已为这个账号打开。扫码登录后，回到这里点“检查状态”即可。')
    accountForm.accountId = result.result?.accountId || account.accountId
    await loadPlatforms()
  } catch (error) {
    feedback.value = getErrorMessage(error)
    MessagePlugin.error(feedback.value)
  }
}

async function handleOpenLoginFromForm() {
  saving.value = true

  try {
    const result = await openPublishLogin({
      platform: accountForm.platform || selectedPlatform.value,
      accountRemark: accountForm.accountRemark,
      cookieText: accountForm.cookieText
    })

    const connectedAccount = result.result || null
    feedback.value = result.message || '账号接入浏览器已打开'
    MessagePlugin.success('请在浏览器中扫码登录，完成后回到账号卡片点“检查状态”，系统会自动识别真实账号名。')

    if (connectedAccount?.accountId) {
      accountForm.accountId = connectedAccount.accountId
    }

    await Promise.all([loadPlatforms(), loadPublishJobs()])
  } catch (error) {
    feedback.value = getErrorMessage(error)
    MessagePlugin.error(feedback.value)
  } finally {
    saving.value = false
  }
}

async function handleDeleteAccount(accountId) {
  try {
    await deletePublishAccount(accountId)
    MessagePlugin.success('账号已删除')
    await loadPlatforms()
  } catch (error) {
    feedback.value = getErrorMessage(error)
    MessagePlugin.error(feedback.value)
  }
}

onMounted(async () => {
  await Promise.all([loadPlatforms(), loadPublishJobs()])
  resetAccountForm()
  startPublishJobsPolling()
})

onBeforeUnmount(() => {
  stopPublishJobsPolling()
})
</script>
