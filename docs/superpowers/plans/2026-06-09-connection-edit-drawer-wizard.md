# Connection Edit Drawer Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom edit-block and Add Connection dropdown with a right-side 3-step drawer wizard (Configure → Auth → Test & Save) covering both edit and add flows.

**Architecture:** Pure frontend change — two files only (`client-script.ts`, `styles.ts`). The drawer state lives in `uiState.drawer`. `render()` already replaces `appRoot.innerHTML` completely on each state change, so `renderDrawer()` is injected at the end of `renderBrands()` and re-renders from `uiState.drawer` on every cycle. All existing backend endpoints (`PATCH /admin/api/connections/:id`, `POST /admin/api/regions/:id/connections`, `POST /admin/api/connections/:id/test`) are reused as-is.

**Tech Stack:** TypeScript (compiled to inline JS via `tsc`), vanilla DOM event delegation, no new dependencies. Build: `npm run build` in `template-gateway/`. Run: `node dist/index.js` with `ADMIN_DATA_SOURCE=gateway-store`.

---

## File Map

| File | Change |
|---|---|
| `src/admin/client-script.ts` | Add `DrawerState` type + `drawer` to `uiState`; add `renderDrawer()`, `renderDrawerStep1()`, `renderDrawerStep2()`, `renderDrawerStep3()`; add action handlers; remove `selectedConnectionId` / `select-connection` / `test-connection` (row) / `edit-block` / `renderConnectionEditor()` / `renderConnectorSetup()` |
| `src/admin/styles.ts` | Add `.drawer`, `.drawer-overlay`, `.drawer-active`, `.wizard-steps`, `.wizard-step-content`, `.test-result` variants |

---

### Task 1: Add DrawerState type, drawer to uiState, and CSS

**Files:**
- Modify: `src/admin/client-script.ts:1-35`
- Modify: `src/admin/styles.ts`

- [ ] **Step 1: Add DrawerState type and drawer field to UiState**

In `client-script.ts`, replace the `UiState` type block (lines 13–23) and the `uiState` initialiser (lines 27–35):

```typescript
  type DrawerState = {
    open: boolean;
    mode: "edit" | "add";
    connectionId: string | null;
    step: 1 | 2 | 3;
    testState: "idle" | "running" | "passed" | "failed";
    testDetail: string | null;
    pendingConnectorId: string | null;
  };
  type UiState = {
    data: Item | null;
    view: string;
    selectedBrandId: string | null;
    selectedRegionId: string | null;
    selectedConnectorId: string | null;
    secretReveal: SecretReveal | null;
    appInstalls?: Item[];
    allConnectors?: Item[];
    drawer: DrawerState;
  };

  const root = document.getElementById("app-root") as HTMLElement | null;
  const errorPanel = document.getElementById("app-error") as HTMLElement | null;
  const uiState: UiState = {
    data: null,
    view: "overview",
    selectedBrandId: null,
    selectedRegionId: null,
    selectedConnectorId: null,
    secretReveal: null,
    drawer: {
      open: false,
      mode: "edit",
      connectionId: null,
      step: 1,
      testState: "idle",
      testDetail: null,
      pendingConnectorId: null
    }
  };
```

Note: `selectedConnectionId` is removed from the type and initialiser — the drawer replaces it.

- [ ] **Step 2: Remove selectedConnectionId references in selectBrand and selectedConnectionForRegion**

In `selectBrand` (around line 179), remove the `uiState.selectedConnectionId = null;` line. In `selectedConnectionForRegion` (around line 193), remove all references to `uiState.selectedConnectionId`. These functions no longer manage connection selection:

```typescript
  function selectBrand(brandId: string | null): void {
    if (uiState.selectedBrandId !== brandId) {
      uiState.selectedRegionId = null;
    }
    uiState.selectedBrandId = brandId;
    selectedRegionForBrand(brandRegions(brandId));
  }

  function regionConnections(regionId: unknown): Item[] {
    return collection("connections").filter((connection) => connection.regionId === regionId);
  }

  function selectedConnectionForRegion(connections: Item[]): Item | undefined {
    return connections[0];
  }
```

- [ ] **Step 3: Add drawer CSS to styles.ts**

At the end of the CSS template string in `src/admin/styles.ts` (before the closing backtick), add:

```css
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
  overflow-y: auto;
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
```

- [ ] **Step 4: Build and verify no type errors**

```bash
cd /path/to/template-gateway && npm run typecheck
```

