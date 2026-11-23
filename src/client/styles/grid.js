/** Timeline header, rows, task cells, bars and grid lines. */
export const CSS_GRID = `
  .gantt-body { flex: 1; min-height: 0; display: flex; overflow: hidden; position: relative; }
  .gantt-main { flex: 1 1 auto; min-width: 0; overflow: auto; position: relative; }
  .gantt-task-panel {
    flex: 0 0 clamp(320px, 34%, 420px);
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--gantt-line-strong);
    background: var(--gantt-surface);
  }
  .gantt-task-panel > * { flex: 1 1 auto; min-height: 0; }
  @container (max-width: 900px) {
    .gantt-task-panel {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(420px, 100%);
      z-index: 30;
      box-shadow: -12px 0 28px color-mix(in srgb, #000 18%, transparent);
    }
  }
  @container (max-width: 520px) {
    .gantt-task-panel { width: 100%; border-left: 0; }
  }
  .gantt-grid { position: relative; min-width: max-content; }
  .gantt-header {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    background: var(--gantt-surface);
    border-bottom: 1px solid var(--gantt-line-strong);
  }
  .gantt-corner {
    position: sticky;
    left: 0;
    z-index: 22;
    width: var(--gantt-left);
    flex: 0 0 var(--gantt-left);
    height: 56px;
    padding: 0 14px 7px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    background: var(--gantt-surface);
    border-right: 1px solid var(--gantt-line-strong);
  }
  .gantt-corner-title { font-size: 12px; font-weight: 600; }
  .gantt-corner-sub { font-size: 11px; color: var(--gantt-muted); }
  .gantt-header-timeline { flex: 0 0 auto; height: 56px; }
  .gantt-group-row { display: flex; height: 26px; border-bottom: 1px solid var(--gantt-line); }
  .gantt-group-cell {
    display: flex; align-items: center;
    padding: 0 8px;
    border-right: 1px solid var(--gantt-line);
    font-size: 11px; font-weight: 600; color: var(--gantt-muted);
    white-space: nowrap; overflow: hidden;
  }
  .gantt-unit-row { display: flex; height: 30px; }
  .gantt-unit-cell {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0;
    border-right: 1px solid var(--gantt-line);
    color: var(--gantt-muted);
    overflow: hidden;
    white-space: nowrap;
  }
  .gantt-unit-cell[data-weekend="true"] { background: color-mix(in srgb, var(--gantt-muted) 6%, transparent); }
  .gantt-unit-cell[data-today="true"] {
    background: color-mix(in srgb, var(--gantt-accent) 14%, transparent);
    color: var(--gantt-accent);
    font-weight: 700;
  }
  .gantt-unit-main { font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .gantt-unit-sub { font-size: 9px; opacity: 0.75; line-height: 1.1; }
  .gantt-rows { position: relative; }
  .gantt-grid-lines { position: absolute; top: 0; bottom: 0; z-index: 0; pointer-events: none; }
  .gantt-vline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--gantt-line); opacity: 0.8; }
  .gantt-vline[data-strong="true"] { background: var(--gantt-line-strong); opacity: 1; }
  .gantt-today-line {
    position: absolute; top: 0; bottom: 0; width: 2px;
    background: color-mix(in srgb, var(--gantt-accent) 55%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--gantt-accent) 12%, transparent);
  }
  .gantt-row {
    display: flex;
    min-height: 38px;
    height: auto;
    position: relative;
    z-index: 1;
    cursor: pointer;
    outline: none;
  }
  .gantt-row:hover .gantt-task-cell { background: var(--gantt-surface-2); }
  .gantt-row:hover .gantt-track { background: color-mix(in srgb, var(--gantt-accent) 4%, transparent); }
  .gantt-task-cell {
    position: sticky;
    left: 0;
    z-index: 5;
    width: var(--gantt-left);
    flex: 0 0 var(--gantt-left);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding-right: 8px;
    background: var(--gantt-surface);
    border-right: 1px solid var(--gantt-line-strong);
    border-bottom: 1px solid var(--gantt-line);
    overflow: hidden;
  }
  .gantt-task-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .gantt-task-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-left: 24px;
    overflow: hidden;
  }
  .gantt-row-chip {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 190px;
    font-size: 10px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid var(--gantt-line);
    color: var(--gantt-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gantt-row-tag {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 30%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 9%, transparent);
  }
  .gantt-row-actions { display: flex; align-items: center; gap: 1px; flex: 0 0 auto; }
  .gantt-row-action {
    flex: 0 0 20px;
    width: 20px; height: 20px;
    display: grid; place-items: center;
    border: 0; border-radius: 6px;
    background: transparent;
    color: var(--gantt-muted);
    opacity: 0.5;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    padding: 0;
  }
  .gantt-row-action:hover { opacity: 1; color: var(--gantt-accent); background: color-mix(in srgb, var(--gantt-accent) 12%, transparent); }
  .gantt-row[data-selected="true"] .gantt-task-cell {
    background: color-mix(in srgb, var(--gantt-accent) 10%, var(--gantt-surface));
    box-shadow: inset 3px 0 0 var(--gantt-accent);
  }
  .gantt-track {
    position: relative;
    flex: 0 0 auto;
    min-height: 38px;
    height: auto;
    border-bottom: 1px solid var(--gantt-line);
  }
  .gantt-chevron {
    width: 18px; height: 18px; flex: 0 0 18px;
    display: grid; place-items: center;
    border: 0; border-radius: 5px;
    background: transparent;
    color: var(--gantt-muted);
    cursor: pointer;
    font-size: 10px;
    padding: 0;
  }
  .gantt-chevron:hover { background: var(--gantt-surface-2); color: var(--gantt-text); }
  .gantt-chevron-empty { visibility: hidden; }
  .gantt-number {
    flex: 0 0 auto;
    min-width: 38px;
    color: var(--gantt-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .gantt-task-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    color: var(--gantt-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gantt-status {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--st, var(--gantt-muted)) 32%, transparent);
    background: color-mix(in srgb, var(--st, var(--gantt-muted)) 11%, transparent);
    color: var(--st, var(--gantt-muted));
    font-size: 10.5px;
    line-height: 1;
    white-space: nowrap;
    cursor: default;
  }
  .gantt-status[data-interactive="true"] { cursor: pointer; }
  .gantt-status[data-interactive="true"]:hover { background: color-mix(in srgb, var(--st, var(--gantt-muted)) 20%, transparent); }
  .gantt-status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 6px; }
  .gantt-status-label { overflow: hidden; text-overflow: ellipsis; }
  .gantt-row-activity {
    flex: 0 0 auto;
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 9.5px;
    line-height: 1;
    font-weight: 700;
    border: 1px solid transparent;
  }
  .gantt-row-activity[data-state="waiting"] {
    color: #9a5b00;
    border-color: color-mix(in srgb, #d98300 45%, transparent);
    background: color-mix(in srgb, #d98300 16%, transparent);
  }
  .gantt-row-activity[data-state="running"] {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 14%, transparent);
    animation: gantt-activity-pulse 1.4s ease-in-out infinite;
  }
  @keyframes gantt-activity-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .gantt-row-activity[data-state="running"] { animation: none; }
  }
  .gantt-row-unformed {
    flex: 0 0 auto;
    font-size: 10px;
    line-height: 1;
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px dashed var(--gantt-muted);
    color: var(--gantt-muted);
    white-space: nowrap;
  }
  .gantt-row[data-unformed="true"] .gantt-task-title { color: var(--gantt-muted); }
  .gantt-bar[data-unformed="true"] {
    border-style: dashed;
    opacity: 0.75;
  }
  .gantt-add-child {
    flex: 0 0 20px;
    width: 20px; height: 20px;
    display: grid; place-items: center;
    border: 0; border-radius: 6px;
    background: transparent;
    color: var(--gantt-muted);
    opacity: 0.45;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0;
  }
  .gantt-add-child:hover { opacity: 1; color: var(--gantt-accent); background: color-mix(in srgb, var(--gantt-accent) 12%, transparent); }
  .gantt-bar {
    position: absolute;
    top: 9px;
    height: 20px;
    padding: 0 7px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--st, var(--gantt-accent)) 55%, transparent);
    background: color-mix(in srgb, var(--st, var(--gantt-accent)) 14%, var(--gantt-surface));
    color: var(--gantt-text);
    font-size: 10.5px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    display: flex;
    align-items: center;
    box-shadow: 0 1px 2px color-mix(in srgb, #000 10%, transparent);
  }
  .gantt-bar:hover { filter: brightness(1.05); }
  .gantt-bar[data-overdue="true"] { border-color: var(--dsw-alias-state-error-primary); }
  .gantt-bar[data-summary="true"] {
    top: 14px;
    height: 10px;
    padding: 0;
    border-radius: 3px;
    border: 0;
    overflow: visible;
    background: color-mix(in srgb, var(--st, var(--gantt-accent)) 55%, var(--gantt-surface));
  }
  .gantt-bar[data-summary="true"]::before,
  .gantt-bar[data-summary="true"]::after {
    content: "";
    position: absolute;
    top: -4px;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--st, var(--gantt-accent));
  }
  .gantt-bar[data-summary="true"]::before { left: -1px; }
  .gantt-bar[data-summary="true"]::after { right: -1px; }
  .gantt-bar-fill {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    background: color-mix(in srgb, var(--st, var(--gantt-accent)) 34%, transparent);
    pointer-events: none;
  }
  .gantt-bar[data-summary="true"] .gantt-bar-fill { background: color-mix(in srgb, var(--gantt-surface) 55%, var(--st, var(--gantt-accent))); }
  .gantt-bar-label {
    position: relative;
    z-index: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  /* A leaf bar drags: the body moves it one timeline cell at a time, the two edge zones
     resize it. Summary bars stay roll-up only and keep the plain pointer. */
  .gantt-bar[data-editable="true"] { cursor: grab; touch-action: pan-y; }
  .gantt-bar[data-dragging="true"] {
    cursor: grabbing;
    overflow: visible;
    z-index: 6;
    box-shadow: 0 4px 12px color-mix(in srgb, #000 18%, transparent);
  }
  .gantt-bar-handle {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 9px;
    z-index: 2;
    cursor: ew-resize;
    touch-action: none;
  }
  .gantt-bar-handle[data-edge="start"] { left: -3px; }
  .gantt-bar-handle[data-edge="end"] { right: -3px; }
  .gantt-bar-handle::after {
    content: "";
    position: absolute;
    top: 30%;
    bottom: 30%;
    width: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--st, var(--gantt-accent)) 55%, transparent);
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .gantt-bar-handle[data-edge="start"]::after { left: 3px; }
  .gantt-bar-handle[data-edge="end"]::after { right: 3px; }
  .gantt-bar:hover .gantt-bar-handle::after,
  .gantt-bar:focus-visible .gantt-bar-handle::after,
  .gantt-bar[data-dragging="true"] .gantt-bar-handle::after { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .gantt-bar-handle::after { transition: none; }
  }
  .gantt-bar[data-dragging="true"]::after {
    content: attr(data-range);
    position: absolute;
    left: 0;
    top: -22px;
    z-index: 3;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid var(--gantt-line-strong);
    background: var(--gantt-surface);
    color: var(--gantt-text);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    box-shadow: 0 2px 8px color-mix(in srgb, #000 16%, transparent);
  }
  /* Work mode: the header toggle reads as pressed, and the row keeps an
     explicit edit affordance because a row click now opens the conversation. */
  .gantt-actions .gantt-btn[data-action="work-mode"][data-active="true"] {
    color: var(--gantt-accent);
    border-color: color-mix(in srgb, var(--gantt-accent) 45%, transparent);
    background: color-mix(in srgb, var(--gantt-accent) 13%, transparent);
  }
  .gantt-row[data-work="true"]:hover .gantt-task-title { color: var(--gantt-accent); }
  .gantt-row[data-work="true"] .gantt-row-action[data-action="edit"] {
    opacity: 1;
    color: var(--gantt-accent);
  }
  /* The narrow task cell cannot hold four actions beside a title: fold the two
     organize actions and keep edit plus add-child reachable. */
  @container (max-width: 720px) {
    .gantt-row[data-work="true"] .gantt-row-action[data-action="decompose"],
    .gantt-row[data-work="true"] .gantt-row-action[data-action="schedule"] { display: none; }
  }
`
