# infra/ — platform-agnostic deploy (Pulumi)

One Pulumi TypeScript program, one provider-neutral contract
(`src/target.ts`), one adapter per cloud. The deployable unit is the
container built from `apps/server/Dockerfile` — Bun runs everywhere a
container runs, so no provider dictates the runtime.

```
infra/
  Pulumi.yaml          # nodejs runtime, bun package manager
  src/
    config.core.ts     # PURE: stack config decoded via effect Schema -> Either
    config.core.test.ts
    target.ts          # DeployTarget contract (the provider-neutral interface)
    registry.ts        # TargetName -> adapter factory
    targets/
      gcp.ts           # reference adapter: Artifact Registry + Cloud Run v2
```

## Deploy

```bash
brew install pulumi            # once
cd infra && bun install

pulumi login                   # or: pulumi login --local
pulumi stack init dev
pulumi config set ts-axioms:target gcp
pulumi config set gcp:project <your-project>
pulumi config set gcp:region europe-west1

bun run preview                # pulumi preview
bun run up                     # build image, push, deploy Cloud Run
```

The stack output `serverUrl` is the public URL (once you opt into public
access — see below); `GET <serverUrl>/health` verifies the deploy end-to-end.

Optional config: `ts-axioms:serviceName` (default `ts-axioms-server`),
`ts-axioms:appVersion` (default `0.0.0`, surfaced by `/health`).

### GCP-specific config

- `gcp:region` — Cloud Run + Artifact Registry location. Defaults to
  `europe-west1` (decoded via `config.core.ts`'s `decodeGcpRuntimeConfig`, not
  an ad-hoc fallback).
- `ts-axioms:allowPublicAccess` (`pulumi config set ts-axioms:allowPublicAccess true`)
  — grants `roles/run.invoker` to `allUsers`. **Private by default**; the
  service has no public invoker until you opt in.

### Persistence caveat: sqlite on Cloud Run

Cloud Run's container filesystem is per-instance ephemeral tmpfs: it's wiped
on every scale event, restart, or new revision. The Notes slice's sqlite file
(`NOTES_DB_PATH`, set by `apps/server/Dockerfile` to `/app/data/notes.sqlite`)
is **not durable** across instances on this target — fine for demoing the
container, not for real data. For actual persistence, either mount a durable
volume (Cloud Run NFS/GCS FUSE volume mounts), move Notes to Cloud SQL, or
replicate the sqlite file to object storage with
[litestream](https://litestream.io).

## Adding a provider (aws / azure / cloudflare)

Targets are valid config the moment they parse, but unimplemented ones fail
at synth with a pointer here. Case-by-case:

1. Create `src/targets/<name>.ts` implementing `DeployTarget`
   (`targets/gcp.ts` is the reference — ~50 lines).
2. `bun add @pulumi/<provider>` in `infra/`.
3. Register the factory in `src/registry.ts`.
4. `bun run verify` at the repo root.

Suggested mappings for the same container:

| Target       | Service                                  |
| ------------ | ---------------------------------------- |
| `aws`        | ECS Fargate (+ ECR)                      |
| `azure`      | Container Apps (+ ACR)                   |
| `cloudflare` | Cloudflare Containers (or Workers via a Hono-only entry) |

Note for `cloudflare`: plain Workers cannot run Bun (`Bun.serve`,
`process.on` live in `apps/server/src/main.ts` only). The Hono app itself
(`api.ts`) is runtime-neutral — a Workers entrypoint exporting `app.fetch`
works if you bypass the Bun composition root.