Expected: clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/admin/client-script.ts src/admin/styles.ts
git commit -m "feat(admin-ui): add DrawerState type, drawer uiState, drawer CSS"
```

---

### Task 2: renderDrawer() and Step 1 — Configure

**Files:**
- Modify: `src/admin/client-script.ts` — add `renderDrawer()`, `renderDrawerStep1()`

- [ ] **Step 1: Add renderDrawer() after renderConnectorSetup()**

Insert after the closing brace of `renderConnectorSetup()` (around line 606), before `renderBrands()`:

```typescript
  function renderDrawer(): string {
    const { drawer } = uiState;
    if (!drawer.open) return "";

    const connection = drawer.connectionId ? byId("connections", drawer.connectionId) : undefined;
    const connector = connection
      ? connectorFor(connection)
      : drawer.pendingConnectorId
        ? byId("connectors", drawer.pendingConnectorId)
        : collection("connectors")[0];

    const title = drawer.mode === "add" ? "Add connection" : "Edit connection";
    const subtitle = connection
      ? h(connection.displayName)
      : connector
        ? `${h(connector.name)} · new connection`
        : "Select a connector";

    const stepLabels = ["Configure", "Auth", "Test & Save"];
    const stepSegs = [1, 2, 3].map((n) =>
      `<div class="wizard-step-seg ${n <= drawer.step ? "active" : ""}"></div>`
    ).join("");

    const body = drawer.step === 1
      ? renderDrawerStep1(connection, connector)
      : drawer.step === 2
        ? renderDrawerStep2(connection, connector)
        : renderDrawerStep3(connection);

    return `
      <div class="drawer-overlay" data-action="close-drawer"></div>
      <div class="drawer">
        <div class="drawer-header">
          <div><h3>${title}</h3><p>${subtitle}</p></div>
          <button class="drawer-close" type="button" data-action="close-drawer" title="Close">✕</button>
        </div>
        <div class="wizard-steps">${stepSegs}</div>
        <div class="wizard-step-label">${h(stepLabels[drawer.step - 1])}</div>
        ${body}
      </div>`;
  }
```

- [ ] **Step 2: Add renderDrawerStep1()**

Insert immediately after `renderDrawer()`:

```typescript
  function renderDrawerStep1(connection: Item | undefined, connector: Item | undefined): string {
    const { drawer } = uiState;
    const allConnectors = collection("connectors");
    const backendOptions = ((connector?.backendOptions ?? ["native"]) as string[]).filter(Boolean);
    const requiredFields = ((connector?.requiredFields ?? []) as Item[]).filter((f) => !f.secret);
    const authMode = String(connector?.authMode ?? "none");

    // Connector selector (add mode only)
    const connectorSelect = drawer.mode === "add"
      ? `<div class="wizard-field">
           <label>Connector</label>
           <select name="connectorId" data-control="drawer-connector">
             ${allConnectors.map((c) =>
               `<option value="${h(c.id)}" ${c.id === (connector?.id ?? "") ? "selected" : ""}>${h(c.name)}</option>`
             ).join("")}
           </select>
           <div style="margin-top:4px;font-size:.8rem;color:var(--muted)">Auth: ${h(authMode)}</div>
         </div>`
      : `<div style="font-size:.8rem;color:var(--muted);padding:4px 0">${h(connector?.name ?? "")} · ${h(authMode)}</div>`;

    const fields = requiredFields.map((field: Item) =>
      `<div class="wizard-field">
         <label>${h(field.label)}</label>
         <input name="config_${h(field.key)}" type="text" autocomplete="off"
                placeholder="${h(field.example ?? "")}"
                value="${h((connection?.configSummary as Record<string, string>)?.[String(field.key)] ?? "")}">
       </div>`
    ).join("");

    const skipAuth = authMode === "none";

    return `<form data-action="drawer-save-step1" class="wizard-body">
      ${connectorSelect}
      <div class="wizard-field">
        <label>Display name <span style="color:var(--danger)">*</span></label>
        <input name="displayName" required
               value="${h(connection?.displayName ?? "")}"
               placeholder="${h(connector?.name ?? "New connection")}">
      </div>
      <div class="wizard-field">
        <label>Backend type</label>
        <select name="backendType">
          ${backendOptions.map((b) =>
            `<option value="${h(b)}" ${b === (connection?.backendType ?? backendOptions[0]) ? "selected" : ""}>${h(b)}</option>`
          ).join("")}
        </select>
      </div>
      ${fields}
      <div class="wizard-footer" style="margin-top:auto;padding:14px 0 0;border-top:1px solid var(--line)">
        <button class="btn btn-primary" type="submit">${skipAuth ? "Next: Test →" : "Next: Auth →"}</button>
        <button class="btn" type="button" data-action="close-drawer">Cancel</button>
      </div>
    </form>`;
  }
