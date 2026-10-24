import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { CONVERTERS } from '../config/converters'

const routes: RouteRecordRaw[] = CONVERTERS.map((converter) => ({
  path: converter.path,
  name: converter.name,
  component: () => import('../views/ConverterView.vue'),
  props: {
    from: converter.from,
    to: converter.to,
  },
  meta: { title: converter.title },
}))

routes.push(
  {
    path: '/privacy',
    name: 'privacy',
    component: () => import('../views/PrivacyView.vue'),
    meta: { title: '使用条款' },
  },
  { path: '/', redirect: CONVERTERS[0].path },
  { path: '/:pathMatch(.*)*', redirect: CONVERTERS[0].path },
)

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const converter = CONVERTERS.find((item) => item.path === to.path)
  const pageTitle = typeof to.meta.title === 'string' ? to.meta.title : null

  if (converter) {
    document.title = `∮ ${converter.title}`
  } else if (pageTitle) {
    document.title = `∮ ${pageTitle}`
  } else {
    document.title = '∮ 转换器'
  }
})

export default router
