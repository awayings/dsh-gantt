// Minimal hand-written MCP (Model Context Protocol) server logic. It speaks
// JSON-RPC 2.0 over newline-delimited stdio or a single POST body, exposes the
// external-agent tools (the same read/write surface the in-process assistant
// tools have), and never depends on a protocol SDK. A status write-back on a
// task delegated through `gantt_delegate` also completes the armed
// dispatch-notice row, so the dispatching conversation hears without polling
// (the host plugin drains the notices).

import { GanttError } from './errors.js'
import { NOTICE_STATUSES, completeDispatchNotice } from './store/notify.js'
import { resolveTaskId } from './tools.js'

/** The MCP revision this server implements. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** Bind hosts that are unreachable off-machine and therefore need no token. */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost']

/**
 * Refuse an HTTP bind that would expose task writes to the network without
 * authentication: only loopback hosts may serve without a bearer token, so a
 * LAN or wildcard bind fails before the socket opens instead of running open.
 * @param {string} host the requested bind host
 * @param {string} token the bearer token, empty when none is configured
 * @returns {void}
 */
export function assertHttpBinding(host, token) {
  if (token !== '') return
  if (LOOPBACK_HOSTS.includes(host)) return
  throw new Error(`refusing to serve ${host === '' ? 'all interfaces' : host} without a bearer token; set GANTT_MCP_TOKEN or --token`)
}

/**
 * The usage contract an MCP client receives in the `initialize` result. Kept
 * short because clients may truncate it; the long form lives in
 * {@link WORKER_GUIDE} behind `get_worker_guide`.
 */
export const MCP_INSTRUCTIONS = `dsh-gantt is a shared task and context store: conversations and turns gain time and relation dimensions in a Gantt tree. This server is pull-only — nothing is dispatched to you.

Start once with register_agent: the name is your stable identity (re-registering the same name returns the same id), and passing agentName on later calls attributes every write to you. Registration doubles as your dispatch contract: to receive tasks remotely, put \`ssh://user@host\` (or an ssh alias) in endpoint and two single-line fields in details — \`capabilities:\` (what you can do) and \`dispatch:\` (the headless command that starts one run of you; the task brief arrives on that command's stdin, or inline where the command writes {prompt}). Call get_worker_guide for the exact format. Then: get_tree_overview when you have no keyword — the whole tree in two levels, parentId drills one level deeper per call; search_tasks {q} when you know a concept but not its point number — it matches title, description, and doneWhen across every track and depth, done work included, and each hit carries its number and ancestor chain; list_ready_tasks (tag=ready, optional tags list + mode=any|and) to find work; get_task_context before decomposing, updating, or answering anything about a task, because a task only makes sense inside its ancestor chain; create_task / decompose_task / update_task write straight into the shared tree (every child needs a verifiable doneWhen); track_task records a round that wrote no task tree; report_completion closes a task with evidence. taskId accepts the internal id, a point number such as 1.8.1, or a ref.

Finish every round with exactly one write or one track. Never invent a task id: if a reference is ambiguous, read the context again or ask a human. When you commit code for the task you are working, end the commit subject with its point number, e.g. \`feat(today): keep the plan row bold (1.8.1)\`. Read large files in offset/limit windows, never whole. Call get_worker_guide for the full playbook.`

