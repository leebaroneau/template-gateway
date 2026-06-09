function adminClientApp() {
  type Item = Record<string, any>;
  type SecretReveal = {
    action: string;
    clientId: string;
    keyId?: string;
    clientName: string;
    keyLabel: string;
    preview?: string;
    fingerprint?: string;
    secret: string;
  };
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
  const ACCESS_SCOPES = [
    "brands.read",
    "regions.read",
    "connectors.read",
    "connections.read",
    "mcp.read",
    "api_clients.read",
    "api_clients.write",
    "audit.read",
    "apps.read",
    "apps.write"
  ];

  if (!root || !errorPanel) {
    return;
  }
  const appRoot = root;
  const errors = errorPanel;

  function h(value: unknown): string {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const replacements: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return replacements[char] ?? char;
    });
  }

  function safeClass(value: unknown): string {
    return String(value ?? "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_");
  }

  function showError(message: string): void {
    errors.textContent = message;
    errors.hidden = false;
  }

  function clearError(): void {
    errors.textContent = "";
    errors.hidden = true;
  }

  function statusBadge(status: unknown): string {
    const raw = String(status ?? "unknown");
    return `<span class="badge ${safeClass(raw)}">${h(raw.replace(/_/g, " "))}</span>`;
  }

  function entityMeta(entityType: string, entityId: unknown): Item | undefined {
    const meta = Array.isArray(uiState.data?.entityMeta) ? uiState.data.entityMeta : [];
    return meta.find((item: Item) => item.entityType === entityType && item.entityId === entityId);
  }

  function sourceBadge(entityType: string, entityId: unknown): string {
    const meta = entityMeta(entityType, entityId);
    if (!meta) {
      return "";
    }
    const overrideFields = Array.isArray(meta.overrideFields) ? meta.overrideFields : [];
    const overrideTitle = overrideFields.length ? ` title="Override fields: ${h(overrideFields.join(", "))}"` : "";
    const sourceClass = safeClass(meta.source ?? "source");
    return `<span class="source-row">
      <span class="source-chip ${sourceClass}">${h(meta.sourceLabel ?? meta.source ?? "Source")}</span>
      ${meta.hasOverride ? `<span class="source-chip override"${overrideTitle}>Override</span>` : ""}
    </span>`;
  }

  function canReset(entityType: string, entityId: unknown): boolean {
    return entityMeta(entityType, entityId)?.hasOverride === true;
  }

  function resetButton(entityType: string, entityId: unknown): string {
    if (!canReset(entityType, entityId)) {
      return "";
    }
    return `<button class="btn btn-danger btn-reset" type="button" data-action="reset-entity" data-entity-type="${h(entityType)}" data-entity-id="${h(entityId)}">Reset overlay</button>`;
  }

  function chips(values: unknown[]): string {
    if (!values.length) {
      return `<span class="muted small">None</span>`;
    }
    return `<div class="chip-row">${values.map((value) => `<span class="chip">${h(value)}</span>`).join("")}</div>`;
  }

  function formatDate(value: unknown): string {
    if (!value) {
      return "Never";
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString();
  }

  function formatPercent(value: unknown): string {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "0.0%";
    }
    return `${(number * 100).toFixed(1)}%`;
  }

  function formatCount(value: unknown): string {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "0";
    }
    return number.toLocaleString();
  }

  function collection(name: string): Item[] {
    return Array.isArray(uiState.data?.[name]) ? uiState.data[name] : [];
  }

  function byId(name: string, id: unknown): Item | undefined {
    return collection(name).find((item) => item.id === id);
  }

  function connectorFor(connection: Item): Item | undefined {
    return byId("connectors", connection.connectorId);
  }

  function brandRegions(brandId: unknown): Item[] {
    return collection("regions").filter((region) => region.brandId === brandId);
  }

  function selectedRegionForBrand(regions: Item[]): Item | undefined {
    const selectedRegion = regions.find((region) => region.id === uiState.selectedRegionId);
    if (selectedRegion) {
      return selectedRegion;
    }
    const fallbackRegion = regions[0];
    uiState.selectedRegionId = fallbackRegion?.id ?? null;
    return fallbackRegion;
  }

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

  function applyState(nextState: Item): void {
    uiState.data = nextState;
    ensureSelections();
  }

  async function requestJson(path: string, init: RequestInit = {}): Promise<Item> {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Accept: "application/json"
      }
    });
    const text = await response.text();
    let payload: Item = {};
    if (text) {
      try {
        payload = JSON.parse(text) as Item;
      } catch {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      throw new Error(String(payload.error ?? `Request failed with ${response.status}`));
    }
    return payload;
  }

  async function postJson(path: string, body: Item = {}): Promise<Item> {
    return requestJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function patchJson(path: string, body: Item = {}): Promise<Item> {
    return requestJson(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function refreshState(): Promise<void> {
    clearError();
    const state = await requestJson("/admin/api/state");
    applyState(state);
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
    render();
  }

  function viewHeader(title: string, subtitle: string, accessory = ""): string {
    return `<div class="view-header">
      <div>
        <h2>${h(title)}</h2>
        <p>${h(subtitle)}</p>
      </div>
      ${accessory}
    </div>`;
  }

  function metric(label: string, value: unknown): string {
    return `<div class="metric"><span>${h(label)}</span><strong>${h(value)}</strong></div>`;
  }

  function connectionRows(connections: Item[]): string {
    if (!connections.length) {
      return `<tr><td colspan="7" class="muted">No connections.</td></tr>`;
    }
    return connections
      .map((connection) => {
        const connector = connectorFor(connection);
        const region = byId("regions", connection.regionId);
        const isSelected = connection.id === uiState.drawer.connectionId && uiState.drawer.open;
        return `<tr class="${isSelected ? "is-selected" : ""}">
          <td><strong>${h(connection.displayName)}</strong></td>
          <td>${h(connector?.name ?? connection.connectorId)}</td>
          <td>${h(region?.code ?? connection.regionId)}</td>
          <td>${h(connection.backendType)}</td>
          <td>${statusBadge(connection.status)}</td>
          <td>${sourceBadge("connection", connection.id)}</td>
          <td class="button-row">
            <button class="btn" type="button" data-action="select-connection" data-connection-id="${h(connection.id)}">${isSelected ? "Selected" : "Edit"}</button>
            <button class="btn" type="button" data-action="test-connection" data-connection-id="${h(connection.id)}">Test</button>
          </td>
        </tr>`;
      })
      .join("");
  }

  function auditRows(events: Item[]): string {
    if (!events.length) {
      return `<tr><td colspan="4" class="muted">No audit events.</td></tr>`;
    }
    return events
      .map(
        (event) => `<tr>
          <td>${h(formatDate(event.timestamp))}</td>
          <td>${h(event.action)}</td>
          <td>${h(event.detail)}</td>
          <td>${h(event.actor)}</td>
        </tr>`
      )
      .join("");
  }

  function renderOverview(): string {
    const brands = collection("brands");
    const regions = collection("regions");
    const connectors = collection("connectors");
    const connections = collection("connections");
    const activeKeys = collection("apiClients").flatMap((client) => client.keys ?? []).filter((key) => key.status === "active");
    const issueCount = connections.filter((connection) => ["error", "needs_reconnect", "needs_config"].includes(connection.status)).length;
    const meta = collection("entityMeta");
    const firstSource = meta.length > 0 ? String((meta[0] as Item).source ?? "") : "";
    const backendLabel = firstSource === "gateway" ? "Gateway store" : firstSource === "dev_api" ? "Dev API" : "Fixture";
    const backendBadgeClass = firstSource === "gateway" ? "success" : firstSource === "dev_api" ? "info" : "info";
    const subtitle = firstSource === "gateway"
      ? "Live data from the gateway SQLite store. Seeded from Haverford Dev API."
      : firstSource === "dev_api"
      ? "Live data from Haverford Dev API."
      : "Fixture-backed local data.";
    return `${viewHeader("Overview", subtitle, `<span class="badge ${backendBadgeClass}">${h(backendLabel)}</span>`)}
      <div class="metrics-grid">
        ${metric("Brands", brands.length)}
        ${metric("Regions", regions.length)}
        ${metric("Connectors", connectors.length)}
        ${metric("Active keys", activeKeys.length)}
      </div>
      <div class="metrics-grid">
        ${metric("Connections", connections.length)}
        ${metric("Connected", connections.filter((connection) => connection.status === "connected").length)}
        ${metric("Needs attention", issueCount)}
        ${metric("Audit events", collection("auditEvents").length)}
      </div>
      <div class="grid-two">
        <section class="panel">
          <div class="panel-header">
            <div><h3>Connection lifecycle</h3><p>Recent configured integrations.</p></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Connector</th><th>Rgn</th><th>Status</th></tr></thead>
              <tbody>${connections.slice(0, 8).map((connection) => {
                const connector = connectorFor(connection);
                const region = byId("regions", connection.regionId);
                return `<tr>
                  <td><strong>${h(connection.displayName)}</strong></td>
                  <td class="small">${h(connector?.name ?? connection.connectorId)}</td>
                  <td class="small">${h(region?.code ?? connection.regionId)}</td>
                  <td>${statusBadge(connection.status)}</td>
                </tr>`;
              }).join("")}</tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div><h3>Audit</h3><p>Latest events.</p></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Action</th><th>Detail</th><th>Actor</th></tr></thead>
              <tbody>${auditRows(collection("auditEvents").slice(0, 8))}</tbody>
            </table>
          </div>
        </section>
      </div>`;
  }

  function optionsFor(items: Item[], selectedId: unknown, labelKey = "name"): string {
    return items
      .map((item) => `<option value="${h(item.id)}" ${item.id === selectedId ? "selected" : ""}>${h(item[labelKey] ?? item.id)}</option>`)
      .join("");
  }

  function valueOptions(values: string[], selectedValue: unknown): string {
    return values.map((value) => `<option value="${h(value)}" ${value === selectedValue ? "selected" : ""}>${h(value.replace(/_/g, " "))}</option>`).join("");
  }

  function configSummaryText(configSummary: Item | undefined): string {
    return Object.entries(configSummary ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n");
  }

  function configSummaryFromText(value: string): Item {
    const summary: Item = {};
    for (const [index, rawLine] of value.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        throw new Error(`Config summary line ${index + 1} must use key=value.`);
      }
      const key = line.slice(0, separatorIndex).trim();
      const fieldValue = line.slice(separatorIndex + 1).trim();
      if (!key) {
        throw new Error(`Config summary line ${index + 1} is missing a key.`);
      }
      summary[key] = fieldValue;
    }
    return summary;
  }

  function renderBrandEditor(brand: Item | undefined): string {
    if (!brand) {
      return `<section class="panel"><div class="empty-panel">Select a brand to edit.</div></section>`;
    }
    return `<section class="panel">
      <div class="panel-header">
        <div><h3>Selected brand</h3><p>${h(brand.slug)} is source-owned identity.</p></div>
        ${sourceBadge("brand", brand.id)}
      </div>
      <form data-action="update-brand" data-brand-id="${h(brand.id)}" class="form-grid inline-edit">
        <label>
          Name
          <input name="name" required value="${h(brand.name)}">
        </label>
        <label>
          Status
          <select name="status">${valueOptions(["active", "disabled"], brand.status)}</select>
        </label>
        <label class="span-2">
          Slug
          <input name="slug_display" value="${h(brand.slug)}" readonly>
        </label>
        <div class="button-row span-2">
          <button class="btn btn-primary" type="submit">Save brand</button>
          ${resetButton("brand", brand.id)}
        </div>
      </form>
    </section>`;
  }

  function renderRegionEditor(region: Item | undefined): string {
    if (!region) {
      return `<div class="empty-panel">Select a region to edit.</div>`;
    }
    return `<form data-action="update-region" data-region-id="${h(region.id)}" class="form-grid inline-edit">
      <label>
        Name
        <input name="name" required value="${h(region.name)}">
      </label>
      <label>
        Status
        <select name="status">${valueOptions(["active", "disabled"], region.status)}</select>
      </label>
      <label>
        Code
        <input name="code_display" value="${h(region.code)}" readonly>
      </label>
      <label>
        Domain
        <input name="domain" value="${h(region.domain ?? "")}" placeholder="brand.example">
      </label>
      <div class="source-line span-2">${sourceBadge("region", region.id)}</div>
      <div class="button-row span-2">
        <button class="btn btn-primary" type="submit">Save region</button>
        ${resetButton("region", region.id)}
      </div>
    </form>`;
  }

  function renderConnectionEditor(connection: Item | undefined): string {
    if (!connection) {
      return `<div class="empty-panel">Select a connection to edit.</div>`;
    }
    const connector = connectorFor(connection);
    const backendOptions = ((connector?.backendOptions ?? [connection.backendType]) as string[]).filter(Boolean);
    return `<form data-action="update-connection" data-connection-id="${h(connection.id)}" class="form-grid inline-edit">
      <label>
        Display name
        <input name="displayName" required value="${h(connection.displayName)}">
      </label>
      <label>
        Backend type
        <select name="backendType">${valueOptions(backendOptions, connection.backendType)}</select>
      </label>
      <label>
        Status
        <select name="status">${valueOptions(["needs_config", "pending", "connected", "needs_reconnect", "error"], connection.status)}</select>
      </label>
      <label>
        Connector
        <input value="${h(connector?.name ?? connection.connectorId)}" readonly>
      </label>
      <label class="span-2">
        Config summary fields to save for this connection
        <textarea name="configSummary" spellcheck="false" placeholder="key=value">${h(configSummaryText(connection.configSummary))}</textarea>
      </label>
      <div class="source-line span-2">${sourceBadge("connection", connection.id)}</div>
      <div class="button-row span-2">
        <button class="btn btn-primary" type="submit">Save connection</button>
        ${resetButton("connection", connection.id)}
      </div>
    </form>`;
  }

  function renderBrandList(): string {
    return collection("brands")
      .map((brand) => {
        const regions = brandRegions(brand.id);
        const isSelected = brand.id === uiState.selectedBrandId;
        return `<div class="record-row ${isSelected ? "is-selected" : ""}" style="cursor:pointer" data-action="select-brand" data-brand-id="${h(brand.id)}">
          <div>
            <strong>${h(brand.name)}</strong>
            <div class="small muted">${h(brand.slug)} · ${regions.length} region${regions.length === 1 ? "" : "s"}</div>
          </div>
          ${statusBadge(brand.status)}
        </div>`;
      })
      .join("");
  }

  function renderRegionList(regions: Item[]): string {
    if (!regions.length) {
      return `<div class="empty-panel">No regions for this brand.</div>`;
    }
    return regions
      .map(
        (region) => {
          const isSelected = region.id === uiState.selectedRegionId;
          return `<div class="record-row ${isSelected ? "is-selected" : ""}" style="cursor:pointer" data-action="select-region" data-region-id="${h(region.id)}">
            <div>
              <strong>${h(region.name)}</strong>
              <div class="small muted">${h(region.code)}${region.domain ? ` · ${h(region.domain)}` : ""}</div>
            </div>
            ${statusBadge(region.status)}
          </div>`;
        }
      )
      .join("");
  }

  function renderConnectorSetup(): string {
    const selectedBrand = byId("brands", uiState.selectedBrandId);
    const selectedRegion = selectedRegionForBrand(brandRegions(selectedBrand?.id));
    const connector = byId("connectors", uiState.selectedConnectorId) ?? collection("connectors")[0];
    if (!selectedBrand || !selectedRegion || !connector) {
      return `<section class="panel setup-flow"><div class="empty-panel">Select a brand, region, and connector.</div></section>`;
    }
    const backendOptions = (connector.backendOptions ?? []) as string[];
    const requiredFields = (connector.requiredFields ?? []) as Item[];
    const fields = requiredFields.length
      ? requiredFields
          .map((field) => {
            const inputType = field.secret ? "password" : "text";
            return `<label>
              ${h(field.label)}
              <input name="config_${h(field.key)}" type="${inputType}" autocomplete="${field.secret ? "new-password" : "off"}" placeholder="${h(field.example ?? "")}">
            </label>`;
          })
          .join("")
      : `<div class="empty-panel span-2">No required setup fields.</div>`;
    return `<section class="panel setup-flow" id="setup-flow">
      <div class="panel-header">
        <div><h3>Connection setup</h3><p>${h(selectedBrand.name)} / ${h(selectedRegion.code)}</p></div>
        ${statusBadge(connector.authMode)}
      </div>
      <form data-action="create-connection">
        <div class="form-grid">
          <label>
            Connector
            <select name="connectorId" data-control="connector">${optionsFor(collection("connectors"), connector.id)}</select>
          </label>
          <label>
            Backend
            <select name="backendType">
              ${backendOptions.map((backend) => `<option value="${h(backend)}">${h(backend)}</option>`).join("")}
            </select>
          </label>
          <label class="span-2">
            Display name
            <input name="displayName" required placeholder="${h(selectedBrand.name)} ${h(selectedRegion.code)} ${h(connector.name)}">
          </label>
          ${fields}
          <div class="setup-summary span-2">
            <div><strong>Scopes</strong>${chips((connector.scopes ?? []) as unknown[])}</div>
            <div><strong>Supported backends</strong>${chips(backendOptions)}</div>
          </div>
          <div class="button-row span-2">
            <button class="btn btn-primary" type="submit">Save connection</button>
          </div>
        </div>
      </form>
    </section>`;
  }

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
        <div class="wizard-step-label">${stepLabels[drawer.step - 1]}</div>
        ${body}
      </div>`;
  }

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

  function renderBrands(): string {
    const allBrands = collection("brands");
    const allRegions = collection("regions");
    const selectedBrand = byId("brands", uiState.selectedBrandId);
    const regions = brandRegions(uiState.selectedBrandId);
    const selectedRegion = selectedRegionForBrand(regions);
    const connections = selectedRegion ? regionConnections(selectedRegion.id) : [];
    const selectedConnection = connections[0];

    // Region tabs: AU | NZ | SG | UK | + Add
    const regionTabs = regions.map((region) => {
      const isActive = region.id === uiState.selectedRegionId;
      return `<button class="tab${isActive ? " is-active" : ""}" type="button" data-action="select-region" data-region-id="${h(region.id)}">${h(region.code)}</button>`;
    }).join("");

    // Right panel — only shown when a brand is selected
    const rightPanel = !selectedBrand
      ? `<section class="panel"><div class="empty-panel muted" style="padding:40px;text-align:center">Select a brand to manage its regions and connections.</div></section>`
      : `<section class="panel">
          <!-- Brand header with inline edit -->
          <div class="panel-header">
            <div><h3>${h(selectedBrand.name)}</h3><p class="small muted">${h(selectedBrand.slug)}</p></div>
            <div style="display:flex;align-items:center;gap:8px">
              ${statusBadge(selectedBrand.status)}
              <details>
                <summary style="cursor:pointer;font-size:.8rem;color:var(--text-muted,#6b7280);list-style:none;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:#fff">Edit</summary>
                <div style="position:absolute;right:16px;z-index:20;background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;margin-top:4px;min-width:320px;box-shadow:0 4px 16px rgba(0,0,0,.12)">
                  <form data-action="update-brand" data-brand-id="${h(selectedBrand.id)}" class="form-grid">
                    <label>Name<input name="name" required value="${h(selectedBrand.name)}"></label>
                    <label>Status<select name="status">${valueOptions(["active", "disabled"], selectedBrand.status)}</select></label>
                    <div class="button-row span-2"><button class="btn btn-primary" type="submit">Save brand</button>${resetButton("brand", selectedBrand.id)}</div>
                  </form>
                </div>
              </details>
            </div>
          </div>

          <!-- Region tabs + add region -->
          <div style="display:flex;align-items:center;gap:4px;padding:10px 16px;border-top:1px solid var(--border);border-bottom:1px solid var(--border);flex-wrap:wrap">
            ${regionTabs}
            <details style="margin-left:4px">
              <summary style="cursor:pointer;padding:5px 10px;border-radius:6px;border:1px dashed var(--border);font-size:.82rem;color:var(--text-muted,#6b7280);list-style:none;white-space:nowrap">＋ Add region</summary>
              <div style="position:absolute;z-index:20;background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;margin-top:4px;min-width:280px;box-shadow:0 4px 16px rgba(0,0,0,.12)">
                <form data-action="create-region" class="form-grid">
                  <label>Code<input name="code" required placeholder="AU"></label>
                  <label>Name<input name="name" required placeholder="Australia"></label>
                  <label class="span-2">Domain<input name="domain" placeholder="brand.example"></label>
                  <div class="button-row span-2"><button class="btn btn-primary" type="submit">Add region</button></div>
                </form>
              </div>
            </details>
          </div>

          <!-- Region meta strip: domain info + Edit region + Add connection -->
          ${selectedRegion ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg-subtle,#f9fafb)">
            <span class="small muted">${h(selectedRegion.name)}${selectedRegion.domain ? ` · ${h(selectedRegion.domain)}` : ""}</span>
            <div style="display:flex;gap:6px;align-items:center">
              <details>
                <summary style="cursor:pointer;font-size:.8rem;color:var(--text-muted,#6b7280);list-style:none;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:#fff">Edit region</summary>
                <div style="position:absolute;right:120px;z-index:20;background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;margin-top:4px;min-width:320px;box-shadow:0 4px 16px rgba(0,0,0,.12)">
                  ${renderRegionEditor(selectedRegion)}
                </div>
              </details>
              <details>
                <summary style="cursor:pointer;font-size:.8rem;color:#fff;list-style:none;padding:4px 10px;border-radius:4px;background:#2a7090;border:1px solid #2a7090">＋ Add connection</summary>
                <div style="position:absolute;right:16px;z-index:20;background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px;margin-top:4px;min-width:360px;box-shadow:0 4px 16px rgba(0,0,0,.12)">
                  ${renderConnectorSetup()}
                </div>
              </details>
            </div>
          </div>` : ""}

          <!-- Connections table -->
          ${selectedRegion ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>Connection</th><th>Connector</th><th>Backend</th><th>Status</th><th></th></tr></thead>
              <tbody>${connectionRows(connections)}</tbody>
            </table>
          </div>
          ${selectedConnection ? `<div class="edit-block">${renderConnectionEditor(selectedConnection)}</div>` : ""}
          ` : `<div class="empty-panel muted" style="padding:24px 16px">Select a region tab to view its connections.</div>`}

        </section>`;

    return `${renderDrawer()}${viewHeader("Brands", `${allBrands.length} brands, ${allRegions.length} regions.`)}
      <div class="grid-wide">
        <section class="panel">
          <div class="panel-header"><div><h3>Brands</h3><p>${allBrands.length} configured.</p></div></div>
          <div class="dense-list">${renderBrandList()}</div>
          <details style="border-top:1px solid var(--border)">
            <summary style="padding:10px 16px;cursor:pointer;font-size:.85rem;color:var(--text-muted,#6b7280);list-style:none">＋ New brand</summary>
            <form data-action="create-brand" class="form-grid" style="padding:0 16px 16px">
              <label>Name<input name="name" required placeholder="New brand"></label>
              <label>Slug<input name="slug" placeholder="new-brand"></label>
              <div class="button-row span-2"><button class="btn btn-primary" type="submit">Add brand</button></div>
            </form>
          </details>
        </section>
        <div class="workspace">
          ${rightPanel}
        </div>
      </div>`;
  }

  function renderConnectors(): string {
    const allConnectors = (uiState.allConnectors ?? collection("connectors").map((c) => ({ ...c, enabled: true }))) as Item[];
    const enabledCount = allConnectors.filter((c) => c.enabled !== false).length;
    const rows = allConnectors
      .map(
        (connector) => {
          const enabled = connector.enabled !== false;
          return `<tr style="${enabled ? "" : "opacity:.5"}">
            <td><strong>${h(connector.name)}</strong><div class="small muted">${h(connector.slug)}</div></td>
            <td>${h(connector.category)}</td>
            <td>${statusBadge(connector.authMode)}</td>
            <td>${chips((connector.backendOptions ?? []) as unknown[])}</td>
            <td>${chips(((connector.requiredFields ?? []) as Item[]).map((field) => `${field.label}${field.secret ? " (secret)" : ""}`))}</td>
            <td><button class="btn btn-sm" type="button" data-action="toggle-connector" data-connector-id="${h(connector.id)}" data-enabled="${enabled ? "1" : "0"}">${enabled ? "Disable" : "Enable"}</button></td>
          </tr>`;
        }
      )
      .join("");
    return `${viewHeader("Connectors", `${enabledCount} of ${allConnectors.length} connectors enabled for this deployment.`)}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Connector</th><th>Category</th><th>Auth</th><th>Backends</th><th>Required fields</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  async function refreshConnectorsState(): Promise<void> {
    try {
      const result = await requestJson("/admin/api/connectors/all");
      (uiState as Record<string, unknown>).allConnectors = result.connectors;
    } catch {
      // falls back to state.connectors (enabled only) if endpoint unavailable
    }
  }

  function apiAccessAuditEvents(): Item[] {
    return collection("auditEvents").filter((event) => {
      const action = String(event.action ?? "");
      return action.startsWith("api_") || event.targetType === "api_key" || event.targetType === "api_client";
    });
  }

  function renderSecretReveal(): string {
    const reveal = uiState.secretReveal;
    if (!reveal) {
      return "";
    }
    return `<section class="secret-reveal" aria-live="polite">
      <div>
        <strong>One-time ${h(reveal.action)} secret</strong>
        <div class="small muted">${h(reveal.clientName)} / ${h(reveal.keyLabel)}${reveal.preview ? ` / ${h(reveal.preview)}` : ""}</div>
      </div>
      <code>${h(reveal.secret)}</code>
      <div class="button-row">
        <button class="btn" type="button" data-action="copy-secret">Copy</button>
        <button class="btn" type="button" data-action="dismiss-secret">Clear</button>
      </div>
    </section>`;
  }

  function scopeCheckboxes(selectedScopes: unknown[] = []): string {
    const selected = new Set(selectedScopes.map((scope) => String(scope)));
    return `<div class="scope-checklist">
      ${ACCESS_SCOPES.map(
        (scope) => `<label>
          <input type="checkbox" name="scopes" value="${h(scope)}" ${selected.has(scope) ? "checked" : ""}>
          <span>${h(scope)}</span>
        </label>`
      ).join("")}
    </div>`;
  }

  function accessMetric(label: string, value: string): string {
    return `<div class="access-meta-item"><span>${h(label)}</span><strong>${value}</strong></div>`;
  }

  function renderKeyRows(client: Item): string {
    const keys = Array.isArray(client.keys) ? client.keys : [];
    if (!keys.length) {
      return `<tr><td colspan="9" class="muted">No keys for this client.</td></tr>`;
    }
    return keys
      .map((key) => {
        const hasLifecycleActions = client.status === "active" && key.status === "active";
        return `<tr>
          <td><strong>${h(key.label)}</strong></td>
          <td class="truncate">${h(key.preview)}</td>
          <td class="truncate mono">${h(key.fingerprint)}</td>
          <td>${statusBadge(key.status)}</td>
          <td>${h(formatDate(key.createdAt))}</td>
          <td>${h(formatDate(key.rotatedAt))}</td>
          <td>${h(formatDate(key.revokedAt))}</td>
          <td>${h(formatDate(key.lastUsedAt))}</td>
          <td class="button-row">
            ${
              hasLifecycleActions
                ? `<button class="btn lifecycle" type="button" data-action="rotate-key" data-client-id="${h(client.id)}" data-key-id="${h(key.id)}">Rotate</button>
                  <button class="btn btn-danger lifecycle" type="button" data-action="revoke-key" data-client-id="${h(client.id)}" data-key-id="${h(key.id)}">Revoke</button>`
                : `<span class="small muted">No actions</span>`
            }
          </td>
        </tr>`;
      })
      .join("");
  }

  function renderApiClient(client: Item): string {
    const keys = Array.isArray(client.keys) ? client.keys : [];
    return `<section class="access-client">
      <div class="access-client-header">
        <div>
          <h3>${h(client.name)}</h3>
          <div class="small muted">${h(client.owner)} / ${h(client.type)}</div>
        </div>
        <div class="button-row">
          ${statusBadge(client.status)}
          <button class="btn" type="button" data-action="create-key" data-client-id="${h(client.id)}" ${client.status === "active" ? "" : "disabled"}>Create key</button>
        </div>
      </div>
      <div class="access-client-meta">
        ${accessMetric("Owner", h(client.owner))}
        ${accessMetric("Type", h(client.type))}
        ${accessMetric("Status", statusBadge(client.status))}
        ${accessMetric("Keys", h(keys.length))}
        ${accessMetric("24h requests", h(formatCount(client.requestCount24h)))}
        ${accessMetric("24h error rate", h(formatPercent(client.errorRate24h)))}
        ${accessMetric("Last used", h(formatDate(client.lastUsedAt)))}
        <div class="access-meta-item access-scopes"><span>Scopes</span>${chips((client.scopes ?? []) as unknown[])}</div>
      </div>
      <div class="access-key-list">
        <table>
          <thead><tr><th>Label</th><th>Preview</th><th>Fingerprint</th><th>Status</th><th>Created</th><th>Rotated</th><th>Revoked</th><th>Last used</th><th>Actions</th></tr></thead>
          <tbody>${renderKeyRows(client)}</tbody>
        </table>
      </div>
    </section>`;
  }

  function renderAccessAudit(): string {
    const events = apiAccessAuditEvents().slice(0, 8);
    if (!events.length) {
      return "";
    }
    return `<section class="panel">
      <div class="panel-header"><div><h3>Access audit</h3><p>Latest API access events.</p></div></div>
      <ul class="audit-compact">
        ${events
          .map(
            (event) => `<li>
              <strong>${h(event.action)}</strong>
              <span>${h(event.detail)}</span>
              <span class="small muted">${h(formatDate(event.timestamp))} / ${h(event.actor)}</span>
            </li>`
          )
          .join("")}
      </ul>
    </section>`;
  }

  function renderCreateApiClientForm(): string {
    return `<section class="panel">
      <div class="panel-header"><div><h3>Create client</h3><p>Provision API access for local services and agents.</p></div></div>
      <form data-action="create-api-client" class="form-grid inline-edit">
        <label>
          Name
          <input name="name" required placeholder="Local API client">
        </label>
        <label>
          Owner
          <input name="owner" required placeholder="ops@haverford.au">
        </label>
        <label class="span-2">
          Type
          <select name="type">
            ${valueOptions(["service", "agent", "worker"], "service")}
          </select>
        </label>
        <div class="span-2">
          <label>Scopes</label>
          ${scopeCheckboxes()}
        </div>
        <div class="button-row span-2">
          <button class="btn btn-primary" type="submit">Create client</button>
        </div>
      </form>
    </section>`;
  }

  function renderApiAccess(): string {
    const clients = collection("apiClients");
    const clientList = clients.length
      ? `<div class="access-client-list">${clients.map((client) => renderApiClient(client)).join("")}</div>`
      : `<div class="empty-panel">No API clients yet. Create one to test /api/v1 locally.</div>`;
    return `${viewHeader("API Access", "Service, agent, and worker API clients.")}
      ${renderSecretReveal()}
      <div class="access-grid">
        ${clientList}
        <div class="workspace">
          ${renderCreateApiClientForm()}
          ${renderAccessAudit()}
        </div>
      </div>`;
  }

  function renderAudit(): string {
    return `${viewHeader("Audit", "Admin and MCP access events, connection tests, and key lifecycle.")}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Action</th><th>Detail</th><th>Actor</th></tr></thead>
            <tbody>${auditRows(collection("auditEvents"))}</tbody>
          </table>
        </div>
      </section>`;
  }

  async function refreshAppsState(): Promise<void> {
    clearError();
    const result = await requestJson("/admin/api/app-installs");
    uiState.appInstalls = Array.isArray(result.installs) ? (result.installs as Item[]) : Array.isArray(result) ? (result as Item[]) : [];
    render();
  }

  function renderApps(): string {
    const installs = uiState.appInstalls ?? [];
    const installRows = installs.length
      ? installs
          .map(
            (install) => `<tr>
              <td>${h(install.brand ?? install.brandId ?? "—")}</td>
              <td>${h(install.region ?? install.regionId ?? "—")}</td>
              <td>${statusBadge(install.status ?? "unknown")}</td>
              <td>${install.status === "pending" ? `<button class="btn btn-sm" type="button" data-action="shopify-connect" data-install-id="${h(install.id)}" data-brand-id="${h(install.brandId ?? install.brand ?? "")}" data-region-id="${h(install.regionId ?? install.region ?? "")}">Connect Shopify</button>` : ""}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted">No installs yet. <button class="btn btn-sm" type="button" data-action="provision-apps">Provision installs</button></td></tr>`;

    return `${viewHeader("Apps", "Installed app catalog entries across brands.")}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Haverford Storefront</h3>
            <p>Storefront intelligence for a Haverford brand region powered by a connected Shopify store.</p>
          </div>
        </div>
        <div class="meta-grid">
          ${accessMetric("Required connectors", h("shopify, cin7"))}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div><h3>Installs</h3><p>Active app installs per brand and region.</p></div>
          <button class="btn" type="button" data-action="refresh-apps">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Brand</th><th>Region</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${installRows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function render(): void {
    document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === uiState.view);
    });
    if (!uiState.data) {
      appRoot.innerHTML = `<div class="loading-panel">Loading gateway state...</div>`;
      return;
    }
    ensureSelections();
    const views: Record<string, () => string> = {
      overview: renderOverview,
      brands: renderBrands,
      connectors: renderConnectors,
      "api-access": renderApiAccess,
      audit: renderAudit,
      apps: renderApps
    };
    appRoot.innerHTML = (views[uiState.view] ?? renderOverview)();
  }

  function field(form: HTMLFormElement, name: string): string | undefined {
    const value = new FormData(form).get(name);
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  function formText(form: HTMLFormElement, name: string): string {
    const value = new FormData(form).get(name);
    return typeof value === "string" ? value : "";
  }

  function formValues(form: HTMLFormElement, name: string): string[] {
    return new FormData(form)
      .getAll(name)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim());
  }

  function revealSecret(result: Item, action: string, clientId: string, fallbackLabel: string): void {
    if (typeof result.secret !== "string" || !result.secret) {
      uiState.secretReveal = null;
      return;
    }
    const key = (result.key ?? {}) as Item;
    const client = byId("apiClients", clientId);
    uiState.secretReveal = {
      action,
      clientId,
      keyId: typeof key.id === "string" ? key.id : undefined,
      clientName: String(client?.name ?? clientId),
      keyLabel: String(key.label ?? fallbackLabel),
      preview: typeof key.preview === "string" ? key.preview : undefined,
      fingerprint: typeof key.fingerprint === "string" ? key.fingerprint : undefined,
      secret: result.secret
    };
  }

  async function copySecret(): Promise<void> {
    const secret = uiState.secretReveal?.secret;
    if (!secret) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(secret);
      return;
    }
    throw new Error("Clipboard API is not available.");
  }

  function configSummaryFromForm(form: HTMLFormElement): Item {
    const summary: Item = {};
    for (const [key, value] of new FormData(form).entries()) {
      if (!key.startsWith("config_") || typeof value !== "string" || !value.trim()) {
        continue;
      }
      summary[key.slice("config_".length)] = value;
    }
    return summary;
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    clearError();
    const form = event.target as HTMLFormElement | null;
    if (!form?.matches("form[data-action]")) {
      return;
    }
    const action = form.dataset.action;
    if (action === "create-brand") {
      const result = await postJson("/admin/api/brands", {
        name: field(form, "name"),
        slug: field(form, "slug")
      });
      applyState(result.state);
      selectBrand(result.brand?.id ?? uiState.selectedBrandId);
      render();
      return;
    }
    if (action === "create-region") {
      if (!uiState.selectedBrandId) {
        throw new Error("Select a brand before adding a region.");
      }
      const result = await postJson(`/admin/api/brands/${encodeURIComponent(uiState.selectedBrandId)}/regions`, {
        code: field(form, "code"),
        name: field(form, "name"),
        domain: field(form, "domain")
      });
      applyState(result.state);
      uiState.selectedRegionId = result.region?.id ?? uiState.selectedRegionId;
      selectedRegionForBrand(brandRegions(uiState.selectedBrandId));
      render();
      return;
    }
    if (action === "update-brand") {
      const brandId = form.dataset.brandId;
      if (!brandId) {
        throw new Error("Select a brand before saving.");
      }
      const result = await patchJson(`/admin/api/brands/${encodeURIComponent(brandId)}`, {
        name: field(form, "name"),
        status: field(form, "status")
      });
      applyState(result.state);
      selectBrand(result.brand?.id ?? brandId);
      render();
      return;
    }
    if (action === "update-region") {
      const regionId = form.dataset.regionId;
      if (!regionId) {
        throw new Error("Select a region before saving.");
      }
      const result = await patchJson(`/admin/api/regions/${encodeURIComponent(regionId)}`, {
        name: field(form, "name"),
        domain: formText(form, "domain"),
        status: field(form, "status")
      });
      applyState(result.state);
      uiState.selectedRegionId = result.region?.id ?? regionId;
      render();
      return;
    }
    if (action === "create-connection") {
      const selectedRegion = selectedRegionForBrand(brandRegions(uiState.selectedBrandId));
      if (!uiState.selectedBrandId || !selectedRegion) {
        throw new Error("Select a brand and region before adding a connection.");
      }
      const result = await postJson(`/admin/api/regions/${encodeURIComponent(selectedRegion.id)}/connections`, {
        brandId: uiState.selectedBrandId,
        connectorId: field(form, "connectorId"),
        backendType: field(form, "backendType"),
        displayName: field(form, "displayName"),
        configSummary: configSummaryFromForm(form)
      });
      applyState(result.state);
      uiState.drawer.connectionId = result.connection?.id ?? uiState.drawer.connectionId;
      render();
      return;
    }
    if (action === "create-api-client") {
      const result = await postJson("/admin/api/api-clients", {
        name: field(form, "name"),
        owner: field(form, "owner"),
        type: field(form, "type"),
        scopes: formValues(form, "scopes")
      });
      applyState(result.state);
      uiState.secretReveal = null;
      render();
      return;
    }
    if (action === "update-connection") {
      const connectionId = form.dataset.connectionId;
      if (!connectionId) {
        throw new Error("Select a connection before saving.");
      }
      const result = await patchJson(`/admin/api/connections/${encodeURIComponent(connectionId)}`, {
        displayName: field(form, "displayName"),
        backendType: field(form, "backendType"),
        status: field(form, "status"),
        configSummary: configSummaryFromText(formText(form, "configSummary"))
      });
      applyState(result.state);
      uiState.drawer.connectionId = result.connection?.id ?? connectionId;
      render();
    }
  }

  // Stub — implemented in Task 6
  async function triggerDrawerTest(connectionId: string): Promise<void> {
    void connectionId;
  }

  async function handleButton(button: HTMLElement): Promise<void> {
    clearError();
    const action = button.dataset.action;
    if (action === "select-brand" && button.dataset.brandId) {
      selectBrand(button.dataset.brandId);
      render();
      return;
    }
    if (action === "select-region" && button.dataset.regionId) {
      uiState.selectedRegionId = button.dataset.regionId;
      render();
      return;
    }
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
    if (action === "test-connection" && button.dataset.connectionId) {
      const result = await postJson(`/admin/api/connections/${encodeURIComponent(button.dataset.connectionId)}/test`);
      applyState(result.state);
      uiState.drawer.connectionId = result.connection?.id ?? button.dataset.connectionId;
      render();
      return;
    }
    if (action === "reset-entity" && button.dataset.entityType && button.dataset.entityId) {
      const result = await postJson("/admin/api/entities/reset", {
        entityType: button.dataset.entityType,
        entityId: button.dataset.entityId
      });
      applyState(result.state);
      render();
      return;
    }
    if (action === "create-key" && button.dataset.clientId) {
      const label = prompt("API key label", "primary");
      if (label === null) {
        return;
      }
      const trimmedLabel = label.trim();
      if (!trimmedLabel) {
        throw new Error("API key label is required.");
      }
      const result = await postJson(`/admin/api/api-clients/${encodeURIComponent(button.dataset.clientId)}/keys`, {
        label: trimmedLabel
      });
      applyState(result.state);
      revealSecret(result, "created", button.dataset.clientId, trimmedLabel);
      render();
      return;
    }
    if (action === "copy-secret") {
      await copySecret();
      return;
    }
    if (action === "dismiss-secret") {
      uiState.secretReveal = null;
      render();
      return;
    }
    if (action === "rotate-key" && button.dataset.clientId && button.dataset.keyId) {
      const result = await postJson(
        `/admin/api/api-clients/${encodeURIComponent(button.dataset.clientId)}/keys/${encodeURIComponent(button.dataset.keyId)}/rotate`
      );
      applyState(result.state);
      revealSecret(result, "rotated", button.dataset.clientId, "rotated key");
      render();
      return;
    }
    if (action === "revoke-key" && button.dataset.clientId && button.dataset.keyId) {
      const result = await postJson(
        `/admin/api/api-clients/${encodeURIComponent(button.dataset.clientId)}/keys/${encodeURIComponent(button.dataset.keyId)}/revoke`
      );
      applyState(result.state);
      if (uiState.secretReveal?.clientId === button.dataset.clientId && uiState.secretReveal.keyId === button.dataset.keyId) {
        uiState.secretReveal = null;
      }
      render();
    }
    if (action === "refresh-apps") {
      await refreshAppsState();
      return;
    }
    if (action === "toggle-connector" && button.dataset.connectorId) {
      const enabling = button.dataset.enabled === "0";
      await postJson(`/admin/api/connectors/${encodeURIComponent(button.dataset.connectorId)}/toggle`, { enabled: enabling });
      const state = await requestJson("/admin/api/state");
      applyState(state);
      await refreshConnectorsState();
      render();
      return;
    }
    if (action === "provision-apps") {
      await postJson("/api/v1/app-installs/provision", {});
      await refreshAppsState();
      return;
    }
    if (action === "shopify-connect") {
      const shop = prompt("Enter shop domain (e.g. brand.myshopify.com):");
      if (!shop || !shop.trim()) {
        return;
      }
      await postJson("/admin/shopify-oauth/install", { shop: shop.trim() });
      await refreshAppsState();
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const viewButton = target?.closest<HTMLElement>("button[data-view]");
    if (viewButton?.dataset.view) {
      uiState.view = viewButton.dataset.view;
      if (viewButton.dataset.view === "apps") {
        void refreshAppsState().catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
      }
      if (viewButton.dataset.view === "connectors") {
        void refreshConnectorsState().catch(() => { /* falls back to state.connectors */ });
      }
      render();
      return;
    }
    const actionButton = target?.closest<HTMLElement>("[data-action]");
    if (actionButton) {
      void handleButton(actionButton).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target as HTMLSelectElement | null;
    if (!target?.matches("select[data-control]")) {
      return;
    }
    const control = target.dataset.control;
    if (control === "brand") {
      selectBrand(target.value || null);
      render();
    }
    if (control === "region") {
      uiState.selectedRegionId = target.value;
      render();
    }
    if (control === "connector") {
      uiState.selectedConnectorId = target.value;
      render();
    }
    if (control === "drawer-connector") {
      uiState.drawer.pendingConnectorId = target.value;
      render();
    }
    if (control === "connection") {
      uiState.drawer.connectionId = target.value;
      render();
    }
  });

  document.addEventListener("submit", (event) => {
    void handleSubmit(event as SubmitEvent).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
  });

  void refreshState().catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
}

export function renderAdminClientScript(appSource = adminClientApp.toString()): string {
  return `(() => {
  const __name = (target) => target;
  (${appSource})();
})();\n`;
}

export const adminClientScript = renderAdminClientScript();
