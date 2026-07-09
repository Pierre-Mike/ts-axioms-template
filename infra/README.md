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

The stack output `serverUrl` is the public URL; `GET <serverUrl>/health`
verifies the deploy end-to-end.

Optional config: `ts-axioms:serviceName` (default `ts-axioms-server`),
`ts-axioms:appVersion` (default `0.0.0`, surfaced by `/health`).

> [!WARNING]
> The reference GCP adapter is a demo posture, not a production one:
>
> - **The service is public and write-capable.** `targets/gcp.ts` grants
>   `roles/run.invoker` to `allUsers` — anyone on the internet can call every
>   route, including `POST /notes`. Put auth in front (IAM invoker binding,
>   IAP, or an app-level auth middleware) before deploying anything real.
> - **Note data is ephemeral and per-instance.** `bun:sqlite` writes to the
>   container's local filesystem; on Cloud Run that disk is in-memory and
>   per-replica. Notes are lost on every restart, deploy, or scale-to-zero,
>   and each replica keeps its own database — `NOTE_LIMIT` becomes a
>   per-replica limit. Use a managed database for real persistence.

> [!NOTE]
> `pulumi preview` is not read-only here: the `docker-build` image is built
> during preview, so it needs a running local Docker daemon. GCP calls
> authenticate via Application Default Credentials — run
> `gcloud auth application-default login` (and `gcloud auth configure-docker
> <region>-docker.pkg.dev` before `up` pushes the image).

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