```

- [ ] **Step 3: Inject renderDrawer() into renderBrands()**

In `renderBrands()`, find the closing return statement (around line 693). Replace:

```typescript
    return `${viewHeader("Brands", `${allBrands.length} brands, ${allRegions.length} regions.`)}
      <div class="grid-wide">
```

with:

```typescript
    return `${renderDrawer()}${viewHeader("Brands", `${allBrands.length} brands, ${allRegions.length} regions.`)}
      <div class="grid-wide">
```

- [ ] **Step 4: Build and check**

```bash
npm run typecheck && npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/admin/client-script.ts
git commit -m "feat(admin-ui): add renderDrawer() and renderDrawerStep1()"
```

---

### Task 3: renderDrawerStep2() — Auth step

**Files:**
- Modify: `src/admin/client-script.ts` — add `renderDrawerStep2()`

- [ ] **Step 1: Add renderDrawerStep2() after renderDrawerStep1()**

```typescript
  function renderDrawerStep2(connection: Item | undefined, connector: Item | undefined): string {
    const authMode = String(connector?.authMode ?? "none");
    const connStatus = String(connection?.status ?? "needs_config");
    const isConnected = connStatus === "connected";
    const connectorName = h(connector?.name ?? "");

    // OAuth connectors (Shopify, Google, etc.)
    if (authMode === "oauth") {
      const statusHtml = isConnected
        ? `<div class="oauth-status oauth-status--connected">
             <strong style="color:var(--success)">✓ Connected</strong>
             <div style="font-size:.8rem;margin-top:2px;color:var(--muted)">
               ${h((connection?.configSummary as Record<string, string>)?.credential_ref ?? "Credentials stored")}
             </div>
           </div>`
        : `<div class="oauth-status oauth-status--disconnected">
             <strong style="color:var(--muted)">Not authorised</strong>
             <div style="font-size:.8rem;margin-top:2px">Connect your ${connectorName} account to proceed.</div>
           </div>`;

      // Determine OAuth start URL per connector slug
      const slug = String(connector?.slug ?? "");
      const oauthStartPath = slug.startsWith("google")
        ? "/admin/google-oauth/account/start"
        : slug === "shopify"
          ? "/admin/shopify-oauth/start"
          : null;

      const authoriseBtn = oauthStartPath
        ? `<button class="btn btn-primary" type="button"
                    data-action="drawer-oauth-start"
                    data-oauth-path="${h(oauthStartPath)}">
             ${isConnected ? "↺ Re-authorise with " + connectorName : "Authorise with " + connectorName}
           </button>`
        : `<div class="small muted">OAuth start not configured for this connector.</div>`;

      return `<div class="wizard-body">
        ${statusHtml}
        ${authoriseBtn}
        <div class="wizard-footer" style="margin-top:auto;padding:14px 0 0;border-top:1px solid var(--line)">
          ${isConnected
            ? `<button class="btn btn-primary" type="button" data-action="drawer-next">Next: Test →</button>`
            : `<button class="btn" type="button" data-action="drawer-next" title="Skip and keep existing auth">Skip →</button>`
          }
          <button class="btn" type="button" data-action="drawer-back">← Back</button>
        </div>
      </div>`;
    }

    // API key / service account — secret fields
    const secretFields = ((connector?.requiredFields ?? []) as Item[]).filter((f) => f.secret);
    const serviceAccount = authMode === "service_account";

    if (serviceAccount || secretFields.length > 0) {
      const inputs = serviceAccount
        ? `<div class="wizard-field">
             <label>Service account JSON <span style="color:var(--danger)">*</span></label>
             <textarea name="config_service_account_json" rows="6"
                       placeholder='{"type":"service_account","project_id":"..."}'
                       autocomplete="new-password"></textarea>
           </div>`
        : secretFields.map((field: Item) =>
            `<div class="wizard-field">
               <label>${h(field.label)} <span style="color:var(--danger)">*</span></label>
               <input name="config_${h(field.key)}" type="password" autocomplete="new-password"
                      placeholder="${h(field.example ?? "")}"
                      value="">
             </div>`
          ).join("");

      const hasExisting = isConnected;
      return `<form data-action="drawer-save-step2" class="wizard-body">
        ${hasExisting
          ? `<div class="test-result test-result--passed" style="margin-bottom:4px">✓ Credentials already set. Leave fields blank to keep existing.</div>`
          : ""}
        ${inputs}
        <div class="wizard-footer" style="margin-top:auto;padding:14px 0 0;border-top:1px solid var(--line)">
          <button class="btn btn-primary" type="submit">Next: Test →</button>
          <button class="btn" type="button" data-action="drawer-back">← Back</button>
        </div>
      </form>`;
    }

    // none — should not be reached (step is skipped), but handle gracefully
    return `<div class="wizard-body">
      <div class="small muted">No authentication required for this connector.</div>
      <div class="wizard-footer" style="padding:14px 0 0;border-top:1px solid var(--line)">
        <button class="btn btn-primary" type="button" data-action="drawer-next">Next: Test →</button>
        <button class="btn" type="button" data-action="drawer-back">← Back</button>
      </div>
    </div>`;
  }
