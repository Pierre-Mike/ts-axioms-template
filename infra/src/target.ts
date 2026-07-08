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
}

export interface ServerDeployResult {
  readonly url: Output<string>
}

export interface DeployTarget {
  readonly deployServer: (args: ServerDeployArgs) => ServerDeployResult
}
