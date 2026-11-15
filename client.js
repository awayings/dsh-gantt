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
      skipped: 'var(--dsw-alias-label-secondary)',
    }
    const SLOT_ORDER = ['morning', 'daytime', 'evening', 'other']
    const PLAN_STATUSES = ['todo', 'in_progress', 'done', 'skipped']

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
      'nav.today': 'Today',
      'today.title': 'Today',
      'today.subtitle': 'Planned time blocks, their status, and the task-tree nodes in play.',
      'today.prevDay': 'Previous day',
      'today.nextDay': 'Next day',
      'today.todayButton': 'Today',
      'today.refresh': 'Refresh',
      'today.import': 'Import plan',
      'today.importDone': 'Plan imported',
      'today.importFailed': 'Import failed',
      'today.coreGoal': 'Core goal',
      'today.integrityTitle': 'Integrity checks',
      'today.integrity.landing-missing': 'A block has no landing target',
      'today.integrity.evening-missing': 'No evening block for this day',
      'today.integrity.inspiration-missing': 'An evening block carries no inspiration id',
      'today.integrity.unplanned-day': 'This day has no plan yet',
      'today.blocks': 'Time blocks',
      'today.nodes': "This week's nodes",
      'today.nodesEmpty': 'No task-tree nodes in play this week.',
      'today.emptyTitle': 'No plan for this day',
      'today.emptyHint': 'Import the task tracker to load the schedule board, task tree, and daily card.',
      'today.emptyAction': 'Import now',
      'today.emptyDay': 'No time blocks planned for this day.',
      'slot.morning': 'Morning',
      'slot.daytime': 'Daytime',
      'slot.evening': 'Evening',
      'slot.other': 'Unscheduled',
      'planStatus.todo': 'To do',
      'planStatus.in_progress': 'In progress',
      'planStatus.done': 'Done',
      'planStatus.skipped': 'Skipped',
      'today.statusHint': 'Click to cycle the block status',
      'today.open': 'Market open',
      'today.closed': 'Market closed',
      'today.weekdayLabel': 'Weekday',
      'today.remaining': 'Remaining',
      'today.doneCount': 'Done',
      'today.fromTree': 'From task tree',
      'level.label': 'Tree depth',
      'level.all': 'All levels',
      'level.two': 'Two levels',
      'level.one': 'One level',
      'brief.title': 'Frontier / next',
      'brief.pending': 'pending leaves',
      'brief.frontier': 'Frontier',
      'brief.next': 'Next',
      'tree.decompose': 'Decompose into subtasks',
      'tree.schedule': 'Schedule into a day plan',
      'field.state': 'Raw state',
      'field.lane': 'Lane',
      'field.doneWhen': 'Done when',
      'field.doneWhenPlaceholder': 'What evidence proves this is done?',
      'field.landing': 'Landing',
      'field.estimate': 'Estimate',
      'field.category': 'Category',
      'field.inspiration': 'Inspiration',
      'field.links': 'Links',
      'field.planDate': 'Plan date',
      'field.planTime': 'Plan time',
      'field.startTime': 'Start time',
      'field.endTime': 'End time',
      'dialog.decomposeTitle': 'Decompose node',
      'dialog.decompose': 'Decompose',
      'dialog.decomposeParent': 'Parent',
      'dialog.decomposeHint': 'A/B rule: decomposition itself takes a slot — class A children go straight into a work block; class B children first get a definition slot.',
      'dialog.scheduleTitle': 'Schedule into day plan',
      'dialog.schedule': 'Schedule',
      'dialog.scheduleHint': 'The block lands on the chosen day; fields start from the node values and stay editable.',
      'dialog.contextTitle': 'Model context',
      'actions.context': 'Export context',
      'context.intro': 'Read-only Markdown export of the unified task tree and today plan, ready to paste into a model context.',
      'context.loading': 'Rendering context…',
      'context.chars': '{n} characters',
      'context.truncated': 'truncated to the size limit',
      'context.copy': 'Copy',
      'context.copied': 'Copied to the clipboard.',
      'context.copyFallback': 'Clipboard unavailable: the text is selected. Press Ctrl/Cmd+C to copy.',
      'validation.decomposeChild': 'Each child needs a title and a done-when standard.',
      'validation.planDate': 'Pick a day to schedule this into.',
      'validation.times': 'The end time cannot be before the start time.',
      'notice.decomposed': 'Decomposed {n} subtasks, {m} scheduled into {date}',
      'notice.decomposedNoPlan': 'Decomposed {n} subtasks (none scheduled yet)',
      'notice.scheduled': 'Scheduled into {date}',
    }

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
      'nav.today': '今日',
      'today.title': '今日安排',
      'today.subtitle': '当天的时间格、执行状态，以及正在推进的任务树节点。',
      'today.prevDay': '前一天',
      'today.nextDay': '后一天',
      'today.todayButton': '今天',
      'today.refresh': '刷新',
      'today.import': '导入计划',
      'today.importDone': '计划已导入',
      'today.importFailed': '导入失败',
      'today.coreGoal': '核心目标',
      'today.integrityTitle': '完整性检查',
      'today.integrity.landing-missing': '有任务格缺少落点',
      'today.integrity.evening-missing': '当天缺少晚间多元格',
      'today.integrity.inspiration-missing': '晚间多元格缺少灵感编号',
      'today.integrity.unplanned-day': '这一天还没有计划',
      'today.blocks': '时间格',
      'today.nodes': '本周节点',
      'today.nodesEmpty': '本周没有推进中的节点。',
      'today.emptyTitle': '这一天还没有计划',
      'today.emptyHint': '导入任务跟踪器，载入未来 7 天日程、任务树和每日卡片。',
      'today.emptyAction': '立即导入',
      'today.emptyDay': '这一天没有安排时间格。',
      'slot.morning': '盘前',
      'slot.daytime': '工作时段',
      'slot.evening': '晚间多元格',
      'slot.other': '未定时',
      'planStatus.todo': '待开始',
      'planStatus.in_progress': '进行中',
      'planStatus.done': '已完成',
      'planStatus.skipped': '已跳过',
      'today.statusHint': '点击切换时间格状态',
      'today.open': '开市',
      'today.closed': '休市',
      'today.weekdayLabel': '星期',
      'today.remaining': '剩余',
      'today.doneCount': '已完成',
      'today.fromTree': '来自树节点',
      'level.label': '显示层级',
      'level.all': '全部',
      'level.two': '两层',
      'level.one': '一层',
      'brief.title': '前沿 / 该动',
      'brief.pending': '个待办叶子',
      'brief.frontier': '前沿',
      'brief.next': '该动',
      'tree.decompose': '拆解为子任务',
      'tree.schedule': '排入某天计划',
      'field.state': '原始状态',
      'field.lane': '泳道',
      'field.doneWhen': '完成标准',
      'field.doneWhenPlaceholder': '用什么证据证明已经完成？',
      'field.landing': '落点',
      'field.estimate': '预估',
      'field.category': '类别',
      'field.inspiration': '灵感',
      'field.links': '链接',
      'field.planDate': '排到哪天',
      'field.planTime': '排入时间',
      'field.startTime': '开始时间',
      'field.endTime': '结束时间',
      'dialog.decomposeTitle': '拆解节点',
      'dialog.decompose': '拆解',
      'dialog.decomposeParent': '父节点',
      'dialog.decomposeHint': 'A/B 类规则：拆解本身也占一个时间格——A 类子任务直接进执行格，B 类子任务先排一个「定义/拆解」格。',
      'dialog.scheduleTitle': '排入某天计划',
      'dialog.schedule': '排入计划',
      'dialog.scheduleHint': '时间格会落在所选日期；字段默认继承节点值，仍可修改。',
      'dialog.contextTitle': '模型上下文',
      'actions.context': '导出上下文',
      'context.intro': '统一任务树与今日计划的只读 Markdown，可直接粘贴进模型上下文。',
      'context.loading': '正在生成上下文…',
      'context.chars': '{n} 字符',
      'context.truncated': '已按上限裁剪',
      'context.copy': '复制',
      'context.copied': '已复制到剪贴板。',
      'context.copyFallback': '剪贴板不可用：文本已选中，请按 Ctrl/Cmd+C 复制。',
      'validation.decomposeChild': '每个子任务都需要标题和完成标准（done when）。',
      'validation.planDate': '请选择要排入的日期。',
      'validation.times': '结束时间不能早于开始时间。',
      'notice.decomposed': '已拆解 {n} 项，{m} 项已排入 {date}',
      'notice.decomposedNoPlan': '已拆解 {n} 项（暂未排期）',
      'notice.scheduled': '已排入 {date}',
    }

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
      '/api/gantt/task/decompose': {
        en: 'Decompose a tree node into subtasks, optionally scheduling each one. Body: { id, planDate?, children: [{ title, doneWhen, ..., plan? }] }.',
        zh: '把树节点拆成子任务，可选同时排期。Body：{ id, planDate?, children: [{ title, doneWhen, ..., plan? }] }。',
      },
      '/api/gantt/task/schedule': {
        en: 'Schedule one task into a day plan. Body: { id, date, startTime?, endTime?, slot?, landing?, estimate?, category?, inspiration?, detail? }.',
        zh: '把一个任务排进某天计划。Body：{ id, date, startTime?, endTime?, slot?, landing?, estimate?, category?, inspiration?, detail? }。',
      },
      '/api/gantt/context': {
        en: 'Export the unified task tree and today plan as read-only Markdown for model context.',
        zh: '把统一任务树与今日计划导出为只读 Markdown，供模型上下文使用。',
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

    function formatDate(iso, locale) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        year: 'numeric',
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

    function formatWeekdayLong(iso, locale) {
      return new Intl.DateTimeFormat(localeTag(locale), {
        weekday: 'long',
        timeZone: 'UTC',
      }).format(new Date(isoToDay(iso)))
    }

    function groupUnits(units, keyLength) {
      const groups = []
      for (const unit of units) {
        const key = unit.startIso.slice(0, keyLength)
        let group = groups[groups.length - 1]
        if (!group || group.key !== key) {
          group = { key, startIso: unit.startIso, width: 0 }
          groups.push(group)
        }
        group.width += unit.width
      }
      return groups
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
        const groups = groupUnits(units, 7)
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
      const groups = groupUnits(units, 4)
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
        return `${formatDate(timeline.start, locale)} – ${formatDate(addDays(timeline.endExclusive, -1), locale)}`
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
        listener => (ctx ? ctx.locale.subscribe(listener) : () => {}),
        [ctx],
      )
      const readRevision = useCallback(
        () => (ctx ? ctx.locale.getSnapshot().revision : 0),
        [ctx],
      )
      useSyncExternalStore(subscribe, readRevision, readRevision)
      if (!ctx) return { locale: 'en', t: key => key }
      const snapshot = ctx.locale.getSnapshot()
      return {
        locale: snapshot.locale,
        t: ctx.locale.bind(NS),
      }
    }

    function useGanttData() {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [revision, setRevision] = useState(0)
      const refresh = useCallback(() => setRevision(value => value + 1), [])

      useEffect(() => {
        const controller = new AbortController()
        let active = true
        setState(previous => ({
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
            setState(previous => ({
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

    function useTodayData(date) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [revision, setRevision] = useState(0)
      const refresh = useCallback(() => setRevision(value => value + 1), [])

      useEffect(() => {
        const controller = new AbortController()
        let active = true
        setState(previous => ({
          ...previous,
          status: previous.data ? 'refreshing' : 'loading',
          error: null,
        }))
        requestJson(`api/gantt/day?date=${encodeURIComponent(date)}`, { signal: controller.signal })
          .then((body) => {
            if (active) setState({ status: 'ready', data: body, error: null })
          })
          .catch((error) => {
            if (!active || error.name === 'AbortError') return
            setState(previous => ({
              ...previous,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            }))
          })
        return () => {
          active = false
          controller.abort()
        }
      }, [date, revision])

      return { ...state, refresh }
    }

    function nextPlanStatus(status) {
      const index = PLAN_STATUSES.indexOf(status)
      return PLAN_STATUSES[(index + 1) % PLAN_STATUSES.length]
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
          output.push({ id: node.id, label: `${rowNumber(node)} ${node.title}`, depth })
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

    /** Hermes dotted id of a `track:1` / `node:1.8.1` ref. */
    function refIdOf(ref) {
      return String(ref || '').replace(/^(?:node|track):/, '')
    }

    function rowNumber(task) {
      return task.ref ? refIdOf(task.ref) : task.number
    }

    /** Ids of the nodes that must be collapsed to keep only `level` tree depths. */
    function collapseForLevel(nodes, level) {
      const ids = new Set()
      const walk = (list, depth) => {
        for (const node of list) {
          if (node.children.length > 0 && depth >= level - 1) ids.add(node.id)
          walk(node.children, depth + 1)
        }
      }
      walk(nodes, 0)
      return ids
    }

    /** Root-to-node path, or null when the id is not in the current tree. */
    function taskPath(nodes, id) {
      const walk = (list, trail) => {
        for (const node of list) {
          const nextTrail = [...trail, node]
          if (node.id === id) return nextTrail
          const found = walk(node.children, nextTrail)
          if (found !== null) return found
        }
        return null
      }
      return walk(nodes, [])
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
      h('path', { d: 'M3.5 2.8v18.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.42 }),
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
      h('path', { d: 'M3.5 3v18', opacity: 0.4 }),
      )
    }

    function TodayGlyph({ size = 18, active = false }) {
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
      h('rect', { x: 4, y: 5, width: 16, height: 15, rx: 3.2 }),
      h('path', { d: 'M4 9.6h16', opacity: 0.55 }),
      h('path', { d: 'M8 3v3.4M16 3v3.4' }),
      h('circle', { cx: 12, cy: 14.6, r: 2.3, fill: 'currentColor', stroke: 'none' }),
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

    function MetaChips({ task, t }) {
      const chips = []
      const push = (key, label, title) => {
        chips.push(h('span', { key, className: 'gantt-row-chip', title }, label))
      }
      if (task.kind === 'track') {
        if (task.lane) push('lane', task.lane, `${t('field.lane')}: ${task.lane}`)
        if (task.state) push('state', task.state, `${t('field.state')}: ${task.state}`)
      } else {
        if (task.state) push('state', task.state, `${t('field.state')}: ${task.state}`)
        if (task.doneWhen) push('doneWhen', task.doneWhen, `${t('field.doneWhen')}: ${task.doneWhen}`)
        if (task.landing) push('landing', `⤷ ${task.landing}`, `${t('field.landing')}: ${task.landing}`)
        if (task.estimate) push('estimate', task.estimate, `${t('field.estimate')}: ${task.estimate}`)
        if (task.category) push('category', task.category, `${t('field.category')}: ${task.category}`)
        if (task.inspiration) push('inspiration', task.inspiration, `${t('field.inspiration')}: ${task.inspiration}`)
        for (const link of Array.isArray(task.links) ? task.links : []) {
          push(`link:${link.ref}`, link.label || link.ref, `${t('field.links')}: ${link.type}:${link.ref}`)
        }
      }
      if (chips.length === 0) return null
      return h('div', { className: 'gantt-task-meta' }, chips)
    }

    function BriefStrip({ brief, t, onReveal }) {
      const lanes = brief && Array.isArray(brief.lanes)
        ? brief.lanes.filter(lane => lane && (lane.frontier || lane.next))
        : []
      if (lanes.length === 0) return null
      const pick = (entry, label, kind) => h('button', {
        key: kind,
        type: 'button',
        className: 'gantt-brief-pick',
        'data-kind': kind,
        title: `${entry.number || refIdOf(entry.ref)} ${entry.title}`,
        onClick: () => onReveal(entry.id),
      },
      h('span', { className: 'gantt-brief-tag' }, label),
      h('span', { className: 'gantt-brief-id' }, entry.number || refIdOf(entry.ref)),
      h('span', { className: 'gantt-brief-name' }, entry.title),
      )
      return h('section', { className: 'gantt-brief' },
        h('div', { className: 'gantt-brief-head' },
          h('span', { className: 'gantt-brief-title' }, t('brief.title')),
          typeof brief.pending === 'number'
            ? h('span', { className: 'gantt-brief-pending' }, `${brief.pending} ${t('brief.pending')}`)
            : null,
        ),
        h('div', { className: 'gantt-brief-lanes' },
          lanes.map(lane => h('div', { key: lane.id || lane.ref || lane.name, className: 'gantt-brief-lane' },
            h('span', { className: 'gantt-brief-lane-name' }, lane.name),
            lane.lane ? h('span', { className: 'gantt-row-chip' }, lane.lane) : null,
            lane.frontier ? pick(lane.frontier, t('brief.frontier'), 'frontier') : null,
            lane.next ? pick(lane.next, t('brief.next'), 'next') : null,
          )),
        ),
      )
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
        title: `${rowNumber(task)} ${task.title}\n${task.startDate} → ${task.endDate} · ${task.progress}%`,
        onClick: (event) => {
          event.stopPropagation()
          onSelect(task)
        },
      },
      h('span', { className: 'gantt-bar-fill', style: { width: `${task.progress}%` } }),
      !task.hasChildren && range.width > 58
        ? h('span', { className: 'gantt-bar-label' }, task.title)
        : null,
      )
    }

    function GanttRow({
      task,
      depth,
      timeline,
      selected,
      collapsed,
      t,
      onSelect,
      onToggle,
      onAddChild,
      onCycleStatus,
      onDecompose,
      onSchedule,
    }) {
      const hasChildren = task.hasChildren
      const number = rowNumber(task)
      const isTrack = task.kind === 'track'
      return h('div', {
        className: 'gantt-row',
        'data-selected': selected ? 'true' : undefined,
        'data-depth': depth,
        'data-kind': task.kind,
        'data-task-id': task.id,
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
        'aria-label': `${number} ${task.title}`,
      },
      h('div', { className: 'gantt-task-cell', style: { paddingLeft: `${10 + depth * 16}px` } },
        h('div', { className: 'gantt-task-line' },
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
          h('span', { className: 'gantt-number', title: task.ref || number }, number),
          h('span', { className: 'gantt-task-title', title: task.title }, task.title),
          h(StatusPill, {
            status: task.status,
            label: t(`status.${task.status}`),
            interactive: !hasChildren,
            title: hasChildren ? t('status.summaryHint') : t('status.cycleHint'),
            onClick: () => onCycleStatus(task),
          }),
          h('div', { className: 'gantt-row-actions' },
            isTrack ? null : h('button', {
              className: 'gantt-row-action',
              type: 'button',
              'data-action': 'decompose',
              title: t('tree.decompose'),
              'aria-label': t('tree.decompose'),
              onClick: (event) => {
                event.stopPropagation()
                onDecompose(task)
              },
            }, '⋔'),
            isTrack ? null : h('button', {
              className: 'gantt-row-action',
              type: 'button',
              'data-action': 'schedule',
              title: t('tree.schedule'),
              'aria-label': t('tree.schedule'),
              onClick: (event) => {
                event.stopPropagation()
                onSchedule(task)
              },
            }, '▦'),
            h('button', {
              className: 'gantt-add-child',
              type: 'button',
              title: t('tree.addChild'),
              'aria-label': t('tree.addChild'),
              onClick: (event) => {
                event.stopPropagation()
                onAddChild(task)
              },
            }, '+'),
          ),
        ),
        h(MetaChips, { task, t }),
      ),
      h('div', { className: 'gantt-track', style: { width: `${timeline.totalWidth}px` } },
        h(TaskBar, { task, timeline, onSelect }),
      ),
      )
    }

    function TimelineHeader({ timeline, t, locale, taskCount }) {
      return h('div', { className: 'gantt-header' },
        h('div', { className: 'gantt-corner' },
          h('span', { className: 'gantt-corner-title' }, t('tree.task')),
          h('span', { className: 'gantt-corner-sub' }, `${taskCount} ${t('stats.tasks')}`),
        ),
        h('div', { className: 'gantt-header-timeline', style: { width: `${timeline.totalWidth}px` } },
          h('div', { className: 'gantt-group-row' },
            timeline.groups.map(group => h('div', {
              key: group.key,
              className: 'gantt-group-cell',
              style: { width: `${group.width}px` },
            }, timeline.scale === 'week'
              ? formatMonthYear(group.startIso, locale)
              : formatYear(group.startIso, locale))),
          ),
          h('div', { className: 'gantt-unit-row' },
            timeline.units.map(unit => h('div', {
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
              : null,
            )),
          ),
        ),
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
        : null,
      )
    }

    function Field({ label, hint, children, full }) {
      return h('label', { className: `gantt-field${full ? ' gantt-field-full' : ''}` },
        h('span', { className: 'gantt-label' }, label),
        children,
        hint ? h('span', { className: 'gantt-hint' }, hint) : null,
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
        }, '×'),
      ),
      h('div', { className: 'gantt-dialog-body' }, children),
      h('div', { className: 'gantt-dialog-foot' }, footer),
      ),
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
        title: mode === 'create' ? t('dialog.createTitle') : `${t('dialog.editTitle')} · ${rowNumber(task)}`,
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
              : null,
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
            }, saving ? '…' : (mode === 'create' ? t('dialog.create') : t('dialog.save'))),
          ),
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
            onChange: event => setTitle(event.target.value),
          }),
        ),
        h(Field, { label: t('field.description'), full: true },
          h('textarea', {
            className: 'gantt-textarea',
            value: description,
            maxLength: 4000,
            placeholder: t('field.descriptionPlaceholder'),
            onChange: event => setDescription(event.target.value),
          }),
        ),
        h(Field, { label: t('field.parent'), full: true, hint: hasChildren ? t('field.summaryDates') : null },
          h('select', {
            className: 'gantt-select',
            value: parent,
            onChange: event => setParent(event.target.value),
          },
          h('option', { value: '' }, t('field.parentNone')),
          parentChoices.map(option => h('option', {
            key: option.id,
            value: option.id,
          }, `${'\u00a0\u00a0'.repeat(option.depth)}${option.label}`)),
          ),
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
          }),
        ),
        h(Field, { label: t('field.end') },
          h('input', {
            className: 'gantt-input',
            type: 'date',
            value: endDate,
            disabled: hasChildren,
            min: startDate,
            onChange: event => setEndDate(event.target.value),
          }),
        ),
        h(Field, { label: t('field.status') },
          h('select', {
            className: 'gantt-select',
            value: status,
            disabled: hasChildren,
            onChange: event => changeStatus(event.target.value),
          },
          STATUSES.map(value => h('option', { key: value, value }, t(`status.${value}`))),
          ),
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
            onChange: event => changeProgress(event.target.value),
          }),
        ),
      ),
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
        setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
      }

      const addRow = () => {
        const last = rows[rows.length - 1]
        const startDate = addDays(last.endDate, 1)
        const endDate = task.endDate > startDate ? task.endDate : addDays(startDate, 1)
        setRows(current => [...current, {
          key: `row-${splitRowSequence += 1}`,
          title: '',
          startDate,
          endDate,
        }])
      }

      const removeRow = (key) => {
        setRows(current => current.filter(row => row.key !== key))
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
              children: rows.map(row => ({
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
        title: `${t('dialog.splitTitle')} · ${rowNumber(task)} ${task.title}`,
        closeLabel: t('actions.close'),
        onClose,
        wide: true,
        footer: h(React.Fragment, null,
          h('div', { className: 'gantt-dialog-foot-left' },
            h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: addRow }, `+ ${t('dialog.addRow')}`),
          ),
          h('div', { className: 'gantt-dialog-foot-right' },
            h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
            h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.split')),
          ),
        ),
      },
      error ? h('div', { className: 'gantt-form-error' }, error) : null,
      h('p', { className: 'gantt-dialog-note' }, t('dialog.splitHint')),
      h('div', { className: 'gantt-split-head' },
        h('span', null, t('dialog.splitChildTitle')),
        h('span', null, t('field.start')),
        h('span', null, t('field.end')),
        h('span', null, ''),
      ),
      rows.map(row => h('div', { className: 'gantt-split-row', key: row.key },
        h('input', {
          className: 'gantt-input',
          'aria-label': t('dialog.splitChildTitle'),
          value: row.title,
          autoFocus: row === rows[0],
          placeholder: t('dialog.splitChildTitle'),
          onChange: event => updateRow(row.key, { title: event.target.value }),
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
          onChange: event => updateRow(row.key, { endDate: event.target.value }),
        }),
        h('button', {
          className: 'gantt-btn gantt-icon-btn',
          type: 'button',
          title: t('dialog.removeRow'),
          'aria-label': t('dialog.removeRow'),
          disabled: rows.length <= 1,
          onClick: () => removeRow(row.key),
        }, '×'),
      )),
      )
    }

    let decomposeRowSequence = 0

    function newDecomposeRow() {
      const planDate = addDays(todayIso(), 1)
      return {
        key: `dec-${decomposeRowSequence += 1}`,
        title: '',
        doneWhen: '',
        landing: '',
        estimate: '',
        category: '',
        inspiration: '',
        startDate: planDate,
        endDate: planDate,
        planDate,
        planTime: '21:00',
      }
    }

    function DecomposeDialog({ task, t, onClose, onSaved }) {
      const [rows, setRows] = useState(() => [newDecomposeRow()])
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)

      const updateRow = (key, patch) => {
        setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
      }

      const addRow = () => setRows(current => [...current, newDecomposeRow()])

      const removeRow = (key) => {
        setRows(current => current.filter(row => row.key !== key))
      }

      const submit = async () => {
        for (const row of rows) {
          if (row.title.trim().length === 0 || row.doneWhen.trim().length === 0) {
            setError(t('validation.decomposeChild'))
            return
          }
          if (row.startDate && row.endDate && row.endDate < row.startDate) {
            setError(t('validation.dates'))
            return
          }
        }
        setSaving(true)
        setError(null)
        try {
          const children = rows.map((row) => {
            const child = {
              title: row.title.trim(),
              doneWhen: row.doneWhen.trim(),
              landing: row.landing.trim(),
              estimate: row.estimate.trim(),
              category: row.category.trim(),
              inspiration: row.inspiration.trim(),
              startDate: row.startDate || undefined,
              endDate: row.endDate || undefined,
            }
            if (row.planDate) {
              child.plan = { date: row.planDate }
              if (row.planTime) child.plan.startTime = row.planTime
            }
            return child
          })
          const result = await requestJson('api/gantt/task/decompose', {
            method: 'POST',
            body: JSON.stringify({ id: task.id, children }),
          })
          const planned = children.filter(child => child.plan).length
          const planDay = children.find(child => child.plan)?.plan.date ?? ''
          const message = planned === 0
            ? t('notice.decomposedNoPlan').replace('{n}', String(children.length))
            : t('notice.decomposed')
              .replace('{n}', String(children.length))
              .replace('{m}', String(planned))
              .replace('{date}', planDay)
          onSaved(message, result.parent?.id ?? task.id)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }

      const fieldInput = (row, key, options = {}) => h('input', {
        className: 'gantt-input',
        'data-field': key,
        type: options.type,
        'aria-label': options.label,
        placeholder: options.placeholder,
        maxLength: options.maxLength,
        value: row[key],
        onChange: event => updateRow(row.key, { [key]: event.target.value }),
      })

      return h(Dialog, {
        title: `${t('dialog.decomposeTitle')} · ${rowNumber(task)} ${task.title}`,
        closeLabel: t('actions.close'),
        onClose,
        wide: true,
        footer: h(React.Fragment, null,
          h('div', { className: 'gantt-dialog-foot-left' },
            h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: addRow }, `+ ${t('dialog.addRow')}`),
          ),
          h('div', { className: 'gantt-dialog-foot-right' },
            h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
            h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.decompose')),
          ),
        ),
      },
      error ? h('div', { className: 'gantt-form-error' }, error) : null,
      h('p', { className: 'gantt-dialog-note' }, t('dialog.decomposeHint')),
      h('div', { className: 'gantt-parent-summary' },
        h('span', { className: 'gantt-label' }, t('dialog.decomposeParent')),
        h('span', { className: 'gantt-number' }, rowNumber(task)),
        h('span', { className: 'gantt-task-title' }, task.title),
        task.state ? h('span', { className: 'gantt-row-chip' }, task.state) : null,
        task.doneWhen ? h('span', { className: 'gantt-row-chip', title: task.doneWhen }, task.doneWhen) : null,
      ),
      rows.map((row, index) => h('div', { className: 'gantt-decompose-row', key: row.key },
        h('div', { className: 'gantt-decompose-head' },
          h('span', { className: 'gantt-decompose-index' }, `#${index + 1}`),
          fieldInput(row, 'title', { label: t('dialog.splitChildTitle'), placeholder: t('dialog.splitChildTitle'), maxLength: 200 }),
          fieldInput(row, 'doneWhen', { label: t('field.doneWhen'), placeholder: t('field.doneWhenPlaceholder') }),
          h('button', {
            className: 'gantt-btn gantt-icon-btn',
            type: 'button',
            title: t('dialog.removeRow'),
            'aria-label': t('dialog.removeRow'),
            disabled: rows.length <= 1,
            onClick: () => removeRow(row.key),
          }, '×'),
        ),
        h('div', { className: 'gantt-decompose-fields' },
          fieldInput(row, 'landing', { label: t('field.landing'), placeholder: t('field.landing') }),
          fieldInput(row, 'estimate', { label: t('field.estimate'), placeholder: t('field.estimate') }),
          fieldInput(row, 'category', { label: t('field.category'), placeholder: t('field.category') }),
          fieldInput(row, 'inspiration', { label: t('field.inspiration'), placeholder: t('field.inspiration') }),
          fieldInput(row, 'startDate', { type: 'date', label: t('field.start') }),
          fieldInput(row, 'endDate', { type: 'date', label: t('field.end') }),
          fieldInput(row, 'planDate', { type: 'date', label: t('field.planDate') }),
          fieldInput(row, 'planTime', { type: 'time', label: t('field.planTime') }),
        ),
      )),
      )
    }

    function ScheduleDialog({ task, t, onClose, onSaved }) {
      const [date, setDate] = useState(() => addDays(todayIso(), 1))
      const [startTime, setStartTime] = useState('21:00')
      const [endTime, setEndTime] = useState('22:00')
      const [category, setCategory] = useState(task.category || '')
      const [landing, setLanding] = useState(task.landing || '')
      const [estimate, setEstimate] = useState(task.estimate || '')
      const [inspiration, setInspiration] = useState(task.inspiration || '')
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)

      const submit = async () => {
        if (!date) {
          setError(t('validation.planDate'))
          return
        }
        if (startTime && endTime && endTime < startTime) {
          setError(t('validation.times'))
          return
        }
        setSaving(true)
        setError(null)
        try {
          const body = { id: task.id, date }
          if (startTime) body.startTime = startTime
          if (endTime) body.endTime = endTime
          if (category.trim()) body.category = category.trim()
          if (landing.trim()) body.landing = landing.trim()
          if (estimate.trim()) body.estimate = estimate.trim()
          if (inspiration.trim()) body.inspiration = inspiration.trim()
          const result = await requestJson('api/gantt/task/schedule', {
            method: 'POST',
            body: JSON.stringify(body),
          })
          onSaved(t('notice.scheduled').replace('{date}', date), result.task?.id ?? task.id)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving(false)
        }
      }

      return h(Dialog, {
        title: `${t('dialog.scheduleTitle')} · ${rowNumber(task)} ${task.title}`,
        closeLabel: t('actions.close'),
        onClose,
        footer: h('div', { className: 'gantt-dialog-foot-right' },
          h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
          h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.schedule')),
        ),
      },
      error ? h('div', { className: 'gantt-form-error' }, error) : null,
      h('p', { className: 'gantt-dialog-note' }, t('dialog.scheduleHint')),
      h('div', { className: 'gantt-form-grid' },
        h(Field, { label: t('field.planDate'), full: true },
          h('input', {
            className: 'gantt-input',
            'data-field': 'date',
            type: 'date',
            value: date,
            autoFocus: true,
            onChange: event => setDate(event.target.value),
          }),
        ),
        h(Field, { label: t('field.startTime') },
          h('input', {
            className: 'gantt-input',
            'data-field': 'startTime',
            type: 'time',
            value: startTime,
            onChange: event => setStartTime(event.target.value),
          }),
        ),
        h(Field, { label: t('field.endTime') },
          h('input', {
            className: 'gantt-input',
            'data-field': 'endTime',
            type: 'time',
            value: endTime,
            onChange: event => setEndTime(event.target.value),
          }),
        ),
        h(Field, { label: t('field.category') },
          h('input', {
            className: 'gantt-input',
            'data-field': 'category',
            value: category,
            onChange: event => setCategory(event.target.value),
          }),
        ),
        h(Field, { label: t('field.landing') },
          h('input', {
            className: 'gantt-input',
            'data-field': 'landing',
            value: landing,
            onChange: event => setLanding(event.target.value),
          }),
        ),
        h(Field, { label: t('field.estimate') },
          h('input', {
            className: 'gantt-input',
            'data-field': 'estimate',
            value: estimate,
            onChange: event => setEstimate(event.target.value),
          }),
        ),
        h(Field, { label: t('field.inspiration') },
          h('input', {
            className: 'gantt-input',
            'data-field': 'inspiration',
            value: inspiration,
            onChange: event => setInspiration(event.target.value),
          }),
        ),
      ),
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
          h('button', { className: 'gantt-btn', type: 'button', onClick: onClose }, t('actions.close')),
        ),
      },
      h('p', { className: 'gantt-dialog-note' }, t('dialog.apiIntro')),
      h('div', { className: 'gantt-api-meta' },
        h('div', null,
          h('span', { className: 'gantt-label' }, t('dialog.apiDb')),
          h('code', { className: 'gantt-code' }, meta?.dbPath ?? '—'),
        ),
        h('div', null,
          h('span', { className: 'gantt-label' }, 'Engine'),
          h('code', { className: 'gantt-code' }, meta?.engine ?? '—'),
        ),
      ),
      h('p', { className: 'gantt-hint' }, t('dialog.apiAuth')),
      error ? h('div', { className: 'gantt-form-error' }, error) : null,
      !meta && !error ? h('p', { className: 'gantt-hint' }, t('dialog.apiEmpty')) : null,
      meta
        ? h('div', { className: 'gantt-api-list' },
          (meta.endpoints ?? []).map(endpoint => h('div', { className: 'gantt-api-row', key: `${endpoint.method} ${endpoint.path}` },
            h('span', { className: 'gantt-method', 'data-method': endpoint.method }, endpoint.method),
            h('code', { className: 'gantt-code gantt-api-path' }, endpoint.path),
            h('span', { className: 'gantt-api-desc' }, API_TEXT[endpoint.path]
              ? API_TEXT[endpoint.path][String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en']
              : endpoint.description),
          )))
        : null,
      )
    }

    function ContextDialog({ t, onClose }) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [copyState, setCopyState] = useState('idle')
      const textareaRef = useRef(null)

      useEffect(() => {
        let active = true
        requestJson('api/gantt/context')
          .then((body) => {
            if (active) setState({ status: 'ready', data: body, error: null })
          })
          .catch((failure) => {
            if (active) {
              setState({
                status: 'error',
                data: null,
                error: failure instanceof Error ? failure.message : String(failure),
              })
            }
          })
        return () => {
          active = false
        }
      }, [])

      const copy = async () => {
        const markdown = state.data?.markdown ?? ''
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('clipboard unavailable')
          }
          await navigator.clipboard.writeText(markdown)
          setCopyState('copied')
        } catch {
          textareaRef.current?.select()
          setCopyState('fallback')
        }
      }

      const data = state.data
      const chars = data ? (typeof data.chars === 'number' ? data.chars : String(data.markdown ?? '').length) : 0

      return h(Dialog, {
        title: t('dialog.contextTitle'),
        closeLabel: t('actions.close'),
        onClose,
        wide: true,
        footer: h('div', { className: 'gantt-dialog-foot-right' },
          h('button', { className: 'gantt-btn', type: 'button', onClick: onClose }, t('actions.close')),
          h('button', {
            className: 'gantt-btn gantt-btn-primary',
            'data-action': 'copy',
            type: 'button',
            disabled: !data,
            onClick: copy,
          }, t('context.copy')),
        ),
      },
      state.status === 'loading' ? h('p', { className: 'gantt-hint' }, t('context.loading')) : null,
      state.error ? h('div', { className: 'gantt-form-error' }, state.error) : null,
      data
        ? h(React.Fragment, null,
          h('p', { className: 'gantt-dialog-note' }, t('context.intro')),
          h('textarea', {
            className: 'gantt-textarea gantt-context-text',
            ref: textareaRef,
            readOnly: true,
            value: data.markdown ?? '',
            rows: 14,
            'aria-label': t('dialog.contextTitle'),
          }),
          h('div', { className: 'gantt-context-meta' },
            h('span', null, t('context.chars').replace('{n}', String(chars))),
            data.truncated ? h('span', { className: 'gantt-context-truncated' }, t('context.truncated')) : null,
          ),
        )
        : null,
      copyState === 'copied' ? h('p', { className: 'gantt-hint' }, t('context.copied')) : null,
      copyState === 'fallback' ? h('p', { className: 'gantt-hint' }, t('context.copyFallback')) : null,
      )
    }

    function TodayBlock({ block, t, onCycle }) {
      const time = [block.startTime, block.endTime].filter(Boolean).join('–') || '—'
      return h('article', {
        className: 'today-block',
        'data-block-id': block.id,
        'data-slot': block.slot,
        'data-status': block.status,
        'data-source': block.source,
      },
      h('div', { className: 'today-block-time' }, time),
      h('div', { className: 'today-block-main' },
        h('div', { className: 'today-block-head' },
          block.source === 'task'
            ? h('span', { className: 'today-source-badge' }, t('today.fromTree'))
            : null,
          block.category ? h('span', { className: 'today-chip' }, block.category) : null,
          h('h4', { className: 'today-block-title', title: block.title }, block.title),
          h(StatusPill, {
            status: block.status,
            label: t(`planStatus.${block.status}`),
            interactive: true,
            title: t('today.statusHint'),
            onClick: () => onCycle(block),
          }),
        ),
        block.detail && block.detail !== block.title
          ? h('p', { className: 'today-block-detail' }, block.detail)
          : null,
        h('div', { className: 'today-block-meta' },
          block.landing ? h('span', { className: 'today-chip today-chip-muted' }, `⤷ ${block.landing}`) : null,
          block.estimate ? h('span', { className: 'today-chip today-chip-muted' }, block.estimate) : null,
          block.inspiration ? h('span', { className: 'today-chip today-chip-muted' }, block.inspiration) : null,
        ),
      ),
      )
    }

    function TodayNode({ node, t }) {
      const range = [node.startDate, node.endDate].filter(Boolean).join(' – ')
      const links = Array.isArray(node.links) ? node.links : []
      return h('li', {
        className: 'today-node',
        'data-state': node.state || 'unknown',
        'data-kind': node.kind,
      },
      h('span', { className: 'today-node-id', title: node.ref || node.id }, node.ref ? refIdOf(node.ref) : node.id),
      h('span', { className: 'today-node-title', title: node.title }, node.title),
      node.state ? h('span', { className: 'today-chip' }, node.state) : null,
      node.lane ? h('span', { className: 'today-chip' }, node.lane) : null,
      range ? h('span', { className: 'today-node-range' }, range) : null,
      node.dep ? h('span', { className: 'today-chip today-chip-muted' }, node.dep) : null,
      node.landing
        ? h('span', { className: 'today-chip today-chip-muted', title: `${t('field.landing')}: ${node.landing}` }, `⤷ ${node.landing}`)
        : null,
      links.map(link => h('span', {
        key: `${link.type}:${link.ref}`,
        className: 'today-chip today-chip-muted',
        title: `${link.type}:${link.ref}`,
      }, link.label || link.ref)),
      )
    }

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
        container-type: inline-size;
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
        min-height: 38px;
        height: auto;
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
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding-right: 8px;
        background: var(--gantt-surface);
        border-right: 1px solid var(--gantt-line-strong);
        border-bottom: 1px solid var(--gantt-line);
        overflow: hidden;
      }
      .gantt-task-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .gantt-task-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        padding-left: 24px;
        overflow: hidden;
      }
      .gantt-row-chip {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 190px;
        font-size: 10px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 999px;
        border: 1px solid var(--gantt-line);
        color: var(--gantt-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .gantt-row-actions { display: flex; align-items: center; gap: 1px; flex: 0 0 auto; }
      .gantt-row-action {
        flex: 0 0 20px;
        width: 20px; height: 20px;
        display: grid; place-items: center;
        border: 0; border-radius: 6px;
        background: transparent;
        color: var(--gantt-muted);
        opacity: 0.5;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        padding: 0;
      }
      .gantt-row-action:hover { opacity: 1; color: var(--gantt-accent); background: color-mix(in srgb, var(--gantt-accent) 12%, transparent); }
      .gantt-row[data-selected="true"] .gantt-task-cell {
        background: color-mix(in srgb, var(--gantt-accent) 10%, var(--gantt-surface));
        box-shadow: inset 3px 0 0 var(--gantt-accent);
      }
      .gantt-track {
        position: relative;
        flex: 0 0 auto;
        min-height: 38px;
        height: auto;
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
      .gantt-brief {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 22px 10px;
        border-bottom: 1px solid var(--gantt-line);
        background: color-mix(in srgb, var(--gantt-accent) 4%, var(--gantt-bg));
      }
      .gantt-brief-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
      .gantt-brief-title { font-size: 11.5px; font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; color: var(--gantt-muted); }
      .gantt-brief-pending { font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
      .gantt-brief-lanes { display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px 18px; }
      .gantt-brief-lane { flex: 1 1 330px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
      .gantt-brief-lane-name { font-size: 11.5px; font-weight: 600; min-width: 86px; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .gantt-brief-pick {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: min(360px, 100%);
        height: 24px;
        padding: 0 9px;
        border-radius: 7px;
        border: 1px solid var(--gantt-line-strong);
        background: var(--gantt-surface);
        color: var(--gantt-text);
        font-size: 11px;
        cursor: pointer;
        min-width: 0;
      }
      .gantt-brief-pick:hover { border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent); }
      .gantt-brief-tag { flex: 0 0 auto; font-size: 10px; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--gantt-accent) 14%, transparent); color: var(--gantt-accent); }
      .gantt-brief-pick[data-kind="next"] .gantt-brief-tag { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent); color: var(--dsw-alias-state-success-primary); }
      .gantt-brief-id { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--gantt-muted); }
      .gantt-brief-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gantt-parent-summary {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        padding: 9px 11px;
        border: 1px solid var(--gantt-line);
        border-radius: 9px;
        background: color-mix(in srgb, var(--gantt-bg) 60%, transparent);
      }
      .gantt-parent-summary .gantt-task-title { flex: 0 1 auto; }
      .gantt-decompose-row {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 9px 10px;
        border: 1px solid var(--gantt-line);
        border-radius: 10px;
        background: color-mix(in srgb, var(--gantt-bg) 50%, transparent);
      }
      .gantt-decompose-head {
        display: grid;
        grid-template-columns: 22px minmax(0, 1.1fr) minmax(0, 1fr) 32px;
        gap: 7px;
        align-items: center;
      }
      .gantt-decompose-index { font-size: 10.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
      .gantt-decompose-head .gantt-btn { width: 32px; height: 32px; }
      .gantt-decompose-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 7px; }
      .gantt-context-text { min-height: 260px; max-height: 46vh; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.5; white-space: pre; }
      .gantt-context-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
      .gantt-context-truncated { color: var(--gantt-accent); }
      @container (max-width: 980px) {
        .gantt-head, .gantt-stats, .gantt-body, .gantt-backdrop { --gantt-left: 280px; }
        .gantt-subtitle { display: none; }
        .gantt-stat-progress { max-width: none; }
        .gantt-api-meta { grid-template-columns: 1fr; }
        .gantt-brief, .gantt-head, .gantt-stats { padding-left: 14px; padding-right: 14px; }
      }
      @container (max-width: 720px) {
        .gantt-head, .gantt-stats, .gantt-body, .gantt-backdrop { --gantt-left: 230px; }
        .gantt-number { min-width: 30px; }
        .gantt-status-label { display: none; }
        .gantt-status { padding: 0 6px; }
        .gantt-task-meta { padding-left: 10px; }
        .gantt-row-chip { max-width: 132px; }
        .gantt-form-grid { grid-template-columns: 1fr; }
        .gantt-split-head, .gantt-split-row { grid-template-columns: minmax(0, 1fr) 110px 110px 32px; }
        .gantt-api-row { grid-template-columns: 44px minmax(0, 1fr); }
        .gantt-api-desc { grid-column: 1 / -1; }
        .gantt-decompose-head { grid-template-columns: 18px minmax(0, 1fr) 32px; }
        .gantt-decompose-head > [data-field="doneWhen"] { grid-column: 2 / 4; }
        .gantt-brief-lane-name { min-width: 0; }
      }
    `

    const CSS = [CSS_BASE, CSS_HEAD, CSS_STATS, CSS_GRID, CSS_EMPTY, CSS_DIALOG, CSS_MISC].join('\n')

    const CSS_TODAY = `
      .today-page { container-type: inline-size; }
      .today-page .today-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding: 14px 22px 26px; }
      .today-meta { flex-wrap: wrap; gap: 8px 14px; padding: 10px 12px; border: 1px solid var(--gantt-line); border-radius: 10px; background: var(--gantt-surface); }
      .today-meta-date { display: inline-flex; align-items: baseline; gap: 7px; }
      .today-meta-date strong { font-size: 13.5px; font-variant-numeric: tabular-nums; }
      .today-weekday { font-size: 12px; color: var(--gantt-muted); }
      .today-meta-label { font-size: 12px; color: var(--gantt-muted); }
      .today-market { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--gantt-line-strong); color: var(--gantt-muted); white-space: nowrap; }
      .today-market[data-open="true"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); }
      .today-meta .gantt-stat-progress { margin-left: auto; min-width: 200px; flex: 1 1 240px; max-width: 440px; }
      .today-goal { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-left: 3px solid var(--gantt-accent); border-radius: 8px; background: color-mix(in srgb, var(--gantt-accent) 8%, transparent); }
      .today-goal-text { margin: 0; font-size: 12.5px; }
      .today-section-title { margin: 0; font-size: 11.5px; font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; color: var(--gantt-muted); }
      .today-integrity { display: flex; flex-direction: column; gap: 7px; padding: 10px 12px; border: 1px solid var(--gantt-line); border-radius: 10px; background: var(--gantt-surface); }
      .today-integrity-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .today-integrity-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--gantt-muted); }
      .today-blocks, .today-slot, .today-nodes { display: flex; flex-direction: column; }
      .today-blocks { gap: 10px; }
      .today-slot { gap: 7px; }
      .today-nodes { gap: 8px; }
      .today-slot-title { display: flex; align-items: baseline; gap: 7px; margin: 0; font-size: 12px; font-weight: 650; color: var(--gantt-muted); }
      .today-slot-count { font-size: 10.5px; font-variant-numeric: tabular-nums; opacity: 0.8; }
      .today-block { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 10px; padding: 9px 11px; border: 1px solid var(--gantt-line); border-left: 3px solid var(--gantt-line-strong); border-radius: 10px; background: var(--gantt-surface); }
      .today-block[data-status="in_progress"] { border-left-color: var(--dsw-alias-brand-primary); }
      .today-block[data-status="done"] { border-left-color: var(--dsw-alias-state-success-primary); }
      .today-block[data-status="todo"] { border-left-color: var(--dsw-alias-state-idle-primary); }
      .today-block-time { font-size: 12px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .today-block-main { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
      .today-block-head { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
      .today-block-title { margin: 0; flex: 1 1 auto; min-width: 0; font-size: 12.5px; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .today-block-detail { margin: 0; font-size: 11.5px; color: var(--gantt-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .today-chip { flex: 0 0 auto; font-size: 10.5px; line-height: 1; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--gantt-line-strong); color: var(--gantt-muted); white-space: nowrap; }
      .today-chip-muted { border-style: dashed; }
      .today-source-badge {
        flex: 0 0 auto;
        font-size: 10px;
        line-height: 1;
        padding: 3px 7px;
        border-radius: 5px;
        border: 1px solid color-mix(in srgb, var(--gantt-accent) 40%, transparent);
        background: color-mix(in srgb, var(--gantt-accent) 10%, transparent);
        color: var(--gantt-accent);
        white-space: nowrap;
      }
      .today-block-meta { display: flex; flex-wrap: wrap; gap: 5px; }
      .today-muted { margin: 0; font-size: 12px; color: var(--gantt-muted); }
      .today-node-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .today-node { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 7px 10px; border: 1px solid var(--gantt-line); border-radius: 9px; background: var(--gantt-surface); font-size: 12px; }
      .today-node-id { color: var(--gantt-accent); font-size: 11px; font-variant-numeric: tabular-nums; }
      .today-node-title { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .today-node-range { font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .today-nav-date { min-width: 96px; text-align: center; font-size: 12px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
      .today-body .gantt-banner { margin: 0; }
      @container (max-width: 560px) {
        .today-page .today-body { padding: 12px 14px 22px; }
        .today-block { grid-template-columns: 1fr; }
        .today-meta .gantt-stat-progress { margin-left: 0; max-width: none; }
        .today-node-title { flex-basis: 100%; }
      }
    `

    function GanttPage() {
      const { locale, t } = useLocale(runtime)
      const { status, data, error, refresh } = useGanttData()
      const [scale, setScale] = useState('week')
      const [anchor, setAnchor] = useState(() => todayIso())
      const [collapsed, setCollapsed] = useState(() => new Set())
      const [level, setLevel] = useState(99)
      const [selectedId, setSelectedId] = useState(null)
      const [focusId, setFocusId] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [toast, setToast] = useState(null)
      const initialized = useRef(false)
      const pageRef = useRef(null)

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
      const byId = useMemo(() => new Map(allTasks.map(task => [task.id, task])), [allTasks])
      const options = useMemo(() => taskOptions(tasks), [tasks])
      const rows = useMemo(() => visibleRows(tasks, collapsed), [tasks, collapsed])
      const timeline = useMemo(() => {
        const value = buildWindow(scale, anchor, today)
        return { ...value, today }
      }, [scale, anchor, today])

      useEffect(() => {
        if (!focusId || !pageRef.current) return
        const rowElement = pageRef.current.querySelector(`.gantt-row[data-task-id="${focusId}"]`)
        if (rowElement && typeof rowElement.scrollIntoView === 'function') {
          rowElement.scrollIntoView({ block: 'nearest' })
        }
      }, [focusId, rows])

      useEffect(() => {
        if (status === 'ready' && selectedId && !byId.has(selectedId)) setSelectedId(null)
      }, [status, selectedId, byId])

      useEffect(() => {
        if (!dialog) return
        if ((dialog.type === 'edit' || dialog.type === 'split' || dialog.type === 'decompose' || dialog.type === 'schedule')
          && dialog.id && !byId.has(dialog.id)) {
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

      const changeLevel = useCallback((next) => {
        setLevel(next)
        setCollapsed(collapseForLevel(tasks, next))
      }, [tasks])

      const revealTask = useCallback((id) => {
        const path = taskPath(tasks, id)
        if (path === null) return
        setCollapsed((current) => {
          const next = new Set(current)
          for (const ancestor of path.slice(0, -1)) next.delete(ancestor.id)
          return next
        })
        setSelectedId(id)
        setFocusId(id)
      }, [tasks])

      const openCreate = useCallback((parentTask) => {
        setDialog({ type: 'create', parentId: parentTask?.id ?? null })
      }, [])

      const openEdit = useCallback((task) => {
        setSelectedId(task.id)
        setDialog({ type: 'edit', id: task.id })
      }, [])

      const openDecompose = useCallback((task) => {
        setSelectedId(task.id)
        setDialog({ type: 'decompose', id: task.id })
      }, [])

      const openSchedule = useCallback((task) => {
        setSelectedId(task.id)
        setDialog({ type: 'schedule', id: task.id })
      }, [])

      const shift = useCallback((direction) => {
        setAnchor(current => (scale === 'week'
          ? addDays(current, direction * 14)
          : addMonths(current, direction * 3)))
      }, [scale])

      const goToday = useCallback(() => setAnchor(today), [today])

      const shell = children => h('div', { className: 'gantt-page', ref: pageRef },
        h('style', { key: 'gantt-css' }, CSS),
        children,
      )

      if (status === 'loading' && data === null) {
        return shell(h('div', { className: 'gantt-center' },
          h('span', { className: 'gantt-spinner' }),
          h('span', null, t('loading')),
        ))
      }

      if (status === 'error' && data === null) {
        return shell(h('div', { className: 'gantt-center' },
          h('div', { className: 'gantt-empty-title' }, t('error.title')),
          h('div', { className: 'gantt-empty-body' }, error),
          h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: refresh }, t('error.retry')),
        ))
      }

      const dialogTask = dialog && dialog.id ? byId.get(dialog.id) : null
      const parentExcluded = dialogTask ? collectSubtree(dialogTask) : null
      const parentChoices = parentExcluded
        ? options.filter(option => !parentExcluded.has(option.id))
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
          onSplit: task => setDialog({ type: 'split', id: task.id }),
        })
      } else if (dialog?.type === 'split' && dialogTask) {
        dialogNode = h(SplitDialog, {
          key: `split-${dialogTask.id}`,
          task: dialogTask,
          t,
          onClose: () => setDialog(null),
          onSaved: handleSaved,
        })
      } else if (dialog?.type === 'decompose' && dialogTask) {
        dialogNode = h(DecomposeDialog, {
          key: `decompose-${dialogTask.id}`,
          task: dialogTask,
          t,
          onClose: () => setDialog(null),
          onSaved: handleSaved,
        })
      } else if (dialog?.type === 'schedule' && dialogTask) {
        dialogNode = h(ScheduleDialog, {
          key: `schedule-${dialogTask.id}`,
          task: dialogTask,
          t,
          onClose: () => setDialog(null),
          onSaved: handleSaved,
        })
      } else if (dialog?.type === 'context') {
        dialogNode = h(ContextDialog, {
          key: 'context',
          t,
          onClose: () => setDialog(null),
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
              h('button', { className: 'gantt-btn', type: 'button', onClick: seed }, t('empty.seed')),
            ),
          ),
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
              onDecompose: openDecompose,
              onSchedule: openSchedule,
            })),
          ),
          ),
        )

      return shell(h(React.Fragment, null,
        h('header', { className: 'gantt-head' },
          h('div', { className: 'gantt-brand' },
            h('span', { className: 'gantt-brand-mark' }, h(GanttGlyph, { size: 22 })),
            h('div', { className: 'gantt-brand-text' },
              h('h1', { className: 'gantt-title' }, t('page.title')),
              h('p', { className: 'gantt-subtitle' }, t('page.subtitle')),
            ),
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
              }, t('scale.month')),
            ),
            h('div', { className: 'gantt-seg', role: 'group', 'aria-label': t('level.label') },
              [['all', 99], ['two', 2], ['one', 1]].map(([key, depth]) => h('button', {
                key,
                className: 'gantt-seg-btn',
                type: 'button',
                'data-level': depth,
                'data-active': level === depth ? 'true' : undefined,
                onClick: () => changeLevel(depth),
              }, t(`level.${key}`))),
            ),
            h('button', { className: 'gantt-btn gantt-icon-btn', type: 'button', title: t('actions.prev'), 'aria-label': t('actions.prev'), onClick: () => shift(-1) }, '‹'),
            h('button', { className: 'gantt-btn', type: 'button', onClick: goToday }, t('actions.today')),
            h('button', { className: 'gantt-btn gantt-icon-btn', type: 'button', title: t('actions.next'), 'aria-label': t('actions.next'), onClick: () => shift(1) }, '›'),
            h('button', { className: 'gantt-btn', type: 'button', onClick: () => setDialog({ type: 'context' }) }, t('actions.context')),
            h('button', { className: 'gantt-btn', type: 'button', onClick: () => setDialog({ type: 'api' }) }, t('actions.api')),
            h('button', {
              className: 'gantt-btn gantt-icon-btn',
              type: 'button',
              title: t('actions.refresh'),
              'aria-label': t('actions.refresh'),
              disabled: status === 'refreshing',
              onClick: refresh,
            }, status === 'refreshing' ? '…' : '⟳'),
            h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: () => openCreate(null) }, `+ ${t('actions.new')}`),
          ),
        ),
        h('section', { className: 'gantt-stats' },
          h('div', { className: 'gantt-window' },
            h('span', { className: 'gantt-window-scale' }, scale === 'week' ? t('scale.weekShort') : t('scale.monthShort')),
            h('span', { className: 'gantt-window-label' }, windowTitle(timeline, locale)),
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': 'var(--dsw-alias-label-secondary)' } }),
            t('stats.total'), h('b', null, stats.total),
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.in_progress } }),
            t('stats.inProgress'), h('b', null, stats.inProgress),
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.done } }),
            t('stats.done'), h('b', null, stats.done),
          ),
          h('div', { className: 'gantt-stat' },
            h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.blocked } }),
            t('stats.overdue'), h('b', null, stats.overdue),
          ),
          h('div', { className: 'gantt-stat-progress' },
            h('span', null, `${t('stats.progress')} ${stats.progress}%`),
            h('div', { className: 'gantt-progress' }, h('span', { style: { width: `${stats.progress}%` } })),
          ),
        ),
        error && data ? h('div', { className: 'gantt-banner' },
          h('span', null, error),
          h('button', { className: 'gantt-btn', type: 'button', onClick: refresh }, t('error.retry')),
        ) : null,
        h(BriefStrip, { brief: data?.brief, t, onReveal: revealTask }),
        content,
        dialogNode,
        toast ? h('div', {
          className: 'gantt-toast',
          'data-error': toast.kind === 'error' ? 'true' : undefined,
          role: 'status',
        }, toast.text) : null,
      ))
    }

    function TodayPage() {
      const { locale, t } = useLocale(runtime)
      const [date, setDate] = useState(() => todayIso())
      const { status, data, error, refresh } = useTodayData(date)
      const [notice, setNotice] = useState(null)
      const [writeError, setWriteError] = useState(null)
      const [importing, setImporting] = useState(false)

      const day = data?.day ?? null
      const blocks = data?.blocks ?? []
      const nodes = data?.nodes ?? []
      const integrity = data?.integrity ?? []
      const stats = data?.stats ?? { total: 0, done: 0, inProgress: 0, skipped: 0, remaining: 0 }
      const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
      const serverToday = data?.today || todayIso()
      const unplanned = day === null && blocks.length === 0

      const shiftDay = useCallback(direction => setDate(current => addDays(current, direction)), [])
      const goToday = useCallback(() => setDate(serverToday), [serverToday])

      const cycleStatus = useCallback(async (block) => {
        setNotice(null)
        setWriteError(null)
        try {
          await requestJson('api/gantt/plan/status', {
            method: 'POST',
            body: JSON.stringify({ id: block.id, status: nextPlanStatus(block.status) }),
          })
          refresh()
        } catch (failure) {
          setWriteError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [refresh])

      const importPlan = useCallback(async () => {
        setNotice(null)
        setWriteError(null)
        setImporting(true)
        try {
          await requestJson('api/gantt/plan/import', { method: 'POST', body: '{}' })
          setNotice(t('today.importDone'))
          refresh()
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : String(failure)
          setWriteError(`${t('today.importFailed')}: ${message}`)
        } finally {
          setImporting(false)
        }
      }, [refresh, t])

      const shell = children => h('div', { className: 'gantt-page today-page' },
        h('style', { key: 'gantt-css' }, CSS),
        h('style', { key: 'today-css' }, CSS_TODAY),
        children,
      )

      if (status === 'loading' && data === null) {
        return shell(h('div', { className: 'gantt-center' },
          h('span', { className: 'gantt-spinner' }),
          h('span', null, t('loading')),
        ))
      }

      if (status === 'error' && data === null) {
        return shell(h('div', { className: 'gantt-center' },
          h('div', { className: 'gantt-empty-title' }, t('error.title')),
          h('div', { className: 'gantt-empty-body' }, error),
          h('div', { className: 'gantt-empty-actions' },
            h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: refresh }, t('error.retry')),
            h('button', { className: 'gantt-btn', type: 'button', onClick: importPlan }, t('today.import')),
          ),
        ))
      }

      const header = h('header', { className: 'gantt-head' },
        h('div', { className: 'gantt-brand' },
          h('span', { className: 'gantt-brand-mark' }, h(TodayGlyph, { size: 22 })),
          h('div', { className: 'gantt-brand-text' },
            h('h1', { className: 'gantt-title' }, t('today.title')),
            h('p', { className: 'gantt-subtitle' }, t('today.subtitle')),
          ),
        ),
        h('div', { className: 'gantt-actions' },
          h('button', {
            className: 'gantt-btn gantt-icon-btn',
            type: 'button',
            title: t('today.prevDay'),
            'aria-label': t('today.prevDay'),
            onClick: () => shiftDay(-1),
          }, '‹'),
          h('span', { className: 'today-nav-date' }, formatDate(date, locale)),
          h('button', {
            className: 'gantt-btn gantt-icon-btn',
            type: 'button',
            title: t('today.nextDay'),
            'aria-label': t('today.nextDay'),
            onClick: () => shiftDay(1),
          }, '›'),
          h('button', { className: 'gantt-btn', type: 'button', onClick: goToday }, t('today.todayButton')),
          h('button', {
            className: 'gantt-btn gantt-icon-btn',
            type: 'button',
            title: t('today.refresh'),
            'aria-label': t('today.refresh'),
            disabled: status === 'refreshing',
            onClick: refresh,
          }, status === 'refreshing' ? '…' : '⟳'),
          h('button', {
            className: 'gantt-btn gantt-btn-primary',
            type: 'button',
            disabled: importing,
            onClick: importPlan,
          }, t('today.import')),
        ),
      )

      const meta = h('section', { className: 'gantt-stats today-meta' },
        h('div', { className: 'today-meta-date' },
          h('strong', null, formatDate(date, locale)),
          h('span', { className: 'today-weekday', title: t('today.weekdayLabel') }, formatWeekdayLong(date, locale)),
        ),
        day?.label ? h('span', { className: 'today-meta-label' }, day.label) : null,
        h('span', { className: 'today-market', 'data-open': day?.marketOpen ? 'true' : 'false' },
          day?.marketOpen ? t('today.open') : t('today.closed')),
        h('div', { className: 'gantt-stat-progress' },
          h('span', null, `${t('today.doneCount')} ${stats.done}/${stats.total}`),
          h('div', { className: 'gantt-progress' }, h('span', { style: { width: `${percent}%` } })),
          h('span', null, `${t('today.remaining')} ${stats.remaining}`),
        ),
      )

      const goal = day && day.coreGoal
        ? h('section', { className: 'today-goal' },
          h('span', { className: 'gantt-label' }, t('today.coreGoal')),
          h('p', { className: 'today-goal-text' }, day.coreGoal),
        )
        : null

      const integritySection = integrity.length > 0
        ? h('section', { className: 'today-integrity' },
          h('div', { className: 'today-integrity-head' },
            h('h2', { className: 'today-section-title' }, t('today.integrityTitle')),
            h('button', { className: 'gantt-btn', type: 'button', disabled: importing, onClick: importPlan }, t('today.import')),
          ),
          h('ul', { className: 'today-integrity-list' },
            integrity.map(item => h('li', {
              key: `${item.code}:${item.blockId || ''}`,
              className: 'today-integrity-item',
              'data-code': item.code,
            }, t(`today.integrity.${item.code}`))),
          ),
        )
        : null

      const content = unplanned
        ? h('div', { className: 'gantt-empty-wrap' },
          h('div', { className: 'gantt-empty' },
            h('span', { className: 'gantt-empty-icon' }, h(TodayGlyph, { size: 26 })),
            h('div', { className: 'gantt-empty-title' }, t('today.emptyTitle')),
            h('div', { className: 'gantt-empty-body' }, t('today.emptyHint')),
            h('div', { className: 'gantt-empty-actions' },
              h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: importing, onClick: importPlan }, t('today.emptyAction')),
            ),
          ),
        )
        : h(React.Fragment, null,
          h('section', { className: 'today-blocks' },
            h('h2', { className: 'today-section-title' }, t('today.blocks')),
            blocks.length === 0
              ? h('p', { className: 'today-muted' }, t('today.emptyDay'))
              : SLOT_ORDER.map((slot) => {
                const list = blocks.filter(block => block.slot === slot)
                return list.length === 0 ? null : h('section', {
                  key: slot,
                  className: 'today-slot',
                  'data-slot': slot,
                },
                h('h3', { className: 'today-slot-title' },
                  h('span', null, t(`slot.${slot}`)),
                  h('span', { className: 'today-slot-count' }, list.length),
                ),
                list.map(block => h(TodayBlock, { key: block.id, block, t, onCycle: cycleStatus })),
                )
              }),
          ),
          h('section', { className: 'today-nodes' },
            h('h2', { className: 'today-section-title' }, t('today.nodes')),
            nodes.length === 0
              ? h('p', { className: 'today-muted' }, t('today.nodesEmpty'))
              : h('ul', { className: 'today-node-list' },
                nodes.map(node => h(TodayNode, { key: node.id, node, t })),
              ),
          ),
        )

      return shell(h(React.Fragment, null,
        header,
        h('div', { className: 'today-body' },
          meta,
          error && data
            ? h('div', { className: 'gantt-banner' },
              h('span', null, error),
              h('button', { className: 'gantt-btn', type: 'button', onClick: refresh }, t('error.retry')),
            )
            : null,
          writeError ? h('div', { className: 'gantt-banner' }, h('span', null, writeError)) : null,
          goal,
          integritySection,
          content,
        ),
        notice ? h('div', { className: 'gantt-toast', role: 'status' }, notice) : null,
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
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'today',
          order: 21,
          label: () => t('nav.today'),
        }, TodayGlyph))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'today',
        }, TodayPage))
      },
    }
  },
})
