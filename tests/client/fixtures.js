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
    statuses: ['todo', 'in_progress', 'blocked', 'done'],
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
    statuses: ['todo', 'in_progress', 'blocked', 'done'],
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
    statuses: ['todo', 'in_progress', 'blocked', 'done'],
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
