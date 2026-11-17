// Workbench tab body for the native conversation sidebar: a focused task chip,
// four sub-tabs, and dense scrollable panels. The root owns the pane height and
// every panel scrolls inside it; narrow widths fold through container queries so
// the same body works in a full-size rail and in the ~390 px compact layout.
/** Compact workbench stylesheet for the better-sidebar work tab. */
export const CSS_WORKBENCH = `
  .gantt-workbench {
    --gantt-bg: var(--dsw-alias-bg-base);
    --gantt-surface: var(--dsw-alias-bg-layer-1);
    --gantt-surface-2: var(--dsw-alias-bg-layer-2);
    --gantt-line: var(--dsw-alias-border-l1);
    --gantt-line-strong: var(--dsw-alias-border-l2);
    --gantt-text: var(--dsw-alias-label-primary);
    --gantt-muted: var(--dsw-alias-label-secondary);
    --gantt-accent: var(--dsw-alias-brand-primary);
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--gantt-bg);
    color: var(--gantt-text);
    font-size: 12.5px;
    line-height: 1.45;
    overflow: hidden;
  }
  .gantt-workbench, .gantt-workbench * { box-sizing: border-box; }
  .gantt-workbench button { font: inherit; }
  .gantt-workbench button:focus-visible { outline: 2px solid color-mix(in srgb, var(--gantt-accent) 65%, transparent); outline-offset: 1px; }
  .gantt-workbench-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 8px 10px;
    border-bottom: 1px solid var(--gantt-line);
    background: var(--gantt-surface);
  }
  .gantt-workbench-chip {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding: 2px 7px;
    border: 1px solid color-mix(in srgb, var(--gantt-accent) 40%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--gantt-accent) 10%, transparent);
  }
  .gantt-workbench-chip-ref { flex: 0 0 auto; font-size: 10.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-workbench-chip-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
  .gantt-workbench-none { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--gantt-muted); }
  .gantt-workbench-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--gantt-line-strong);
    border-radius: 6px;
    background: var(--gantt-surface);
    color: var(--gantt-text);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }
  .gantt-workbench-btn:hover:not(:disabled) { background: var(--gantt-surface-2); }
  .gantt-workbench-btn:disabled { opacity: 0.5; cursor: default; }
  .gantt-workbench-tabs {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
    padding: 6px 10px 0;
    border-bottom: 1px solid var(--gantt-line);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .gantt-workbench-tabs::-webkit-scrollbar { display: none; }
  .gantt-workbench-tab {
    flex: 0 0 auto;
    padding: 4px 8px 5px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--gantt-muted);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }
  .gantt-workbench-tab:hover { color: var(--gantt-text); }
  .gantt-workbench-tab[data-active="true"] { color: var(--gantt-accent); border-bottom-color: var(--gantt-accent); }
  .gantt-workbench-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 12px;
  }
  .gantt-workbench-panel { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .gantt-workbench-state {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 28px 16px;
    color: var(--gantt-muted);
    text-align: center;
  }
  .gantt-workbench-message { margin: 0; font-size: 11.5px; }
  .gantt-workbench-error {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
    color: var(--dsw-alias-state-error-primary);
    font-size: 11px;
  }
  .gantt-workbench-empty { margin: 0; font-size: 11.5px; color: var(--gantt-muted); }
  .gantt-workbench-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--gantt-line);
    border-radius: 7px;
    background: var(--gantt-surface);
  }
  .gantt-workbench-row-action {
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid var(--gantt-line);
    border-radius: 4px;
    color: var(--gantt-muted);
    font-size: 9.5px;
    line-height: 1;
  }
  .gantt-workbench-row[data-action="complete"] .gantt-workbench-row-action {
    color: var(--dsw-alias-state-success-primary);
    border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);
  }
  .gantt-workbench-row[data-action="decompose"] .gantt-workbench-row-action,
  .gantt-workbench-row[data-action="track"] .gantt-workbench-row-action {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 40%, transparent);
  }
  .gantt-workbench-row-turn,
  .gantt-workbench-row-time {
    flex: 0 0 auto;
    color: var(--gantt-muted);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .gantt-workbench-row-detail { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .gantt-workbench-row-session {
    flex: 0 0 auto;
    max-width: 42%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--gantt-accent);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  button.gantt-workbench-row-session { cursor: pointer; }
  button.gantt-workbench-row-session:hover { text-decoration: underline; }
  .gantt-workbench-task { display: flex; flex-direction: column; gap: 10px; }
  .gantt-workbench-conversation { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .gantt-workbench-chat-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .gantt-workbench-chat-title { font-size: 11.5px; font-weight: 600; }
  .gantt-workbench-chat-state { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--gantt-line); color: var(--gantt-muted); }
  .gantt-workbench-chat-state[data-running="true"] {
    color: var(--dsw-alias-state-success-primary);
    border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);
  }
  .gantt-workbench-chat-state[data-waiting="true"] {
    color: #9a5b00;
    border-color: color-mix(in srgb, #d98300 45%, transparent);
    background: color-mix(in srgb, #d98300 14%, transparent);
  }
  .gantt-workbench-chat-updated { font-size: 10.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-workbench-chat-block {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px;
    border: 1px solid var(--gantt-line);
    border-radius: 7px;
    background: var(--gantt-surface);
  }
  .gantt-workbench-writeback {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--gantt-line);
    border-radius: 7px;
    background: var(--gantt-surface);
  }
  .gantt-workbench-writeback-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .gantt-workbench-writeback-label { flex: 0 0 auto; width: 68px; color: var(--gantt-muted); font-size: 10.5px; }
  .gantt-workbench-writeback-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
  .gantt-workbench-writeback-row[data-field="report"] .gantt-workbench-writeback-value { color: var(--gantt-text); }
  .gantt-workbench-description { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .gantt-workbench-description-body {
    max-height: 180px;
    overflow-y: auto;
    overflow-wrap: anywhere;
    padding: 7px 9px;
    border: 1px solid var(--gantt-line);
    border-radius: 7px;
    background: var(--gantt-surface);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .gantt-workbench-description-body > :first-child { margin-top: 0; }
  .gantt-workbench-description-body > :last-child { margin-bottom: 0; }
  .gantt-workbench-description-body p { margin: 0 0 6px; }
  .gantt-workbench-description-body h1,
  .gantt-workbench-description-body h2,
  .gantt-workbench-description-body h3,
  .gantt-workbench-description-body h4,
  .gantt-workbench-description-body h5,
  .gantt-workbench-description-body h6 { margin: 8px 0 4px; font-size: 12px; line-height: 1.3; }
  .gantt-workbench-description-body h1 { font-size: 13.5px; }
  .gantt-workbench-description-body h2 { font-size: 12.5px; }
  .gantt-workbench-description-body ul,
  .gantt-workbench-description-body ol { margin: 0 0 6px; padding-left: 18px; }
  .gantt-workbench-description-body li { margin: 0; }
  .gantt-workbench-description-body li + li { margin-top: 2px; }
  .gantt-workbench-description-body strong { font-weight: 600; }
  .gantt-workbench-description-body code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--gantt-surface-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
  }
  .gantt-workbench-description-body pre {
    margin: 0 0 6px;
    padding: 6px 8px;
    overflow-x: auto;
    border: 1px solid var(--gantt-line);
    border-radius: 6px;
    background: var(--gantt-surface-2);
  }
  .gantt-workbench-description-body pre code { padding: 0; background: transparent; white-space: pre-wrap; }
  .gantt-workbench-description-body blockquote {
    margin: 0 0 6px;
    padding-left: 8px;
    border-left: 2px solid var(--gantt-line-strong);
    color: var(--gantt-muted);
  }
  .gantt-workbench-description-body a { color: var(--gantt-accent); text-decoration: none; }
  .gantt-workbench-description-body a:hover { text-decoration: underline; }
  .gantt-workbench-description-body hr { margin: 8px 0; border: 0; border-top: 1px solid var(--gantt-line); }
  .gantt-workbench-prompt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .gantt-workbench-prompt-label { font-size: 10.5px; color: var(--gantt-muted); }
  .gantt-workbench-prompt-input {
    width: 100%;
    min-height: 54px;
    max-height: 180px;
    resize: vertical;
    padding: 6px 7px;
    border: 1px solid var(--gantt-line);
    border-radius: 7px;
    background: var(--gantt-surface);
    color: var(--gantt-text);
    font: inherit;
    font-size: 11.5px;
    line-height: 1.45;
  }
  .gantt-workbench-prompt-input:focus-visible { outline: 2px solid color-mix(in srgb, var(--gantt-accent) 65%, transparent); outline-offset: 1px; }
  .gantt-workbench-prompt-input::placeholder { color: var(--gantt-muted); }
  .gantt-workbench-chat-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .gantt-workbench-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .gantt-workbench-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--gantt-line);
    border-radius: 7px;
    background: var(--gantt-surface);
  }
  .gantt-workbench-item-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .gantt-workbench-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
  .gantt-workbench-item-source,
  .gantt-workbench-item-mode { flex: 0 0 auto; font-size: 9.5px; line-height: 1; padding: 2px 5px; border-radius: 4px; border: 1px solid var(--gantt-line); color: var(--gantt-muted); }
  .gantt-workbench-item-description { margin: 0; font-size: 11px; color: var(--gantt-muted); overflow-wrap: anywhere; }
  .gantt-workbench-item-actions { display: flex; gap: 6px; margin-top: 2px; }
  @container (max-width: 400px) {
    .gantt-workbench-writeback-row { flex-direction: column; align-items: stretch; gap: 1px; }
    .gantt-workbench-writeback-label { width: auto; }
  }
  @container (max-width: 320px) {
    .gantt-workbench-head { padding: 7px 8px; }
    .gantt-workbench-tabs { padding: 5px 8px 0; }
    .gantt-workbench-body { padding: 7px 8px 10px; }
    .gantt-workbench-row-turn { display: none; }
    .gantt-workbench-item-source { display: none; }
  }
`
