/** Endpoint catalog, toasts, filter bar and dialog extras. */
export const CSS_MISC = `
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
  .gantt-filter {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 7px 22px;
    border-bottom: 1px solid var(--gantt-line);
    background: var(--gantt-bg);
  }
  .gantt-filter-label { font-size: 11px; color: var(--gantt-muted); }
  .gantt-filter-count { font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-filter-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 42px 24px;
    text-align: center;
    color: var(--gantt-muted);
  }
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
`
