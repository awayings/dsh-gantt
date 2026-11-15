/** Container-query folding for narrow panes. */
export const CSS_RESPONSIVE = `
  @container (max-width: 980px) {
    .gantt-head, .gantt-stats, .gantt-body, .gantt-backdrop { --gantt-left: 280px; }
    .gantt-subtitle { display: none; }
    .gantt-stat-progress { max-width: none; }
    .gantt-api-meta { grid-template-columns: 1fr; }
    .gantt-head, .gantt-stats { padding-left: 14px; padding-right: 14px; }
    .gantt-brief { margin: 12px 14px 0; }
  }
  @container (max-width: 720px) {
    .gantt-head, .gantt-stats, .gantt-body, .gantt-backdrop { --gantt-left: 230px; }
    .gantt-number { min-width: 30px; }
    .gantt-status-label { display: none; }
    .gantt-status { padding: 0 6px; }
    .gantt-task-meta { padding-left: 10px; }
    .gantt-row-chip { max-width: 132px; }
    .gantt-form-grid { grid-template-columns: 1fr; }
    .gantt-split-head, .gantt-split-row { grid-template-columns: minmax(0, 1fr) 110px 110px 32px; }
    .gantt-api-row { grid-template-columns: 44px minmax(0, 1fr); }
    .gantt-api-desc { grid-column: 1 / -1; }
    .gantt-decompose-head { grid-template-columns: 18px minmax(0, 1fr) 32px; }
    .gantt-decompose-head > [data-field="doneWhen"] { grid-column: 2 / 4; }
    .gantt-brief-lane-name { min-width: 0; }
    .gantt-brief-lanes-head, .gantt-brief-lane { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); }
    .gantt-brief-windows { grid-template-columns: 1fr; }
    .gantt-filter { padding-left: 14px; padding-right: 14px; }
    .gantt-brief { margin: 10px 14px 0; padding: 8px 10px; }
  }
`
