import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

// Hash history keeps deep links working on GitHub Pages (and fully offline)
// without needing a server-side 404 → index.html rewrite.
export const routes = [
  { path: '/', name: 'home', component: HomeView },
  {
    path: '/session',
    name: 'session',
    component: () => import('../views/SessionView.vue'),
  },
  {
    path: '/batch',
    name: 'batch',
    component: () => import('../views/BatchSelectView.vue'),
  },
  {
    path: '/progress',
    name: 'progress',
    component: () => import('../views/ProgressView.vue'),
  },
  {
    path: '/data',
    name: 'data',
    component: () => import('../views/DataView.vue'),
  },
  {
    path: '/vocab',
    name: 'vocab',
    component: () => import('../views/VocabView.vue'),
  },
  {
    path: '/declension',
    name: 'declension',
    component: () => import('../views/InflectionView.vue'),
    props: { pos: 'noun' },
  },
  {
    path: '/verbs',
    name: 'verbs',
    component: () => import('../views/InflectionView.vue'),
    props: { pos: 'verb' },
  },
  {
    path: '/pronouns',
    name: 'pronouns',
    component: () => import('../views/InflectionView.vue'),
    props: { pos: 'pronoun' },
  },
  {
    path: '/adjectives',
    name: 'adjectives',
    component: () => import('../views/InflectionView.vue'),
    props: { pos: 'adjective' },
  },
  {
    path: '/numbers',
    name: 'numbers',
    component: () => import('../views/NumberDrillView.vue'),
  },
  {
    path: '/phrases',
    name: 'phrases',
    component: () => import('../views/PhraseTesterView.vue'),
  },
  {
    path: '/listening',
    name: 'listening',
    component: () => import('../views/ListeningView.vue'),
  },
  {
    path: '/speaking',
    name: 'speaking',
    component: () => import('../views/SpeakingView.vue'),
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
