/** Modal dialog shell and form controls. */
export const CSS_DIALOG = `
  .gantt-backdrop {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, #000 38%, transparent);
  }
  .gantt-dialog {
    width: min(620px, 100%);
    max-height: min(780px, 100%);
    display: flex;
    flex-direction: column;
    background: var(--gantt-surface);
    border: 1px solid var(--gantt-line-strong);
    border-radius: 14px;
    box-shadow: 0 24px 70px color-mix(in srgb, #000 32%, transparent);
    overflow: hidden;
  }
  .gantt-dialog-wide { width: min(760px, 100%); }
  .gantt-dialog-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--gantt-line);
  }
  .gantt-dialog-title { margin: 0; flex: 1; min-width: 0; font-size: 14px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gantt-dialog-body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .gantt-dialog-note { margin: 0; font-size: 12px; color: var(--gantt-muted); }
  .gantt-dialog-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--gantt-line);
    background: color-mix(in srgb, var(--gantt-surface) 80%, var(--gantt-bg));
  }
  .gantt-dialog-foot-left, .gantt-dialog-foot-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .gantt-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .gantt-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .gantt-field-full { grid-column: 1 / -1; }
  .gantt-label { font-size: 11.5px; color: var(--gantt-muted); font-weight: 550; }
  .gantt-hint { font-size: 11px; color: var(--gantt-muted); opacity: 0.85; }
  .gantt-input, .gantt-select, .gantt-textarea {
    width: 100%;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--gantt-line-strong);
    background: var(--gantt-bg);
    color: var(--gantt-text);
    font-size: 12.5px;
  }
  .gantt-input[type="date"] { color-scheme: light dark; }
  .gantt-textarea { height: auto; min-height: 76px; padding: 8px 10px; resize: vertical; }
  .gantt-input:focus, .gantt-select:focus, .gantt-textarea:focus {
    border-color: var(--gantt-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--gantt-accent) 16%, transparent);
    outline: none;
  }
  .gantt-input:disabled, .gantt-select:disabled, .gantt-range:disabled { opacity: 0.6; cursor: not-allowed; }
  .gantt-range { width: 100%; accent-color: var(--gantt-accent); }
  .gantt-form-error {
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
    background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
    color: var(--dsw-alias-state-error-primary);
    font-size: 12px;
  }
  .gantt-tag-editor { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .gantt-tag-list { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
  .gantt-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 2px 3px 2px 8px;
    border: 1px solid color-mix(in srgb, var(--gantt-accent) 30%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--gantt-accent) 9%, transparent);
    color: var(--gantt-accent);
    font-size: 11.5px;
    line-height: 1.4;
  }
  .gantt-tag-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gantt-tag-remove {
    width: 16px; height: 16px;
    display: grid; place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }
  .gantt-tag-remove:hover { background: color-mix(in srgb, var(--gantt-accent) 18%, transparent); }
  .gantt-tag-add { display: flex; align-items: center; gap: 6px; }
  .gantt-tag-add .gantt-input { flex: 1 1 auto; }
  .gantt-writeback {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--gantt-line);
    border-radius: 10px;
    background: color-mix(in srgb, var(--gantt-bg) 55%, transparent);
  }
  .gantt-writeback-row {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    min-width: 0;
  }
  .gantt-writeback-label { font-size: 11.5px; color: var(--gantt-muted); font-weight: 550; }
  .gantt-writeback-value {
    display: block;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--gantt-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .gantt-writeback-report { max-height: 96px; overflow: auto; }
  .gantt-split-head, .gantt-split-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 132px 132px 32px;
    gap: 8px;
    align-items: center;
  }
  .gantt-split-head { font-size: 11px; color: var(--gantt-muted); }
  .gantt-split-row .gantt-btn { width: 32px; height: 32px; }
  .gantt-api-meta { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 12px; }
  .gantt-api-meta > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .gantt-code {
    display: block;
    padding: 6px 8px;
    border-radius: 7px;
    background: var(--gantt-bg);
    border: 1px solid var(--gantt-line);
    color: var(--gantt-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    overflow: auto;
    white-space: nowrap;
  }
  .gantt-api-list { display: flex; flex-direction: column; gap: 6px; }
  .gantt-api-row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1.1fr) minmax(0, 1.6fr);
    gap: 8px;
    align-items: start;
    padding: 7px 8px;
    border: 1px solid var(--gantt-line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--gantt-bg) 55%, transparent);
  }
  .gantt-method {
    display: inline-flex; align-items: center; justify-content: center;
    height: 20px;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);
    color: var(--dsw-alias-state-success-primary);
      }
`
