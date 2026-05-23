# Service Auth Flow

Every service integration should follow the same gateway shape:

1. A user, agent, or API client requests access to a service through the gateway.
2. The gateway resolves the requested service provider and the actor making the request.
3. If that actor is not connected to the service, the gateway returns a login/connect URL that can be opened directly or sent in chat.
4. The actor logs in to the upstream service account they want the gateway to use.
5. The gateway stores the service authorization as an actor-to-service binding.
6. Future user, agent, MCP, CLI, or API requests for that service act as the logged-in upstream account, subject to gateway policy and audit.

The important invariant is that the gateway authorizes an entity to act as the exact service login that completed the connection flow. New services should not add a separate identity model.

## New Service Checklist

- Register the service in the provider registry with a stable slug, display name, auth mode, and MCP/API path.
- Provide a connect/start action that returns the upstream login URL for the current actor.
- Complete the OAuth or service-specific callback by binding returned credentials to the actor and provider slug.
- Reuse the template token storage and audit primitives instead of adding side stores.
- Require all service actions to resolve the current actor, provider binding, gateway policy, and audit context before calling the upstream API.
- Return a clear reconnect response when the actor has no binding or the upstream token needs renewal.
- Keep user, agent, API, MCP, and CLI paths on the same actor-to-service binding model.

