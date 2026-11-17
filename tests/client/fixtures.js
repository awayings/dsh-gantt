// Deterministic payloads for the Gantt client tests.
//
// The payloads mirror the host contract from index.js/store.js: a nested task
// tree with read-time hierarchical numbers, rollup status/progress, stats, and
// the pinned `today` the page anchors its timeline on. Dates are fixed so window
// labels, overdue markers, and bar geometry never depend on the wall clock.

export const TODAY = '2026-11-18'

function task(fields) {
  return {
    description: '',
    parentId: null,
    sortOrder: 0,
    kind: 'task',
    ref: '',
    state: '',
    lane: '',
    dep: '',
    doneWhen: '',
    landing: '',
    estimate: '',
    category: '',
    inspiration: '',
    links: [],
    source: 'manual',
    workSessionId: null,
    operatorId: '',
    completedById: '',
    report: '',
    children: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...fields,
  }
}

/** The fixture tree used by most specs (6 tasks, 2 summary rows, 1 overdue). */
export function makeTree() {
  return [
    task({
      id: 'p1',
      number: '1',
      title: 'Release 2.0',
      status: 'in_progress',
      progress: 50,
      startDate: '2026-11-05',
      endDate: '2026-11-20',
      hasChildren: true,
      children: [
        task({
          id: 'c1',
          number: '1.1',
          title: 'Write spec',
          status: 'done',
          progress: 100,
          startDate: '2026-11-09',
          endDate: '2026-11-12',
          parentId: 'p1',
          hasChildren: false,
          operatorId: 'a1',
          completedById: 'a2',
          report: 'Spec written and reviewed.\nVerified with tests/client/dialogs.spec.js.',
          children: [],
        }),
        task({
          id: 'c2',
          number: '1.2',
          title: 'Build UI',
          status: 'blocked',
          progress: 30,
          startDate: '2026-11-05',
          endDate: '2026-11-10',
          parentId: 'p1',
          hasChildren: false,
          children: [],
        }),
      ],
    }),
    task({
      id: 'p2',
      number: '2',
      title: 'Launch',
      status: 'todo',
      progress: 0,
      startDate: '2026-11-16',
      endDate: '2026-11-16',
      hasChildren: true,
      children: [
        task({
          id: 'c3',
          number: '2.1',
          title: 'Announce',
          status: 'todo',
          progress: 0,
          startDate: '2026-11-16',
          endDate: '2026-11-16',
          parentId: 'p2',
          hasChildren: false,
          children: [],
        }),
      ],
    }),
    task({
      id: 'p3',
      number: '3',
      title: 'Later',
      status: 'in_progress',
      progress: 40,
      startDate: '2027-09-01',
      endDate: '2027-09-30',
      hasChildren: false,
      children: [],
    }),
  ]
}

export function makeStats() {
  return { total: 6, done: 1, inProgress: 2, blocked: 1, overdue: 1, progress: 45 }
}

/** Successful GET /api/gantt/tree payload. */
export function treePayload(overrides = {}) {
  return {
    ok: true,
    today: TODAY,
    statuses: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
    tasks: makeTree(),
    stats: makeStats(),
    ...overrides,
  }
}

/** Empty database payload (drives the empty state + seed button). */
export function emptyTreePayload(today = TODAY) {
  return {
    ok: true,
    today,
    statuses: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
    tasks: [],
    stats: { total: 0, done: 0, inProgress: 0, blocked: 0, overdue: 0, progress: 0 },
  }
}

/** Successful GET /api/gantt/meta payload (mirrors store.meta() + endpoints). */
export function metaPayload(overrides = {}) {
  const payload = {
    ok: true,
    dbPath: '/data/home/ws-plugin/dsh-gantt/.tmp/gantt.db',
    engine: 'node:sqlite',
    statuses: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
    schemaVersion: 1,
    taskCount: 6,
    endpoints: [
      { method: 'GET', path: '/api/gantt/tree', description: 'Read the task tree.' },
      { method: 'GET', path: '/api/gantt/meta', description: 'Read the database location.' },
      { method: 'POST', path: '/api/gantt/tasks', description: 'Create a task.' },
      { method: 'POST', path: '/api/gantt/task/status', description: 'Change only status.' },
      { method: 'POST', path: '/api/gantt/custom', description: 'Custom endpoint from the host.' },
    ],
  }
  return { ...payload, ...overrides }
}