/** The full worker playbook served by `get_worker_guide`. */
export const WORKER_GUIDE = `# Working a shared Gantt task tree

The store is a shared context memory: every task carries its ancestor chain, its
detail, and the session/turn trajectory of the work behind it. You are a worker
pulling from it; nothing is ever pushed to you.

## Loop

1. register_agent once per machine: name is the upsert key, so the same name
   always returns the same agent id. Pass agentName on every later call.
2. list_ready_tasks {tag: "ready"} — leaves whose dependencies are met. Use
   tag "next" for the first executable pick per track, "todo" for every pending
   leaf. Add tags: ["ops"] to keep only tasks carrying those manual labels;
   mode "any" (default) needs one of them, "and" needs all. Pick one task (a
   human may also hand you the point number). When you know the concept but
   not the number, search_tasks {q} first: it matches title, description, and
   doneWhen across every track and depth — completed work included — and every
   hit carries its point number, matched fields, and ancestor chain. With no
   keyword at all, get_tree_overview shows the whole tree in two levels; pass
   parentId to drill one level deeper per call until you reach the task.
3. get_task_context {taskId} — always before writing. The chain, the detail, and
   the completion report are the context a decomposition needs; a title alone is
   never enough.
4. Work. When the task turns out to be too large, decompose_task {parentId,
   children:[{title, doneWhen, ...}]} — one to one hundred children, max four
   levels, and every child is verifiable only if doneWhen says how to prove it.
   Children inherit the parent's date range unless you pass planDate or dates.
5. update_task to move status/progress while you work — do not sit on a task
   without writing it. status "blocked" needs the condition in summary.
6. report_completion {taskId, report, status?} when the task is done: report is
   the evidence (what was produced, where it was verified). It writes the
   completer, the report, the status, and one complete event.
7. track_task {taskId, summary} when a round wrote no task tree: it records the
   round against the task, so the trajectory still knows you were there.

## Registration doubles as the dispatch contract

The gantt dispatcher (the 甘特长城 preset) reads this registry to decide who
receives a task, and its gantt_delegate tool launches you through exactly what
you registered — so register_agent is not just an identity, it is how a task
finds your machine:

- endpoint: \`ssh://user@host\` or \`ssh://<ssh-config-alias>\` — the target the
  dispatcher sshes to. Without it you can still pull work, but nothing can
  hand you a task.
- details must carry two single-line fields:
  - \`capabilities: coding(python,sql), decompose, ops\` — what you can do,
    comma-separated; the dispatcher routes by these words.
  - \`dispatch: export PATH="$HOME/.local/bin:$PATH"; nohup lo -p\` — the
    headless command that starts one run of you. It must run unattended,
    without a TTY. The task brief (point number, title, doneWhen,
    description, report instructions) is piped to the command's stdin; a
    command that cannot read stdin puts the brief inline by writing
    \`{prompt}\` where it belongs — the dispatcher substitutes it, safely
    quoted, into the command line.
  - The PATH prefix is part of the contract, not decoration: the ssh side
    runs your line in a non-interactive shell that reads no rc file
    (\`~/.zshrc\`, \`~/.bashrc\`), so a bare command name — one that works in
    your terminal only because those files put its directory (typically
    \`~/.local/bin\`) on PATH — dies with exit code 127 before your tool
    ever starts. Prefix the PATH as shown, or spell the absolute path
    (\`nohup /home/you/.local/bin/lo -p\`); the guard allows both shapes.
- The launch is fire-and-forget: the dispatcher drops the connection after
  the launch ack, so a long run must keep itself alive — wrap it in \`nohup\`
  (or daemonize) and log somewhere you can read back.
- Destructive shapes (\`rm -rf\`, disk writes, power commands) are refused
  before ssh runs, and every attempt lands in an audit log with tokens
  redacted — the same gate the manual remote-exec CLI uses.

You never report to the dispatcher directly: you report to this store,
through the same tools as always (update_task, report_completion,
decompose_task, track_task — each with your agentName). The dispatcher only
reads the tree and the trajectory, so the store stays the single channel
between you two; a delegated task carries your name as its operator the
moment it is dispatched.

## Reading code in a repo

Locate before you read: \`grep\` for the symbol or function name (\`wc -l\` for
size), then \`read\` with offset/limit in windows of 200 lines or fewer, and
stop once the task has what it needs. Never read a whole source file to answer
one question: a whole-file read stays in your context for the rest of the run
and is re-sent on every step, so a 30 KB file read once is a permanent tax on
every later call — and several workers on the same repo pay it again each.
Nothing in a task brief requires a file's full text; when it looks like it
does, grep for the relevant symbol or ask.

## Rules

- Every round ends with exactly one write (create/decompose/update/report) or
  one track. A round that ends silently loses its place in the memory.
- Only decomposing needs the full chain; updating a status does not. Read
  anyway when the task looks ambiguous.
- taskId accepts the internal UUID, the point number (1.8.1), or a ref — use
  whatever the human or get_task_context gave you. Never invent one.
- Your own session id goes in session when you have one (Codex session, Claude
  Code session id); the trajectory then shows that context next to the write.
- When you commit code for the task you are working, end the commit subject
  with its point number: \`feat(today): keep the plan row bold (1.8.1)\`.
  Template \`<type>(<scope>): <imperative subject> (<point number>)\`. The
  number is the only handle that ties the commit back to the tree a human is
  watching, so a bare subject loses that link.
- A task that blocks a human decision is status "blocked" with the concrete
  condition in summary, not a silent stop.
- Cancelling (status "cancelled") drops the task from the parent rollup; do it
  only when the task is genuinely obsolete.

## Failure modes

- The client shows no tools although the server is registered: the token header
  is missing (HTTP 401) or the client renders an empty tool list while tools
  still work. Verify by calling get_worker_guide.
- "task ... was not found": the id is stale or belongs to another store; re-read
  list_ready_tasks, get_tree_overview, or search_tasks by keyword instead of guessing.
- "agent ... was not found": register_agent first, or pass the exact name.`

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {{ name: string, description: string, inputSchema: Record<string, unknown> }} McpTool */
/** @typedef {{ jsonrpc: '2.0', id: unknown, result: unknown }} McpResultResponse */
/** @typedef {{ jsonrpc: '2.0', id: unknown, error: { code: number, message: string } }} McpErrorResponse */
/** @typedef {McpResultResponse | McpErrorResponse} McpResponse */

