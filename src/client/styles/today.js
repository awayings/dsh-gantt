/** Today page layout, plan blocks and node list. */
export const CSS_TODAY = `
  .today-page { container-type: inline-size; }
  .today-page .today-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding: 14px 22px 26px; }
  .today-meta { flex-wrap: wrap; gap: 8px 14px; padding: 10px 12px; border: 1px solid var(--gantt-line); border-radius: 10px; background: var(--gantt-surface); }
  .today-meta-date { display: inline-flex; align-items: baseline; gap: 7px; }
  .today-meta-date strong { font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .today-weekday { font-size: 12px; color: var(--gantt-muted); }
  .today-meta-label { font-size: 12px; color: var(--gantt-muted); }
  .today-market { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--gantt-line-strong); color: var(--gantt-muted); white-space: nowrap; }
  .today-market[data-open="true"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); }
  .today-meta .gantt-stat-progress { margin-left: auto; min-width: 200px; flex: 1 1 240px; max-width: 440px; }
  .today-goal { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-left: 3px solid var(--gantt-accent); border-radius: 8px; background: color-mix(in srgb, var(--gantt-accent) 8%, transparent); }
  .today-goal-text { margin: 0; font-size: 12.5px; }
  .today-section-title { margin: 0; font-size: 11.5px; font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; color: var(--gantt-muted); }
  .today-integrity { display: flex; flex-direction: column; gap: 7px; padding: 10px 12px; border: 1px solid var(--gantt-line); border-radius: 10px; background: var(--gantt-surface); }
  .today-integrity-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .today-integrity-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--gantt-muted); }
  .today-brief { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--gantt-line); border-radius: 10px; background: var(--gantt-surface); }
  .today-brief-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .today-brief-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .today-brief-meta { font-size: 11.5px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .today-brief-list { display: flex; flex-direction: column; gap: 6px; }
  .today-brief-row {
    display: grid;
    grid-template-columns: 96px auto minmax(90px, 0.6fr) minmax(0, 1.4fr);
    gap: 8px;
    align-items: center;
    padding: 7px 9px;
    border: 1px solid var(--gantt-line);
    border-radius: 9px;
    font-size: 12px;
  }
  .today-brief-row[data-filled="false"] { border-style: dashed; }
  .today-brief-time { color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .today-brief-role { justify-self: start; font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 999px; border: 1px solid var(--gantt-line-strong); color: var(--gantt-muted); white-space: nowrap; }
  .today-brief-role[data-role="core"] { color: var(--gantt-accent); border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent); }
  .today-brief-track { color: var(--gantt-muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .today-brief-task { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .today-brief-unfilled { color: var(--gantt-muted); font-style: italic; }
  .today-blocks, .today-slot, .today-nodes { display: flex; flex-direction: column; }
  .today-blocks { gap: 10px; }
  .today-slot { gap: 7px; }
  .today-nodes { gap: 8px; }
  .today-slot-title { display: flex; align-items: baseline; gap: 7px; margin: 0; font-size: 12px; font-weight: 650; color: var(--gantt-muted); }
  .today-slot-count { font-size: 10.5px; font-variant-numeric: tabular-nums; opacity: 0.8; }
  .today-block { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 10px; padding: 9px 11px; border: 1px solid var(--gantt-line); border-left: 3px solid var(--gantt-line-strong); border-radius: 10px; background: var(--gantt-surface); }
  .today-block[data-status="in_progress"] { border-left-color: var(--dsw-alias-brand-primary); }
  .today-block[data-status="done"] { border-left-color: var(--dsw-alias-state-success-primary); }
  .today-block[data-status="todo"] { border-left-color: var(--dsw-alias-state-idle-primary); }
  .today-block-time { font-size: 12px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .today-block-main { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .today-block-head { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
  .today-block-title { margin: 0; flex: 1 1 auto; min-width: 0; font-size: 12.5px; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .today-block-detail { margin: 0; font-size: 11.5px; color: var(--gantt-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .today-chip { flex: 0 0 auto; font-size: 10.5px; line-height: 1; padding: 3px 7px; border-radius: 999px; border: 1px solid var(--gantt-line-strong); color: var(--gantt-muted); white-space: nowrap; }
  .today-chip-muted { border-style: dashed; }
  .today-source-badge {
    flex: 0 0 auto;
    font-size: 10px;
    line-height: 1;
    padding: 3px 7px;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, var(--gantt-accent) 40%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 10%, transparent);
    color: var(--gantt-accent);
    white-space: nowrap;
  }
  .today-block-meta { display: flex; flex-wrap: wrap; gap: 5px; }
  .today-muted { margin: 0; font-size: 12px; color: var(--gantt-muted); }
  .today-node-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .today-node { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 7px 10px; border: 1px solid var(--gantt-line); border-radius: 9px; background: var(--gantt-surface); font-size: 12px; }
  .today-node-id { color: var(--gantt-accent); font-size: 11px; font-variant-numeric: tabular-nums; }
  .today-node-title { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .today-node-range { font-size: 11px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .today-nav-date { min-width: 96px; text-align: center; font-size: 12px; color: var(--gantt-muted); font-variant-numeric: tabular-nums; }
  .today-body .gantt-banner { margin: 0; }
  @container (max-width: 560px) {
    .today-page .today-body { padding: 12px 14px 22px; }
    .today-block { grid-template-columns: 1fr; }
    .today-meta .gantt-stat-progress { margin-left: 0; max-width: none; }
    .today-node-title { flex-basis: 100%; }
    .today-brief-row { grid-template-columns: 1fr; gap: 4px; }
  }
`
