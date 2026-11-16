/** Compact task-tree panel for the native conversation sidebar tab. */
export const CSS_PANEL = `
  .gantt-panel {
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
  .gantt-panel, .gantt-panel * { box-sizing: border-box; }
  .gantt-panel button { font: inherit; }
  .gantt-panel button:focus-visible { outline: 2px solid color-mix(in srgb, var(--gantt-accent) 65%, transparent); outline-offset: 1px; }
  .gantt-panel-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--gantt-line);
    background: var(--gantt-surface);
  }
  .gantt-panel-focus { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
  .gantt-panel-focus-label { flex: 0 0 auto; font-size: 10px; letter-spacing: 0.03em; text-transform: uppercase; color: var(--gantt-muted); }
  .gantt-panel-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding: 2px 7px;
    border: 1px solid color-mix(in srgb, var(--gantt-accent) 40%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--gantt-accent) 10%, transparent);
  }
  .gantt-panel-chip-ref { flex: 0 0 auto; font-size: 10.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-panel-chip-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--gantt-text); }
  .gantt-panel-focus-none { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; color: var(--gantt-muted); }
  .gantt-panel-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--gantt-line-strong);
    background: var(--gantt-surface);
    color: var(--gantt-text);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }
  .gantt-panel-btn:hover:not(:disabled) { background: var(--gantt-surface-2); }
  .gantt-panel-btn:disabled { opacity: 0.5; cursor: default; }
  .gantt-panel-btn-icon { width: 26px; padding: 0; font-size: 13px; }
  .gantt-panel-clear { height: 22px; padding: 0 7px; margin-left: auto; }
  .gantt-panel-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px 0 10px; }
  .gantt-panel-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    height: 30px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--gantt-text);
    text-align: left;
    cursor: pointer;
  }
  .gantt-panel-row:hover { background: var(--gantt-surface-2); }
  .gantt-panel-row[data-focused="true"] {
    background: color-mix(in srgb, var(--gantt-accent) 12%, transparent);
    box-shadow: inset 2px 0 0 var(--gantt-accent);
  }
  .gantt-panel-row:disabled { cursor: progress; }
  .gantt-panel-dot { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; background: var(--st, var(--gantt-muted)); }
  .gantt-panel-ref { flex: 0 0 auto; min-width: 34px; font-size: 10.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gantt-panel-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .gantt-panel-kind { flex: 0 0 auto; font-size: 9.5px; line-height: 1; padding: 2px 5px; border-radius: 4px; border: 1px solid var(--gantt-line); color: var(--gantt-muted); }
  .gantt-panel-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 28px 16px; color: var(--gantt-muted); text-align: center; }
  .gantt-panel-message { margin: 0; font-size: 11.5px; }
  .gantt-panel-error {
    margin: 6px 10px 0;
    padding: 6px 8px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
    color: var(--dsw-alias-state-error-primary);
    font-size: 11px;
  }
  .gantt-panel-spinner {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--gantt-line-strong);
    border-top-color: var(--gantt-accent);
    animation: gantt-panel-spin 800ms linear infinite;
  }
  @keyframes gantt-panel-spin { to { transform: rotate(360deg); } }
  .gantt-panel-trajectory {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 10px 7px;
    border-bottom: 1px solid var(--gantt-line);
    background: color-mix(in srgb, var(--gantt-accent) 4%, transparent);
  }
  .gantt-panel-trajectory-head { display: flex; align-items: baseline; gap: 6px; }
  .gantt-panel-trajectory-title { font-size: 10px; letter-spacing: 0.03em; text-transform: uppercase; color: var(--gantt-muted); }
  .gantt-panel-trajectory-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    color: var(--gantt-text);
  }
  .gantt-panel-trajectory-action {
    flex: 0 0 auto;
    font-size: 9.5px;
    line-height: 1;
    padding: 2px 5px;
    border-radius: 4px;
    border: 1px solid var(--gantt-line);
    color: var(--gantt-muted);
  }
  .gantt-panel-trajectory-row[data-action="complete"] .gantt-panel-trajectory-action {
    color: var(--dsw-alias-state-success-primary);
    border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);
  }
  .gantt-panel-trajectory-row[data-action="decompose"] .gantt-panel-trajectory-action {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 40%, transparent);
  }
  .gantt-panel-trajectory-turn {
    flex: 0 0 auto;
    color: var(--gantt-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .gantt-panel-trajectory-time {
    flex: 0 0 auto;
    color: var(--gantt-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .gantt-panel-trajectory-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gantt-panel-trajectory-error { margin: 0; font-size: 10.5px; color: var(--dsw-alias-state-error-primary); }
  @container (max-width: 340px) {
    .gantt-panel-trajectory-turn { display: none; }
  }
  @container (max-width: 340px) {
    .gantt-panel-focus-label { display: none; }
    .gantt-panel-kind { display: none; }
    .gantt-panel-ref { min-width: 28px; }
  }
`
