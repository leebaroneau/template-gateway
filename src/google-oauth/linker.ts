import type { GatewayConnectionBackend } from "../admin/types.js";
import type { GatewayAccountStore } from "../account-credentials/store.js";
import type { GatewayGoogleStore } from "./store.js";
import type { GoogleOAuthAdapter } from "./adapter.js";
import {
  googleConnectorBinding,
  type GoogleLinkPlan,
  type GoogleLinkPlanEntry,
  type GoogleLinkRequest,
  type GoogleLinkResult
} from "./types.js";
import type { AccessAuditInput } from "../access/types.js";
import type { GatewayAccessStore } from "../access/store.js";

// Normalise resource ids per product so GA4 properties/ prefix and Ads
// dashes/spaces are handled consistently.
function normaliseResourceId(connectorSlug: string, raw: string): string {
  const trimmed = raw.trim();
  if (connectorSlug === "google-ads") {
    return trimmed.replace(/[\s-]/g, "");
  }
  return trimmed;
}

export class GoogleAccountLinker {
  constructor(
    private readonly backend: GatewayConnectionBackend,
    private readonly accountStore: GatewayAccountStore,
    private readonly googleStore: GatewayGoogleStore,
    private readonly adapter: GoogleOAuthAdapter,
    private readonly accessStore?: GatewayAccessStore
  ) {}

  async buildPlan(accountId: string): Promise<GoogleLinkPlan> {
    const account = this.accountStore.getAccount(accountId);
    if (!account || account.service !== "google") {
      const err = new Error("Account not found") as Error & { code: string };
      err.code = "not_found";
      throw err;
    }
    if (account.status !== "connected") {
      const err = new Error("Account not connected") as Error & { code: string };
      err.code = "conflict";
      throw err;
    }

    const state = await this.backend.snapshot();
    const connectorMap = new Map(state.connectors.map((c) => [c.id, c]));

    const entries: GoogleLinkPlanEntry[] = [];

    for (const connection of state.connections) {
      const connector = connectorMap.get(connection.connectorId);
      if (!connector) continue;

      const binding = googleConnectorBinding[connector.slug];
      if (!binding) continue;

      const { product, configKey } = binding;
      const connectorSlug = connector.slug;
      const rawId = connection.configSummary[configKey];
      const resourceId = rawId ? normaliseResourceId(connectorSlug, String(rawId)) : undefined;

      const entry: GoogleLinkPlanEntry = {
        connectionId: connection.id,
        brandId: connection.brandId,
        regionId: connection.regionId,
        connectorSlug,
        product,
        resourceId,
        resourceName: connection.displayName,
        status: "proposed"
      };

      if (!resourceId) {
        entry.status = "unmatched";
        entry.reason = `configSummary has no ${configKey}`;
        entries.push(entry);
        continue;
      }

      const existingLink = this.accountStore.getLinkForScope({
        service: "google",
        brandId: connection.brandId,
        regionId: connection.regionId,
        connectorSlug
      });

      if (existingLink && existingLink.accountId === accountId) {
        entry.status = "already_linked";
        entry.existingLinkId = existingLink.id;
      }

      entries.push(entry);
    }

    const counts = {
      proposed: entries.filter((e) => e.status === "proposed").length,
      alreadyLinked: entries.filter((e) => e.status === "already_linked").length,
      unmatched: entries.filter((e) => e.status === "unmatched").length
    };

    return {
      accountId,
      googleAccountEmail: account.externalAccountId,
      entries,
      counts
    };
  }

  async applyLinks(
    accountId: string,
    request: GoogleLinkRequest,
    fetchFn: typeof fetch = fetch
  ): Promise<GoogleLinkResult> {
    const plan = await this.buildPlan(accountId);
    const proposed = plan.entries.filter((e) => e.status === "proposed");

    const targets =
      request.connectionIds && request.connectionIds.length > 0
        ? proposed.filter((e) => request.connectionIds!.includes(e.connectionId))
        : proposed;

    const linked: GoogleLinkResult["linked"] = [];
    const skipped: GoogleLinkResult["skipped"] = [];

    for (const entry of targets) {
      try {
        const linkId = this.accountStore.linkAccount({
          accountId,
          brandId: entry.brandId,
          regionId: entry.regionId,
          connectorSlug: entry.connectorSlug,
          connectionId: entry.connectionId
        });

        const credentialId = await this.adapter.provisionConnectionCredential(
          {
            accountId,
            brandId: entry.brandId,
            regionId: entry.regionId,
            connectorSlug: entry.connectorSlug,
            product: entry.product,
            resourceId: entry.resourceId!,
            resourceName: entry.resourceName
          },
          fetchFn,
          this.accountStore
        );

        this.accountStore.setLinkConnectionId(linkId, entry.connectionId);

        if (this.accessStore) {
          this.accessStore.writeAccessAudit({
            action: "oauth_account_link.created",
            targetType: "oauth_account_link",
            targetId: linkId,
            detail: `Linked ${entry.connectorSlug} for ${entry.brandId}/${entry.regionId}`,
            actor: "system"
          } satisfies AccessAuditInput);
          this.accessStore.writeAccessAudit({
            action: "connection.saved",
            targetType: "connection",
            targetId: entry.connectionId,
            detail: `Credential provisioned via account ${accountId}`,
            actor: "system"
          } satisfies AccessAuditInput);
        }

        linked.push({ connectionId: entry.connectionId, linkId, credentialId });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        skipped.push({ connectionId: entry.connectionId, reason });
      }
    }

    // Add unmatched entries to skipped (always, spec says "unmatched ... are returned in skipped")
    for (const entry of plan.entries.filter((e) => e.status === "unmatched")) {
      if (!request.connectionIds || request.connectionIds.includes(entry.connectionId)) {
        skipped.push({
          connectionId: entry.connectionId,
          reason: `unmatched: ${entry.reason ?? "no resource id"}`
        });
      }
    }

    // Add proposed-but-not-requested entries to skipped
    if (request.connectionIds && request.connectionIds.length > 0) {
      const linkedIds = new Set(linked.map((l) => l.connectionId));
      const skippedIds = new Set(skipped.map((s) => s.connectionId));
      for (const entry of plan.entries.filter((e) => e.status === "proposed")) {
        if (!linkedIds.has(entry.connectionId) && !skippedIds.has(entry.connectionId)) {
          skipped.push({ connectionId: entry.connectionId, reason: "not requested" });
        }
      }
    }

    return { accountId, linked, skipped };
  }
}
