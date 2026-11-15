/** Base page variables, layout shell and focus outlines. */
export const CSS_BASE = `
  .gantt-page {
    --gantt-left: 340px;
    --gantt-bg: var(--dsw-alias-bg-base);
    --gantt-surface: var(--dsw-alias-bg-layer-1);
    --gantt-surface-2: var(--dsw-alias-bg-layer-2);
    --gantt-line: var(--dsw-alias-border-l1);
    --gantt-line-strong: var(--dsw-alias-border-l2);
    --gantt-text: var(--dsw-alias-label-primary);
    --gantt-muted: var(--dsw-alias-label-secondary);
    --gantt-accent: var(--dsw-alias-brand-primary);
    position: relative;
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--gantt-bg);
    color: var(--gantt-text);
    font-size: 13px;
    line-height: 1.45;
    overflow: hidden;
  }
  .gantt-page, .gantt-page * { box-sizing: border-box; }
  .gantt-page button, .gantt-page input, .gantt-page select, .gantt-page textarea { font: inherit; }
  .gantt-page button:focus-visible,
  .gantt-page input:focus-visible,
  .gantt-page select:focus-visible,
  .gantt-page textarea:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--gantt-accent) 65%, transparent);
    outline-offset: 2px;
  }
`
