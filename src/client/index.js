import { NS } from './constants.js'
import { h } from './dom.js'
import { DICTS } from './i18n/index.js'
import { SidebarIcon, TodayGlyph } from './icons.js'
import { GanttPage } from './pages/gantt.js'
import { TodayPage } from './pages/today.js'

// The browser half of the plugin: registers the two sidebar entries and the two
// keyed main pages. The host context is passed into each page component at
// registration, so no plugin-scoped state lives in module scope.
/** Plugin descriptor consumed by the DSH client module loader. */
export const plugin = {
  inject: ['slots', 'locale'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, DICTS), 'gantt: locale dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'gantt',
      order: 20,
      label: () => t('nav.label'),
    }, SidebarIcon))
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: 'gantt',
    }, () => h(GanttPage, { ctx })))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'today',
      order: 21,
      label: () => t('nav.today'),
    }, TodayGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: 'today',
    }, () => h(TodayPage, { ctx })))
  },
}
