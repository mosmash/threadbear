# Codex Docker dependency

The lockfile pins the official Apache-2.0 `@openai/codex` package at 0.167.0,
including platform-package integrity hashes. Install without lifecycle scripts.

`models.json` is a filtered copy of the official model metadata at
[`rust-v0.167.0`](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/models-manager/models.json).
Only the language models also granted by `../model-policy.mjs` remain. Preserve
the upstream metadata; this is a picker catalog, not proof of account access.
When changing the pin, regenerate from that version and verify real turns.

Copy `config.toml.example` into this trial's private Codex home. Account discovery
also needs that home's `auth.json`; it may contain only the scoped trial relay
key. Never mount or copy host OAuth credentials. The entrypoint supplies the
existing mounted trial key as `THREADBEAR_MODEL_TOKEN`. Provider authentication
is owned by the upstream proxy. Keep permission policies in Threadbear's native
adapter; do not bypass them to enable Docker execution.
