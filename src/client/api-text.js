/** Localized one-line descriptions for the endpoint catalog dialog. */
export const API_TEXT = {
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