```

- [ ] **Step 2: Build**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/admin/client-script.ts
git commit -m "feat(admin-ui): add renderDrawerStep2() auth step"
```

---

### Task 4: renderDrawerStep3() — Test & Save

**Files:**
- Modify: `src/admin/client-script.ts` — add `renderDrawerStep3()`

- [ ] **Step 1: Add renderDrawerStep3() after renderDrawerStep2()**

```typescript
  function renderDrawerStep3(connection: Item | undefined): string {
    const { drawer } = uiState;
    const connector = connection ? connectorFor(connection) : undefined;

    const testPanel = (() => {
      switch (drawer.testState) {
        case "running":
          return `<div class="test-result test-result--running">
            <span style="display:inline-block;animation:spin 1s linear infinite">⟳</span>
            Testing connection…
          </div>`;
        case "passed":
          return `<div class="test-result test-result--passed">
            <strong>✓ Connection test passed</strong>
            ${drawer.testDetail ? `<div style="margin-top:4px;font-size:.8rem">${h(drawer.testDetail)}</div>` : ""}
          </div>`;
        case "failed":
          return `<div class="test-result test-result--failed">
            <strong>✗ Connection test failed</strong>
            ${drawer.testDetail ? `<div style="margin-top:4px;font-size:.8rem">${h(drawer.testDetail)}</div>` : ""}
          </div>`;
        default:
          return drawer.mode === "add"
            ? `<div class="test-result test-result--running">Test will run after saving.</div>`
            : `<div class="test-result test-result--running">Ready to test.</div>`;
      }
    })();

    const summary = connection
      ? `<div style="background:var(--panel-soft);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:.85rem">
           <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line)">
             <span style="color:var(--muted)">Connection</span>
             <strong>${h(connection.displayName)}</strong>
           </div>
           <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line)">
             <span style="color:var(--muted)">Connector</span>
             <span>${h(connector?.name ?? connection.connectorId)}</span>
           </div>
           <div style="display:flex;justify-content:space-between;padding:3px 0">
             <span style="color:var(--muted)">Status</span>
             ${statusBadge(connection.status)}
           </div>
         </div>`
      : "";

    const saveBtn = drawer.testState === "failed"
      ? `<button class="btn" type="button" data-action="drawer-save"
                 style="background:var(--warning);color:#fff;border-color:var(--warning)"
                 title="Connection will be saved with status needs_reconnect">
           Save anyway
         </button>`
      : `<button class="btn btn-primary" type="button" data-action="drawer-save">Save connection</button>`;

    const retestBtn = connection && drawer.mode === "edit"
      ? `<button class="btn" type="button" data-action="drawer-test"
                 data-connection-id="${h(connection.id)}"
                 ${drawer.testState === "running" ? "disabled" : ""}>
           ${drawer.testState === "failed" ? "Retry test" : "Run test"}
         </button>`
      : "";

    return `<div class="wizard-body">
      ${testPanel}
      ${summary}
      <div class="wizard-footer" style="margin-top:auto;padding:14px 0 0;border-top:1px solid var(--line)">
        ${saveBtn}
        ${retestBtn}
        <button class="btn" type="button" data-action="drawer-back">← Back</button>
      </div>
    </div>`;
  }
```

- [ ] **Step 2: Add spin keyframe to styles.ts**

At the end of the CSS string (before closing backtick), add:

```css
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: Build**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/admin/client-script.ts src/admin/styles.ts
git commit -m "feat(admin-ui): add renderDrawerStep3() test and save step"
```

---

### Task 5: Action handlers — open, close, next, back, connector change

**Files:**
- Modify: `src/admin/client-script.ts` — `handleButton()` and `document.addEventListener("change")`

- [ ] **Step 1: Add open/close/nav handlers to handleButton()**

