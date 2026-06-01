function adminClientApp() {
  type Item = Record<string, any>;
  type UiState = {
    data: Item | null;
    view: string;
    selectedBrandId: string | null;
    selectedRegionId: string | null;
    selectedConnectorId: string | null;
  };

  const root = document.getElementById("app-root") as HTMLElement | null;
  const errorPanel = document.getElementById("app-error") as HTMLElement | null;
  const uiState: UiState = {
    data: null,
    view: "overview",
    selectedBrandId: null,
    selectedRegionId: null,
    selectedConnectorId: null
  };

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

  async function refreshState(): Promise<void> {
    clearError();
    const state = await requestJson("/admin/api/state");
    applyState(state);
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
      return `<tr><td colspan="6" class="muted">No connections.</td></tr>`;
    }
    return connections
      .map((connection) => {
        const connector = connectorFor(connection);
        const region = byId("regions", connection.regionId);
        return `<tr>
          <td><strong>${h(connection.displayName)}</strong><div class="small muted">${h(connection.id)}</div></td>
          <td>${h(connector?.name ?? connection.connectorId)}</td>
          <td>${h(region?.code ?? connection.regionId)}</td>
          <td>${h(connection.backendType)}</td>
          <td>${statusBadge(connection.status)}</td>
          <td class="button-row">
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
    return `${viewHeader("Overview", "Fixture-backed operational view for the unified gateway prototype.", `<span class="badge info">Fixture backend</span>`)}
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
              <thead><tr><th>Name</th><th>Connector</th><th>Region</th><th>Backend</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>${connectionRows(connections.slice(0, 8))}</tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div><h3>Audit</h3><p>Latest fixture events.</p></div>
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

  function renderBrandList(): string {
    return collection("brands")
      .map((brand) => {
        const regions = brandRegions(brand.id);
        return `<div class="record-row">
          <div>
            <strong>${h(brand.name)}</strong>
            <div class="small muted">${h(brand.slug)} - ${regions.length} region${regions.length === 1 ? "" : "s"}</div>
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
        (region) => `<div class="record-row">
          <div>
            <strong>${h(region.name)}</strong>
            <div class="small muted">${h(region.code)}${region.domain ? ` - ${h(region.domain)}` : ""}</div>
          </div>
          ${statusBadge(region.status)}
        </div>`
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

  function renderBrands(): string {
    const selectedBrand = byId("brands", uiState.selectedBrandId);
    const regions = brandRegions(uiState.selectedBrandId);
    const selectedRegion = selectedRegionForBrand(regions);
    const connections = selectedRegion ? regionConnections(selectedRegion.id) : [];
    return `${viewHeader("Brands", "Manage brand and region entities for the fixture gateway.")}
      <div class="grid-wide">
        <section class="panel">
          <div class="panel-header"><div><h3>Brands</h3><p>${collection("brands").length} configured.</p></div></div>
          <div class="dense-list">${renderBrandList()}</div>
        </section>
        <div class="workspace">
          <section class="panel">
            <div class="form-grid">
              <form data-action="create-brand" class="form-grid span-2">
                <label>
                  Brand name
                  <input name="name" required placeholder="New brand">
                </label>
                <label>
                  Slug
                  <input name="slug" placeholder="new-brand">
                </label>
                <div class="button-row span-2">
                  <button class="btn btn-primary" type="submit">Add brand</button>
                </div>
              </form>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <div><h3>Regions</h3><p>${selectedBrand ? h(selectedBrand.name) : "No brand selected"}</p></div>
              <select data-control="brand" aria-label="Selected brand">${optionsFor(collection("brands"), uiState.selectedBrandId)}</select>
            </div>
            <div class="dense-list">${renderRegionList(regions)}</div>
            <form data-action="create-region" class="form-grid">
              <label>
                Code
                <input name="code" required placeholder="AU">
              </label>
              <label>
                Name
                <input name="name" required placeholder="Australia">
              </label>
              <label class="span-2">
                Domain
                <input name="domain" placeholder="brand.example">
              </label>
              <div class="button-row span-2">
                <button class="btn btn-primary" type="submit" ${selectedBrand ? "" : "disabled"}>Add region</button>
              </div>
            </form>
          </section>
          <section class="panel">
            <div class="panel-header">
              <div><h3>Regional connections</h3><p>${selectedRegion ? h(selectedRegion.name) : "No region selected"}</p></div>
              <select data-control="region" aria-label="Selected region">${optionsFor(regions, uiState.selectedRegionId, "code")}</select>
            </div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Connector</th><th>Region</th><th>Backend</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>${connectionRows(connections)}</tbody>
              </table>
            </div>
          </section>
          ${renderConnectorSetup()}
        </div>
      </div>`;
  }

  function renderConnectors(): string {
    const rows = collection("connectors")
      .map(
        (connector) => `<tr>
          <td><strong>${h(connector.name)}</strong><div class="small muted">${h(connector.slug)}</div></td>
          <td>${h(connector.category)}</td>
          <td>${statusBadge(connector.authMode)}</td>
          <td>${chips((connector.backendOptions ?? []) as unknown[])}</td>
          <td>${chips(((connector.requiredFields ?? []) as Item[]).map((field) => `${field.label}${field.secret ? " (secret)" : ""}`))}</td>
          <td>${chips((connector.scopes ?? []) as unknown[])}</td>
        </tr>`
      )
      .join("");
    return `${viewHeader("Connectors", "Supported fixture connector catalog and setup contract.")}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Connector</th><th>Category</th><th>Auth</th><th>Backends</th><th>Required fields</th><th>Scopes</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderApiAccess(): string {
    const rows = collection("apiClients")
      .flatMap((client) =>
        ((client.keys ?? []) as Item[]).map(
          (key) => `<tr>
            <td><strong>${h(client.name)}</strong><div class="small muted">${h(client.owner)} / ${h(client.type)}</div></td>
            <td>${h(key.label)}<div class="small muted">${h(key.preview)}</div></td>
            <td>${statusBadge(key.status)}</td>
            <td>${h(client.requestCount24h)} requests<br><span class="small muted">${h(formatPercent(client.errorRate24h))} errors</span></td>
            <td>${chips((client.scopes ?? []) as unknown[])}</td>
            <td class="button-row">
              <button class="btn lifecycle" type="button" data-action="rotate-key" data-client-id="${h(client.id)}" data-key-id="${h(key.id)}" ${key.status === "revoked" ? "disabled" : ""}>Rotate</button>
              <button class="btn btn-danger lifecycle" type="button" data-action="revoke-key" data-client-id="${h(client.id)}" data-key-id="${h(key.id)}" ${key.status === "revoked" ? "disabled" : ""}>Revoke</button>
            </td>
          </tr>`
        )
      )
      .join("");
    return `${viewHeader("API Access", "Service, agent, and worker API clients.")}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Key</th><th>Status</th><th>24h</th><th>Scopes</th><th>Lifecycle</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderAudit(): string {
    return `${viewHeader("Audit", "Fixture audit trail for admin actions.")}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Action</th><th>Detail</th><th>Actor</th></tr></thead>
            <tbody>${auditRows(collection("auditEvents"))}</tbody>
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
      audit: renderAudit
    };
    appRoot.innerHTML = (views[uiState.view] ?? renderOverview)();
  }

  function field(form: HTMLFormElement, name: string): string | undefined {
    const value = new FormData(form).get(name);
    return typeof value === "string" && value.trim() ? value : undefined;
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
      render();
    }
  }

  async function handleButton(button: HTMLElement): Promise<void> {
    clearError();
    const action = button.dataset.action;
    if (action === "test-connection" && button.dataset.connectionId) {
      const result = await postJson(`/admin/api/connections/${encodeURIComponent(button.dataset.connectionId)}/test`);
      applyState(result.state);
      render();
      return;
    }
    if (action === "rotate-key" && button.dataset.clientId && button.dataset.keyId) {
      const result = await postJson(
        `/admin/api/api-clients/${encodeURIComponent(button.dataset.clientId)}/keys/${encodeURIComponent(button.dataset.keyId)}/rotate`
      );
      applyState(result.state);
      render();
      return;
    }
    if (action === "revoke-key" && button.dataset.clientId && button.dataset.keyId) {
      const result = await postJson(
        `/admin/api/api-clients/${encodeURIComponent(button.dataset.clientId)}/keys/${encodeURIComponent(button.dataset.keyId)}/revoke`
      );
      applyState(result.state);
      render();
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const viewButton = target?.closest<HTMLElement>("button[data-view]");
    if (viewButton?.dataset.view) {
      uiState.view = viewButton.dataset.view;
      render();
      return;
    }
    const actionButton = target?.closest<HTMLElement>("button[data-action]");
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
      selectedRegionForBrand(brandRegions(uiState.selectedBrandId));
      render();
    }
    if (control === "connector") {
      uiState.selectedConnectorId = target.value;
      render();
    }
  });

  document.addEventListener("submit", (event) => {
    void handleSubmit(event as SubmitEvent).catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
  });

  void refreshState().catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)));
}

export const adminClientScript = `(${adminClientApp.toString()})();\n`;
