import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import TDesign from 'tdesign-vue-next'
import App from './App.vue'
import routes from './router'
import 'tdesign-vue-next/es/style/index.css'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
  routes
})

createApp(App).use(router).use(TDesign).mount('#app')
