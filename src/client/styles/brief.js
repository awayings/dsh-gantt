/** Frontier / next brief card, lane grid, fold summary and window cards. */
export const CSS_BRIEF = `
  .gantt-brief {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 22px 0;
    padding: 10px 14px;
    border: 1px solid var(--gantt-line);
    border-radius: 12px;
    background: color-mix(in srgb, var(--gantt-accent) 4%, var(--gantt-bg));
  }
  .gantt-brief[data-collapsed="true"] { width: fit-content; max-width: 100%; }
  .gantt-brief-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .gantt-brief-toggle { flex: 0 0 auto; width: 24px; height: 24px; padding: 0; font-size: 11px; }
  .gantt-brief-title { font-size: 11.5px; font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; color: var(--gantt-muted); }
  .gantt-brief-pending, .gantt-brief-computed { font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-brief-summary { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .gantt-brief-summary-frontier { color: var(--gantt-accent); }
  .gantt-brief-summary-next { color: var(--dsw-alias-state-success-primary); }
  .gantt-brief-recompute { margin-left: auto; }
  .gantt-brief-lanes {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--gantt-line);
    border-radius: 9px;
    overflow: hidden;
    background: var(--gantt-surface);
  }
  .gantt-brief-lanes-head, .gantt-brief-lane {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr);
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .gantt-brief-lanes-head {
    height: 26px;
    padding: 0 10px;
    border-bottom: 1px solid var(--gantt-line);
    background: color-mix(in srgb, var(--gantt-bg) 55%, transparent);
  }
  .gantt-brief-col { font-size: 10.5px; font-weight: 650; color: var(--gantt-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gantt-brief-col[data-kind="frontier"] { color: var(--gantt-accent); }
  .gantt-brief-col[data-kind="next"] { color: var(--dsw-alias-state-success-primary); }
  .gantt-brief-lane { height: 34px; padding: 0 10px; border-top: 1px solid var(--gantt-line); }
  .gantt-brief-lane:nth-child(even) { background: color-mix(in srgb, var(--gantt-muted) 4%, transparent); }
  .gantt-brief-lane:hover { background: color-mix(in srgb, var(--gantt-accent) 7%, transparent); }
  .gantt-brief-lane-name, .gantt-brief-cell { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gantt-brief-cell { display: flex; align-items: center; }
  .gantt-brief-pick {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    min-width: 0;
    height: 22px;
    padding: 0 7px;
    border: 1px solid var(--gantt-line-strong);
    border-left: 3px solid var(--gantt-line-strong);
    border-radius: 6px;
    background: var(--gantt-surface);
    color: var(--gantt-text);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
  }
  .gantt-brief-pick[data-kind="frontier"] { border-left-color: var(--gantt-accent); }
  .gantt-brief-pick[data-kind="next"] { border-left-color: var(--dsw-alias-state-success-primary); }
  .gantt-brief-pick:hover { border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent); }
  .gantt-brief-tag {
    flex: 0 0 auto;
    font-size: 9.5px;
    line-height: 1;
    padding: 2px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--gantt-accent) 14%, transparent);
    color: var(--gantt-accent);
  }
  .gantt-brief-pick[data-kind="next"] .gantt-brief-tag {
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 15%, transparent);
    color: var(--dsw-alias-state-success-primary);
  }
  .gantt-brief-id { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--gantt-muted); }
  .gantt-brief-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gantt-brief-none { color: var(--gantt-muted); opacity: 0.6; }
  .gantt-brief-today { display: flex; flex-direction: column; gap: 6px; }
  .gantt-brief-windows { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; }
  .gantt-brief-window {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--gantt-line);
    border-radius: 9px;
    background: var(--gantt-surface);
  }
  .gantt-brief-window[data-filled="true"] { border-left: 3px solid var(--gantt-accent); }
  .gantt-brief-window-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .gantt-brief-window-time { font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .gantt-brief-role {
    flex: 0 0 auto;
    font-size: 10px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid var(--gantt-line-strong);
    color: var(--gantt-muted);
    white-space: nowrap;
  }
  .gantt-brief-role[data-role="core"] { color: var(--gantt-accent); border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent); }
  .gantt-brief-window-task {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--gantt-text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
  }
  .gantt-brief-window-task:hover .gantt-brief-window-name { color: var(--gantt-accent); }
  .gantt-brief-window-ref { flex: 0 0 auto; color: var(--gantt-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .gantt-brief-window-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gantt-brief-unfilled { font-size: 11.5px; color: var(--gantt-muted); font-style: italic; }
  .gantt-brief-empty { margin: 0; font-size: 11.5px; color: var(--gantt-muted); }
`
