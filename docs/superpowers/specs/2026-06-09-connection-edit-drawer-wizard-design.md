# Connection Edit Drawer Wizard — Design Spec

**Status:** approved
**Date:** 2026-06-09
**Scope:** `src/admin/client-script.ts`, `src/admin/styles.ts` only — no backend changes

## Context

The Brands → Regions → Connections view currently renders a connection edit form at the bottom of the page (`edit-block` div, `selectedConnectionId` state). This is confusing — clicking Edit on a row scrolls down to a separate form that isn't visually tied to the row. The "Add connection" flow uses a `<details>` dropdown anchored to the region strip, which is cramped and separate from the edit flow.

This spec replaces both flows with a single **right-side drawer wizard**: a panel that slides in from the right edge, keeps the connection table visible, and steps the admin through Configure → Auth → Test & Save in a structured sequence.

## Drawer Layout

A fixed panel slides in from the right (400px wide, full admin content height). The rest of the page dims slightly and narrows to accommodate it. Clicking outside the drawer or pressing Escape closes it (prompting confirmation if there are unsaved changes).

The active connection row in the table highlights with a left blue border while the drawer is open, visually tying the form to the row being edited.

## Wizard Steps

### Step 1 — Configure

**Both `edit` and `add` modes.**

- Display name (text input, required)
- Backend type (select, from `connector.backendOptions`)
- **Add mode only:** Connector selector at the top (changing it re-renders the step)
- Connector-specific **non-secret** required fields — `connector.requiredFields` where `field.secret !== true` (e.g. shop domain, GA4 property ID, site URL). Rendered as labelled text inputs with `field.example` as placeholder.
- Read-only connector name + auth mode badge (informational)

"Next: Auth →" advances. If the connector's `authMode` is `"none"`, step 2 is skipped and the wizard jumps to step 3 automatically.

### Step 2 — Auth

**Adapts to `connector.authMode`:**

