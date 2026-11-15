// Facade over the host-side AI decompose chat: the system prompt, the fenced-JSON
// proposal parser, and the one streamed model call the chat route uses.

export { ChatError } from './errors.js'
export { buildChatMessages, buildSystemPrompt } from './chat/prompt.js'
export { parseProposal } from './chat/proposal.js'
export { runChat } from './chat/service.js'

/** @typedef {import('./chat/prompt.js').ChatContext} ChatContext */
/** @typedef {import('./chat/prompt.js').DailyBriefLike} DailyBriefLike */
/** @typedef {import('./chat/proposal.js').Proposal} Proposal */
/** @typedef {import('./chat/service.js').ChatStreamOptions} ChatStreamOptions */
