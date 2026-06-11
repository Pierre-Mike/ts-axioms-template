/**
 * Pulumi program — the imperative shell. Reads stack config (impure), decodes
 * it through the pure core (sandwich filling), dispatches to the selected
 * provider adapter, exports stack outputs.
 */
import * as pulumi from "@pulumi/pulumi"
import { Either } from "effect"
import { decodeInfraConfig } from "./config.core"
import { registry } from "./registry"

const stack = new pulumi.Config()

const decoded = decodeInfraConfig({
  target: stack.require("target"),
  serviceName: stack.get("serviceName"),
  appVersion: stack.get("appVersion"),
})
if (Either.isLeft(decoded)) {
  throw new Error(`invalid infra config: ${decoded.left}`)
}
const config = decoded.right

const makeTarget = registry[config.target]
if (makeTarget === undefined) {
  throw new Error(
    `target '${config.target}' is not implemented yet — implement DeployTarget in ` +
      `infra/src/targets/${config.target}.ts and register it in infra/src/registry.ts ` +
      `(targets/gcp.ts is the reference adapter)`,
  )
}

const { url } = makeTarget().deployServer({
  serviceName: config.serviceName,
  appVersion: config.appVersion,
})

export const serverUrl = url