/** The tool schemas an external coding tool can call. */
export const MCP_TOOLS = /** @type {McpTool[]} */ ([
  {
    name: 'register_agent',
    description: 'Register or update this coding tool as an operator. Re-registering the same name updates that agent and keeps its id; fields you omit keep their stored values, so an identity re-register never clears the dispatch contract (endpoint, details). Pass the returned name (or id) to later calls.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Unique agent name, 1-100 characters; this is your stable identity.' },
        type: { type: 'string', enum: ['human', 'ai-agent'], description: 'Operator kind.' },
        role: { type: 'string', description: 'Optional role, such as implementer or reviewer.' },
        description: { type: 'string', description: 'Optional one-line description.' },
        details: { type: 'string', description: 'Optional longer notes. Remote dispatch eligibility needs two single-line fields here: capabilities: <what you can do, comma-separated> and dispatch: <headless command that starts one run of you; the task brief arrives on its stdin, or inline via {prompt}>.' },
        endpoint: { type: 'string', description: 'Optional callback or home endpoint. Remote dispatch needs ssh://user@host or ssh://<ssh-config-alias>.' },
        id: { type: 'string', description: 'Optional existing agent id; ignored when unknown.' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'list_agents',
    description: 'List registered operators, optionally filtered by type, role, or a fuzzy text query.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['human', 'ai-agent'] },
        role: { type: 'string' },
        q: { type: 'string', description: 'Fuzzy match over name, role, description, and details.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'list_ready_tasks',
    description: 'List the tasks an external tool can work on: ready (dependencies met), next (the first executable pick per track), or todo (every pending leaf). Filter by manual task tags with tags and mode; each returned task carries its tags.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: { type: 'string', enum: ['ready', 'next', 'todo'], description: 'Selection vocabulary; defaults to ready.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional manual task tags to match: trimmed, 1-40 characters each, at most 20, deduplicated.' },
        mode: { type: 'string', enum: ['any', 'and'], description: 'Tag match: any (default) keeps a task carrying one of the tags, and keeps only tasks carrying all of them.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'search_tasks',
    description: 'Locate tasks by keyword across the whole tree: every track, every depth, done and cancelled work included. Case-insensitive substring match over title, description, and doneWhen; each hit carries its point number, matched fields, and ancestor chain, so a concept you only remember by name can be found and then read with get_task_context.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: 'Keyword, 1-200 characters after trimming; matched as a case-insensitive substring over title, description, and doneWhen.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_tree_overview',
    description: 'Read the whole task tree at a glance when you have no keyword: every track with its direct children (two levels), each row carrying its point number, kind, status, and child count. Pass parentId to see the one level below that task instead, and repeat with any child that has children to walk down level by level; then read the task you land on with get_task_context.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        parentId: { type: 'string', description: 'Optional parent task: internal id, point number (1.12), or ref. Returns the one level below it instead of the two-level whole tree.' },
      },
    },
  },
  {
    name: 'get_task_context',
    description: 'Read one task\'s stable markdown context: fields, ancestor chain, detail, completion report, and recent trajectory. Read it before decomposing or updating the task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Internal task id, point number (1.8.1), or ref.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_task',
    description: 'Create one task in the shared tree, either as a child of parentId or as the next sibling of afterTaskId. Pass exactly one of them.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Task title, 1-200 characters.' },
        parentId: { type: 'string', description: 'Parent task: internal id, point number, or ref. Creates a child.' },
        afterTaskId: { type: 'string', description: 'Reference task: internal id, point number, or ref. Creates the next sibling.' },
        doneWhen: { type: 'string', description: 'Verifiable completion standard: how do we prove it is done? Filling it shapes a captured idea into a commitment.' },
        description: { type: 'string', description: 'Optional detail (plain text or markdown, max 4000 characters).' },
        inspiration: { type: 'string', description: 'Optional source of inspiration, kept verbatim. A new todo with this and no doneWhen renders as an unshaped idea until shaped.' },
        category: { type: 'string', description: 'Optional category.' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: 'Defaults to todo.' },
        startDate: { type: 'string', description: 'Optional YYYY-MM-DD; defaults to the later of today and the parent task\'s start date.' },
        endDate: { type: 'string', description: 'Optional YYYY-MM-DD; defaults to the start date plus three days.' },
        agentName: { type: 'string', description: 'Your registered agent name, recorded as the operator.' },
        session: { type: 'string', description: 'Optional id of your own conversation or run, recorded in the trajectory.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'decompose_task',
    description: 'Split one task into 1-100 child tasks in the shared tree (max four levels deep). Every child needs a verifiable doneWhen. Read get_task_context first: a decomposition needs the ancestor chain.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        parentId: { type: 'string', description: 'Parent task: internal id, point number, or ref.' },
        children: {
          type: 'array',
          description: 'The child tasks (1-100).',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', description: 'Child task title.' },
              doneWhen: { type: 'string', description: 'Verifiable completion standard: how do we prove it is done?' },
              description: { type: 'string', description: 'Optional detail (plain text or markdown, max 4000 characters).' },
              estimate: { type: 'string', description: 'Optional estimate, such as 30min.' },
              category: { type: 'string', description: 'Optional category.' },
              landing: { type: 'string', description: 'Optional landing point.' },
              inspiration: { type: 'string', description: 'Optional source of inspiration.' },
              status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: 'Defaults to todo.' },
            },
            required: ['title', 'doneWhen'],
          },
        },
        planDate: { type: 'string', description: 'Optional YYYY-MM-DD, used only as the default child date range.' },
        summary: { type: 'string', description: 'Optional note recorded in the task trajectory.' },
        agentName: { type: 'string', description: 'Your registered agent name, recorded on the parent trajectory.' },
        session: { type: 'string', description: 'Optional id of your own conversation or run, recorded in the trajectory.' },
      },
      required: ['parentId', 'children'],
    },
  },
  {
    name: 'update_task',
    description: 'Update one task\'s status, progress, title, description, doneWhen, or dates. Marking it done records the completion in the trajectory; use summary for the evidence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Internal task id, point number (1.8.1), or ref.' },
        title: { type: 'string' },
        description: { type: 'string' },
        doneWhen: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] },
        progress: { type: 'integer', minimum: 0, maximum: 100 },
        startDate: { type: 'string', description: 'YYYY-MM-DD.' },
        endDate: { type: 'string', description: 'YYYY-MM-DD.' },
        summary: { type: 'string', description: 'What changed, or the completion evidence; written to the trajectory.' },
        agentName: { type: 'string', description: 'Your registered agent name, recorded as the operator.' },
        session: { type: 'string', description: 'Optional id of your own conversation or run, recorded in the trajectory.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'track_task',
    description: 'Record this worker round against a task without writing the task tree: use it when a round only read, investigated, or produced evidence elsewhere.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Internal task id, point number (1.8.1), or ref.' },
        summary: { type: 'string', description: 'What this round did (write it in the trajectory).' },
        agentName: { type: 'string', description: 'Your registered agent name, recorded on the trajectory.' },
        session: { type: 'string', description: 'Optional id of your own conversation or run, recorded in the trajectory.' },
      },
      required: ['taskId', 'summary'],
    },
  },
  {
    name: 'report_completion',
    description: 'Report a task completion back to the store: writes the operator, completer, report, status, and progress, and records one complete event.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Internal task id, point number (1.8.1), or ref.' },
        agentId: { type: 'string', description: 'Registered agent id reporting the completion.' },
        agentName: { type: 'string', description: 'Registered agent name; an alternative to agentId.' },
        report: { type: 'string', description: 'What was produced and where it was verified; 1-4000 characters.' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: 'Defaults to done.' },
        progress: { type: 'integer', minimum: 0, maximum: 100 },
        session: { type: 'string', description: 'Optional id of your own conversation or run, recorded in the trajectory.' },
      },
      required: ['taskId', 'report'],
    },
  },
  {
    name: 'get_worker_guide',
    description: 'Read the full worker playbook: the pull loop, when to decompose, the provenance rules, and the round-closing discipline.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
])

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} id @param {unknown} result @returns {McpResultResponse} */
function resultResponse(id, result) {
  return { jsonrpc: '2.0', id, result }
}

