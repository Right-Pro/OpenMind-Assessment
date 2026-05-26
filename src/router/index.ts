import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView
  },
  {
    path: '/scales',
    name: 'scales',
    component: () => import('@/views/ScaleListView.vue')
  },
  {
    path: '/test/:scaleId',
    name: 'test',
    component: () => import('@/views/TestView.vue')
  },
  {
    path: '/result',
    name: 'result',
    component: () => import('@/views/ResultView.vue')
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('@/views/UserManagerView.vue')
  },
  {
    path: '/user/:id/history',
    name: 'userHistory',
    component: () => import('@/views/UserHistoryView.vue')
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue')
  },
  {
    path: '/scale-editor',
    name: 'scaleEditor',
    component: () => import('@/views/ScaleEditorView.vue')
  },
  {
    path: '/appointments',
    name: 'appointments',
    component: () => import('@/views/AppointmentManagerView.vue')
  },
  {
    path: '/package-summary',
    name: 'packageSummary',
    component: () => import('@/views/PackageSummaryView.vue')
  },
  {
    path: '/data-analysis',
    name: 'dataAnalysis',
    component: () => import('@/views/DataAnalysisView.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
