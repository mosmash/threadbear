# Native Linux trial

`launch.py` runs the pinned Node runner and its scoped model relay and protected
setup helper as systemd user services, without Docker. Linux bubblewrap is the
native filesystem boundary: the runner gets only its trial home, state, workspace
and scoped model key. Helpers receive separate grants; the upstream key and
Cloud account/deployment credentials never enter the runner. Ask remains the
native permission default. Agent tools may create nested user namespaces.

The runner's virtual paths match the former deployment, preserving native CLI
sessions without rewriting transcripts. It sees a private `/proc`, `/dev` and
`/tmp`, read-only system programs/certificates and the installed runtime. Host
home, Windows mounts, Docker/SSH/WSL sockets and other services' private files
are absent. Network access remains the host network, including loopback; this
is not an egress firewall or a separate Unix account. All Threadbear agents
share their trial state. The approved permission choices still apply inside
this filesystem boundary, including an explicit Full choice by the user.

Install audited Node 24.22.1, locked root/runner dependencies and the Codex
lockfile from `../docker/codex/` into a private `native/runtime` snapshot. Put
Node's distribution under its `runtime/node/` and this deployment code in
`deploy/native/`. Artifact receipts must pin the source, binary versions and
hashes. Extraction of the already audited runner image is a valid initial
installation; subsequent execution and backup/restore require no image.
The runner uses the SDK's pinned Claude executable, never a host OAuth login.
Keep the eight-model filtered catalog and the provider policy in their owning
files under `../docker/`; native deployment reuses those modules.

The role units assume a private `~/services/threadbear` root. Install them under
`~/.config/systemd/user/`, create `native/logs/` mode 0700 and supply
`native/cloud-site-origin` with the fixed HTTPS Cloud site. The launcher
validates the site through the existing edge module. Loopback listeners are
8797 (authenticated RPC), 18318 (capped model relay) and 13211 (setup edge).
Point private Serve at the edge without changing saved setup links. Enable
`threadbear-model-relay`, `threadbear-site-edge` and `threadbear-runner`.
Logs rotate at 5 MiB with two older segments per role; they remain private.
Systemd restarts the complete process group with bounded memory/CPU/PIDs.

The `cloud-cli` role is a one-shot worker with only `cloud/home` and `cloud/work`
writable. It reads its request on stdin through `cloud-command.mjs`; do not
place deployment keys in argv or grant this role's mounts to the runner.

Before cutover, check the authenticated runner is idle and make a private cold
checkpoint. Stop the original runner before starting its replacement. Migrate
only trial state, keep Cloud URLs, runner identity, pairing and account defaults,
then validate both adapters, authenticated Cloud commands, setup refusal,
controlled terminal execution and restart recovery. Remove only verified retired
trial Docker objects after validation, preserving data and checked backups.
The host's private owning runbook defines checkpoint/restore and rollback.
