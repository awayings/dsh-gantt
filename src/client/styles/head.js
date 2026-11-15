/** Header, buttons and segmented controls. */
export const CSS_HEAD = `
  .gantt-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 16px 22px 12px;
    border-bottom: 1px solid var(--gantt-line);
    background: var(--gantt-bg);
  }
  .gantt-brand { display: flex; align-items: center; gap: 12px; flex: 1 1 260px; min-width: 220px; }
  .gantt-brand-mark {
    width: 38px; height: 38px; flex: 0 0 38px;
    display: grid; place-items: center;
    border-radius: 11px;
    color: var(--gantt-accent);
    background: color-mix(in srgb, var(--gantt-accent) 13%, transparent);
    border: 1px solid color-mix(in srgb, var(--gantt-accent) 22%, transparent);
  }
  .gantt-title { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
  .gantt-subtitle { margin: 2px 0 0; font-size: 12px; color: var(--gantt-muted); }
  .gantt-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .gantt-btn {
    height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--gantt-line-strong);
    background: var(--gantt-surface);
    color: var(--gantt-text);
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  }
  .gantt-btn:hover:not(:disabled) { background: var(--gantt-surface-2); border-color: var(--gantt-line-strong); }
  .gantt-btn:disabled { opacity: 0.5; cursor: default; }
  .gantt-btn-primary {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 13%, transparent);
  }
  .gantt-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--gantt-accent) 20%, transparent); }
  .gantt-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
  .gantt-icon-btn { width: 32px; padding: 0; font-size: 16px; }
  .gantt-seg {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--gantt-line-strong);
    border-radius: 9px;
    background: var(--gantt-surface);
  }
  .gantt-seg-btn {
    height: 26px;
    padding: 0 11px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--gantt-muted);
    cursor: pointer;
    font-size: 12px;
  }
  .gantt-seg-btn[data-active="true"] {
    color: var(--gantt-accent);
    background: color-mix(in srgb, var(--gantt-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--gantt-accent) 28%, transparent);
    font-weight: 600;
  }
`
