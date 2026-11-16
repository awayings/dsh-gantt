import { NS } from './constants.js'
import { h } from './dom.js'
import { DICTS } from './i18n/index.js'
import { SidebarIcon, TodayGlyph } from './icons.js'
import { GanttPage } from './pages/gantt.js'
import { GanttPanel } from './pages/panel.js'
import { TodayPage } from './pages/today.js'

// The browser half of the plugin: registers the two sidebar entries, the two
// keyed main pages, and (when dsh-better-sidebar is installed) the compact tree
// as a native conversation-sidebar tab. The host context is passed into every
// component at registration, so no plugin-scoped state lives in module scope.
/** Plugin descriptor consumed by the DSH client module loader. */
export const plugin = {
  inject: ['slots', 'locale'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, DICTS), 'gantt: locale dictionaries')
    const t = ctx.locale.bind(NS)
    // Contribute the compact tree as a tab of the native conversation sidebar.
    // A host without dsh-better-sidebar simply never resolves this injection.
    if (typeof ctx.inject === 'function') {
      ctx.inject(['betterSidebar'], (injected) => {
        ctx.effect(() => injected.betterSidebar.registerTab({
          id: 'gantt',
          title: () => t('nav.label'),
          description: () => t('panel.description'),
          order: 22,
          single: true,
          component: props => h(GanttPanel, { ctx: props.ctx, scope: props.scope, visible: props.visible }),
        }), 'gantt: better-sidebar tab')
      })
    }
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
