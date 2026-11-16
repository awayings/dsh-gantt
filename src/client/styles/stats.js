/** Stats bar, progress bar and error banner. */
export const CSS_STATS = `
  .gantt-stats {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px 18px;
    padding: 8px 22px;
    border-bottom: 1px solid var(--gantt-line);
    background: var(--gantt-bg);
  }
  .gantt-window { display: inline-flex; align-items: baseline; gap: 8px; min-width: 220px; }
  .gantt-window-scale {
    font-size: 11px;
    color: var(--gantt-accent);
    background: color-mix(in srgb, var(--gantt-accent) 12%, transparent);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .gantt-window-label { font-size: 12px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-stat { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--gantt-muted); white-space: nowrap; }
  .gantt-stat b { color: var(--gantt-text); font-size: 13px; font-variant-numeric: tabular-nums; }
  .gantt-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--st, var(--gantt-muted)); flex: 0 0 7px; }
  .gantt-stat-progress { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; min-width: 180px; flex: 1 1 220px; max-width: 360px; color: var(--gantt-muted); font-size: 12px; }
  .gantt-progress { height: 6px; flex: 1; min-width: 80px; border-radius: 999px; background: var(--gantt-line); overflow: hidden; }
  .gantt-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-state-success-primary); }
  .gantt-banner {
    display: flex; align-items: center; gap: 10px;
    margin: 8px 22px 0;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
    border-radius: 8px;
    color: var(--dsw-alias-state-error-primary);
    font-size: 12px;
  }
  .gantt-banner span { flex: 1; min-width: 0; }
`