In `handleButton()`, replace the `select-connection` block (around line 1183):

```typescript
    if (action === "select-connection" && button.dataset.connectionId) {
      uiState.selectedConnectionId = button.dataset.connectionId;
      render();
      return;
    }
```

with the drawer open/close/navigation handlers:

```typescript
    if (action === "open-edit-drawer" && button.dataset.connectionId) {
      uiState.drawer = {
        open: true,
        mode: "edit",
        connectionId: button.dataset.connectionId,
        step: 1,
        testState: "idle",
        testDetail: null,
        pendingConnectorId: null
      };
      render();
      return;
    }
    if (action === "open-add-drawer") {
      const firstConnector = collection("connectors")[0];
      uiState.drawer = {
        open: true,
        mode: "add",
        connectionId: null,
        step: 1,
        testState: "idle",
        testDetail: null,
        pendingConnectorId: firstConnector?.id ?? null
      };
      render();
      return;
    }
    if (action === "close-drawer") {
      uiState.drawer.open = false;
      render();
      return;
    }
    if (action === "drawer-next") {
      const { drawer } = uiState;
      const connection = drawer.connectionId ? byId("connections", drawer.connectionId) : undefined;
      const connector = connection
        ? connectorFor(connection)
        : drawer.pendingConnectorId
          ? byId("connectors", drawer.pendingConnectorId)
          : collection("connectors")[0];
      const authMode = String(connector?.authMode ?? "none");
      // Step 1 → 2: skip step 2 if authMode is "none"
      if (drawer.step === 1) {
        drawer.step = authMode === "none" ? 3 : 2;
        if (drawer.step === 3 && drawer.mode === "edit" && drawer.connectionId) {
          void triggerDrawerTest(drawer.connectionId);
        }
      } else if (drawer.step === 2) {
        drawer.step = 3;
        if (drawer.mode === "edit" && drawer.connectionId) {
          void triggerDrawerTest(drawer.connectionId);
        }
      }
      render();
      return;
    }
    if (action === "drawer-back") {
      const { drawer } = uiState;
      const connection = drawer.connectionId ? byId("connections", drawer.connectionId) : undefined;
      const connector = connection
        ? connectorFor(connection)
        : drawer.pendingConnectorId
          ? byId("connectors", drawer.pendingConnectorId)
          : collection("connectors")[0];
      const authMode = String(connector?.authMode ?? "none");
      if (drawer.step === 3) {
        drawer.step = authMode === "none" ? 1 : 2;
        drawer.testState = "idle";
        drawer.testDetail = null;
      } else if (drawer.step === 2) {
        drawer.step = 1;
      }
      render();
      return;
    }
    if (action === "drawer-oauth-start" && button.dataset.oauthPath) {
      const { drawer } = uiState;
      // Preserve drawer state across OAuth redirect
      sessionStorage.setItem("drawerReturn", JSON.stringify({
        mode: drawer.mode,
        connectionId: drawer.connectionId,
        pendingConnectorId: drawer.pendingConnectorId,
        step: 2
      }));
      const response = await postJson(button.dataset.oauthPath, {});
      if (response.redirectUrl) {
        window.location.href = response.redirectUrl as string;
      }
      return;
    }
```

- [ ] **Step 2: Add drawer-connector change handler**

In `document.addEventListener("change", ...)`, after the `connector` control block (around line 1313), add:

```typescript
    if (control === "drawer-connector") {
      uiState.drawer.pendingConnectorId = target.value;
      render();
    }
```

- [ ] **Step 3: Add OAuth return check on page load**

In `refreshState()` (or wherever the initial load happens — find `void refreshState().catch`), add before the existing call a session-storage restore. Find `refreshState` function and add at the start of its body after `applyState`:

Find the `async function refreshState()` (around line 975–985) and after `applyState(result)` or after `ensureSelections()`, add:

```typescript
    // Restore drawer state if returning from OAuth redirect
    const drawerReturn = sessionStorage.getItem("drawerReturn");
    if (drawerReturn) {
      try {
        const saved = JSON.parse(drawerReturn) as Partial<DrawerState>;
        sessionStorage.removeItem("drawerReturn");
        uiState.drawer = {
          open: true,
          mode: saved.mode ?? "edit",
          connectionId: saved.connectionId ?? null,
          step: (saved.step as 1 | 2 | 3) ?? 2,
          testState: "idle",
          testDetail: null,
          pendingConnectorId: saved.pendingConnectorId ?? null
        };
      } catch { /* ignore malformed */ }
    }
```

