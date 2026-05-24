# Adding a new brand

End-to-end walkthrough for standing up a new brand on the agent stack with the Composio pattern. Estimated time: ~30 minutes after you've done it once.

This guide uses `mybrand` as a placeholder. Replace with your actual brand slug throughout.

## Prerequisites

- A Composio account (https://app.composio.dev)
- The brand's Hermes deploy repo set up (e.g. `agent-mybrand`) with the `template-agent` runtime image
- Coolify access for the brand's deploy
- A Google account owning the brand's GA4 + GSC properties (the "analytics owner")
- A Microsoft Clarity project + a generated Data Export API token

## Step 1 — Composio dashboard setup (5–10 minutes)

1. Open https://app.composio.dev → sign in.
2. Create a **Project** for this brand (or reuse an existing project).
3. Generate a **Project API key** if you don't have one. Save it as `COMPOSIO_API_KEY` — you'll need it for both the scaffold script and the brand's Coolify env. Treat it as a secret.
4. For each toolkit you need, create an **Auth Config**:
   - **Outlook, OneDrive, Pipedrive** — select the toolkit, choose "Use Composio's app" (Composio-managed OAuth), save. No client ID/secret needed.
   - **Google Analytics, Google Search Console** — same. Composio-managed Google OAuth.
   - **Microsoft Clarity** — select toolkit, paste the Clarity Data Export JWT token, save.
   - **Microsoft Teams** (optional) — same as Outlook.
5. Note each auth config's ID (looks like `ac_...`). You'll pass them to the scaffold script.

> Auth config IDs are not secrets, but they ARE per-project. Don't reuse another brand's IDs.

## Step 2 — Sign in the analytics owner (one-time)

Shared-entity toolkits (GA4, GSC) need one OAuth sign-in to seed the brand's connected account. Easiest path:

1. In the Composio dashboard, go to the GA4 auth config you just created.
2. Click "Add Connected Account" → enter `user_id` = `mybrand` (the brand slug — must match what the scaffold will use).
3. Complete the OAuth flow as the analytics owner (e.g. `lee@mybrand.com`).
4. Repeat for GSC.
5. Clarity uses an API key — no per-user OAuth needed.

After this, the connection is active and any caller using `user_id=mybrand` reads the same OAuth token.

## Step 3 — Clone and run the scaffold

```bash
git clone https://github.com/leebaroneau/template-gateway.git
cd template-gateway
npm install
export COMPOSIO_API_KEY="ak_..."   # the project API key from Step 1

node scripts/composio-create-servers.mjs \
  --brand mybrand \
  --allowlists "allowlists/outlook-mail-calendar.json,allowlists/onedrive-files.json,allowlists/pipedrive-crm.json,allowlists/ga4-reporting.json,allowlists/gsc-search.json,allowlists/clarity-export.json" \
  --auth-configs '{
    "outlook":"ac_...",
    "one_drive":"ac_...",
    "pipedrive":"ac_...",
    "google_analytics":"ac_...",
    "google_search_console":"ac_...",
    "microsoft_clarity":"ac_..."
  }' \
  --output ./mybrand-composio.yaml
```

The script:
- Creates 6 Composio MCP servers (named `mybrand-outlook`, `mybrand-onedrive`, etc.) with the allowlists baked in.
- Writes a brand overlay fragment to `./mybrand-composio.yaml`.

> Tip: use `--dry-run` first to confirm the plan before the script makes any API calls.

## Step 4 — Wire the overlay into your brand deploy repo

1. Open your brand's deploy repo (e.g. `agent-mybrand`).
2. Copy the contents of `mybrand-composio.yaml` into the brand's Hermes overlay:
   - File path is typically `runtime/<brand>/hermes/overlays/<brand>.yaml`
   - Merge the `mcp_servers:` entries with any existing entries (e.g. paperclip, brand-specific servers).
3. In `docker-compose.yaml`, mirror the overlay content in the inline `<brand>_mcp_overlay` config block. This is what Coolify mounts into the container.

## Step 5 — Add per-profile env sync

In the brand's `docker-compose.yaml`, add a runtime-seed helper that writes `COMPOSIO_USER_ID` per-profile and `COMPOSIO_API_KEY` everywhere. Drop this alongside any existing `sync_per_profile_*()` functions:

```bash
sync_per_profile_composio_env() {
  # Write per-profile Composio config into each profile's .env on every boot.
  composio_key_value="${COMPOSIO_API_KEY:-}"
  for profile in \
    mybrand-head-of-marketing \
    mybrand-head-of-sales \
    mybrand-executive-assistant \
    ; do
    profile_home="$hermes_home/profiles/$profile"
    env_file="$profile_home/.env"
    [ -d "$profile_home" ] || continue
    touch "$env_file"
    chmod 0600 "$env_file"
    grep -v -E "^(COMPOSIO_USER_ID|COMPOSIO_API_KEY)=" "$env_file" > "$env_file.tmp" || true
    printf '%s=%s\n' "COMPOSIO_USER_ID" "$profile" >> "$env_file.tmp"
    [ -z "$composio_key_value" ] || printf '%s=%s\n' "COMPOSIO_API_KEY" "$composio_key_value" >> "$env_file.tmp"
    mv "$env_file.tmp" "$env_file"
    chmod 0600 "$env_file"
  done
}
```

Call it from the runtime-seed init flow alongside the other sync functions. Don't forget to add `COMPOSIO_API_KEY: ${COMPOSIO_API_KEY:-}` to the paperclip and hermes service env blocks so the value is available in the container.

> Reference: see `genvest/agent-genvest@task/28-composio-persistence` for a working implementation.

## Step 6 — Set Coolify env

In the brand's Coolify app:

1. Environment Variables → add `COMPOSIO_API_KEY=ak_...` (same value as Step 1).
2. Save.

> Without this, `runtime-seed` writes an empty key into every profile's `.env` and the MCP servers will 401.

## Step 7 — Deploy

Push the overlay + compose changes, merge the PR, let Coolify auto-deploy. Watch the agent-genvest deploy logs for `sync_per_profile_composio_env` output and confirm each profile's `.env` got the new keys.

## Step 8 — Per-profile sign-in via chat

For per-profile toolkits, each bot user signs in via chat:

```
User → Telegram → mybrand-head-of-sales bot
  "Connect my Outlook"
Bot calls mcp_composio_outlook_COMPOSIO_INITIATE_CONNECTION
Bot replies with Composio sign-in URL
User opens URL, signs in with their work Microsoft 365 account
Connected account is bound to user_id=mybrand-head-of-sales
```

Repeat for OneDrive, Pipedrive, Teams. Each is its own OAuth.

## Step 9 — Smoke test

In chat, ask the bot to use each toolkit:

- "List my unread emails" (Outlook)
- "Show recent files from OneDrive"
- "List open Pipedrive deals"
- "Pull GA4 sessions for last 7 days"
- "Top 10 search queries from GSC last month"
- "Clarity dead clicks this week"

The first call to each per-profile toolkit will prompt OAuth if the bot hasn't signed in. Shared toolkits should work immediately (because Step 2 seeded the connection).

## Common gotchas

- **`prompt is too long: NNNNNN tokens`** — the overlay added too many tools. Check `hermes mcp test composio-<x>` in the container; trim the allowlist or split a toolkit further.
- **`Invalid toolkit slugs`** — Composio's actual toolkit slug doesn't match the JSON. Run `node scripts/composio-list-tools.mjs --toolkit <slug>` to confirm.
- **`401 Unauthorized` from Composio MCP** — `COMPOSIO_API_KEY` is missing or empty in the profile's `.env`. Check `docker exec` into the container, grep the per-profile `.env`.
- **OAuth completes but `mcp_*` tool calls return "not connected"** — the `user_id` in the URL doesn't match the connected account's `user_id`. Compare the URL in `config.yaml` to the connected account in Composio dashboard.
- **First MCP call to a shared toolkit prompts OAuth** — Step 2 wasn't completed (no connected account for the shared user_id). Sign in once via the dashboard.

## Going further

- Add Teams later — repeat Steps 1, 3, 4 just for Teams. Use `--allowlists allowlists/teams-messaging.json --auth-configs '{"microsoft_teams":"ac_..."}'`.
- Add a new profile (e.g. `mybrand-head-of-finance`) — add it to the bash loop in Step 5; ship the change. The new profile inherits the overlay.
- Rotate a key — see `composio-rotate-key.mjs` (when shipped) or follow `docs/adding-a-toolkit.md#rotating-keys`.
