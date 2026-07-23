/**
 * GCP adapter — the working reference implementation of DeployTarget.
 * Artifact Registry repo -> docker-build image push -> Cloud Run v2 service.
 * Cloud Run injects PORT; the server's typed config picks it up at boot.
 */
import * as dockerBuild from "@pulumi/docker-build"
import * as gcp from "@pulumi/gcp"
import * as pulumi from "@pulumi/pulumi"
import { Either } from "effect"
import { decodeGcpRuntimeConfig } from "../config.core"
import type { DeployTarget, ServerDeployArgs, ServerDeployResult } from "../target"

// Matches the writable data dir the container image creates for the
// notes.io sqlite file (apps/server/Dockerfile: `ENV NOTES_DB_PATH=...`).
// Set explicitly here too so the Cloud Run service definition is a complete,
// legible record of what the container needs — not something you have to
// go find in the Dockerfile.
const NOTES_DB_PATH = "/app/data/notes.sqlite"

const deployServer = ({ serviceName, appVersion, env }: ServerDeployArgs): ServerDeployResult => {
  const decoded = decodeGcpRuntimeConfig({
    region: gcp.config.region,
    allowPublicAccess: new pulumi.Config("ts-axioms").getBoolean("allowPublicAccess"),
  })
  if (Either.isLeft(decoded)) {
    throw new Error(`invalid gcp target config: ${decoded.left}`)
  }
  const { region: location, allowPublicAccess } = decoded.right

  const repo = new gcp.artifactregistry.Repository("server-images", {
    repositoryId: `${serviceName}-images`,
    format: "DOCKER",
    location,
  })

  const imageRef = pulumi.interpolate`${location}-docker.pkg.dev/${repo.project}/${repo.repositoryId}/${serviceName}`

  const image = new dockerBuild.Image("server-image", {
    tags: [pulumi.interpolate`${imageRef}:${appVersion}`],
    context: { location: "../.." },
    dockerfile: { location: "../../apps/server/Dockerfile" },
    platforms: ["linux/amd64"],
    push: true,
  })

  // NOTE — ephemeral disk: Cloud Run's container filesystem is per-instance
  // tmpfs, wiped on every scale event, restart, or new revision. A sqlite
  // file at NOTES_DB_PATH is NOT durable across instances — fine for a demo,
  // not for real data. For actual persistence, either mount a durable volume
  // (Cloud Run NFS/GCS FUSE volume mounts), move Notes to Cloud SQL, or
  // replicate the sqlite file to object storage with litestream
  // (https://litestream.io).
  const service = new gcp.cloudrunv2.Service(serviceName, {
    location,
    ingress: "INGRESS_TRAFFIC_ALL",
    template: {
      containers: [
        {
          image: image.ref,
          envs: [
            { name: "APP_VERSION", value: appVersion },
            { name: "NOTES_DB_PATH", value: NOTES_DB_PATH },
            ...Object.entries(env ?? {}).map(([name, value]) => ({ name, value })),
          ],
        },
      ],
    },
  })

  // Private by default — opt in with `pulumi config set ts-axioms:allowPublicAccess true`.
  if (allowPublicAccess) {
    new gcp.cloudrunv2.ServiceIamMember("public-invoker", {
      name: service.name,
      location,
      role: "roles/run.invoker",
      member: "allUsers",
    })
  }

  return { url: service.uri }
}

export const gcpTarget = (): DeployTarget => ({ deployServer })