- [ ] **Step 4: Build**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/admin/client-script.ts
git commit -m "feat(admin-ui): drawer open/close/nav action handlers and OAuth return restore"
```

---

### Task 6: drawer-test and drawer-save handlers

**Files:**
- Modify: `src/admin/client-script.ts` — add `triggerDrawerTest()`, `drawer-test` and `drawer-save` handlers

- [ ] **Step 1: Add triggerDrawerTest() helper**

Add after `renderDrawerStep3()` (before `renderBrandList()`):

```typescript
  async function triggerDrawerTest(connectionId: string): Promise<void> {
    uiState.drawer.testState = "running";
    uiState.drawer.testDetail = null;
    render();
    try {
      const result = await postJson(`/admin/api/connections/${encodeURIComponent(connectionId)}/test`);
      applyState(result.state);
      const connection = byId("connections", connectionId);
      uiState.drawer.testState = connection?.status === "connected" ? "passed" : "failed";
      uiState.drawer.testDetail = connection?.lastError
        ? String(connection.lastError)
        : connection?.status === "connected"
          ? `Status: connected · tested ${connection?.lastTestedAt ? formatDate(connection.lastTestedAt) : "just now"}`
          : "Test did not return a connected status.";
    } catch (err) {
      uiState.drawer.testState = "failed";
      uiState.drawer.testDetail = err instanceof Error ? err.message : String(err);
    }
    render();
  }
```

- [ ] **Step 2: Add drawer-test handler to handleButton()**

After the `drawer-oauth-start` block, add:

```typescript
    if (action === "drawer-test" && button.dataset.connectionId) {
      void triggerDrawerTest(button.dataset.connectionId);
      return;
    }
```

- [ ] **Step 3: Add drawer-save handler to handleButton()**

After `drawer-test`, add:

```typescript
    if (action === "drawer-save") {
      const { drawer } = uiState;
      if (drawer.mode === "add") {
        // For add mode, save was already handled by drawer-save-step1 form submit
        // This button closes the drawer after the connection was created
        uiState.drawer.open = false;
        render();
        return;
      }
      // Edit mode: save current config (already done via form submit in step 1)
      // Just close the drawer
      uiState.drawer.open = false;
      render();
      return;
    }
```

- [ ] **Step 4: Add drawer-save-step1 form submit handler to handleSubmit()**

In `handleSubmit()`, after the `update-connection` block (around line 1165), add:

```typescript
    if (action === "drawer-save-step1") {
      const { drawer } = uiState;
      const connection = drawer.connectionId ? byId("connections", drawer.connectionId) : undefined;
      const connector = drawer.pendingConnectorId
        ? byId("connectors", drawer.pendingConnectorId)
        : connection ? connectorFor(connection) : collection("connectors")[0];
      const authMode = String(connector?.authMode ?? "none");

      if (drawer.mode === "edit" && drawer.connectionId) {
        // Persist step-1 fields for edit mode
        const configFields: Record<string, string> = {};
        const requiredFields = ((connector?.requiredFields ?? []) as Item[]).filter((f) => !f.secret);
        for (const f of requiredFields) {
          const val = field(form, `config_${String(f.key)}`);
          if (val) configFields[String(f.key)] = val;
        }
        const result = await patchJson(`/admin/api/connections/${encodeURIComponent(drawer.connectionId)}`, {
          displayName: field(form, "displayName"),
          backendType: field(form, "backendType"),
          configSummary: { ...((connection?.configSummary as Record<string, string>) ?? {}), ...configFields }
        });
        applyState(result.state);
        uiState.drawer.connectionId = result.connection?.id ?? drawer.connectionId;
      } else if (drawer.mode === "add") {
        // Store step-1 data; don't create yet (need auth first for oauth connectors)
        // For non-oauth connectors, create connection now
        if (authMode !== "oauth") {
          const selectedRegion = selectedRegionForBrand(brandRegions(uiState.selectedBrandId));
          if (!uiState.selectedBrandId || !selectedRegion) {
            throw new Error("Select a brand and region before adding a connection.");
          }
          const configFields: Record<string, string> = {};
          const requiredFields = ((connector?.requiredFields ?? []) as Item[]).filter((f) => !f.secret);
          for (const f of requiredFields) {
            const val = field(form, `config_${String(f.key)}`);
            if (val) configFields[String(f.key)] = val;
          }
          const result = await postJson(`/admin/api/regions/${encodeURIComponent(selectedRegion.id)}/connections`, {
            brandId: uiState.selectedBrandId,
            connectorId: field(form, "connectorId") ?? drawer.pendingConnectorId,
            backendType: field(form, "backendType"),
            displayName: field(form, "displayName"),
            configSummary: configFields
          });
          applyState(result.state);
          uiState.drawer.connectionId = result.connection?.id ?? null;
          uiState.drawer.mode = "edit";
        }
      }

      // Advance step
      drawer.step = authMode === "none" ? 3 : 2;
      if (drawer.step === 3 && drawer.connectionId) {
        void triggerDrawerTest(drawer.connectionId);
      }
      render();
      return;
    }
    if (action === "drawer-save-step2") {
      // Secret fields for api_key / service_account connectors
      const { drawer } = uiState;
      if (drawer.connectionId) {
        const connection = byId("connections", drawer.connectionId);
        const connector = connection ? connectorFor(connection) : undefined;
        const secretFields = ((connector?.requiredFields ?? []) as Item[]).filter((f) => f.secret);
        const configUpdate: Record<string, string> = {};
        for (const f of secretFields) {
          const val = field(form, `config_${String(f.key)}`);
          if (val) configUpdate[String(f.key)] = val;
        }
        if (Object.keys(configUpdate).length > 0) {
          const result = await patchJson(`/admin/api/connections/${encodeURIComponent(drawer.connectionId)}`, {
            configSummary: { ...((connection?.configSummary as Record<string, string>) ?? {}), ...configUpdate }
          });
          applyState(result.state);
        }
      }
      drawer.step = 3;
      if (drawer.connectionId) {
        void triggerDrawerTest(drawer.connectionId);
      }
      render();
      return;
    }