/** @param {unknown} id @param {number} code @param {string} message @returns {McpErrorResponse} */
function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** @param {unknown} id @param {{ content: Array<{ type: 'text', text: string }>, isError?: boolean }} result
 * @returns {McpResultResponse} */
function toolResponse(id, result) {
  return resultResponse(id, result)
}

/** @param {unknown} id @param {string} text @returns {McpResultResponse} */
function toolError(id, text) {
  return toolResponse(id, { content: [{ type: 'text', text }], isError: true })
}

/** @param {unknown} id @param {unknown} value @returns {McpResultResponse} */
function toolSuccess(id, value) {
  return toolResponse(id, { content: [{ type: 'text', text: JSON.stringify(value) }] })
}

/**
 * Resolve the calling worker: an explicit `agentId`, an `agentName`, or null
 * when the call is anonymous. A name that was never registered is an error, so
 * a typo cannot silently write unattributed tasks.
 * @param {GanttStore} store
 * @param {Record<string, any>} args
 * @returns {import('./store.js').AgentRow | null}
 */
function resolveAgent(store, args) {
  if (typeof args.agentId === 'string' && args.agentId.trim() !== '') return store.requireAgent(args.agentId.trim())
  if (typeof args.agentName !== 'string' || args.agentName.trim() === '') return null
  const name = args.agentName.trim()
  const found = store.listAgents({ q: name, limit: 100 }).find(agent => agent.name === name)
  if (found === undefined) throw new GanttError(`agent ${name} was not found; call register_agent first`, 404)
  return found
}

