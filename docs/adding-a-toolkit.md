# Adding a toolkit to an existing brand

Use this when a brand is already up on the Composio pattern (`adding-a-brand.md` complete) and you need to introduce a new Composio toolkit — e.g. Teams, Notion, GitHub, Slack.

## Step 1 — Verify the toolkit exists in Composio

```bash
COMPOSIO_API_KEY=ak_... node scripts/composio-list-tools.mjs --toolkit <slug>
```

You should see the toolkit's full catalog. If the toolkit doesn't exist in Composio, this pattern doesn't apply — either build a custom MCP server or open a request with Composio.

## Step 2 — Decide entity scope

| Use case | Scope |
|---|---|
| Personal account per bot (each bot has its own login) | `per_profile` |
| Brand-owned single account shared by all bots | `shared` |

Examples:
- **Teams** → `per_profile` (each bot has its own work Teams identity)
- **GitHub** for org dashboards → `shared` (one bot identity reads the org)
- **Slack** for posting to a workspace → `shared` (the bot identity is the brand)
- **Notion** workspace → typically `shared`

## Step 3 — Create the auth config in Composio dashboard

1. https://app.composio.dev → your brand's Project → Auth Configs → Add.
2. Pick the toolkit. Use Composio-managed OAuth if available (fewer steps).
3. For API-key-auth toolkits, paste the key.
4. Save. Note the `ac_...` ID.

If the toolkit is `shared`, also seed the connected account now (dashboard → Connected Accounts → Add → enter `user_id` = brand slug → complete OAuth as the relevant human).

## Step 4 — Write an allowlist

Create `allowlists/<toolkit>-<purpose>.json`:

```json
{
  "toolkit": "microsoft_teams",
  "description": "Teams messaging: list channels, post messages, read recent.",
  "entity_scope": "per_profile",
  "notes": "Each bot signs in with its own Microsoft 365 account.",
  "tools": [
    "MICROSOFT_TEAMS_LIST_CHATS",
    "MICROSOFT_TEAMS_LIST_CHAT_MESSAGES",
    "MICROSOFT_TEAMS_SEND_CHANNEL_MESSAGE"
  ]
}
```

Tool slug rules of thumb:
- Open `composio-list-tools.mjs` output, pick 8–20 tools that cover the use case.
- Favour read tools and the most common write/create tool.
- Skip admin/management tools unless the use case is explicitly admin.

## Step 5 — Re-run the scaffold for just this toolkit

```bash
node scripts/composio-create-servers.mjs \
  --brand mybrand \
  --allowlists allowlists/teams-messaging.json \
  --auth-configs '{"microsoft_teams":"ac_..."}' \
  --output ./mybrand-teams-only.yaml
```

The script creates `mybrand-teams` MCP server and writes a single-entry overlay fragment.

## Step 6 — Add the entry to the brand overlay

Copy the new `composio-teams:` entry from `mybrand-teams-only.yaml` into the brand's existing overlay file alongside the other `composio-*` entries (in the brand deploy repo).

Mirror the same content into `docker-compose.yaml`'s inline `<brand>_mcp_overlay` config block.

## Step 7 — Deploy

Push the overlay change in your brand's deploy repo, open a PR, merge, let Coolify auto-deploy.

## Step 8 — Per-profile sign-in (if `per_profile`)

In chat, each bot user runs through the OAuth flow:

```
User → bot: "Connect my Teams"
Bot → calls mcp_composio_teams_COMPOSIO_INITIATE_CONNECTION
Bot → returns sign-in URL
User signs in
Connection is bound to user_id=<profile-slug>
```

For `shared` toolkits, Step 3's dashboard sign-in already seeded the connection — nothing to do here.

## Rotating keys (until `composio-rotate-key.mjs` ships)

When you rotate a Composio API key or a Clarity JWT:

1. Generate the new key in the source (Composio dashboard or Clarity dashboard).
2. **Composio dashboard:** update the auth config with the new value (for API-key auths) or revoke + re-sign-in (for OAuth).
3. **Coolify env:** update `COMPOSIO_API_KEY` for the brand's app.
4. **Redeploy** the brand's app so `runtime-seed` writes the new value to per-profile `.env`s.
5. Confirm chat still works.
6. Revoke the old key in the source.

Don't try to update connected accounts directly — let Composio handle the OAuth lifecycle.

## When to fork a toolkit's allowlist

If two brands need different surfaces from the same toolkit (e.g. Outlook with send vs read-only), don't try to parameterise — fork the allowlist:

```
allowlists/outlook-mail-calendar.json    # original
allowlists/outlook-readonly.json         # new fork
```

Then pass the right one per brand at scaffold time.

## When to retire a toolkit

To remove a toolkit from a brand:

1. Remove the `composio-<toolkit>:` entry from the brand overlay and `docker-compose.yaml`.
2. Deploy.
3. Delete the MCP server in Composio dashboard (or via `c.mcp.delete(id)` if you'd rather script it).
4. Optionally revoke the auth config + connected accounts in the dashboard.
