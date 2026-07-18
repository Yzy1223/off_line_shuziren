<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-top">
        <p class="eyebrow">Duix Studio</p>
        <h1>数字人口播工作台</h1>
        <p class="sidebar-copy">
          一套页面里串起爆款拆解、文案改写、数字人生成和矩阵号发布，尽量让每一步都清楚可见。
        </p>
      </div>

      <nav class="nav">
        <RouterLink to="/" class="nav-link">
          <span class="nav-link-title">创作页</span>
          <small>拆解文案、生成视频、选择平台发布</small>
        </RouterLink>
        <RouterLink to="/avatar-train" class="nav-link">
          <span class="nav-link-title">数字人训练</span>
          <small>上传训练视频，沉淀可复用数字人资产</small>
        </RouterLink>
        <RouterLink to="/matrix-accounts" class="nav-link">
          <span class="nav-link-title">矩阵号管理</span>
          <small>管理抖音、小红书账号与 cookies 状态</small>
        </RouterLink>
      </nav>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>
