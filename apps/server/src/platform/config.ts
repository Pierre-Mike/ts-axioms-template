/**
 * Typed configuration — the ONLY place the server reads `process.env`.
 *
 * The env is decoded once at module load through an @effect/schema struct, so
 * a malformed environment fails the boot loudly with a typed ParseError
 * instead of half-working at request time. Biome bans the `process` global
 * everywhere else under apps/server/src (composition root excepted), which
 * makes this funnel an enforced axiom, not a convention.
 */
import { Schema as S } from "@effect/schema"

const Env = S.Struct({
  PORT: S.optionalWith(S.NumberFromString, { default: () => 8787 }),
  APP_VERSION: S.optionalWith(S.String, { default: () => "0.0.0" }),
  /** Comma-separated extra CORS origins, e.g. "https://app.example.com". */
  CORS_ORIGINS: S.optionalWith(S.String, { default: () => "" }),
})

const env = S.decodeUnknownSync(Env)(process.env)

const DEFAULT_ORIGINS = ["http://localhost:5173"]

export const appConfig = {
  port: env.PORT,
  version: env.APP_VERSION,
  corsOrigins: [
    ...DEFAULT_ORIGINS,
    ...env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ],
} as const
