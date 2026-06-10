/**
 * Target registry. A TargetName maps to a DeployTarget factory; names without
 * an entry are valid config but fail at synth time with a pointer to this
 * file. Implement aws / azure / cloudflare case-by-case in targets/<name>.ts
 * (use targets/gcp.ts as the reference) and register them here.
 */
import type { TargetName } from "./config.core"
import type { DeployTarget } from "./target"
import { gcpTarget } from "./targets/gcp"

export const registry: Partial<Record<TargetName, () => DeployTarget>> = {
  gcp: gcpTarget,
}
