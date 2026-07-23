/**
 * Typed configuration — the ONLY place the server reads `process.env`.
 *
 * The env is decoded once at module load through an effect Schema struct, so
 * a malformed environment fails the boot loudly with a typed ParseError
 * instead of half-working at request time. Biome bans the `process` global
 * everywhere else under apps/server/src (composition root excepted), which
 * makes this funnel an enforced axiom, not a convention.
 */
import { Schema as S } from "effect"

const Env = S.Struct({
  PORT: S.optionalWith(S.NumberFromString, { default: () => 8787 }),
  APP_VERSION: S.optionalWith(S.String, { default: () => "0.0.0" }),
  /** Comma-separated extra CORS origins, e.g. "https://app.example.com". */
  CORS_ORIGINS: S.optionalWith(S.String, { default: () => "" }),
  NODE_ENV: S.optionalWith(S.Literal("development", "test", "production"), {
    default: () => "development" as const,
  }),
  // Default is a sane relative path for `bun run dev`. The container image
  // (apps/server/Dockerfile) overrides this via `ENV NOTES_DB_PATH=...` to a
  // writable, non-root-owned directory — the env var always wins here.
  NOTES_DB_PATH: S.optionalWith(S.String, { default: () => "notes.sqlite" }),
})

const env = S.decodeUnknownSync(Env)(process.env)

// The Vite dev server origin — only a sane default outside production; a
// production deploy must opt in via CORS_ORIGINS instead of inheriting a
// localhost origin it will never see traffic from.
const DEFAULT_ORIGINS = env.NODE_ENV === "production" ? [] : ["http://localhost:5173"]

export const appConfig = {
  port: env.PORT,
  version: env.APP_VERSION,
  nodeEnv: env.NODE_ENV,
  notesDbPath: env.NOTES_DB_PATH,
  corsOrigins: [
    ...DEFAULT_ORIGINS,
    ...env.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ],
} as const
