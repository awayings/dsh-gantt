// Task routes: the tree read, task CRUD, split/decompose, and scheduling.

import { json, readBody, requiredId } from './http.js'

/** @typedef {import('../store.js').DecomposeChildInput} DecomposeChildInput */
/** @typedef {import('../store.js').ScheduleInput} ScheduleInput */
/** @typedef {import('../store.js').SplitChild} SplitChild */
/** @typedef {import('../store.js').TaskInput} TaskInput */
/** @typedef {import('../store.js').TaskPatch} TaskPatch */
/** @typedef {import('../store.js').TaskStatus} TaskStatus */
/** @typedef {import('./http.js').RouteSpec} RouteSpec */
/** @type {RouteSpec} */
export const treeRoute = {
  method: 'GET',
  path: '/api/gantt/tree',
  description: 'Read the hierarchical task tree with numbers, rollups, and stats.',
  fetch: async (_request, { store }) => json({
    ok: true,
    ...store.snapshot(),
  }),
}

/** @type {RouteSpec} */
export const createTaskRoute = {
  method: 'POST',
  path: '/api/gantt/tasks',
  description: 'Create a task. Body: { title, parentId?, kind?, ref?, startDate?, endDate?, status?, progress?, description?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const task = store.create(/** @type {TaskInput} */ (body))
    return json({ ok: true, task }, 201)
  },
}

/** @type {RouteSpec} */
export const updateTaskRoute = {
  method: 'POST',
  path: '/api/gantt/task/update',
  description: 'Update task fields. Body: { id, title?, description?, parentId?, startDate?, endDate?, status?, progress?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const { id: _id, ...patch } = body
    const task = store.update(id, /** @type {TaskPatch} */ (patch))
    return json({ ok: true, task })
  },
}

/** @type {RouteSpec} */
export const statusRoute = {
  method: 'POST',
  path: '/api/gantt/task/status',
  description: 'Change only status and/or progress. Body: { id, status, progress? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const task = store.setStatus(
      id,
      /** @type {TaskStatus} */ (body.status),
      /** @type {number | undefined} */ (body.progress),
    )
    return json({ ok: true, task })
  },
}

/** @type {RouteSpec} */
export const splitTaskRoute = {
  method: 'POST',
  path: '/api/gantt/task/split',
  description: 'Split a task into child subtasks. Body: { id, children: [{ title, startDate?, endDate?, ..., doneWhen?, landing?, links? }] }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const result = store.split(id, /** @type {SplitChild[]} */ (body.children))
    return json({ ok: true, ...result })
  },
}

/** @type {RouteSpec} */
export const deleteTaskRoute = {
  method: 'POST',
  path: '/api/gantt/task/delete',
  description: 'Delete a task and all of its descendants. Body: { id }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const result = store.delete(id)
    return json({ ok: true, ...result })
  },
}

/** @type {RouteSpec} */
export const decomposeRoute = {
  method: 'POST',
  path: '/api/gantt/task/decompose',
  description: 'Decompose a task into child subtasks, optionally scheduling each. Body: { id, planDate?, children: [{ title, ..., plan? }] }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const result = store.decompose(
      id,
      /** @type {DecomposeChildInput[]} */ (body.children),
      body.planDate,
    )
    return json({ ok: true, ...result })
  },
}

/** @type {RouteSpec} */
export const scheduleTaskRoute = {
  method: 'POST',
  path: '/api/gantt/task/schedule',
  description: 'Schedule a task into one day plan cell, idempotently. Body: { id, date, startTime?, endTime?, slot?, category?, landing?, estimate?, inspiration?, detail? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const { id: _id, ...input } = body
    const result = store.scheduleTask(id, /** @type {ScheduleInput} */ (input))
    return json({ ok: true, ...result })
  },
}