/**
 * The context key one write is recorded under. A worker that knows its own
 * session id passes it; otherwise its stable name stands in for the context, so
 * the trajectory never shows an anonymous "manual" write for an agent.
 * @param {Record<string, any>} args
 * @param {import('./store.js').AgentRow | null} agent
 * @returns {string}
 */
function sessionKey(args, agent) {
  if (typeof args.session === 'string' && args.session.trim() !== '') return args.session.trim()
  return agent === null ? 'mcp:manual' : `agent:${agent.name}`
}

/**
 * Provenance for one remote write.
 * @param {Record<string, any>} args
 * @param {import('./store.js').AgentRow | null} agent
 * @param {unknown} summary
 * @returns {{ sessionId: string, turn: null, summary: string }}
 */
function originOf(args, agent, summary) {
  return { sessionId: sessionKey(args, agent), turn: null, summary: typeof summary === 'string' ? summary : '' }
}

/**
 * Create one task either as a child (`parentId`) or as the next sibling
 * (`afterTaskId`). Exactly one reference is required.
 * @param {GanttStore} store
 * @param {Record<string, any>} args
 * @param {import('./store.js').AgentRow | null} agent
 * @returns {Record<string, unknown>}
 */
function createTask(store, args, agent) {
  const hasParent = typeof args.parentId === 'string' && args.parentId.trim() !== ''
  const hasAfter = typeof args.afterTaskId === 'string' && args.afterTaskId.trim() !== ''
  if (hasParent === hasAfter) throw new GanttError('exactly one of parentId or afterTaskId is required')
  const origin = originOf(args, agent, undefined)
  const fields = {
    title: args.title,
    doneWhen: args.doneWhen,
    description: args.description,
    inspiration: args.inspiration,
    category: args.category,
    status: args.status,
    startDate: args.startDate,
    endDate: args.endDate,
    operatorId: agent === null ? undefined : agent.id,
  }
  if (hasAfter) {
    const reference = resolveTaskId(store, String(args.afterTaskId))
    return { ok: true, task: store.createSibling(reference, fields, origin) }
  }
  const parent = resolveTaskId(store, String(args.parentId))
  const task = /** @type {import('./tree.js').TaskNode} */ (store.create({ parentId: parent, ...fields }))
  // createSibling records its own origin event; a child insert does not, so the
  // trajectory would lose the write without this explicit event.
  store.recordOrigin(task.id, 'create', origin, `created under ${parent}`)
  return { ok: true, task }
}