**`oauth`:**
- Shows current OAuth status pulled from connection state (connected / needs_reconnect / error)
- If connected: green status chip with account email + expiry, plus "↺ Re-authorise" secondary button
- If not connected: primary "Authorise with [Connector Name]" button
- Authorise button for Google routes to `POST /admin/google-oauth/account/start` (account-level flow from #32, not per-brand). For Shopify routes to `POST /admin/shopify-oauth/start`. OAuth redirect takes over; drawer state is preserved in `sessionStorage` so it can reopen on return.
- "Next: Test →" is available immediately if status is `connected`; hidden until OAuth completes otherwise.

**`api_key`:**
- Secret required fields from `connector.requiredFields` where `field.secret === true`, rendered as `type="password"` inputs with `autocomplete="new-password"`
- "Next: Test →" advances

**`service_account`:**
- Single `<textarea>` for the service account JSON blob
- "Next: Test →" advances

**`none`:** Skipped entirely (step 1 "Next" goes directly to step 3).

### Step 3 — Test & Save

Auto-fires the test connection call (`POST /admin/api/connections/:id/test` for edit; deferred to post-save for add) on arrival. Four states:

| State | UI |
|---|---|
| `idle` / loading | Spinner + "Testing connection…" |
| `passed` | Green panel with test detail (response time, account info) + **"Save connection"** primary button |
| `failed` | Red panel with error detail + **"Save anyway"** (orange/warning) + "Retry test" secondary |
| `skipped` (add mode pre-save) | Info panel "Test will run after saving" + "Save connection" primary. After save succeeds, the drawer switches to `edit` mode for the newly created connection and auto-runs the test. |

**Save is always available** — never blocked. If the test failed, the button reads "Save anyway" with a warning colour and tooltip "Connection will be saved with status 'needs_reconnect'". After save the connection status in the table reflects the test result.

Summary card: connection name, connector, auth status (OAuth ✓ / API key set / etc.), backend.

Back button is always available on steps 2 and 3 to return to the previous step.

## State

Add `drawer` to `uiState` (alongside `selectedBrandId`, `selectedConnectionId`, etc.):

```typescript
drawer: {
  open: boolean;
  mode: "edit" | "add";
  connectionId: string | null;   // edit mode: target connection id
  step: 1 | 2 | 3;
  testState: "idle" | "running" | "passed" | "failed";
  testDetail: string | null;
  pendingConnectorId: string | null;  // add mode: connector being configured
}
```

`selectedConnectionId` is removed — the drawer state replaces it entirely.

## Triggers

| Action | Was | Now |
|---|---|---|
| Click "Edit" on connection row | `select-connection` → sets `selectedConnectionId`, scrolls to `edit-block` | `open-edit-drawer` → opens drawer at step 1 for that connection |
| Click "＋ Add connection" | `<details>` dropdown → `renderConnectorSetup()` inline panel | `open-add-drawer` → opens drawer at step 1 (add mode) |
| Click "Test" in connection row | Fires test in place | Removed — testing is inside the wizard |

The "Test" button in connection rows is removed; the status badge and last-tested time remain as read-only info.

## Files Changed

### `src/admin/client-script.ts`

- **Remove:** `selectedConnectionId` from `uiState`; `select-connection` action handler; `edit-block` div in `renderBrands()`; `renderConnectionEditor()` function
- **Remove:** `<details>` "＋ Add connection" dropdown and `renderConnectorSetup()` function
- **Remove:** "Test" button from `connectionRows()` (keep status badge)
- **Add:** `drawer` to `uiState` with initial `{ open: false, mode: "edit", connectionId: null, step: 1, testState: "idle", testDetail: null, pendingConnectorId: null }`
- **Add:** `renderDrawer()` — returns the full drawer HTML (empty string when `!drawer.open`)
- **Add:** `renderDrawerStep1()`, `renderDrawerStep2()`, `renderDrawerStep3()` — step content functions
- **Add:** `open-edit-drawer`, `open-add-drawer`, `close-drawer`, `drawer-next`, `drawer-back`, `drawer-test`, `drawer-save` action handlers
- **Update:** `connectionRows()` — "Edit" button triggers `open-edit-drawer`; active row gets `.drawer-active` class
- **Update:** Region strip "＋ Add connection" becomes a plain button triggering `open-add-drawer`
- **Update:** `renderBrands()` — injects `${renderDrawer()}` at root level (outside the grid, positioned fixed)

### `src/admin/styles.ts`

- Add `.drawer-overlay` — fixed full-screen dim layer (rgba black, low opacity), `z-index: 40`
- Add `.drawer` — fixed right panel, 400px wide, full viewport height, white background, `z-index: 50`, slide-in CSS transition (`transform: translateX(100%)` → `translateX(0)`)
- Add `.drawer-active` — left border highlight on connection table rows (`border-left: 3px solid var(--primary)`)
- Add `.wizard-steps` — step progress indicator (3 segments)
- Add `.wizard-step-content` — padding/spacing for step body
- Add `.test-result` variants: `.test-result--passed`, `.test-result--failed`, `.test-result--running`

## OAuth Return Flow

When the admin clicks "Authorise with Google/Shopify", the page navigates away. On OAuth callback the gateway currently returns `{ credential, bindings }` or `{ account }` as JSON. To re-open the drawer after return, the admin page should:

1. Before navigating: write `{ brandId, regionId, connectionId, step: 2 }` to `sessionStorage["drawerReturn"]`
2. On page load: check `sessionStorage["drawerReturn"]`; if present, re-open the drawer at the stored state and clear the key

This is a best-effort restoration — the drawer opens in the right place without requiring a separate callback UI.

## Out of Scope

- Mobile responsive layout (admin is desktop-only today)
- Drag-to-resize the drawer
- Multi-connection bulk edit
- Any backend API changes — all existing endpoints (`update-connection`, `create-connection`, `test-connection`) are reused as-is
