import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

// Hash history keeps deep links working on GitHub Pages (and fully offline)
// without needing a server-side 404 → index.html rewrite.
export const routes = [
  { path: '/', name: 'home', component: HomeView },
  {
    path: '/vocab',
    name: 'vocab',
    component: () => import('../views/VocabView.vue'),
  },
  {
    path: '/declension',
    name: 'declension',
    component: () => import('../views/DeclensionView.vue'),
  },
  {
    path: '/phrases',
    name: 'phrases',
    component: () => import('../views/PhraseTesterView.vue'),
  },
  {
    path: '/progress',
    name: 'progress',
    component: () => import('../views/ProgressView.vue'),
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
