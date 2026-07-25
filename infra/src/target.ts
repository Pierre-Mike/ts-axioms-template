/**
 * The provider-neutral contract. A deploy target turns the repo's one
 * Dockerfile (apps/server/Dockerfile) into a running container service and
 * reports its public URL. Adding a provider = implementing this interface in
 * targets/<name>.ts and registering it in registry.ts. The registry
 * (`Partial<Record<TargetName, ...>>`) means an unregistered target name is
 * valid config, not a type error — it fails at synth time with a pointer to
 * registry.ts instead.
 */
import type { Output } from "@pulumi/pulumi"

export interface ServerDeployArgs {
  readonly serviceName: string
  readonly appVersion: string
  /**
   * Extra environment variables to inject into the deployed container (e.g.
   * NOTES_DB_PATH overrides, feature flags). Optional and additive so a
   * caller/adapter can start wiring config/secrets through without another
   * breaking change to this interface. Real secrets should be bound via the
   * target's secret manager (e.g. GCP Secret Manager -> Cloud Run secret env
   * vars) — never passed here as plaintext.
   */
  readonly env?: Record<string, string>
}

export interface ServerDeployResult {
  readonly url: Output<string>
}

export interface DeployTarget {
  readonly deployServer: (args: ServerDeployArgs) => ServerDeployResult
}