/**
 * Run one tool. Store validation failures (GanttError) and unexpected errors
 * are converted to `isError` content by the caller; this function only maps
 * the tool name to the store call.
 * @param {GanttStore} store
 * @param {string} name
 * @param {Record<string, any>} args
 * @returns {Record<string, unknown>}
 */
function callTool(store, name, args) {
  if (name === 'register_agent') {
    return {
      ok: true,
      agent: store.registerAgent({
        id: args.id,
        name: args.name,
        type: args.type,
        role: args.role,
        description: args.description,
        details: args.details,
        endpoint: args.endpoint,
      }),
    }
  }
  if (name === 'list_agents') {
    return { ok: true, agents: store.listAgents({ type: args.type, role: args.role, q: args.q, limit: args.limit }) }
  }
  if (name === 'list_ready_tasks') {
    return { ok: true, ...store.readyTasks({ tag: args.tag, limit: args.limit, tags: args.tags, mode: args.mode }) }
  }
  if (name === 'search_tasks') {
    return { ok: true, ...store.searchTasks({ q: args.q, limit: args.limit }) }
  }
  if (name === 'get_tree_overview') {
    const parentId = typeof args.parentId === 'string' && args.parentId.trim() !== '' ? resolveTaskId(store, args.parentId) : null
    return { ok: true, ...store.treeOverview(parentId) }
  }
  if (name === 'get_task_context') {
    return { ok: true, ...store.taskContext(resolveTaskId(store, args.taskId)) }
  }
  if (name === 'create_task') {
    return createTask(store, args, resolveAgent(store, args))
  }
  if (name === 'decompose_task') {
    const agent = resolveAgent(store, args)
    const parentId = resolveTaskId(store, args.parentId)
    const children = Array.isArray(args.children) ? args.children : []
    const result = store.decompose(parentId, children, args.planDate, originOf(args, agent, args.summary))
    return { ok: true, parent: result.parent, children: result.children }
  }
  if (name === 'update_task') {
    const agent = resolveAgent(store, args)
    const taskId = resolveTaskId(store, args.taskId)
    /** @type {Record<string, unknown>} */
    const patch = {}
    for (const field of ['title', 'description', 'doneWhen', 'status', 'progress', 'startDate', 'endDate']) {
      if (args[field] !== undefined) patch[field] = args[field]
    }
    if (Object.keys(patch).length === 0) throw new GanttError('nothing to update')
    // Claim an unowned task; never steal one that already names an operator.
    if (agent !== null && store.requireRow(taskId).operatorId === '') patch.operatorId = agent.id
    const task = store.update(taskId, patch, originOf(args, agent, args.summary))
    // A status/progress write that lands the task in a terminal or attention
    // state completes the armed dispatch notice, so the conversation that
    // delegated this task hears about the write-back without polling. Silent
    // when the task was never delegated through the tool.
    if (patch.status !== undefined || patch.progress !== undefined) {
      const status = store.requireRow(taskId).status
      if (NOTICE_STATUSES.includes(status)) {
        completeDispatchNotice(store, taskId, { status, agentName: agent === null ? '' : agent.name })
      }
    }
    return { ok: true, task }
  }
  if (name === 'track_task') {
    const agent = resolveAgent(store, args)
    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    if (summary === '') throw new GanttError('summary is required')
    return {
      ok: true,
      event: store.recordTrack({
        taskId: resolveTaskId(store, args.taskId),
        sessionId: sessionKey(args, agent),
        turn: null,
        detail: summary,
      }),
    }
  }
  if (name === 'report_completion') {
    const agent = resolveAgent(store, args)
    if (agent === null) throw new GanttError('agentId or agentName is required')
    const taskId = resolveTaskId(store, args.taskId)
    const result = {
      ok: true,
      ...store.reportCompletion({
        taskId,
        agentId: agent.id,
        report: args.report,
        status: args.status,
        progress: args.progress,
        session: sessionKey(args, agent),
      }),
    }
    // The completion report always completes the armed dispatch notice: the
    // conversation that delegated this task is steered with the resulting
    // status, whatever vocabulary the report carried. Silent when the task was
    // never delegated through the tool.
    completeDispatchNotice(store, taskId, { status: store.requireRow(taskId).status, agentName: agent.name })
    return result
  }
  if (name === 'get_worker_guide') {
    return { ok: true, markdown: WORKER_GUIDE }
  }
  throw new Error(`unknown tool: ${name}`)
}

