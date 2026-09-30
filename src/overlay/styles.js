// @ts-check

/**
 * Shadow-root stylesheet for the uce overlay. `:host` resets the host
 * element itself so the target page's styles/resets (box-sizing, fonts,
 * etc.) can never leak in, and nothing here ever touches the app's own DOM.
 * Only interactive surfaces (toolbar/panel/popover/toast) get pointer
 * events; the rest of the full-viewport layer stays click-through.
 * @type {string}
 */
export const overlayStyles = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.uce-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  color: #1a1a1a;
}

.uce-toolbar, .uce-panel, .uce-popover, .uce-toast, .uce-marker, .uce-forward-notice {
  pointer-events: auto;
}

/* Toolbar */
.uce-toolbar {
  position: fixed;
  bottom: 16px;
  left: 16px;
  display: flex;
  max-width: calc(100vw - 32px);
  align-items: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #d8d8dc;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .16);
  padding: 6px;
  user-select: none;
}
.uce-toolbar.uce-collapsed .uce-toolbar-body {
  display: none;
}
.uce-toolbar-handle {
  cursor: grab;
  padding: 4px 6px;
  color: #8a8a8f;
  font-size: 14px;
}
.uce-toolbar-body {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: 4px;
}
.uce-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: #1a1a1a;
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.uce-btn:hover { background: #f1f1f3; }
.uce-btn:disabled { opacity: .4; cursor: default; }
.uce-btn.uce-active { background: #1a73e8; color: #fff; }
.uce-btn.uce-primary { background: #1a73e8; color: #fff; }
.uce-btn.uce-primary:hover { background: #1765cc; }
.uce-btn.uce-danger:hover { background: #fce8e6; color: #c5221f; }
.uce-sep { width: 1px; align-self: stretch; background: #e2e2e6; margin: 0 2px; }
.uce-count {
  display: inline-block;
  min-width: 14px;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(0, 0, 0, .12);
  font-size: 10px;
  line-height: 15px;
  text-align: center;
}
.uce-btn.uce-active .uce-count { background: rgba(255, 255, 255, .3); }

/* Hover / selection / remove boxes */
.uce-hoverbox, .uce-selectionbox, .uce-removebox {
  position: fixed;
  pointer-events: none;
  border-radius: 3px;
  display: none;
}
.uce-hoverbox {
  border: 1.5px dashed #1a73e8;
  background: rgba(26, 115, 232, .06);
}
.uce-selectionbox {
  border: 2px solid #1a73e8;
  background: rgba(26, 115, 232, .10);
}
.uce-removebox {
  background: repeating-linear-gradient(135deg, rgba(197, 34, 31, .10) 0 6px, rgba(197, 34, 31, .22) 6px 12px);
  border: 1.5px solid rgba(197, 34, 31, .6);
}
.uce-removebox::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1.5px solid rgba(197, 34, 31, .7);
}
.uce-quick {
  position: fixed;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: #ffffff;
  border: 1px solid #d8d8dc;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .18);
  pointer-events: auto;
}
.uce-quick[hidden] {
  display: none;
}
.uce-box-label.uce-box-label-inside {
  top: 2px;
  left: 2px;
}
.uce-quick-btn {
  appearance: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #1a1a1a;
  cursor: pointer;
}
.uce-quick-btn:hover {
  background: #e8f0fe;
  color: #1a73e8;
}
.uce-quick-btn[data-quick="move"] {
  cursor: grab;
  touch-action: none;
}
.uce-box-label {
  position: absolute;
  top: -21px;
  left: -2px;
  background: #1a73e8;
  color: #fff;
  font-size: 11px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 3px;
  white-space: nowrap;
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uce-removebox .uce-box-label { background: #c5221f; }

/* Drag & drop / palette place-mode insertion marker */
.uce-dnd-marker {
  position: fixed;
  pointer-events: none;
  z-index: 1;
}
.uce-dnd-line {
  background: #1a73e8;
  border-radius: 2px;
}
.uce-dnd-box {
  border: 2px dashed #1a73e8;
  background: rgba(26, 115, 232, .08);
  border-radius: 3px;
}

/* Change-number markers */
.uce-marker {
  position: fixed;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: #c5221f;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  border-radius: 8px;
  transform: translate(-50%, -50%);
  cursor: pointer;
  display: none;
}
.uce-marker.uce-marker-missing { background: #9aa0a6; }

/* Side panel */
.uce-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: 320px;
  max-width: calc(100vw - 32px);
  background: #ffffff;
  border: 1px solid #d8d8dc;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .16);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.uce-panel[hidden] { display: none; }
.uce-panel-section {
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
  overflow: auto;
}
.uce-panel-section h3 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: #666;
}
.uce-panel-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.uce-panel-heading-row h3 { margin: 0 0 8px; }
.uce-resync-btn { font-size: 11px; padding: 3px 7px; margin-bottom: 6px; }
.uce-locator-summary {
  font-size: 11px;
  color: #555;
  margin-bottom: 8px;
  word-break: break-word;
}
.uce-locator-summary code {
  background: #f1f1f3;
  padding: 1px 3px;
  border-radius: 3px;
}
.uce-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.uce-field label {
  font-size: 11px;
  color: #666;
}
.uce-field input, .uce-field textarea {
  font: inherit;
  padding: 5px 7px;
  border: 1px solid #d8d8dc;
  border-radius: 5px;
  background: #fff;
  color: #1a1a1a;
}
.uce-change-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}
.uce-change-item {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #f1f1f3;
  cursor: pointer;
}
.uce-change-item:hover { background: #f8f9fb; }
.uce-change-num {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #eee;
  color: #444;
  font-size: 10px;
  text-align: center;
  line-height: 18px;
}
.uce-change-body { flex: 1; min-width: 0; }
.uce-change-type { font-weight: 600; font-size: 11px; color: #1a73e8; }
.uce-change-subject { font-size: 12px; color: #333; word-break: break-word; }
.uce-change-diff { font-size: 11px; color: #666; word-break: break-word; }
.uce-change-missing { color: #c5221f; font-size: 11px; }
.uce-change-del {
  flex: none;
  border: none;
  background: transparent;
  color: #999;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0;
}
.uce-change-del:hover { color: #c5221f; }
.uce-empty { padding: 12px; color: #888; font-size: 12px; }

/* Popover */
.uce-popover {
  position: fixed;
  width: 260px;
  background: #fff;
  border: 1px solid #d8d8dc;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .2);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.uce-popover textarea {
  font: inherit;
  width: 100%;
  min-height: 64px;
  padding: 6px;
  border: 1px solid #d8d8dc;
  border-radius: 5px;
  resize: vertical;
}
.uce-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

/* Palette popover ("Add") */
.uce-palette-popover {
  left: 16px;
  bottom: 64px;
  width: 300px;
  max-height: 60vh;
  overflow: hidden;
}
.uce-palette-popover input[type="text"] {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid #d8d8dc;
  border-radius: 5px;
}
.uce-palette-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
}
.uce-palette-list li {
  padding: 7px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  word-break: break-word;
}
.uce-palette-list li:hover { background: #f1f1f3; }
.uce-palette-list li.uce-empty { cursor: default; }
.uce-palette-list li.uce-empty:hover { background: transparent; }

/* Import popover */
.uce-import-popover {
  left: 16px;
  bottom: 64px;
  width: 300px;
}
.uce-import-popover .uce-popover-actions {
  flex-wrap: wrap;
}
.uce-import-counts {
  font-size: 11px;
  color: #666;
}
.uce-import-popover .uce-popover-actions[hidden] { display: none; }

/* Forward-host notice (proxy mode) */
.uce-forward-notice {
  position: fixed;
  bottom: 72px;
  left: 16px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  max-width: min(440px, calc(100vw - 32px));
  background: #fff8e1;
  border: 1px solid #e0b84a;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .16);
  padding: 8px 10px;
  font-size: 12px;
}
.uce-forward-notice[hidden] { display: none; }
.uce-forward-notice span { flex: 1 1 100%; }

/* Toast */
.uce-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  background: #1a1a1a;
  color: #fff;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 12px;
  opacity: 0;
  transition: opacity .15s ease;
  pointer-events: none;
}
.uce-toast.uce-visible { opacity: 1; }
.uce-toast.uce-error { background: #c5221f; }
`;
