import { NS } from './constants.js'
import { h } from './dom.js'
import { DICTS } from './i18n/index.js'
import { SidebarIcon, TodayGlyph } from './icons.js'
import { GanttPage } from './pages/gantt.js'
import { GanttPanel } from './pages/panel.js'
import { TodayPage } from './pages/today.js'
import { GanttWorkbench } from './pages/workbench.js'
import { installPanelCapture, restorePanel } from './panel-session.js'
import { resumeHandedSession } from './session-window.js'

// The browser half of the plugin: registers the two sidebar entries, the two
// keyed main pages, and (when dsh-better-sidebar is installed) the compact tree
// and the workbench as native conversation-sidebar tabs. The host context is
// passed into every component at registration, so no plugin-scoped state lives
// in module scope.
/** Plugin descriptor consumed by the DSH client module loader. */
export const plugin = {
  inject: ['slots', 'locale'],
  apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, DICTS), 'gantt: locale dictionaries')
    // Installed before the `main` entries so its unload cleanup still sees the
    // selected page while they unregister; the next apply restores it.
    installPanelCapture(ctx)
    const t = ctx.locale.bind(NS)
    // A window opened by the workbench's execute button carries its target
    // conversation in a short-lived handoff; select it once the catalog is ready.
    resumeHandedSession(ctx)
    // Contribute the compact tree and the workbench as tabs of the native
    // conversation sidebar. A host without dsh-better-sidebar simply never
    // resolves this injection.
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
        ctx.effect(() => injected.betterSidebar.registerTab({
          id: 'gantt-work',
          title: () => t('panel.workbench'),
          description: () => t('workbench.description'),
          order: 23,
          single: true,
          component: props => h(GanttWorkbench, { ctx: props.ctx, scope: props.scope, visible: props.visible }),
        }), 'gantt: workbench tab')
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
    // 19, not 20: dsh-context's overview entry also claims order 20, and the
    // Today row must sit directly above the gantt row, with no tie that another
    // panel could interleave.
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'today',
      order: 19,
      label: () => t('nav.today'),
    }, TodayGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: 'today',
    }, () => h(TodayPage, { ctx })))
    // After both keyed entries exist: the layout rejects an unknown panel id.
    restorePanel(ctx)
  },
}