/**
 * Handle one `tools/call` request. Unknown tools, non-object params, and
 * non-object arguments are tool errors, not JSON-RPC errors.
 * @param {GanttStore} store
 * @param {unknown} id
 * @param {unknown} params
 * @returns {McpResultResponse}
 */
function handleToolCall(store, id, params) {
  if (!isRecord(params)) return toolError(id, 'params must be an object')
  const { name } = params
  if (typeof name !== 'string') return toolError(id, `unknown tool: ${String(name)}`)
  const args = params.arguments === undefined ? {} : params.arguments
  if (!isRecord(args)) return toolError(id, 'arguments must be an object')
  try {
    return toolSuccess(id, callTool(store, name, args))
  } catch (error) {
    return toolError(id, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Build one MCP server bound to a store. `handle` returns the JSON-RPC
 * response object, or `null` for a notification. An omitted `version` answers
 * `initialize` with "unknown" instead of a frozen literal; the CLI entry
 * passes the version of its own package manifest.
 * @param {{ store: GanttStore, version?: string }} options
 * @returns {{ handle: (message: unknown) => McpResponse | null }}
 */
export function createMcpServer({ store, version = 'unknown' }) {
  return {
    handle(message) {
      if (!isRecord(message)) return errorResponse(null, -32600, 'invalid request')
      const method = message.method
      if (typeof method !== 'string' || method === '') return errorResponse(message.id ?? null, -32600, 'invalid request')
      if (message.id === undefined) return null
      const { id } = message
      if (method === 'initialize') {
        const params = isRecord(message.params) ? message.params : {}
        const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION
        return resultResponse(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dsh-gantt', version },
          instructions: MCP_INSTRUCTIONS,
        })
      }
      if (method === 'notifications/initialized') return null
      if (method === 'ping') return resultResponse(id, {})
      if (method === 'tools/list') return resultResponse(id, { tools: MCP_TOOLS })
      if (method === 'tools/call') return handleToolCall(store, id, message.params)
      return errorResponse(id, -32601, `method not found: ${method}`)
    },
  }
}