// ---- Unified tree v3 (tracks = roots, Hermes nodes = children) ----

/** Two tracks, three Hermes nodes (one nested), rich metadata and links. */
export function makeUnifiedTree() {
  return [
    task({
      id: 't1',
      number: '1',
      kind: 'track',
      ref: 'track:1',
      title: '投资系统',
      lane: '赚钱',
      state: '进行',
      status: 'in_progress',
      progress: 50,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      hasChildren: true,
      children: [
        task({
          id: 'n1',
          number: '1.1',
          kind: 'node',
          ref: 'node:1.1',
          title: '数据底座',
          lane: '赚钱',
          state: '进行',
          status: 'in_progress',
          progress: 50,
          startDate: '2026-11-01',
          endDate: '2026-11-10',
          parentId: 't1',
          hasChildren: false,
          dep: '1.8',
          doneWhen: '数据底座从 tracker 导入后可查',
          landing: 'invest/data.md',
          estimate: '2h',
          category: 'A 主攻片',
          inspiration: '#21',
          links: [
            { type: 'memory', ref: 'key/个人任务系统', label: '系统记忆' },
            { type: 'file', ref: 'invest/data.md' },
          ],
        }),
        task({
          id: 'n2',
          number: '1.8',
          kind: 'node',
          ref: 'node:1.8',
          title: '交易仓',
          lane: '赚钱',
          state: '卡住',
          status: 'blocked',
          progress: 30,
          startDate: '2026-11-05',
          endDate: '2026-11-20',
          parentId: 't1',
          hasChildren: true,
          children: [
            task({
              id: 'n21',
              number: '1.8.4',
              kind: 'node',
              ref: 'node:1.8.4',
              title: '读数收口',
              lane: '赚钱',
              state: '未开始',
              status: 'todo',
              progress: 0,
              startDate: '2026-11-16',
              endDate: '2026-11-18',
              parentId: 'n2',
              hasChildren: false,
              doneWhen: '读数写进策略账本',
              landing: 'invest/strategy-ledger.md',
            }),
          ],
        }),
      ],
    }),
    task({
      id: 't2',
      number: '2',
      kind: 'track',
      ref: 'track:2',
      title: '生活系统',
      lane: '生活',
      state: '卡住',
      status: 'blocked',
      progress: 0,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      hasChildren: false,
      children: [],
    }),
  ]
}

export function makeUnifiedStats() {
  return { total: 5, done: 0, inProgress: 2, blocked: 2, overdue: 0, progress: 16 }
}

/** `brief` payload: per-lane frontier and next picks. */
export function makeBrief() {
  const frontier = {
    id: 'n21',
    ref: 'node:1.8.4',
    number: '1.8.4',
    title: '读数收口',
    trackId: 't1',
    trackName: '投资系统',
  }
  const next = {
    id: 'n1',
    ref: 'node:1.1',
    number: '1.1',
    title: '数据底座',
    trackId: 't1',
    trackName: '投资系统',
  }
  return {
    pending: 3,
    frontier: [frontier],
    next: [next],
    lanes: [
      { id: 't1', ref: 'track:1', name: '投资系统', lane: '赚钱', state: '进行', blocker: '', frontier, next },
      { id: 't2', ref: 'track:2', name: '生活系统', lane: '生活', state: '卡住', blocker: '', frontier: null, next: null },
    ],
  }
}

