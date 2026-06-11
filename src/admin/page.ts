const BUILD_TS = Date.now();

export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Haverford Unified Gateway</title>
    <link rel="stylesheet" href="/admin/style.css">
  </head>
  <body>
    <div class="admin-shell">
      <aside class="admin-nav" aria-label="Admin navigation">
        <div class="brand-lockup">
          <span class="brand-mark">HG</span>
          <div>
            <p class="eyebrow">Gateway admin</p>
            <h1>Haverford Unified Gateway</h1>
          </div>
        </div>
        <nav>
          <button class="nav-link is-active" type="button" data-view="overview">Overview</button>
          <button class="nav-link" type="button" data-view="brands">Brands</button>
          <button class="nav-link" type="button" data-view="connectors">Connectors</button>
          <button class="nav-link" type="button" data-view="api-access">API Access</button>
          <button class="nav-link" type="button" data-view="audit">Audit</button>
          <button class="nav-link" type="button" data-view="apps">Apps</button>
        </nav>
      </aside>
      <main class="admin-main">
        <div id="app-error" class="error-panel" hidden></div>
        <section id="app-root" class="workspace" aria-live="polite">
          <div class="loading-panel">Loading gateway state...</div>
        </section>
      </main>
    </div>
    <script src="/admin/app.js?v=${BUILD_TS}"></script>
  </body>
</html>`;
}
