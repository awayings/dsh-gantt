// Status vocabularies shared by the host and the browser half: both sides
// validate and label the same words, and the client bundle carries this module
// as plain data. No imports here — keep it safe for Node and the browser.
export const STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled']
export const PLAN_STATUSES = ['todo', 'in_progress', 'done', 'skipped']