```

- [ ] **Step 5: Build**

```bash
npm run typecheck && npm run build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/admin/client-script.ts
git commit -m "feat(admin-ui): drawer-test, drawer-save, step form submit handlers"
```

---

### Task 7: Remove old patterns and update connection rows

**Files:**
- Modify: `src/admin/client-script.ts` — remove `selectedConnectionId` remnants, update `connectionRows()`, update `renderBrands()`, remove `renderConnectionEditor()` / `renderConnectorSetup()`

- [ ] **Step 1: Update connectionRows() — remove Test button, change Edit to open-edit-drawer**

Replace `connectionRows()` (lines 282–305):

```typescript
  function connectionRows(connections: Item[]): string {
    if (!connections.length) {
      return `<tr><td colspan="6" class="muted">No connections.</td></tr>`;
    }
    return connections
      .map((connection) => {
        const connector = connectorFor(connection);
        const region = byId("regions", connection.regionId);
        const isActive = connection.id === uiState.drawer.connectionId && uiState.drawer.open;
        return `<tr class="${isActive ? "drawer-active" : ""}">
          <td><strong>${h(connection.displayName)}</strong></td>
          <td>${h(connector?.name ?? connection.connectorId)}</td>
          <td>${h(region?.code ?? connection.regionId)}</td>
          <td>${h(connection.backendType)}</td>
          <td>${statusBadge(connection.status)}</td>
          <td>${sourceBadge("connection", connection.id)}</td>
          <td class="button-row">
            <button class="btn" type="button"
                    data-action="open-edit-drawer"
                    data-connection-id="${h(connection.id)}">Edit</button>
          </td>
        </tr>`;
      })
      .join("");
  }
```

- [ ] **Step 2: Update "＋ Add connection" in renderBrands()**

Find the `<details>` block for Add connection (around line 671–677) and replace the entire `<details>...</details>` element:

```typescript
              <button class="btn btn-primary btn-sm" type="button"
                      data-action="open-add-drawer"
                      style="font-size:.8rem;padding:4px 10px">＋ Add connection</button>
```

- [ ] **Step 3: Remove edit-block div from renderBrands()**

Find and remove this line (around line 688):

```typescript
          ${selectedConnection ? `<div class="edit-block">${renderConnectionEditor(selectedConnection)}</div>` : ""}
```

Replace with nothing (empty string or just remove the line).

Also update the `<thead>` colspan for the connections table — it was 7 columns (with Test button), now it's 7 but Test is gone. The `connectionRows` no-connections row colspan changed from 7 to 6 already in Step 1; verify the `<thead>` matches:

```html
<thead><tr><th>Connection</th><th>Connector</th><th>Rgn</th><th>Backend</th><th>Status</th><th></th><th></th></tr></thead>
```

- [ ] **Step 4: Remove selectedConnectionForRegion usage from renderBrands()**

In `renderBrands()`, remove the line:

```typescript
    const selectedConnection = selectedConnectionForRegion(connections);
