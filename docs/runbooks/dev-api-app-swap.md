# Dev API App Swap Runbook

Use this runbook after importing Dev API app registrations into gateway API Access.

## Import

1. Build the gateway: `npm run build`.
2. Prepare `config/dev-api-apps.manifest.json` from the example manifest. It contains app names, owners, and scopes only; do not put secrets in it.
3. Run `node scripts/import-dev-api-apps.mjs`.
4. Copy the printed `gw_live_*` secrets immediately. They are not stored or re-fetchable.

Use `--dry-run` to validate the manifest and preview actions without writes. Use `--rotate` to issue a fresh overlap-window key for already-imported apps.

## Per-App Swap

For each app owner:

1. Change the base URL from the Dev API host to the gateway `/api/v1` host.
2. Replace `x-internal-client-id` and `x-internal-client-secret` with `Authorization: Bearer gw_live_...`.
3. Call an endpoint the app actually uses and confirm a `200`.
4. Confirm the gateway recorded API auth/read audit activity for the imported client.
5. Retire the old Dev API internal credential only after the app is verified on gateway access.

## Shared Database Note

Fresh databases are fixed by the current seed/import scripts. If an existing `gateway.sqlite` was first created by the old `seed-from-dev-api.mjs`, its `gateway_audit_events` table may have `created_at` instead of `timestamp` and non-null defaulted `metadata_json`.

Before importing on that database, reconcile the audit table to the store shape:

```sql
ALTER TABLE gateway_audit_events RENAME TO gateway_audit_events_old;
CREATE TABLE gateway_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json TEXT,
  timestamp TEXT NOT NULL
);
INSERT INTO gateway_audit_events (
  id, action, target_type, target_id, detail, actor, metadata_json, timestamp
)
SELECT id, action, target_type, target_id, detail, actor, metadata_json, created_at
FROM gateway_audit_events_old;
DROP TABLE gateway_audit_events_old;
```