/** Daily brief report (CONTRACT §1.1): windows, picks and per-track rows. */
export function makeDailyBrief(overrides = {}) {
  const frontier = {
    id: 'n21',
    ref: 'node:1.8.4',
    number: '1.8.4',
    title: '读数收口',
    trackId: 't1',
    trackName: '投资系统',
  }
  const next = {
    id: 'n1',
    ref: 'node:1.1',
    number: '1.1',
    title: '数据底座',
    trackId: 't1',
    trackName: '投资系统',
  }
  return {
    date: TODAY,
    generatedAt: '2026-11-18T00:05:00.000Z',
    source: 'auto',
    dayKind: 'workday',
    slots: [
      { slot: 'morning', startTime: '09:00', endTime: '12:00', minutes: 180, kind: 'core', blockId: '2026-11-18|09:00|0' },
      { slot: 'daytime', startTime: '14:00', endTime: '17:00', minutes: 180, kind: 'core', blockId: '' },
      { slot: 'evening', startTime: '21:00', endTime: '22:00', minutes: 60, kind: 'definition', blockId: '2026-11-18|21:00|1' },
      { slot: 'other', startTime: '', endTime: '', minutes: 0, kind: 'definition', blockId: '' },
    ],
    items: [
      {
        slot: 'morning',
        startTime: '09:00',
        endTime: '12:00',
        minutes: 180,
        blockId: '2026-11-18|09:00|0',
        taskId: 'n1',
        ref: 'node:1.1',
        title: '数据底座',
        trackId: 't1',
        trackName: '投资系统',
        role: 'core',
      },
      {
        slot: 'evening',
        startTime: '21:00',
        endTime: '22:00',
        minutes: 60,
        blockId: '2026-11-18|21:00|1',
        taskId: 'n21',
        ref: 'node:1.8.4',
        title: '读数收口',
        trackId: 't1',
        trackName: '投资系统',
        role: 'definition',
      },
    ],
    tracks: [
      { trackId: 't1', ref: 'track:1', name: '投资系统', state: '进行', role: 'core', picks: 2, frontier, next },
      { trackId: 't2', ref: 'track:2', name: '生活系统', state: '卡住', role: 'blocked', picks: 0, frontier: null, next: null },
    ],
    unfilled: [1, 3],
    notes: ['no ready leaves for 生活系统'],
    ...overrides,
  }
}

/** Successful GET /api/gantt/tree payload for the unified tree. */
export function unifiedTreePayload(overrides = {}) {
  return {
    ok: true,
    today: TODAY,
    statuses: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
    tasks: makeUnifiedTree(),
    stats: makeUnifiedStats(),
    brief: makeBrief(),
    dailyBrief: makeDailyBrief(),
    ...overrides,
  }
}

/** Three tracks / eight rows where the frontier and today filters prune differently. */
export function makeFilterTree() {
  const tree = makeUnifiedTree()
  tree[1].children = [task({
    id: 'n31',
    number: '2.1',
    kind: 'node',
    ref: 'node:2.1',
    title: '生活实验',
    lane: '生活',
    state: '未开始',
    status: 'todo',
    progress: 0,
    startDate: '2026-11-16',
    endDate: '2026-11-17',
    parentId: 't2',
    hasChildren: false,
    doneWhen: '实验可复现',
  })]
  tree[1].hasChildren = true
  tree.push(task({
    id: 't3',
    number: '3',
    kind: 'track',
    ref: 'track:3',
    title: '元能力',
    lane: '赚钱',
    state: '进行',
    status: 'in_progress',
    progress: 20,
    startDate: '2026-11-10',
    endDate: '2026-11-12',
    hasChildren: true,
    children: [task({
      id: 'n41',
      number: '3.1',
      kind: 'node',
      ref: 'node:3.1',
      title: '复盘节奏',
      lane: '赚钱',
      state: '进行',
      status: 'in_progress',
      progress: 20,
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      parentId: 't3',
      hasChildren: false,
      doneWhen: '每周复盘',
    })],
  }))
  return tree
}

