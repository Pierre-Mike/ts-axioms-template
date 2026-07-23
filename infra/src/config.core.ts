/**
 * PURE infra config — mirrors apps/server platform/config.ts: stack config is
 * decoded once through an effect Schema, malformed input is an Either.Left
 * (a value), and the shell (index.ts) decides how to fail. No Pulumi imports
 * here; the core stays data-in / data-out.
 */
import { Either, Schema as S } from "effect"

export const TARGET_NAMES = ["aws", "azure", "cloudflare", "gcp"] as const
export type TargetName = (typeof TARGET_NAMES)[number]

/** Cloud-resource-safe name: lowercase, digits, dashes; must start with a letter. */
const ServiceName = S.String.pipe(S.pattern(/^[a-z][a-z0-9-]{0,48}$/))

const InfraConfigSchema = S.Struct({
  target: S.Literal(...TARGET_NAMES),
  serviceName: S.optionalWith(ServiceName, { default: () => "ts-axioms-server" }),
  appVersion: S.optionalWith(S.String, { default: () => "0.0.0" }),
})

export type InfraConfig = typeof InfraConfigSchema.Type

export const decodeInfraConfig = (raw: unknown): Either.Either<InfraConfig, string> =>
  Either.mapLeft(S.decodeUnknownEither(InfraConfigSchema)(raw), (error) => error.message)

/**
 * GCP adapter-local config. Decoded inside targets/gcp.ts (its own impure
 * shell reads `gcp.config.region` and a `ts-axioms:allowPublicAccess` stack
 * value) so the ad-hoc `?? "europe-west1"` default and the "public by
 * default" invoker grant both go through the same typed-config-fails-fast
 * discipline as the rest of the repo, instead of silent fallbacks.
 */
const GcpRuntimeConfigSchema = S.Struct({
  region: S.optionalWith(S.String, { default: () => "europe-west1" }),
  /** Grants `roles/run.invoker` to `allUsers`. Private by default. */
  allowPublicAccess: S.optionalWith(S.Boolean, { default: () => false }),
})

export type GcpRuntimeConfig = typeof GcpRuntimeConfigSchema.Type

export const decodeGcpRuntimeConfig = (raw: unknown): Either.Either<GcpRuntimeConfig, string> =>
  Either.mapLeft(S.decodeUnknownEither(GcpRuntimeConfigSchema)(raw), (error) => error.message)