```

This variable is no longer used after removing `edit-block`.

- [ ] **Step 5: Remove renderConnectionEditor() and renderConnectorSetup()**

Delete both functions entirely (lines ~483–516 and ~554–606). They are fully replaced by the drawer.

- [ ] **Step 6: Remove test-connection handler from handleButton()**

Remove the `test-connection` block (around lines 1188–1194):

```typescript
    if (action === "test-connection" && button.dataset.connectionId) {
      const result = await postJson(`/admin/api/connections/${encodeURIComponent(button.dataset.connectionId)}/test`);
      applyState(result.state);
      uiState.selectedConnectionId = result.connection?.id ?? button.dataset.connectionId;
      render();
      return;
    }
```

- [ ] **Step 7: Remove remaining selectedConnectionId references**

Search for any remaining `selectedConnectionId` in the file and remove them. Common locations: `uiState.selectedConnectionId = result.connection?.id ?? ...` in the `create-connection` and `update-connection` handlers. Replace with nothing (the drawer's `connectionId` is set in the step handlers instead).

- [ ] **Step 8: Remove .edit-block CSS from styles.ts if present**

Search styles.ts for `.edit-block` and remove that rule block.

- [ ] **Step 9: Build and verify**

```bash
npm run typecheck && npm run build
```

Expected: clean with no references to `selectedConnectionId`, `renderConnectionEditor`, `renderConnectorSetup`.

- [ ] **Step 10: Commit**

```bash
git add src/admin/client-script.ts src/admin/styles.ts
git commit -m "feat(admin-ui): remove legacy edit-block/select-connection; connectionRows uses drawer"
```

---

### Task 8: Visual test end-to-end

**Files:** None — this is a manual verification task.

- [ ] **Step 1: Start the gateway**

```bash
node dist/index.js
# Expected: [gateway] brand=haverford listening on :3000
```

Open `http://localhost:3000/admin` → Brands.

- [ ] **Step 2: Verify Edit opens drawer**

Click "Edit" on any connection. Expected:
- Right-side drawer slides in
- Row highlights with left blue border
- Step 1 shows display name, backend type, connector-specific non-secret fields
- Step indicator shows step 1 active

- [ ] **Step 3: Verify step navigation**

Click "Next: Auth →". Expected: step 2 renders with correct auth mode for the connector.

For a connected connection: OAuth status shows "Connected" + re-authorise button + "Next: Test →" available immediately. Click Next. Expected: step 3 shows spinner then result.

- [ ] **Step 4: Verify Add Connection opens drawer**

Click "＋ Add connection" in the region strip. Expected:
- Drawer opens in add mode
- Connector selector shown at top of step 1
- Fields update when connector changes

- [ ] **Step 5: Verify close behaviour**

Click the ✕ button or the overlay. Expected: drawer closes, row highlight gone.

- [ ] **Step 6: Verify test states**

Edit a connected connection → next to step 3. Expected: auto-fires test, shows spinner → passes → "Save connection" button green.

Edit a connection that will fail → next to step 3. Expected: shows red panel + "Save anyway" + "Retry test".

- [ ] **Step 7: Commit any fixes found during testing**

```bash
git add src/admin/client-script.ts src/admin/styles.ts
git commit -m "fix(admin-ui): <describe what you fixed>"
```

---

## Self-Review Notes

- **Spec coverage:** All sections covered. Legacy Dev API note → handled by Step 3 task 3 (connected status shows "Next: Test →" without forcing re-auth). OAuth return restore → Task 5 Step 3.
- **Type consistency:** `DrawerState` defined in Task 1; used in all tasks. `drawer.connectionId` vs `selectedConnectionId` — fully replaced in Task 7.
- **Placeholder check:** All code blocks are complete. No TBDs.
- **One known gap:** The `ensureSelections()` function still calls `selectedConnectionForRegion()` (line 210) — after Task 7 Step 4 strips that function down, update `ensureSelections()` to remove its call too:

```typescript
  function ensureSelections(): void {
    const brands = collection("brands");
    const connectors = collection("connectors");
    if (!brands.some((brand) => brand.id === uiState.selectedBrandId)) {
      selectBrand(brands[0]?.id ?? null);
    } else {
      selectedRegionForBrand(brandRegions(uiState.selectedBrandId));
    }
    if (!connectors.some((connector) => connector.id === uiState.selectedConnectorId)) {
      uiState.selectedConnectorId = connectors[0]?.id ?? null;
    }
  }
```

Add this to Task 7 Step 7 before committing.
