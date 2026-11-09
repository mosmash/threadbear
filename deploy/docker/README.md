# Isolated Linux trial

For a Docker-free WSL/Linux installation with separate native user services,
see [the native deployment](../native/README.md). Keep host-specific operational
state and receipts outside the checkout.

This fork adds a Docker runner for Linux and a self-hosted Convex backend.
The native macOS application and Mac-only tools are not included. Self-hosting
does not support Threadbear's hosted iPhone push relay. Native self-hosted pairing needs an
iPhone build newer than 1.0.4 (see `docs/self-hosting.md`); older clients reject
the tailnet origin before contacting the backend. The enrollment template makes
browser use primary and gates native pairing by that requirement.

`Dockerfile` pins the Node base and installs locked dependencies without package
lifecycle scripts. `Dockerfile.convex` changes only executable permissions on
the pinned official backend, allowing it to run as a nonroot user. Image tags
are deployment labels; keep the resulting image IDs with your private receipt.

Create a private directory outside this checkout for `runner/`, `home/`,
`workspace/`, `convex/`, `relay-state/` and `private/`. Run as UID/GID 1000,
with private files mode 0600 and directories mode 0700. Do not mount your home,
credentials, SSH agent, production workspaces or Docker socket.

Supply a private Compose environment file defining `THREADBEAR_DATA`,
`THREADBEAR_API_ORIGIN`, `THREADBEAR_SITE_ORIGIN`, `THREADBEAR_HOSTNAME` and
`THREADBEAR_TAILNET_IP`. Both origins must be reachable HTTPS endpoints from
the containers and phone. Preserve existing Tailscale Serve routes.

The runner's `runner.json` supports an optional `defaults.permissionMode`.
This trial sets `ask`, but an explicit client choice still wins. The optional
`THREADBEAR_BIND=0.0.0.0` enables container networking; the default remains
loopback. Keep the host-published RPC port on loopback.

The model relay grants selected Claude message and Codex Responses endpoints, with a
separate random app token, a model allowlist, two concurrent requests, 200
requests per UTC day and a 16,384-token output limit. Its upstream client key
stays outside the agent container. It assumes an existing Docker model proxy;
adapt that private dependency on another host. It never receives OAuth grants.

The runner includes the locked official Codex CLI. Its native Threadbear adapter
discovers a private Codex home with `auth.json`; use only the scoped trial relay
key there, never a host login. `codex/config.toml.example` configures the same
relay and a provider-matched model picker. `codex/SOURCE.md` owns the catalog
provenance. Claude and Codex share the request/concurrency/output caps. Keep the
native `ask` and explicit permission-mode behavior; Docker does not require
granting every Codex turn full access. Test the relay without a provider call
using `node --test deploy/docker/model-relay.test.mjs`.

`site-edge.mjs` forwards to the fixed Convex site and protects `/setup/` with
independent Basic authentication. Its private enrollment files contain short
lived native pairing links: never put them in Git, console output or reports.
The agent container does not receive enrollment admin credentials or a Convex
deployment admin key. Expired invitations must be renewed deliberately.

Run both Compose files together. Updates, telemetry, background model jobs and
full tool/pasted-image sync are disabled. Resource/PID/log limits and read-only
root filesystems apply. Runtime outbound networking is enabled; filesystem
isolation is not a complete network sandbox. Agents within the runner share
its disposable state and scoped model credential.

The deployment container is temporary. Use it to typecheck, deploy functions,
build the web client and upload static files with the new backend's admin key.
Do not add that key to the runner. Host-specific operational notes, backup
procedures, credentials and receipts belong outside this repository.

## Optional Convex Cloud backend

Use `compose.yaml` with `compose.cloud.yaml` instead of the self-hosted variant.
The runner remains isolated in Docker. Provision the Cloud project from a
separate disposable deployment worker, use native snapshot export/import for
an existing trial, and publish the web client with its Cloud URL. Set
`sync.url` and `sync.site` in the private runner configuration. Keep account and
deployment credentials outside the runner; it needs only its application key.
Never start both backends' writers against copied state.

The Cloud variant adds `THREADBEAR_CLOUD_SITE_ORIGIN` to the private Compose
environment. The setup service retains authenticated `/setup/` files and
redirects other GET/HEAD requests to that fixed HTTPS `.convex.site` origin.
It does not forward uploads or arbitrary destinations. Use
`enrollment-cloud.html` for Cloud pairing; the released iPhone client accepts
Cloud origins. Actual device pairing and push delivery need device validation.
With immutable dependency directories, build the website using
`npm run web:build -- --configLoader native` to avoid a Vite cache write.