/** GET /tree payload for filter pruning: frontier keeps t1, today keeps t1+t2. */
export function filterTreePayload(overrides = {}) {
  const dailyBrief = makeDailyBrief()
  const [t1, t2] = dailyBrief.tracks
  dailyBrief.tracks = [
    t1,
    t2,
    { trackId: 't3', ref: 'track:3', name: '元能力', state: '进行', role: 'rotation', picks: 0, frontier: null, next: null },
  ]
  dailyBrief.items = [
    dailyBrief.items[0],
    { ...dailyBrief.items[1], taskId: 'n31', ref: 'node:2.1', title: '生活实验', trackId: 't2', trackName: '生活系统', role: 'rotation' },
  ]
  return {
    ok: true,
    today: TODAY,
    statuses: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'],
    tasks: makeFilterTree(),
    stats: { total: 8, done: 0, inProgress: 3, blocked: 2, overdue: 0, progress: 20 },
    brief: makeBrief(),
    dailyBrief,
    ...overrides,
  }
}

/** Successful GET /api/gantt/context payload. */
export function contextPayload(overrides = {}) {
  const markdown = [
    '# 个人任务树（2 条支线 · 4 个节点 · 0 个任务）',
    '',
    '## 1. 投资系统（赚钱 · 进行）',
    '- 1.8.4 读数收口 [todo 未开始] 2026-11-16→2026-11-18 · 落点 invest/strategy-ledger.md',
    '',
    '## 今日 2026-11-15（周六 · 周末 · 休市）',
    '- [todo] 21:00-22:00 读数收口 · 落点 invest/strategy-ledger.md',
  ].join('\n')
  return {
    ok: true,
    date: TODAY,
    markdown,
    chars: markdown.length,
    truncated: false,
    counts: { tracks: 2, nodes: 4, tasks: 0, blocks: 1 },
    ...overrides,
  }
}

/** Task node returned by create/update/status mutations (`{ ok, task }`). */
export function mutationTask(overrides = {}) {
  return {
    id: 'c3',
    number: '2.1',
    title: 'Announce',
    status: 'todo',
    progress: 0,
    startDate: '2026-11-16',
    endDate: '2026-11-16',
    parentId: 'p2',
    hasChildren: false,
    children: [],
    ...overrides,
  }
}

// ---- Today page payloads (mirrors GET /api/gantt/day) ----

export const TODAY_DATE = '2026-11-15'

const PLAN_ZEROS = { total: 0, done: 0, inProgress: 0, skipped: 0, remaining: 0 }

function planBlock(fields) {
  return {
    id: 'b1',
    planDate: TODAY_DATE,
    startTime: '',
    endTime: '',
    slot: 'morning',
    category: '',
    title: 'Block',
    detail: '',
    landing: '',
    estimate: '',
    inspiration: '',
    status: 'todo',
    notes: '',
    sortOrder: 0,
    source: 'schedule',
    sourceRef: 'SCHEDULE.md',
    ...fields,
  }
}

/** Five blocks across all four slots, one per plan status, mixed optional fields. */
export function makePlanBlocks() {
  return [
    planBlock({
      id: 'b1',
      startTime: '09:00',
      endTime: '12:00',
      slot: 'morning',
      category: 'A 主攻片',
      title: '主攻片：写 Today 页',
      detail: '把设计落到 client.js 并跑通测试',
      landing: '合并到 main',
      estimate: '≥4h',
      status: 'todo',
      sortOrder: 0,
    }),
    planBlock({
      id: 'b2',
      startTime: '14:00',
      endTime: '17:00',
      slot: 'daytime',
      title: '评审 Today 页',
      detail: '评审 Today 页',
      landing: '无',
      estimate: '1h',
      inspiration: '#12',
      status: 'in_progress',
      sortOrder: 1,
    }),
    planBlock({
      id: 'b3',
      startTime: '21:00',
      endTime: '22:00',
      slot: 'evening',
      category: 'C 复盘',
      title: '晚间复盘',
      detail: '记录三件事',
      landing: '写入日志',
      inspiration: '#34',
      status: 'done',
      sortOrder: 2,
    }),
    planBlock({
      id: 'b4',
      slot: 'other',
      title: '机动：收尾杂事',
      landing: '待定',
      status: 'skipped',
      sortOrder: 3,
    }),
    planBlock({
      id: 'b5',
      startTime: '19:00',
      endTime: '19:30',
      slot: 'daytime',
      title: '清收件箱',
      estimate: '30m',
      status: 'todo',
      sortOrder: 4,
    }),
  ]
}

