/** Loading, empty and centered states. */
export const CSS_EMPTY = `
  .gantt-empty-wrap { flex: 1; display: grid; place-items: center; padding: 32px 24px; min-height: 0; }
  .gantt-empty {
    max-width: 460px;
    display: flex; flex-direction: column; align-items: center;
    gap: 10px;
    padding: 34px 30px;
    border: 1px dashed var(--gantt-line-strong);
    border-radius: 14px;
    background: color-mix(in srgb, var(--gantt-surface) 70%, transparent);
    text-align: center;
  }
  .gantt-empty-icon {
    width: 46px; height: 46px;
    display: grid; place-items: center;
    border-radius: 13px;
    color: var(--gantt-accent);
    background: color-mix(in srgb, var(--gantt-accent) 12%, transparent);
    margin-bottom: 2px;
  }
  .gantt-empty-title { font-size: 15px; font-weight: 600; }
  .gantt-empty-body { font-size: 12px; color: var(--gantt-muted); max-width: 36ch; }
  .gantt-empty-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 6px; }
  .gantt-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 40px; color: var(--gantt-muted); }
  .gantt-spinner {
    width: 22px; height: 22px;
    border-radius: 50%;
    border: 2px solid var(--gantt-line-strong);
    border-top-color: var(--gantt-accent);
    animation: gantt-spin 800ms linear infinite;
  }
  @keyframes gantt-spin { to { transform: rotate(360deg); } }
`
