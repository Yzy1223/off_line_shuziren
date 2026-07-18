<template>
  <div class="media-player" :class="rootClass">
    <div class="media-player__viewport" @click="togglePlayback">
      <video
        ref="videoRef"
        class="media-player__video"
        preload="metadata"
        playsinline
        crossorigin="anonymous"
        :src="src"
        @loadedmetadata="handleLoadedMetadata"
        @timeupdate="handleTimeUpdate"
        @play="state.playing = true"
        @pause="state.playing = false"
        @ended="handleEnded"
        @error="handleError"
      />

      <button
        v-if="!state.playing"
        type="button"
        class="media-player__center-button"
        @click.stop="togglePlayback"
      >
        ▶
      </button>

      <div v-if="state.errorMessage" class="media-player__badge media-player__badge--error">
        {{ state.errorMessage }}
      </div>
      <div v-else class="media-player__badge">
        {{ timeLabel }}
      </div>
    </div>

    <div class="media-player__controls">
      <button type="button" class="media-player__action" @click="togglePlayback">
        {{ state.playing ? '暂停' : '播放' }}
      </button>
      <button type="button" class="media-player__action" @click="restartPlayback">重播</button>
      <button type="button" class="media-player__action" @click="toggleMute">
        {{ state.muted ? '开声音' : '静音' }}
      </button>
      <a class="media-player__link" :href="src" target="_blank" rel="noreferrer">直接打开</a>
    </div>

    <div class="media-player__timeline">
      <span>{{ formatTime(state.currentTime) }}</span>
      <input
        class="media-player__range"
        type="range"
        min="0"
        :max="state.duration || 0"
        :value="state.currentTime"
        step="0.1"
        @input="handleSeek"
      />
      <span>{{ formatTime(state.duration) }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps({
  src: {
    type: String,
    default: ''
  },
  variant: {
    type: String,
    default: 'landscape'
  }
})

const videoRef = ref(null)

const state = reactive({
  playing: false,
  muted: false,
  currentTime: 0,
  duration: 0,
  errorMessage: ''
})

const rootClass = computed(() => {
  return props.variant === 'portrait' ? 'media-player--portrait' : 'media-player--landscape'
})

const timeLabel = computed(() => {
  if (state.errorMessage) {
    return state.errorMessage
  }

  if (!state.duration) {
    return '等待加载'
  }

  return `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`
})

function formatTime(value) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0
  const minutes = Math.floor(safeValue / 60)
  const seconds = Math.floor(safeValue % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

async function togglePlayback() {
  const video = videoRef.value

  if (!video || !props.src) {
    return
  }

  state.errorMessage = ''

  if (video.paused) {
    try {
      await video.play()
    } catch (error) {
      state.errorMessage = error?.message || '播放失败'
    }
    return
  }

  video.pause()
}

function restartPlayback() {
  const video = videoRef.value

  if (!video) {
    return
  }

  video.currentTime = 0
  togglePlayback()
}

function toggleMute() {
  const video = videoRef.value

  if (!video) {
    return
  }

  video.muted = !video.muted
  state.muted = video.muted
}

function handleSeek(event) {
  const video = videoRef.value

  if (!video) {
    return
  }

  const nextTime = Number(event.target.value || 0)
  video.currentTime = nextTime
  state.currentTime = nextTime
}

function handleLoadedMetadata() {
  const video = videoRef.value

  if (!video) {
    return
  }

  state.duration = Number.isFinite(video.duration) ? video.duration : 0
  state.currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0
  state.muted = video.muted
  state.errorMessage = ''
}

function handleTimeUpdate() {
  const video = videoRef.value

  if (!video) {
    return
  }

  state.currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0
}

function handleEnded() {
  state.playing = false
}

function handleError() {
  state.errorMessage = '视频加载失败'
  state.playing = false
}

watch(
  () => props.src,
  () => {
    state.playing = false
    state.currentTime = 0
    state.duration = 0
    state.errorMessage = ''
  }
)
</script>
