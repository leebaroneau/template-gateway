export const adminStyles = `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-soft: #f0f4f7;
  --line: #d7dee6;
  --line-strong: #b8c4cf;
  --text: #1d252d;
  --muted: #65717d;
  --accent: #1d6f8f;
  --accent-dark: #155b73;
  --success: #237a57;
  --warning: #9a650c;
  --danger: #b33b36;
  --info: #405f9f;
}

* {
  box-sizing: border-box;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.admin-shell {
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr);
  min-height: 100vh;
}

.admin-nav {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  padding: 18px 14px;
  background: #17222b;
  color: #f7fafc;
  border-right: 1px solid #0e151b;
}

.brand-lockup {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 4px 4px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 6px;
  background: #e8f5f8;
  color: #12313c;
  font-weight: 750;
}

.eyebrow {
  margin: 0 0 2px;
  color: #b8c7d3;
  font-size: 11px;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: 17px;
  line-height: 1.2;
}

h2 {
  margin-bottom: 6px;
  font-size: 20px;
  line-height: 1.2;
}

h3 {
  margin-bottom: 10px;
  font-size: 14px;
  line-height: 1.25;
}

.admin-nav nav {
  display: grid;
  gap: 4px;
  margin-top: 16px;
}

.nav-link {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #d9e3ea;
  text-align: left;
}

.nav-link:hover,
.nav-link.is-active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.admin-main {
  min-width: 0;
  padding: 22px;
}

.workspace {
  display: grid;
  gap: 16px;
  max-width: 1360px;
}

.view-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
}

.view-header p {
  margin-bottom: 0;
  color: var(--muted);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.metric span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.metric strong {
  display: block;
  margin-top: 4px;
  font-size: 24px;
  line-height: 1;
}

.grid-two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.grid-wide {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.panel {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}

.panel-header p {
  margin-bottom: 0;
  color: var(--muted);
  font-size: 12px;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
  background: var(--panel);
}

th,
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}

th {
  background: var(--panel-soft);
  color: #41515e;
  font-size: 12px;
  font-weight: 700;
}

tr:last-child td {
  border-bottom: 0;
}

tr.is-selected td {
  background: #f2f8fa;
}

div.record-row.is-selected {
  background: #e8f4f7;
  border-left: 3px solid #2a7090;
  padding-left: 13px;
}

button.tab {
  padding: 6px 14px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: #fff;
  font-size: .85rem;
  cursor: pointer;
  color: var(--text-muted, #6b7280);
  transition: background .1s, color .1s;
}

button.tab:hover {
  background: #f1f5f9;
  color: var(--text, #1a202c);
}

button.tab.is-active {
  background: #2a7090;
  border-color: #2a7090;
  color: #fff;
  font-weight: 600;
}

.dense-list {
  display: grid;
  gap: 8px;
}

.record-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfd;
}

.record-row strong,
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 12px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef2f6;
  color: #45535f;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.badge.connected,
.badge.active {
  background: #e6f4ed;
  color: var(--success);
}

.badge.pending,
.badge.needs_config {
  background: #fff4df;
  color: var(--warning);
}

.badge.error,
.badge.revoked,
.badge.needs_reconnect {
  background: #fae9e7;
  color: var(--danger);
}

.badge.info {
  background: #e8eefb;
  color: var(--info);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fbfcfd;
  color: #45535f;
  font-size: 12px;
}

.source-row,
.source-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.source-line {
  min-height: 24px;
}

.source-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  max-width: 100%;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #eef5f7;
  color: #38515b;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
  white-space: nowrap;
}

.source-chip.override {
  border-color: #e0b76d;
  background: #fff5df;
  color: var(--warning);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.form-grid .span-2 {
  grid-column: 1 / -1;
}

label {
  display: grid;
  gap: 5px;
  color: #34424e;
  font-size: 12px;
  font-weight: 650;
}

input,
select,
textarea {
  width: 100%;
  min-height: 34px;
  padding: 7px 9px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: #ffffff;
  color: var(--text);
}

input:focus,
select:focus,
textarea:focus {
  outline: 2px solid rgba(29, 111, 143, 0.24);
  border-color: var(--accent);
}

input[readonly] {
  background: #f6f8fa;
  color: var(--muted);
}

textarea {
  min-height: 92px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  line-height: 1.4;
}

.inline-edit {
  padding-top: 2px;
}

.select-pair {
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(160px, 240px);
  gap: 8px;
  align-items: center;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.btn {
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: #ffffff;
  color: #27333d;
  font-weight: 650;
}

.btn:hover {
  border-color: var(--accent);
}

.btn-primary {
  border-color: var(--accent-dark);
  background: var(--accent);
  color: #ffffff;
}

.btn-danger {
  border-color: #d79b96;
  color: var(--danger);
}

.btn-reset {
  background: #fff8f7;
}

.setup-flow {
  border-color: #bdd7df;
}

.setup-summary {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #f7fafb;
}

.lifecycle {
  display: inline-flex;
}

.access-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  gap: 12px;
  align-items: start;
}

.access-client-list {
  display: grid;
  min-width: 0;
  gap: 10px;
}

.access-client {
  display: grid;
  min-width: 0;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.access-client-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  min-width: 0;
}

.access-client-header h3 {
  margin-bottom: 3px;
}

.access-client-header > div:first-child {
  min-width: 0;
}

.access-client-header strong,
.access-client-header h3,
.access-meta-item > strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.access-client-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.access-meta-item {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fbfcfd;
}

.access-meta-item > span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}

.access-meta-item > strong {
  display: block;
  margin-top: 3px;
  color: var(--text);
  font-size: 13px;
}

.access-scopes {
  grid-column: span 2;
}

.access-scopes .chip-row {
  margin-top: 5px;
}

.access-key-list {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.access-key-list table {
  min-width: 980px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.secret-reveal {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid #98cbb5;
  border-radius: 8px;
  background: #eef8f3;
}

.secret-reveal code {
  display: block;
  max-width: 100%;
  padding: 8px 10px;
  overflow-x: auto;
  border: 1px solid #b6d9c8;
  border-radius: 6px;
  background: #ffffff;
  color: #173b2b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  white-space: nowrap;
}

.scope-checklist {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
  margin-top: 5px;
}

.scope-checklist label {
  display: flex;
  min-width: 0;
  gap: 6px;
  align-items: center;
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
}

.scope-checklist input {
  width: auto;
  min-height: auto;
  flex: 0 0 auto;
}

.scope-checklist span,
.audit-compact span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.audit-compact {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.audit-compact li {
  display: grid;
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fbfcfd;
}

.audit-compact strong {
  font-size: 12px;
}

.error-panel {
  max-width: 1360px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #e0aaa5;
  border-radius: 8px;
  background: #fff0ee;
  color: #8e2f2a;
  font-weight: 650;
}

.loading-panel,
.empty-panel {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--muted);
}

@media (max-width: 920px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }

  .admin-nav {
    position: static;
    height: auto;
  }

  .admin-nav nav {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .nav-link {
    text-align: center;
  }

  .metrics-grid,
  .grid-two,
  .grid-wide,
  .access-grid,
  .access-client-meta,
  .form-grid,
  .select-pair,
  .scope-checklist {
    grid-template-columns: 1fr;
  }

  .access-scopes {
    grid-column: auto;
  }

  .form-grid .span-2 {
    grid-column: auto;
  }
}

/* ── Drawer ──────────────────────────────────────────────────────── */
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.25);
  z-index: 40;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 400px;
  height: 100vh;
  background: var(--panel);
  border-left: 1px solid var(--line);
  box-shadow: -4px 0 24px rgba(0,0,0,.12);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(0);
}

.drawer-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.drawer-header h3 { margin: 0; font-size: 1rem; }
.drawer-header p { margin: 2px 0 0; font-size: .8rem; color: var(--muted); }

.drawer-close {
  background: none;
  border: 1px solid var(--line);
  border-radius: 6px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 1rem;
  color: var(--muted);
  flex-shrink: 0;
}
.drawer-close:hover { background: var(--bg); }

.wizard-steps {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
}
.wizard-step-seg {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: var(--line);
}
.wizard-step-seg.active { background: var(--accent); }

.wizard-step-label {
  padding: 6px 20px 14px;
  font-size: .75rem;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}

.wizard-body {
  padding: 0 20px 20px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wizard-field label {
  display: block;
  font-size: .8rem;
  color: var(--muted);
  margin-bottom: 4px;
}
.wizard-field input,
.wizard-field select,
.wizard-field textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--panel);
  font-size: .9rem;
}
.wizard-field input:focus,
.wizard-field select:focus,
.wizard-field textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(29,111,143,.15);
}

.wizard-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  background: var(--panel);
  justify-content: space-between;
}
.wizard-footer .footer-right {
  display: flex;
  gap: 8px;
}

.test-result {
  border-radius: 8px;
  padding: 12px 14px;
  font-size: .85rem;
  line-height: 1.5;
}
.test-result--running { background: var(--panel-soft); color: var(--muted); }
.test-result--passed { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
.test-result--failed { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }

.oauth-status {
  border-radius: 8px;
  padding: 12px 14px;
  font-size: .85rem;
  line-height: 1.5;
}
.oauth-status--connected { background: #f0fdf4; border: 1px solid #bbf7d0; }
.oauth-status--disconnected { background: var(--panel-soft); border: 1px solid var(--line); }

.drawer-active td:first-child {
  border-left: 3px solid var(--accent);
  padding-left: 13px;
}

@keyframes spin { to { transform: rotate(360deg); } }
`;