/** Three unified-tree nodes: full range + metadata, bare, and ongoing. */
export function makePlanNodes() {
  return [
    {
      id: 'task-uuid-181',
      ref: 'node:1.8.1',
      kind: 'node',
      trackId: 't1',
      lane: '赚钱',
      title: '今天页上线',
      state: '进行',
      startDate: '2026-11-10',
      endDate: '2026-11-18',
      dep: '1.8',
      doneWhen: 'Today 页在真实库里可点',
      landing: 'client.js',
      links: [{ type: 'memory', ref: 'key/个人任务系统', label: '系统记忆' }],
    },
    {
      id: 'task-uuid-23',
      ref: 'node:2.3',
      kind: 'node',
      trackId: 't2',
      lane: '',
      title: '导入任务跟踪器',
      state: '',
      startDate: null,
      endDate: null,
      dep: '',
      doneWhen: '',
    },
    {
      id: 'task-uuid-31',
      ref: 'node:3.1',
      kind: 'node',
      trackId: 't3',
      lane: '',
      title: '持续打磨',
      state: '进行中',
      startDate: '2026-11-14',
      endDate: null,
      dep: '3',
      doneWhen: '',
    },
  ]
}

/** A plan block produced by `task/schedule` (`source: 'task'`). */
export function makeTaskBlock(overrides = {}) {
  return planBlock({
    id: 'task|t-1|2026-11-15',
    startTime: '21:00',
    endTime: '22:00',
    slot: 'evening',
    title: '读数收口',
    detail: '把读数写进策略账本',
    landing: 'invest/strategy-ledger.md',
    estimate: '1h',
    status: 'todo',
    sortOrder: 5,
    source: 'task',
    sourceRef: 'task:t-1',
    ...overrides,
  })
}

export function planDay(overrides = {}) {
  return {
    date: TODAY_DATE,
    weekday: '周六',
    dayKind: 'weekend',
    marketOpen: false,
    label: '周末（休市）· 主攻片',
    coreGoal: '把 Today 页跑通并合并',
    source: 'schedule',
    ...overrides,
  }
}

/** Successful GET /api/gantt/day payload for a fully planned day. */
export function dayPayload(overrides = {}) {
  return {
    ok: true,
    today: TODAY_DATE,
    date: TODAY_DATE,
    day: planDay(),
    blocks: makePlanBlocks(),
    nodes: makePlanNodes(),
    tracks: [{
      id: '1',
      name: '赚钱主线',
      lane: '赚钱',
      priority: '高',
      state: '进行',
      blocker: '',
      sortOrder: 1,
    }],
    integrity: [{ code: 'landing-missing', blockId: 'b2' }],
    stats: { total: 5, done: 1, inProgress: 1, skipped: 1, remaining: 3 },
    brief: makeDailyBrief({ date: TODAY_DATE, generatedAt: '2026-11-15T00:05:00.000Z' }),
    ...overrides,
  }
}

/** Day bundle for a planned day with no blocks and no nodes. */
export function emptyDayPayload(overrides = {}) {
  return dayPayload({
    blocks: [],
    nodes: [],
    tracks: [],
    integrity: [],
    stats: { ...PLAN_ZEROS },
    ...overrides,
  })
}

/** Day bundle for a date with no day_plans row and no blocks. */
export function unplannedDayPayload(overrides = {}) {
  return dayPayload({
    day: null,
    blocks: [],
    nodes: [],
    tracks: [],
    integrity: [{ code: 'unplanned-day' }],
    stats: { ...PLAN_ZEROS },
    brief: null,
    ...overrides,
  })
}

/** Successful POST /api/gantt/task/decompose payload. */
export function decomposePayload(overrides = {}) {
  return { ok: true, parent: { id: 'n1' }, children: [], blocks: [], ...overrides }
}
