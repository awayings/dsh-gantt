window.__ModuleLoader__.load({
  id: '@local/dsh-gantt',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
      useSyncExternalStore,
    } = React

    // Slot components are rendered by the host, outside apply(). Keep the live
    // plugin context on the factory closure so page-level hooks can reach the
    // locale service.
    let runtime = null

    const NS = 'dsh-gantt'
    const DAY_MS = 86_400_000
    const STATUSES = ['todo', 'in_progress', 'blocked', 'done']
    const STATUS_COLOR = {
      todo: 'var(--dsw-alias-state-idle-primary)',
      in_progress: 'var(--dsw-alias-brand-primary)',
      blocked: 'var(--dsw-alias-state-error-primary)',
      done: 'var(--dsw-alias-state-success-primary)',
    }

    /** 英文文案。 */
    const DICT_EN = {
        'nav.label': 'Task Gantt',
        'page.title': 'Task Gantt',
        'page.subtitle': 'Plan, split, and track hierarchical work on a weekly or monthly timeline.',
        'actions.new': 'New task',
        'actions.today': 'Today',
        'actions.prev': 'Previous window',
        'actions.next': 'Next window',
        'actions.refresh': 'Refresh',
        'actions.api': 'API',
        'actions.seed': 'Load demo data',
        'actions.close': 'Close',
        'scale.label': 'Timeline scale',
        'scale.week': 'Week',
        'scale.month': 'Month',
        'scale.weekShort': 'Weekly view',
        'scale.monthShort': 'Monthly view',
        'stats.total': 'Total',
        'stats.inProgress': 'In progress',
        'stats.done': 'Done',
        'stats.overdue': 'Overdue',
        'stats.progress': 'Completion',
        'stats.tasks': 'tasks',
        'status.todo': 'To do',
        'status.in_progress': 'In progress',
        'status.blocked': 'Blocked',
        'status.done': 'Done',
        'status.summaryHint': 'Status is rolled up from subtasks',
        'status.cycleHint': 'Click to cycle status',
        'tree.task': 'Task',
        'tree.expand': 'Expand subtasks',
        'tree.collapse': 'Collapse subtasks',
        'tree.addChild': 'Add subtask',
        'empty.title': 'No tasks yet',
        'empty.body': 'Create the first task, or load a small demo tree to explore the timeline.',
        'empty.new': 'Create a task',
        'empty.seed': 'Load demo data',
        'loading': 'Loading tasks…',
        'error.title': 'Could not load tasks',
        'error.retry': 'Retry',
        'dialog.createTitle': 'New task',
        'dialog.editTitle': 'Edit task',
        'dialog.splitTitle': 'Split task',
        'dialog.apiTitle': 'Data API',
        'field.title': 'Title',
        'field.titlePlaceholder': 'What needs to be done?',
        'field.description': 'Description',
        'field.descriptionPlaceholder': 'Notes, acceptance criteria, links…',
        'field.parent': 'Parent task',
        'field.parentNone': 'No parent (top level)',
        'field.start': 'Start date',
        'field.end': 'End date',
        'field.status': 'Status',
        'field.progress': 'Progress',
        'field.progressHint': 'Drag to update; 100% marks the task done.',
        'field.summaryDates': 'Dates, status, and progress are rolled up from subtasks.',
        'dialog.save': 'Save',
        'dialog.create': 'Create',
        'dialog.cancel': 'Cancel',
        'dialog.delete': 'Delete',
        'dialog.deleteConfirm': 'Confirm delete',
        'dialog.split': 'Split',
        'dialog.addRow': 'Add subtask row',
        'dialog.removeRow': 'Remove row',
        'dialog.splitHint': 'Each row becomes a child task. The parent dates and progress follow its subtasks.',
        'dialog.splitChildTitle': 'Subtask title',
        'dialog.apiIntro': 'These JSON endpoints are mounted on the authenticated /api channel. The page and external callers share one task store.',
        'dialog.apiDb': 'SQLite database',
        'dialog.apiAuth': 'Authentication: the browser session cookie; no separate port or token.',
        'dialog.apiEmpty': 'Loading endpoint catalog…',
        'notice.created': 'Task created',
        'notice.saved': 'Task saved',
        'notice.deleted': 'Task deleted',
        'notice.split': 'Subtasks created',
        'notice.seeded': 'Demo data loaded',
        'notice.statusUpdated': 'Status updated',
        'validation.title': 'Enter a title.',
        'validation.dates': 'The end date cannot be before the start date.',
        'validation.splitChild': 'Every subtask needs a title and a valid date range.',
        'window.week': 'Weekly',
        'window.month': 'Monthly',
    }

    /** 中文文案。 */
    const DICT_ZH = {
        'nav.label': '任务甘特图',
        'page.title': '任务甘特图',
        'page.subtitle': '在周/月时间线上规划、拆分和跟踪层级任务，数据保存在本地 SQLite 数据库。',
        'actions.new': '新建任务',
        'actions.today': '今天',
        'actions.prev': '上一段',
        'actions.next': '下一段',
        'actions.refresh': '刷新',
        'actions.api': '接口',
        'actions.seed': '载入示例',
        'actions.close': '关闭',
        'scale.label': '时间粒度',
        'scale.week': '周',
        'scale.month': '月',
        'scale.weekShort': '周视图',
        'scale.monthShort': '月视图',
        'stats.total': '全部',
        'stats.inProgress': '进行中',
        'stats.done': '已完成',
        'stats.overdue': '已逾期',
        'stats.progress': '完成度',
        'stats.tasks': '个任务',
        'status.todo': '待开始',
        'status.in_progress': '进行中',
        'status.blocked': '受阻',
        'status.done': '已完成',
        'status.summaryHint': '状态由子任务汇总',
        'status.cycleHint': '点击切换状态',
        'tree.task': '任务',
        'tree.expand': '展开子任务',
        'tree.collapse': '收起子任务',
        'tree.addChild': '添加子任务',
        'empty.title': '还没有任务',
        'empty.body': '先创建一个任务，或者载入一组示例数据来体验时间线。',
        'empty.new': '创建任务',
        'empty.seed': '载入示例数据',
        'loading': '正在加载任务…',
        'error.title': '任务加载失败',
        'error.retry': '重试',
        'dialog.createTitle': '新建任务',
        'dialog.editTitle': '编辑任务',
        'dialog.splitTitle': '拆分任务',
        'dialog.apiTitle': '数据接口',
        'field.title': '标题',
        'field.titlePlaceholder': '要完成什么？',
        'field.description': '描述',
        'field.descriptionPlaceholder': '备注、验收标准、相关链接…',
        'field.parent': '父任务',
        'field.parentNone': '无父任务（顶层）',
        'field.start': '开始日期',
        'field.end': '结束日期',
        'field.status': '状态',
        'field.progress': '进度',
        'field.progressHint': '拖动调整；100% 会自动标记为已完成。',
        'field.summaryDates': '日期、状态和进度由子任务自动汇总。',
        'dialog.save': '保存',
        'dialog.create': '创建',
        'dialog.cancel': '取消',
        'dialog.delete': '删除',
        'dialog.deleteConfirm': '确认删除',
        'dialog.split': '拆分',
        'dialog.addRow': '添加一行',
        'dialog.removeRow': '删除这一行',
        'dialog.splitHint': '每一行会变成一个子任务，父任务的日期和进度将自动汇总。',
        'dialog.splitChildTitle': '子任务标题',
        'dialog.apiIntro': '以下 JSON 接口挂载在已认证的 /api 通道上，页面与外部调用共用同一个任务库。',
        'dialog.apiDb': 'SQLite 数据库',
        'dialog.apiAuth': '认证：浏览器会话 Cookie；不需要单独端口或令牌。',
        'dialog.apiEmpty': '正在读取接口目录…',
        'notice.created': '任务已创建',
        'notice.saved': '任务已保存',
        'notice.deleted': '任务已删除',
        'notice.split': '子任务已创建',
        'notice.seeded': '示例数据已载入',
        'notice.statusUpdated': '状态已更新',
        'validation.title': '请填写标题。',
        'validation.dates': '结束日期不能早于开始日期。',
        'validation.splitChild': '每个子任务都需要标题和有效的日期范围。',
        'window.week': '周视图',
        'window.month': '月视图',
    }

    /** 语言标签 → 字典，注册给 Client locale 服务。 */
    const DICTS = { en: DICT_EN, zh: DICT_ZH }

    const API_TEXT = {
      '/api/gantt/tree': {
        en: 'Read the task tree with hierarchical numbers, rollups, and stats.',
        zh: '读取任务树，包含层级编号、汇总进度和统计。',
      },
      '/api/gantt/meta': {
        en: 'Read the database location, status vocabulary, and this endpoint catalog.',
        zh: '读取数据库位置、状态取值和接口目录。',
      },
      '/api/gantt/tasks': {
        en: 'Create a task. Body: { title, parentId?, startDate?, endDate?, status?, progress?, description? }.',
        zh: '创建任务。Body：{ title, parentId?, startDate?, endDate?, status?, progress?, description? }。',
      },
      '/api/gantt/task/update': {
        en: 'Update task fields. Body: { id, title?, description?, parentId?, startDate?, endDate?, status?, progress? }.',
        zh: '更新任务字段。Body：{ id, title?, description?, parentId?, startDate?, endDate?, status?, progress? }。',
      },
      '/api/gantt/task/status': {
        en: 'Change only status and/or progress. Body: { id, status, progress? }.',
        zh: '只修改状态和/或进度。Body：{ id, status, progress? }。',
      },
      '/api/gantt/task/split': {
        en: 'Split a task into child subtasks. Body: { id, children: [{ title, startDate?, endDate?, status?, progress? }] }.',
        zh: '把任务拆成子任务。Body：{ id, children: [{ title, startDate?, endDate?, status?, progress? }] }。',
      },
      '/api/gantt/task/delete': {
        en: 'Delete a task and all of its descendants. Body: { id }.',
        zh: '删除任务及其全部后代。Body：{ id }。',
      },
      '/api/gantt/seed': {
        en: 'Insert a small demo tree when the database is empty.',
        zh: '数据库为空时插入一组示例任务。',
      },
    }

    function pad(value) {
      return String(value).padStart(2, '0')
    }

    function todayIso(now = new Date()) {
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }

    function isoToDay(iso) {
      const [year, month, day] = iso.split('-').map(Number)
      return Date.UTC(year, month - 1, day)
    }

    function dayToIso(day) {
      const date = new Date(day)
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    }

    function addDays(iso, days) {
      return dayToIso(isoToDay(iso) + days * DAY_MS)
    }

    function startOfWeek(iso) {
      const day = isoToDay(iso)
      const weekday = new Date(day).getUTCDay()
      return dayToIso(day - ((weekday + 6) % 7) * DAY_MS)
    }

    function startOfMonth(iso) {
      return `${iso.slice(0, 7)}-01`
    }

    function daysInMonth(iso) {
      const year = Number(iso.slice(0, 4))
      const month = Number(iso.slice(5, 7))
      return new Date(Date.UTC(year, month, 0)).getUTCDate()
    }

    function addMonths(iso, months) {
      const date = new Date(isoToDay(iso))
      const targetMonth = date.getUTCMonth() + months
      const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12)
      const normalizedMonth = ((targetMonth % 12) + 12) % 12
      const first = `${targetYear}-${pad(normalizedMonth + 1)}-01`
      const day = Math.min(date.getUTCDate(), daysInMonth(first))
      return `${targetYear}-${pad(normalizedMonth + 1)}-${pad(day)}`
    }

    function localeTag(locale) {
      return String(locale || 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
    }

    function formatDate(iso, locale, withYear) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        year: withYear ? 'numeric' : undefined,
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(isoToDay(iso)))
    }

    function formatMonth(iso, locale) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(isoToDay(iso)))
    }

    function formatMonthYear(iso, locale) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        year: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(isoToDay(iso)))
    }

    function formatYear(iso, locale) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(isoToDay(iso)))
    }

    function formatWeekday(iso, locale) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        weekday: 'narrow',
        timeZone: 'UTC',
      }).format(new Date(isoToDay(iso)))
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    function buildWindow(scale, anchor, today) {
      const pxPerDay = scale === 'week' ? 36 : 3.2
      if (scale === 'week') {
        const start = addDays(startOfWeek(anchor), -7)
        const totalDays = 28
        const startMs = isoToDay(start)
        const endMs = startMs + totalDays * DAY_MS
        const units = []
        for (let index = 0; index < totalDays; index += 1) {
          const iso = addDays(start, index)
          const weekday = new Date(isoToDay(iso)).getUTCDay()
          units.push({
            key: iso,
            startIso: iso,
            width: pxPerDay,
            isWeekend: weekday === 0 || weekday === 6,
            isToday: iso === today,
          })
        }
        const groups = []
        for (const unit of units) {
          const key = unit.startIso.slice(0, 7)
          let group = groups[groups.length - 1]
          if (!group || group.key !== key) {
            group = { key, startIso: unit.startIso, width: 0 }
            groups.push(group)
          }
          group.width += unit.width
        }
        const boundaries = []
        for (let index = 1; index < totalDays; index += 1) {
          const iso = addDays(start, index)
          const weekday = new Date(isoToDay(iso)).getUTCDay()
          boundaries.push({
            x: index * pxPerDay,
            strong: weekday === 1 || iso.endsWith('-01'),
          })
        }
        const todayMs = isoToDay(today)
        return {
          scale,
          start,
          endExclusive: addDays(start, totalDays),
          startMs,
          endMs,
          totalDays,
          pxPerDay,
          totalWidth: totalDays * pxPerDay,
          units,
          groups,
          boundaries,
          todayX: todayMs >= startMs && todayMs < endMs ? ((todayMs - startMs) / DAY_MS) * pxPerDay : null,
        }
      }

      const first = addMonths(startOfMonth(anchor), -3)
      const units = []
      const boundaries = []
      let totalWidth = 0
      let totalDays = 0
      for (let index = 0; index < 12; index += 1) {
        const iso = addMonths(first, index)
        const days = daysInMonth(iso)
        const width = days * pxPerDay
        if (index > 0) {
          boundaries.push({ x: totalWidth, strong: iso.slice(5, 7) === '01' })
        }
        units.push({
          key: iso,
          startIso: iso,
          width,
          isWeekend: false,
          isToday: today.slice(0, 7) === iso.slice(0, 7),
        })
        totalWidth += width
        totalDays += days
      }
      const groups = []
      for (const unit of units) {
        const key = unit.startIso.slice(0, 4)
        let group = groups[groups.length - 1]
        if (!group || group.key !== key) {
          group = { key, startIso: unit.startIso, width: 0 }
          groups.push(group)
        }
        group.width += unit.width
      }
      const startMs = isoToDay(first)
      const endMs = startMs + totalDays * DAY_MS
      const todayMs = isoToDay(today)
      return {
        scale,
        start: first,
        endExclusive: addDays(first, totalDays),
        startMs,
        endMs,
        totalDays,
        pxPerDay,
        totalWidth,
        units,
        groups,
        boundaries,
        todayX: todayMs >= startMs && todayMs < endMs ? ((todayMs - startMs) / DAY_MS) * pxPerDay : null,
      }
    }

    function windowTitle(timeline, locale) {
      if (timeline.scale === 'week') {
        return `${formatDate(timeline.start, locale, true)} – ${formatDate(addDays(timeline.endExclusive, -1), locale, true)}`
      }
      return `${formatMonthYear(timeline.start, locale)} – ${formatMonthYear(addDays(timeline.endExclusive, -1), locale)}`
    }

    async function requestJson(path, options = {}) {
      const { body, headers, ...rest } = options
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...rest,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(headers || {}),
        },
        ...(body !== undefined ? { body } : {}),
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        // keep the status-based failure below
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        const message = payload && typeof payload.error === 'string' && payload.error.length > 0
          ? payload.error
          : `HTTP ${response.status}`
        throw new Error(message)
      }
      return payload
    }

    function useLocale(ctx) {
      const subscribe = useCallback(
        (listener) => (ctx ? ctx.locale.subscribe(listener) : () => {}),
        [ctx],
      )
      const readRevision = useCallback(
        () => (ctx ? ctx.locale.getSnapshot().revision : 0),
        [ctx],
      )
      useSyncExternalStore(subscribe, readRevision, readRevision)
      if (!ctx) return { locale: 'en', t: (key) => key }
      const snapshot = ctx.locale.getSnapshot()
      return {
        locale: snapshot.locale,
        t: ctx.locale.bind(NS),
      }
    }

    function useGanttData() {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [revision, setRevision] = useState(0)
      const refresh = useCallback(() => setRevision((value) => value + 1), [])

      useEffect(() => {
        const controller = new AbortController()
        let active = true
        setState((previous) => ({
          ...previous,
          status: previous.data ? 'refreshing' : 'loading',
          error: null,
        }))
        requestJson('api/gantt/tree', { signal: controller.signal })
          .then((body) => {
            if (active) setState({ status: 'ready', data: body, error: null })
          })
          .catch((error) => {
            if (!active || error.name === 'AbortError') return
            setState((previous) => ({
              ...previous,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            }))
          })
        return () => {
          active = false
          controller.abort()
        }
      }, [revision])

      return { ...state, refresh }
    }

    function flattenTree(nodes) {
      const output = []
      const walk = (list) => {
        for (const node of list) {
          output.push(node)
          walk(node.children)
        }
      }
      walk(nodes)
      return output
    }

    function visibleRows(nodes, collapsed) {
      const output = []
      const walk = (list, depth) => {
        for (const node of list) {
          output.push({ task: node, depth })
          if (!collapsed.has(node.id)) walk(node.children, depth + 1)
        }
      }
      walk(nodes, 0)
      return output
    }

    function taskOptions(nodes) {
      const output = []
      const walk = (list, depth) => {
        for (const node of list) {
          output.push({ id: node.id, label: `${node.number} ${node.title}`, depth })
          walk(node.children, depth + 1)
        }
      }
      walk(nodes, 0)
      return output
    }

    function collectSubtree(task) {
      const ids = new Set()
      const walk = (node) => {
        ids.add(node.id)
        for (const child of node.children) walk(child)
      }
      walk(task)
      return ids
    }

    function barRange(task, timeline) {
      const start = Math.max(isoToDay(task.startDate), timeline.startMs)
      const end = Math.min(isoToDay(task.endDate) + DAY_MS, timeline.endMs)
      if (end <= start) return null
      return {
        left: ((start - timeline.startMs) / DAY_MS) * timeline.pxPerDay,
        width: Math.max(task.hasChildren ? 2 : 3, ((end - start) / DAY_MS) * timeline.pxPerDay),
      }
    }

    function GanttGlyph({ size = 22 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block' },
      },
        h('rect', { x: 3.5, y: 4.5, width: 9, height: 3.4, rx: 1.7, fill: 'currentColor' }),
        h('rect', { x: 8.5, y: 10.3, width: 12, height: 3.4, rx: 1.7, fill: 'currentColor', opacity: 0.72 }),
        h('rect', { x: 5.5, y: 16.1, width: 8, height: 3.4, rx: 1.7, fill: 'currentColor', opacity: 0.46 }),
        h('path', { d: 'M3.5 2.8v18.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.42 })
      )
    }

    function SidebarIcon({ size = 18, active = false }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: active ? 2 : 1.8,
        strokeLinecap: 'round',
        'aria-hidden': 'true',
        style: { display: 'block', opacity: active ? 1 : 0.85 },
      },
        h('rect', { x: 4, y: 4, width: 9, height: 3.4, rx: 1.7 }),
        h('rect', { x: 9, y: 10.3, width: 11, height: 3.4, rx: 1.7 }),
        h('rect', { x: 6, y: 16.6, width: 8, height: 3.4, rx: 1.7 }),
        h('path', { d: 'M3.5 3v18', opacity: 0.4 })
      )
    }

    function StatusPill({ status, label, interactive, onClick, title }) {
      const tag = interactive ? 'button' : 'span'
      return h(tag, {
        className: 'gantt-status',
        'data-status': status,
        'data-interactive': interactive ? 'true' : undefined,
        style: { '--st': STATUS_COLOR[status] || STATUS_COLOR.todo },
        type: interactive ? 'button' : undefined,
        onClick: interactive ? (event) => {
          event.stopPropagation()
          onClick()
        } : undefined,
        title,
      }, h('span', { className: 'gantt-status-dot' }), h('span', { className: 'gantt-status-label' }, label))
    }

    function TaskBar({ task, timeline, onSelect }) {
      const range = barRange(task, timeline)
      if (range === null) return null
      const overdue = task.status !== 'done' && task.endDate < timeline.today
      return h('button', {
        type: 'button',
        className: 'gantt-bar',
        'data-status': task.status,
        'data-summary': task.hasChildren ? 'true' : undefined,
        'data-overdue': overdue ? 'true' : undefined,
        style: {
          left: `${range.left}px`,
          width: `${range.width}px`,
          '--st': STATUS_COLOR[task.status] || STATUS_COLOR.todo,
        },
        title: `${task.number} ${task.title}\n${task.startDate} → ${task.endDate} · ${task.progress}%`,
        onClick: (event) => {
          event.stopPropagation()
          onSelect(task)
        },
      },
        h('span', { className: 'gantt-bar-fill', style: { width: `${task.progress}%` } }),
        !task.hasChildren && range.width > 58
          ? h('span', { className: 'gantt-bar-label' }, task.title)
          : null
      )
    }

    function GanttRow({ task, depth, timeline, selected, collapsed, t, onSelect, onToggle, onAddChild, onCycleStatus }) {
      const hasChildren = task.hasChildren
      return h('div', {
        className: 'gantt-row',
        'data-selected': selected ? 'true' : undefined,
        'data-depth': depth,
        onClick: () => onSelect(task),
        onKeyDown: (event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(task)
          }
        },
        role: 'button',
        tabIndex: 0,
        'aria-label': `${task.number} ${task.title}`,
      },
        h('div', { className: 'gantt-task-cell', style: { paddingLeft: `${10 + depth * 16}px` } },
          hasChildren
            ? h('button', {
              className: 'gantt-chevron',
              type: 'button',
              'aria-label': collapsed ? t('tree.expand') : t('tree.collapse'),
              'aria-expanded': collapsed ? 'false' : 'true',
              onClick: (event) => {
                event.stopPropagation()
                onToggle(task.id)
              },
            }, collapsed ? '▸' : '▾')
            : h('span', { className: 'gantt-chevron gantt-chevron-empty', 'aria-hidden': 'true' }),
          h('span', { className: 'gantt-number' }, task.number),
          h('span', { className: 'gantt-task-title', title: task.title }, task.title),
          h(StatusPill, {
            status: task.status,
            label: t(`status.${task.status}`),
            interactive: !hasChildren,
            title: hasChildren ? t('status.summaryHint') : t('status.cycleHint'),
            onClick: () => onCycleStatus(task),
          }),
          h('button', {
            className: 'gantt-add-child',
            type: 'button',
            title: t('tree.addChild'),
            'aria-label': t('tree.addChild'),
            onClick: (event) => {
              event.stopPropagation()
              onAddChild(task)
            },
          }, '+')
        ),
        h('div', { className: 'gantt-track', style: { width: `${timeline.totalWidth}px` } },
          h(TaskBar, { task, timeline, onSelect })
        )
      )
    }

    function TimelineHeader({ timeline, t, locale, taskCount }) {
      return h('div', { className: 'gantt-header' },
        h('div', { className: 'gantt-corner' },
          h('span', { className: 'gantt-corner-title' }, t('tree.task')),
          h('span', { className: 'gantt-corner-sub' }, `${taskCount} ${t('stats.tasks')}`)
        ),
        h('div', { className: 'gantt-header-timeline', style: { width: `${timeline.totalWidth}px` } },
          h('div', { className: 'gantt-group-row' },
            timeline.groups.map((group) => h('div', {
              key: group.key,
              className: 'gantt-group-cell',
              style: { width: `${group.width}px` },
            }, timeline.scale === 'week'
              ? formatMonthYear(group.startIso, locale)
              : formatYear(group.startIso, locale)))
          ),
          h('div', { className: 'gantt-unit-row' },
            timeline.units.map((unit) => h('div', {
              key: unit.key,
              className: 'gantt-unit-cell',
              'data-today': unit.isToday ? 'true' : undefined,
              'data-weekend': unit.isWeekend ? 'true' : undefined,
              style: { width: `${unit.width}px` },
            },
              h('span', { className: 'gantt-unit-main' }, timeline.scale === 'week'
                ? String(Number(unit.startIso.slice(8, 10)))
                : formatMonth(unit.startIso, locale)),
              timeline.scale === 'week'
                ? h('span', { className: 'gantt-unit-sub' }, formatWeekday(unit.startIso, locale))
                : null
            ))
          )
        )
      )
    }

    function GridLines({ timeline }) {
      return h('div', {
        className: 'gantt-grid-lines',
        style: { left: 'var(--gantt-left)', width: `${timeline.totalWidth}px` },
        'aria-hidden': 'true',
      },
        timeline.boundaries.map((line, index) => h('span', {
          key: index,
          className: 'gantt-vline',
          'data-strong': line.strong ? 'true' : undefined,
          style: { left: `${line.x}px` },
        })),
        timeline.todayX !== null
          ? h('span', { className: 'gantt-today-line', style: { left: `${timeline.todayX}px` } })
          : null
      )
    }

    function Field({ label, hint, children, full }) {
      return h('label', { className: `gantt-field${full ? ' gantt-field-full' : ''}` },
        h('span', { className: 'gantt-label' }, label),
        children,
        hint ? h('span', { className: 'gantt-hint' }, hint) : null
      )
    }

    function Dialog({ title, children, footer, onClose, closeLabel, wide }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      return h('div', {
        className: 'gantt-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose()
        },
      },
        h('div', {
          className: `gantt-dialog${wide ? ' gantt-dialog-wide' : ''}`,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
        },
          h('div', { className: 'gantt-dialog-head' },
            h('h2', { className: 'gantt-dialog-title' }, title),
            h('button', {
              className: 'gantt-btn gantt-icon-btn',
              type: 'button',
              'aria-label': closeLabel,
              title: closeLabel,
              onClick: onClose,
            }, '×')
          ),
          h('div', { className: 'gantt-dialog-body' }, children),
          footer ? h('div', { className: 'gantt-dialog-foot' }, footer) : null
        )
      )
    }

    function TaskDialog({ mode, task, parentTask, parentOptions, t, onClose, onSaved, onSplit }) {
      const hasChildren = Boolean(task && task.hasChildren)
      const initialStart = task?.startDate ?? parentTask?.startDate ?? todayIso()
      const initialEnd = task?.endDate ?? parentTask?.endDate ?? addDays(initialStart, 3)
      const [title, setTitle] = useState(task?.title ?? '')
      const [description, setDescription] = useState(task?.description ?? '')
      const [parent, setParent] = useState(task?.parentId ?? parentTask?.id ?? '')
      const [startDate, setStartDate] = useState(initialStart)
      const [endDate, setEndDate] = useState(initialEnd)
      const [status, setStatus] = useState(task?.status ?? 'todo')
      const [progress, setProgress] = useState(task?.progress ?? 0)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      const [confirmDelete, setConfirmDelete] = useState(false)

      const submit = async () => {
        const cleanTitle = title.trim()
        if (cleanTitle.length === 0) {
          setError(t('validation.title'))
          return
        }
        if (endDate < startDate) {
          setError(t('validation.dates'))
          return
        }
        setSaving(true)
        setError(null)
        try {
          if (mode === 'create') {
            const result = await requestJson('api/gantt/tasks', {
              method: 'POST',
              body: JSON.stringify({
                title: cleanTitle,
                description,
                parentId: parent || null,
                startDate,
                endDate,
                status,
                progress: Number(progress),
              }),
            })
            onSaved(t('notice.created'), result.task.id)
          } else {
            const body = {
              id: task.id,
              title: cleanTitle,
              description,
              parentId: parent || null,
            }
            if (!hasChildren) {
              body.startDate = startDate
              body.endDate = endDate
              body.status = status
              body.progress = Number(progress)
            }
            const result = await requestJson('api/gantt/task/update', {
              method: 'POST',
              body: JSON.stringify(body),
            })
            onSaved(t('notice.saved'), result.task.id)
          }
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }

      const remove = async () => {
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        setSaving(true)
        setError(null)
        try {
          await requestJson('api/gantt/task/delete', {
            method: 'POST',
            body: JSON.stringify({ id: task.id }),
          })
          onSaved(t('notice.deleted'), null)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }

      const changeStatus = (next) => {
        setStatus(next)
        if (next === 'done') setProgress(100)
        else if (next === 'todo') setProgress(0)
        else if (next === 'in_progress' && (progress === 0 || progress === 100)) setProgress(50)
      }

      const changeProgress = (next) => {
        const value = Number(next)
        setProgress(value)
        if (value >= 100) setStatus('done')
        else if (value <= 0) setStatus('todo')
        else if (status === 'todo' || status === 'done') setStatus('in_progress')
      }

      const parentChoices = parentOptions

      return h(Dialog, {
        title: mode === 'create' ? t('dialog.createTitle') : `${t('dialog.editTitle')} · ${task.number}`,
        closeLabel: t('actions.close'),
        onClose,
        footer: h(React.Fragment, null,
          h('div', { className: 'gantt-dialog-foot-left' },
            mode === 'edit'
              ? h('button', {
                className: 'gantt-btn gantt-btn-danger',
                type: 'button',
                disabled: saving,
                onClick: remove,
              }, confirmDelete ? t('dialog.deleteConfirm') : t('dialog.delete'))
              : null,
            mode === 'edit'
              ? h('button', {
                className: 'gantt-btn',
                type: 'button',
                disabled: saving,
                onClick: () => onSplit(task),
              }, t('dialog.split'))
              : null
          ),
          h('div', { className: 'gantt-dialog-foot-right' },
            h('button', {
              className: 'gantt-btn',
              type: 'button',
              disabled: saving,
              onClick: onClose,
            }, t('dialog.cancel')),
            h('button', {
              className: 'gantt-btn gantt-btn-primary',
              type: 'button',
              disabled: saving,
              onClick: submit,
            }, saving ? '…' : (mode === 'create' ? t('dialog.create') : t('dialog.save')))
          )
        ),
      },
        error ? h('div', { className: 'gantt-form-error' }, error) : null,
        h('div', { className: 'gantt-form-grid' },
          h(Field, { label: t('field.title'), full: true },
            h('input', {
              className: 'gantt-input',
              value: title,
              autoFocus: true,
              maxLength: 200,
              placeholder: t('field.titlePlaceholder'),
              onChange: (event) => setTitle(event.target.value),
            })
          ),
          h(Field, { label: t('field.description'), full: true },
            h('textarea', {
              className: 'gantt-textarea',
              value: description,
              maxLength: 4000,
              placeholder: t('field.descriptionPlaceholder'),
              onChange: (event) => setDescription(event.target.value),
            })
          ),
          h(Field, { label: t('field.parent'), full: true, hint: hasChildren ? t('field.summaryDates') : null },
            h('select', {
              className: 'gantt-select',
              value: parent,
              onChange: (event) => setParent(event.target.value),
            },
              h('option', { value: '' }, t('field.parentNone')),
              parentChoices.map((option) => h('option', {
                key: option.id,
                value: option.id,
              }, `${'\u00a0\u00a0'.repeat(option.depth)}${option.label}`))
            )
          ),
          h(Field, { label: t('field.start') },
            h('input', {
              className: 'gantt-input',
              type: 'date',
              value: startDate,
              disabled: hasChildren,
              onChange: (event) => {
                const next = event.target.value
                setStartDate(next)
                if (next > endDate) setEndDate(next)
              },
            })
          ),
          h(Field, { label: t('field.end') },
            h('input', {
              className: 'gantt-input',
              type: 'date',
              value: endDate,
              disabled: hasChildren,
              min: startDate,
              onChange: (event) => setEndDate(event.target.value),
            })
          ),
          h(Field, { label: t('field.status') },
            h('select', {
              className: 'gantt-select',
              value: status,
              disabled: hasChildren,
              onChange: (event) => changeStatus(event.target.value),
            },
              STATUSES.map((value) => h('option', { key: value, value }, t(`status.${value}`)))
            )
          ),
          h(Field, { label: `${t('field.progress')} · ${progress}%`, hint: hasChildren ? null : t('field.progressHint') },
            h('input', {
              className: 'gantt-range',
              type: 'range',
              min: 0,
              max: 100,
              step: 1,
              value: progress,
              disabled: hasChildren,
              onChange: (event) => changeProgress(event.target.value),
            })
          )
        )
      )
    }

    let splitRowSequence = 0

    function defaultSplitRows(task) {
      const total = Math.max(1, Math.round((isoToDay(task.endDate) - isoToDay(task.startDate)) / DAY_MS) + 1)
      if (total <= 1) {
        return [
          { key: `row-${splitRowSequence += 1}`, title: '', startDate: task.startDate, endDate: task.endDate },
        ]
      }
      const firstHalf = Math.max(1, Math.floor(total / 2))
      const middle = addDays(task.startDate, firstHalf - 1)
      return [
        { key: `row-${splitRowSequence += 1}`, title: '', startDate: task.startDate, endDate: middle },
        { key: `row-${splitRowSequence += 1}`, title: '', startDate: addDays(middle, 1), endDate: task.endDate },
      ]
    }

    function SplitDialog({ task, t, onClose, onSaved }) {
      const [rows, setRows] = useState(() => defaultSplitRows(task))
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)

      const updateRow = (key, patch) => {
        setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
      }

      const addRow = () => {
        const last = rows[rows.length - 1]
        const startDate = last ? addDays(last.endDate, 1) : task.startDate
        const endDate = task.endDate > startDate ? task.endDate : addDays(startDate, 1)
        setRows((current) => [...current, {
          key: `row-${splitRowSequence += 1}`,
          title: '',
          startDate,
          endDate,
        }])
      }

      const removeRow = (key) => {
        setRows((current) => (current.length > 1 ? current.filter((row) => row.key !== key) : current))
      }

      const submit = async () => {
        for (const row of rows) {
          if (row.title.trim().length === 0 || row.endDate < row.startDate) {
            setError(t('validation.splitChild'))
            return
          }
        }
        setSaving(true)
        setError(null)
        try {
          const result = await requestJson('api/gantt/task/split', {
            method: 'POST',
            body: JSON.stringify({
              id: task.id,
              children: rows.map((row) => ({
                title: row.title.trim(),
                startDate: row.startDate,
                endDate: row.endDate,
                status: 'todo',
                progress: 0,
              })),
            }),
          })
          onSaved(t('notice.split'), result.parent.id)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }

      return h(Dialog, {
        title: `${t('dialog.splitTitle')} · ${task.number} ${task.title}`,
        closeLabel: t('actions.close'),
        onClose,
        wide: true,
        footer: h(React.Fragment, null,
          h('div', { className: 'gantt-dialog-foot-left' },
            h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: addRow }, `+ ${t('dialog.addRow')}`)
          ),
          h('div', { className: 'gantt-dialog-foot-right' },
            h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
            h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.split'))
          )
        ),
      },
        error ? h('div', { className: 'gantt-form-error' }, error) : null,
        h('p', { className: 'gantt-dialog-note' }, t('dialog.splitHint')),
        h('div', { className: 'gantt-split-head' },
          h('span', null, t('dialog.splitChildTitle')),
          h('span', null, t('field.start')),
          h('span', null, t('field.end')),
          h('span', null, '')
        ),
        rows.map((row) => h('div', { className: 'gantt-split-row', key: row.key },
          h('input', {
            className: 'gantt-input',
            'aria-label': t('dialog.splitChildTitle'),
            value: row.title,
            autoFocus: row === rows[0],
            placeholder: t('dialog.splitChildTitle'),
            onChange: (event) => updateRow(row.key, { title: event.target.value }),
          }),
          h('input', {
            className: 'gantt-input',
            type: 'date',
            'aria-label': t('field.start'),
            value: row.startDate,
            onChange: (event) => {
              const next = event.target.value
              updateRow(row.key, {
                startDate: next,
                endDate: next > row.endDate ? next : row.endDate,
              })
            },
          }),
          h('input', {
            className: 'gantt-input',
            type: 'date',
            'aria-label': t('field.end'),
            value: row.endDate,
            min: row.startDate,
            onChange: (event) => updateRow(row.key, { endDate: event.target.value }),
          }),
          h('button', {
            className: 'gantt-btn gantt-icon-btn',
            type: 'button',
            title: t('dialog.removeRow'),
            'aria-label': t('dialog.removeRow'),
            disabled: rows.length <= 1,
            onClick: () => removeRow(row.key),
          }, '×')
        ))
      )
    }

    function ApiDialog({ t, locale, onClose }) {
      const [meta, setMeta] = useState(null)
      const [error, setError] = useState(null)

      useEffect(() => {
        let active = true
        requestJson('api/gantt/meta')
          .then((body) => {
            if (active) setMeta(body)
          })
          .catch((failure) => {
            if (active) setError(failure instanceof Error ? failure.message : String(failure))
          })
        return () => {
          active = false
        }
      }, [])

      return h(Dialog, {
        title: t('dialog.apiTitle'),
        closeLabel: t('actions.close'),
        onClose,
        wide: true,
        footer: h('div', { className: 'gantt-dialog-foot-right' },
          h('button', { className: 'gantt-btn', type: 'button', onClick: onClose }, t('actions.close'))
        ),
      },
        h('p', { className: 'gantt-dialog-note' }, t('dialog.apiIntro')),
        h('div', { className: 'gantt-api-meta' },
          h('div', null,
            h('span', { className: 'gantt-label' }, t('dialog.apiDb')),
            h('code', { className: 'gantt-code' }, meta?.dbPath ?? '—')
          ),
          h('div', null,
            h('span', { className: 'gantt-label' }, 'Engine'),
            h('code', { className: 'gantt-code' }, meta?.engine ?? '—')
          )
        ),
        h('p', { className: 'gantt-hint' }, t('dialog.apiAuth')),
        error ? h('div', { className: 'gantt-form-error' }, error) : null,
        !meta && !error ? h('p', { className: 'gantt-hint' }, t('dialog.apiEmpty')) : null,
        meta
          ? h('div', { className: 'gantt-api-list' },
            (meta.endpoints ?? []).map((endpoint) => h('div', { className: 'gantt-api-row', key: `${endpoint.method} ${endpoint.path}` },
              h('span', { className: 'gantt-method', 'data-method': endpoint.method }, endpoint.method),
              h('code', { className: 'gantt-code gantt-api-path' }, endpoint.path),
              h('span', { className: 'gantt-api-desc' }, API_TEXT[endpoint.path]
                ? API_TEXT[endpoint.path][String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en']
                : endpoint.description)
            )))
          : null
      )
    }

    // ── 样式表：按界面区域分段，运行时一次性拼成一张 <style> ──
    /** 主题变量、盒模型与焦点样式。 */
    const CSS_BASE = `
      .gantt-page {
        --gantt-left: 340px;
        --gantt-bg: var(--dsw-alias-bg-base);
        --gantt-surface: var(--dsw-alias-bg-layer-1);
        --gantt-surface-2: var(--dsw-alias-bg-layer-2);
        --gantt-line: var(--dsw-alias-border-l1);
        --gantt-line-strong: var(--dsw-alias-border-l2);
        --gantt-text: var(--dsw-alias-label-primary);
        --gantt-muted: var(--dsw-alias-label-secondary);
        --gantt-accent: var(--dsw-alias-brand-primary);
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        background: var(--gantt-bg);
        color: var(--gantt-text);
        font-size: 13px;
        line-height: 1.45;
        overflow: hidden;
      }
      .gantt-page, .gantt-page * { box-sizing: border-box; }
      .gantt-page button, .gantt-page input, .gantt-page select, .gantt-page textarea { font: inherit; }
      .gantt-page button:focus-visible,
      .gantt-page input:focus-visible,
      .gantt-page select:focus-visible,
      .gantt-page textarea:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--gantt-accent) 65%, transparent);
        outline-offset: 2px;
      }
    `

    /** 顶栏：品牌、标题、操作按钮与周/月切换。 */
    const CSS_HEAD = `
      .gantt-head {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        padding: 16px 22px 12px;
        border-bottom: 1px solid var(--gantt-line);
        background: var(--gantt-bg);
      }
      .gantt-brand { display: flex; align-items: center; gap: 12px; flex: 1 1 260px; min-width: 220px; }
      .gantt-brand-mark {
        width: 38px; height: 38px; flex: 0 0 38px;
        display: grid; place-items: center;
        border-radius: 11px;
        color: var(--gantt-accent);
        background: color-mix(in srgb, var(--gantt-accent) 13%, transparent);
        border: 1px solid color-mix(in srgb, var(--gantt-accent) 22%, transparent);
      }
      .gantt-title { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
      .gantt-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--gantt-muted); }
      .gantt-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      .gantt-btn {
        height: 32px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--gantt-line-strong);
        background: var(--gantt-surface);
        color: var(--gantt-text);
        font-size: 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        white-space: nowrap;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      }
      .gantt-btn:hover:not(:disabled) { background: var(--gantt-surface-2); border-color: var(--gantt-line-strong); }
      .gantt-btn:disabled { opacity: 0.5; cursor: default; }
      .gantt-btn-primary {
        color: var(--gantt-accent);
        border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent);
        background: color-mix(in srgb, var(--gantt-accent) 13%, transparent);
      }
      .gantt-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--gantt-accent) 20%, transparent); }
      .gantt-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
      .gantt-icon-btn { width: 32px; padding: 0; font-size: 16px; }
      .gantt-seg {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        border: 1px solid var(--gantt-line-strong);
        border-radius: 9px;
        background: var(--gantt-surface);
      }
      .gantt-seg-btn {
        height: 26px;
        padding: 0 11px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--gantt-muted);
        cursor: pointer;
        font-size: 12px;
      }
      .gantt-seg-btn[data-active="true"] {
        color: var(--gantt-accent);
        background: color-mix(in srgb, var(--gantt-accent) 14%, transparent);
        border-color: color-mix(in srgb, var(--gantt-accent) 28%, transparent);
        font-weight: 600;
      }
    `

    /** 统计条：时间窗、计数、完成度与错误横幅。 */
    const CSS_STATS = `
      .gantt-stats {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 14px 18px;
        padding: 8px 22px;
        border-bottom: 1px solid var(--gantt-line);
        background: var(--gantt-bg);
      }
      .gantt-window { display: inline-flex; align-items: baseline; gap: 8px; min-width: 220px; }
      .gantt-window-scale {
        font-size: 11px;
        color: var(--gantt-accent);
        background: color-mix(in srgb, var(--gantt-accent) 12%, transparent);
        border-radius: 5px;
        padding: 1px 6px;
      }
      .gantt-window-label { font-size: 12px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
      .gantt-stat { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--gantt-muted); white-space: nowrap; }
      .gantt-stat b { color: var(--gantt-text); font-size: 13px; font-variant-numeric: tabular-nums; }
      .gantt-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--st, var(--gantt-muted)); flex: 0 0 7px; }
      .gantt-stat-progress { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; min-width: 180px; flex: 1 1 220px; max-width: 360px; color: var(--gantt-muted); font-size: 12px; }
      .gantt-progress { height: 6px; flex: 1; min-width: 80px; border-radius: 999px; background: var(--gantt-line); overflow: hidden; }
      .gantt-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-state-success-primary); }
      .gantt-banner {
        display: flex; align-items: center; gap: 10px;
        margin: 8px 22px 0;
        padding: 8px 12px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
        border-radius: 8px;
        color: var(--dsw-alias-state-error-primary);
        font-size: 12px;
      }
      .gantt-banner span { flex: 1; min-width: 0; }
    `

    /** 主体：任务树、时间线表头、网格线、任务条。 */
    const CSS_GRID = `
      .gantt-body { flex: 1; min-height: 0; overflow: auto; position: relative; }
      .gantt-grid { position: relative; min-width: max-content; }
      .gantt-header {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        background: var(--gantt-surface);
        border-bottom: 1px solid var(--gantt-line-strong);
      }
      .gantt-corner {
        position: sticky;
        left: 0;
        z-index: 22;
        width: var(--gantt-left);
        flex: 0 0 var(--gantt-left);
        height: 56px;
        padding: 0 14px 7px;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 8px;
        background: var(--gantt-surface);
        border-right: 1px solid var(--gantt-line-strong);
      }
      .gantt-corner-title { font-size: 12px; font-weight: 600; }
      .gantt-corner-sub { font-size: 11px; color: var(--gantt-muted); }
      .gantt-header-timeline { flex: 0 0 auto; height: 56px; }
      .gantt-group-row { display: flex; height: 26px; border-bottom: 1px solid var(--gantt-line); }
      .gantt-group-cell {
        display: flex; align-items: center;
        padding: 0 8px;
        border-right: 1px solid var(--gantt-line);
        font-size: 11px; font-weight: 600; color: var(--gantt-muted);
        white-space: nowrap; overflow: hidden;
      }
      .gantt-unit-row { display: flex; height: 30px; }
      .gantt-unit-cell {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 0;
        border-right: 1px solid var(--gantt-line);
        color: var(--gantt-muted);
        overflow: hidden;
        white-space: nowrap;
      }
      .gantt-unit-cell[data-weekend="true"] { background: color-mix(in srgb, var(--gantt-muted) 6%, transparent); }
      .gantt-unit-cell[data-today="true"] {
        background: color-mix(in srgb, var(--gantt-accent) 14%, transparent);
        color: var(--gantt-accent);
        font-weight: 700;
      }
      .gantt-unit-main { font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.1; }
      .gantt-unit-sub { font-size: 9px; opacity: 0.75; line-height: 1.1; }
      .gantt-rows { position: relative; }
      .gantt-grid-lines { position: absolute; top: 0; bottom: 0; z-index: 0; pointer-events: none; }
      .gantt-vline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gantt-line); opacity: 0.8; }
      .gantt-vline[data-strong="true"] { background: var(--gantt-line-strong); opacity: 1; }
      .gantt-today-line {
        position: absolute; top: 0; bottom: 0; width: 2px;
        background: color-mix(in srgb, var(--gantt-accent) 55%, transparent);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--gantt-accent) 12%, transparent);
      }
      .gantt-row {
        display: flex;
        height: 38px;
        position: relative;
        z-index: 1;
        cursor: pointer;
        outline: none;
      }
      .gantt-row:hover .gantt-task-cell { background: var(--gantt-surface-2); }
      .gantt-row:hover .gantt-track { background: color-mix(in srgb, var(--gantt-accent) 4%, transparent); }
      .gantt-task-cell {
        position: sticky;
        left: 0;
        z-index: 5;
        width: var(--gantt-left);
        flex: 0 0 var(--gantt-left);
        display: flex;
        align-items: center;
        gap: 6px;
        padding-right: 8px;
        background: var(--gantt-surface);
        border-right: 1px solid var(--gantt-line-strong);
        border-bottom: 1px solid var(--gantt-line);
        overflow: hidden;
      }
      .gantt-row[data-selected="true"] .gantt-task-cell {
        background: color-mix(in srgb, var(--gantt-accent) 10%, var(--gantt-surface));
        box-shadow: inset 3px 0 0 var(--gantt-accent);
      }
      .gantt-track {
        position: relative;
        flex: 0 0 auto;
        height: 38px;
        border-bottom: 1px solid var(--gantt-line);
      }
      .gantt-chevron {
        width: 18px; height: 18px; flex: 0 0 18px;
        display: grid; place-items: center;
        border: 0; border-radius: 5px;
        background: transparent;
        color: var(--gantt-muted);
        cursor: pointer;
        font-size: 10px;
        padding: 0;
      }
      .gantt-chevron:hover { background: var(--gantt-surface-2); color: var(--gantt-text); }
      .gantt-chevron-empty { visibility: hidden; }
      .gantt-number {
        flex: 0 0 auto;
        min-width: 38px;
        color: var(--gantt-muted);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        white-space: nowrap;
      }
      .gantt-task-title {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 12.5px;
        color: var(--gantt-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .gantt-status {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--st, var(--gantt-muted)) 32%, transparent);
        background: color-mix(in srgb, var(--st, var(--gantt-muted)) 11%, transparent);
        color: var(--st, var(--gantt-muted));
        font-size: 10.5px;
        line-height: 1;
        white-space: nowrap;
        cursor: default;
      }
      .gantt-status[data-interactive="true"] { cursor: pointer; }
      .gantt-status[data-interactive="true"]:hover { background: color-mix(in srgb, var(--st, var(--gantt-muted)) 20%, transparent); }
      .gantt-status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 6px; }
      .gantt-status-label { overflow: hidden; text-overflow: ellipsis; }
      .gantt-add-child {
        flex: 0 0 20px;
        width: 20px; height: 20px;
        display: grid; place-items: center;
        border: 0; border-radius: 6px;
        background: transparent;
        color: var(--gantt-muted);
        opacity: 0.45;
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 0;
      }
      .gantt-add-child:hover { opacity: 1; color: var(--gantt-accent); background: color-mix(in srgb, var(--gantt-accent) 12%, transparent); }
      .gantt-bar {
        position: absolute;
        top: 9px;
        height: 20px;
        padding: 0 7px;
        border-radius: 6px;
        border: 1px solid color-mix(in srgb, var(--st, var(--gantt-accent)) 55%, transparent);
        background: color-mix(in srgb, var(--st, var(--gantt-accent)) 14%, var(--gantt-surface));
        color: var(--gantt-text);
        font-size: 10.5px;
        text-align: left;
        cursor: pointer;
        overflow: hidden;
        display: flex;
        align-items: center;
        box-shadow: 0 1px 2px color-mix(in srgb, #000 10%, transparent);
      }
      .gantt-bar:hover { filter: brightness(1.05); }
      .gantt-bar[data-overdue="true"] { border-color: var(--dsw-alias-state-error-primary); }
      .gantt-bar[data-summary="true"] {
        top: 14px;
        height: 10px;
        padding: 0;
        border-radius: 3px;
        border: 0;
        overflow: visible;
        background: color-mix(in srgb, var(--st, var(--gantt-accent)) 55%, var(--gantt-surface));
      }
      .gantt-bar[data-summary="true"]::before,
      .gantt-bar[data-summary="true"]::after {
        content: "";
        position: absolute;
        top: -4px;
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 5px solid var(--st, var(--gantt-accent));
      }
      .gantt-bar[data-summary="true"]::before { left: -1px; }
      .gantt-bar[data-summary="true"]::after { right: -1px; }
      .gantt-bar-fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        background: color-mix(in srgb, var(--st, var(--gantt-accent)) 34%, transparent);
        pointer-events: none;
      }
      .gantt-bar[data-summary="true"] .gantt-bar-fill { background: color-mix(in srgb, var(--gantt-surface) 55%, var(--st, var(--gantt-accent))); }
      .gantt-bar-label {
        position: relative;
        z-index: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }
    `

    /** 空态、加载中、遮罩层与转圈动画。 */
    const CSS_EMPTY = `
      .gantt-empty-wrap { flex: 1; display: grid; place-items: center; padding: 32px 24px; min-height: 0; }
      .gantt-empty {
        max-width: 460px;
        display: flex; flex-direction: column; align-items: center;
        gap: 10px;
        padding: 34px 30px;
        border: 1px dashed var(--gantt-line-strong);
        border-radius: 14px;
        background: color-mix(in srgb, var(--gantt-surface) 70%, transparent);
        text-align: center;
      }
      .gantt-empty-icon {
        width: 46px; height: 46px;
        display: grid; place-items: center;
        border-radius: 13px;
        color: var(--gantt-accent);
        background: color-mix(in srgb, var(--gantt-accent) 12%, transparent);
        margin-bottom: 2px;
      }
      .gantt-empty-title { font-size: 15px; font-weight: 600; }
      .gantt-empty-body { font-size: 12px; color: var(--gantt-muted); max-width: 36ch; }
      .gantt-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 6px; }
      .gantt-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px; color: var(--gantt-muted); }
      .gantt-spinner {
        width: 22px; height: 22px;
        border-radius: 50%;
        border: 2px solid var(--gantt-line-strong);
        border-top-color: var(--gantt-accent);
        animation: gantt-spin 800ms linear infinite;
      }
      @keyframes gantt-spin { to { transform: rotate(360deg); } }
    `

    /** 对话框、表单控件、拆分面板与数据接口面板。 */
    const CSS_DIALOG = `
      .gantt-backdrop {
        position: absolute;
        inset: 0;
        z-index: 60;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: color-mix(in srgb, #000 38%, transparent);
      }
      .gantt-dialog {
        width: min(620px, 100%);
        max-height: min(780px, 100%);
        display: flex;
        flex-direction: column;
        background: var(--gantt-surface);
        border: 1px solid var(--gantt-line-strong);
        border-radius: 14px;
        box-shadow: 0 24px 70px color-mix(in srgb, #000 32%, transparent);
        overflow: hidden;
      }
      .gantt-dialog-wide { width: min(760px, 100%); }
      .gantt-dialog-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px 12px;
        border-bottom: 1px solid var(--gantt-line);
      }
      .gantt-dialog-title { margin: 0; flex: 1; min-width: 0; font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .gantt-dialog-body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
      .gantt-dialog-note { margin: 0; font-size: 12px; color: var(--gantt-muted); }
      .gantt-dialog-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 16px;
        border-top: 1px solid var(--gantt-line);
        background: color-mix(in srgb, var(--gantt-surface) 80%, var(--gantt-bg));
      }
      .gantt-dialog-foot-left, .gantt-dialog-foot-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .gantt-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .gantt-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .gantt-field-full { grid-column: 1 / -1; }
      .gantt-label { font-size: 11.5px; color: var(--gantt-muted); font-weight: 550; }
      .gantt-hint { font-size: 11px; color: var(--gantt-muted); opacity: 0.85; }
      .gantt-input, .gantt-select, .gantt-textarea {
        width: 100%;
        min-width: 0;
        height: 34px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--gantt-line-strong);
        background: var(--gantt-bg);
        color: var(--gantt-text);
        font-size: 12.5px;
      }
      .gantt-input[type="date"] { color-scheme: light dark; }
      .gantt-textarea { height: auto; min-height: 76px; padding: 8px 10px; resize: vertical; }
      .gantt-input:focus, .gantt-select:focus, .gantt-textarea:focus {
        border-color: var(--gantt-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--gantt-accent) 16%, transparent);
        outline: none;
      }
      .gantt-input:disabled, .gantt-select:disabled, .gantt-range:disabled { opacity: 0.6; cursor: not-allowed; }
      .gantt-range { width: 100%; accent-color: var(--gantt-accent); }
      .gantt-form-error {
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
        color: var(--dsw-alias-state-error-primary);
        font-size: 12px;
      }
      .gantt-split-head, .gantt-split-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 132px 132px 32px;
        gap: 8px;
        align-items: center;
      }
      .gantt-split-head { font-size: 11px; color: var(--gantt-muted); }
      .gantt-split-row .gantt-btn { width: 32px; height: 32px; }
      .gantt-api-meta { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 12px; }
      .gantt-api-meta > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .gantt-code {
        display: block;
        padding: 6px 8px;
        border-radius: 7px;
        background: var(--gantt-bg);
        border: 1px solid var(--gantt-line);
        color: var(--gantt-text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11.5px;
        overflow: auto;
        white-space: nowrap;
      }
      .gantt-api-list { display: flex; flex-direction: column; gap: 6px; }
      .gantt-api-row {
        display: grid;
        grid-template-columns: 48px minmax(0, 1.1fr) minmax(0, 1.6fr);
        gap: 8px;
        align-items: start;
        padding: 7px 8px;
        border: 1px solid var(--gantt-line);
        border-radius: 8px;
        background: color-mix(in srgb, var(--gantt-bg) 55%, transparent);
      }
      .gantt-method {
        display: inline-flex; align-items: center; justify-content: center;
        height: 20px;
        border-radius: 5px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.03em;
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
        color: var(--dsw-alias-state-success-primary);
    `

    /** 轻提示与响应式断点。 */
    const CSS_MISC = `
      }
      .gantt-method[data-method="POST"] {
        background: color-mix(in srgb, var(--gantt-accent) 15%, transparent);
        color: var(--gantt-accent);
      }
      .gantt-api-path { white-space: normal; overflow-wrap: anywhere; font-size: 11px; padding: 2px 5px; }
      .gantt-api-desc { font-size: 11.5px; color: var(--gantt-muted); line-height: 1.5; }
      .gantt-toast {
        position: absolute;
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%);
        z-index: 80;
        max-width: min(520px, 80%);
        padding: 9px 14px;
        border-radius: 10px;
        border: 1px solid var(--gantt-line-strong);
        background: var(--gantt-surface-2);
        color: var(--gantt-text);
        font-size: 12px;
        box-shadow: 0 12px 30px color-mix(in srgb, #000 20%, transparent);
      }
      .gantt-toast[data-error="true"] {
        color: var(--dsw-alias-state-error-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
      }
      @media (max-width: 980px) {
        .gantt-page { --gantt-left: 280px; }
        .gantt-subtitle { display: none; }
        .gantt-stat-progress { max-width: none; }
        .gantt-api-meta { grid-template-columns: 1fr; }
      }
      @media (max-width: 720px) {
        .gantt-page { --gantt-left: 230px; }
        .gantt-head, .gantt-stats { padding-left: 14px; padding-right: 14px; }
        .gantt-number { min-width: 30px; }
        .gantt-status-label { display: none; }
        .gantt-status { padding: 0 6px; }
        .gantt-form-grid { grid-template-columns: 1fr; }
        .gantt-split-head, .gantt-split-row { grid-template-columns: minmax(0, 1fr) 110px 110px 32px; }
        .gantt-api-row { grid-template-columns: 44px minmax(0, 1fr); }
        .gantt-api-desc { grid-column: 1 / -1; }
      }
    `

    const CSS = [CSS_BASE, CSS_HEAD, CSS_STATS, CSS_GRID, CSS_EMPTY, CSS_DIALOG, CSS_MISC].join('\n')

    function GanttPage() {
      const { locale, t } = useLocale(runtime)
      const { status, data, error, refresh } = useGanttData()
      const [scale, setScale] = useState('week')
      const [anchor, setAnchor] = useState(() => todayIso())
      const [collapsed, setCollapsed] = useState(() => new Set())
      const [selectedId, setSelectedId] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [toast, setToast] = useState(null)
      const initialized = useRef(false)

      useEffect(() => {
        if (data && !initialized.current) {
          initialized.current = true
          setAnchor(data.today || todayIso())
        }
      }, [data])

      useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(() => setToast(null), 2800)
        return () => clearTimeout(timer)
      }, [toast])

      useEffect(() => {
        const onFocus = () => refresh()
        window.addEventListener('focus', onFocus)
        return () => window.removeEventListener('focus', onFocus)
      }, [refresh])

      const tasks = data?.tasks ?? []
      const stats = data?.stats ?? { total: 0, done: 0, inProgress: 0, blocked: 0, overdue: 0, progress: 0 }
      const today = data?.today ?? todayIso()
      const allTasks = useMemo(() => flattenTree(tasks), [tasks])
      const byId = useMemo(() => new Map(allTasks.map((task) => [task.id, task])), [allTasks])
      const options = useMemo(() => taskOptions(tasks), [tasks])
      const rows = useMemo(() => visibleRows(tasks, collapsed), [tasks, collapsed])
      const timeline = useMemo(() => {
        const value = buildWindow(scale, anchor, today)
        return { ...value, today }
      }, [scale, anchor, today])

      useEffect(() => {
        if (status === 'ready' && selectedId && !byId.has(selectedId)) setSelectedId(null)
      }, [status, selectedId, byId])

      useEffect(() => {
        if (!dialog) return
        if ((dialog.type === 'edit' || dialog.type === 'split') && dialog.id && !byId.has(dialog.id)) {
          setDialog(null)
        }
      }, [dialog, byId])

      const refreshWithToast = useCallback((message, errorMessage) => {
        refresh()
        setToast({ text: message, kind: errorMessage ? 'error' : 'ok' })
      }, [refresh])

      const handleSaved = useCallback((message, id) => {
        setDialog(null)
        if (id) setSelectedId(id)
        refresh()
        setToast({ text: message, kind: 'ok' })
      }, [refresh])

      const cycleStatus = useCallback(async (task) => {
        if (task.hasChildren) return
        const base = task.status === 'blocked' ? 'todo' : task.status
        const next = base === 'todo' ? 'in_progress' : base === 'in_progress' ? 'done' : 'todo'
        try {
          await requestJson('api/gantt/task/status', {
            method: 'POST',
            body: JSON.stringify({ id: task.id, status: next }),
          })
          refreshWithToast(t('notice.statusUpdated'))
        } catch (failure) {
          refreshWithToast(failure instanceof Error ? failure.message : String(failure), true)
        }
      }, [refreshWithToast, t])

      const seed = useCallback(async () => {
        try {
          await requestJson('api/gantt/seed', { method: 'POST', body: '{}' })
          refreshWithToast(t('notice.seeded'))
        } catch (failure) {
          refreshWithToast(failure instanceof Error ? failure.message : String(failure), true)
        }
      }, [refreshWithToast, t])

      const toggleCollapse = useCallback((id) => {
        setCollapsed((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }, [])

      const openCreate = useCallback((parentTask) => {
        setDialog({ type: 'create', parentId: parentTask?.id ?? null })
      }, [])

      const openEdit = useCallback((task) => {
        setSelectedId(task.id)
        setDialog({ type: 'edit', id: task.id })
      }, [])

      const shift = useCallback((direction) => {
        setAnchor((current) => (scale === 'week'
          ? addDays(current, direction * 14)
          : addMonths(current, direction * 3)))
      }, [scale])

      const goToday = useCallback(() => setAnchor(today), [today])

      const shell = (children) => h('div', { className: 'gantt-page' },
        h('style', { key: 'gantt-css' }, CSS),
        children
      )

      if (status === 'loading' && data === null) {
        return shell(h('div', { className: 'gantt-center' },
          h('span', { className: 'gantt-spinner' }),
          h('span', null, t('loading'))
        ))
      }

      if (status === 'error' && data === null) {
        return shell(h('div', { className: 'gantt-center' },
          h('div', { className: 'gantt-empty-title' }, t('error.title')),
          h('div', { className: 'gantt-empty-body' }, error),
          h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: refresh }, t('error.retry'))
        ))
      }

      const selectedTask = selectedId ? byId.get(selectedId) : null
      const dialogTask = dialog && dialog.id ? byId.get(dialog.id) : null
      const parentExcluded = dialogTask ? collectSubtree(dialogTask) : null
      const parentChoices = parentExcluded
        ? options.filter((option) => !parentExcluded.has(option.id))
        : options

      let dialogNode = null
      if (dialog?.type === 'create') {
        dialogNode = h(TaskDialog, {
          key: 'create',
          mode: 'create',
          parentTask: dialog.parentId ? byId.get(dialog.parentId) : null,
          parentOptions: options,
          t,
          onClose: () => setDialog(null),
          onSaved: handleSaved,
          onSplit: () => {},
        })
      } else if (dialog?.type === 'edit' && dialogTask) {
        dialogNode = h(TaskDialog, {
          key: dialogTask.id,
          mode: 'edit',
          task: dialogTask,
          parentOptions: parentChoices,
          t,
          onClose: () => setDialog(null),
          onSaved: handleSaved,
          onSplit: (task) => setDialog({ type: 'split', id: task.id }),
        })
      } else if (dialog?.type === 'split' && dialogTask) {
        dialogNode = h(SplitDialog, {
          key: `split-${dialogTask.id}`,
          task: dialogTask,
          t,
          onClose: () => setDialog(null),
          onSaved: handleSaved,
        })
      } else if (dialog?.type === 'api') {
        dialogNode = h(ApiDialog, {
          key: 'api',
          t,
          locale,
          onClose: () => setDialog(null),
        })
      }

      const content = tasks.length === 0
        ? h('div', { className: 'gantt-empty-wrap' },
          h('div', { className: 'gantt-empty' },
            h('span', { className: 'gantt-empty-icon' }, h(GanttGlyph, { size: 26 })),
            h('div', { className: 'gantt-empty-title' }, t('empty.title')),
            h('div', { className: 'gantt-empty-body' }, t('empty.body')),
            h('div', { className: 'gantt-empty-actions' },
              h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: () => openCreate(null) }, t('empty.new')),
              h('button', { className: 'gantt-btn', type: 'button', onClick: seed }, t('empty.seed'))
            )
          )
        )
        : h('div', { className: 'gantt-body' },
          h('div', {
            className: 'gantt-grid',
            style: { width: `calc(var(--gantt-left) + ${timeline.totalWidth}px)` },
          },
            h(TimelineHeader, { timeline, t, locale, taskCount: allTasks.length }),
            h('div', { className: 'gantt-rows' },
              h(GridLines, { timeline }),
              rows.map(({ task, depth }) => h(GanttRow, {
                key: task.id,
                task,
                depth,
                timeline,
                selected: task.id === selectedId,
                collapsed: collapsed.has(task.id),
                t,
                onSelect: openEdit,
                onToggle: toggleCollapse,
                onAddChild: openCreate,
                onCycleStatus: cycleStatus,
              }))
            )
          )
        )

      return shell(h(React.Fragment, null,
        h('header', { className: 'gantt-head' },
          h('div', { className: 'gantt-brand' },
            h('span', { className: 'gantt-brand-mark' }, h(GanttGlyph, { size: 22 })),
            h('div', { className: 'gantt-brand-text' },
              h('h1', { className: 'gantt-title' }, t('page.title')),
              h('p', { className: 'gantt-subtitle' }, t('page.subtitle'))
            )
          ),
          h('div', { className: 'gantt-actions' },
            h('div', { className: 'gantt-seg', role: 'group', 'aria-label': t('scale.label') },
              h('button', {
                className: 'gantt-seg-btn',
                type: 'button',
                'data-active': scale === 'week' ? 'true' : undefined,
                onClick: () => setScale('week'),
              }, t('scale.week')),
              h('button', {
                className: 'gantt-seg-btn',
                type: 'button',
                'data-active': scale === 'month' ? 'true' : undefined,
                onClick: () => setScale('month'),
              }, t('scale.month'))
            ),
            h('button', { className: 'gantt-btn gantt-icon-btn', type: 'button', title: t('actions.prev'), 'aria-label': t('actions.prev'), onClick: () => shift(-1) }, '‹'),
            h('button', { className: 'gantt-btn', type: 'button', onClick: goToday }, t('actions.today')),
            h('button', { className: 'gantt-btn gantt-icon-btn', type: 'button', title: t('actions.next'), 'aria-label': t('actions.next'), onClick: () => shift(1) }, '›'),
            h('button', { className: 'gantt-btn', type: 'button', onClick: () => setDialog({ type: 'api' }) }, t('actions.api')),
            h('button', {
              className: 'gantt-btn gantt-icon-btn',
              type: 'button',
              title: t('actions.refresh'),
              'aria-label': t('actions.refresh'),
              disabled: status === 'refreshing',
              onClick: refresh,
            }, status === 'refreshing' ? '…' : '⟳'),
            h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: () => openCreate(null) }, `+ ${t('actions.new')}`)
          )
        ),
        h('section', { className: 'gantt-stats' },
          h('div', { className: 'gantt-window' },
            h('span', { className: 'gantt-window-scale' }, scale === 'week' ? t('scale.weekShort') : t('scale.monthShort')),
            h('span', { className: 'gantt-window-label' }, windowTitle(timeline, locale))
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': 'var(--dsw-alias-label-secondary)' } }),
            t('stats.total'), h('b', null, stats.total)
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.in_progress } }),
            t('stats.inProgress'), h('b', null, stats.inProgress)
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.done } }),
            t('stats.done'), h('b', null, stats.done)
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.blocked } }),
            t('stats.overdue'), h('b', null, stats.overdue)
          ),
          h('div', { className: 'gantt-stat-progress' },
            h('span', null, `${t('stats.progress')} ${stats.progress}%`),
            h('div', { className: 'gantt-progress' }, h('span', { style: { width: `${stats.progress}%` } }))
          )
        ),
        error && data ? h('div', { className: 'gantt-banner' },
          h('span', null, error),
          h('button', { className: 'gantt-btn', type: 'button', onClick: refresh }, t('error.retry'))
        ) : null,
        content,
        dialogNode,
        toast ? h('div', {
          className: 'gantt-toast',
          'data-error': toast.kind === 'error' ? 'true' : undefined,
          role: 'status',
        }, toast.text) : null
      ))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        runtime = ctx
        ctx.effect(() => () => {
          if (runtime === ctx) runtime = null
        }, 'gantt: release runtime context')
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
        }, GanttPage))
      },
    }
  },
})
