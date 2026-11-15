/** AI decompose chat sidebar and proposal card. */
export const CSS_CHAT = `
  .gantt-work { display: flex; flex: 1; min-height: 0; min-width: 0; }
  .gantt-work-main { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; }
  .gantt-btn[data-active="true"] {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 13%, transparent);
  }
  .gantt-chat {
    display: flex;
    flex-direction: column;
    flex: 0 0 360px;
    width: 360px;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--gantt-line-strong);
    background: var(--gantt-bg);
  }
  .gantt-chat-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--gantt-line); background: var(--gantt-surface); }
  .gantt-chat-title { flex: 1; min-width: 0; font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gantt-chat-focus { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--gantt-line); font-size: 11.5px; color: var(--gantt-muted); }
  .gantt-chat-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    padding: 3px 8px;
    border: 1px solid color-mix(in srgb, var(--gantt-accent) 40%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--gantt-accent) 10%, transparent);
    color: var(--gantt-text);
  }
  .gantt-chat-chip-ref { flex: 0 0 auto; color: var(--gantt-muted); font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .gantt-chat-chip-title { min-width: 0; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gantt-chat-clear-focus { margin-left: auto; height: 26px; padding: 0 8px; font-size: 11px; }
  .gantt-chat-focus-label { flex: 0 0 auto; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em; }
  .gantt-chat-focus-none { font-size: 11.5px; }
  .gantt-chat-depth { flex: 1 1 100%; font-size: 11px; font-style: italic; }
  .gantt-chat-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
  .gantt-chat-welcome { margin: 0; font-size: 12px; line-height: 1.6; color: var(--gantt-muted); }
  .gantt-chat-msg { display: flex; flex-direction: column; gap: 6px; }
  .gantt-chat-msg[data-role="user"] { align-items: flex-end; }
  .gantt-chat-bubble {
    max-width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--gantt-line);
    border-radius: 10px;
    background: var(--gantt-surface);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .gantt-chat-msg[data-role="user"] .gantt-chat-bubble {
    border-color: color-mix(in srgb, var(--gantt-accent) 35%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 11%, transparent);
  }
  .gantt-chat-error {
    padding: 7px 9px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
    color: var(--dsw-alias-state-error-primary);
    font-size: 11.5px;
  }
  .gantt-chat-proposal { display: flex; flex-direction: column; gap: 8px; padding: 9px 10px; border: 1px solid var(--gantt-line-strong); border-radius: 10px; background: var(--gantt-surface); }
  .gantt-chat-proposal[data-applied="true"] { border-style: dashed; }
  .gantt-chat-proposal-head { display: flex; align-items: baseline; gap: 8px; font-size: 11.5px; font-weight: 650; }
  .gantt-chat-proposal-date { margin-left: auto; font-size: 10.5px; font-weight: 400; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-chat-child { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border: 1px solid var(--gantt-line); border-radius: 8px; background: color-mix(in srgb, var(--gantt-bg) 55%, transparent); }
  .gantt-chat-child-title { font-size: 12px; font-weight: 600; }
  .gantt-chat-child-done { font-size: 11px; color: var(--gantt-muted); }
  .gantt-chat-child-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 10.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-chat-applied { font-size: 11px; font-weight: 600; color: var(--dsw-alias-state-success-primary); }
  .gantt-chat-note { font-size: 11px; color: var(--gantt-muted); }
  .gantt-chat-compose { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--gantt-line); background: var(--gantt-bg); }
  .gantt-chat-input { min-height: 56px; max-height: 120px; }
  .gantt-chat-compose-row { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .gantt-chat-sending { margin-right: auto; font-size: 11px; color: var(--gantt-muted); }
  @container (max-width: 900px) {
    .gantt-work { flex-direction: column; }
    .gantt-chat { flex: 1 1 auto; width: auto; max-height: 46vh; border-left: 0; border-top: 1px solid var(--gantt-line-strong); }
  }
  @container (max-width: 720px) {
    .gantt-chat { width: 100%; max-height: 52vh; }
    .gantt-chat-compose { padding: 8px 10px; }
  }
`
