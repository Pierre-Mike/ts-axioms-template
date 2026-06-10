/**
 * GCP adapter — the working reference implementation of DeployTarget.
 * Artifact Registry repo -> docker-build image push -> Cloud Run v2 service.
 * Cloud Run injects PORT; the server's typed config picks it up at boot.
 */
import * as dockerBuild from "@pulumi/docker-build"
import * as gcp from "@pulumi/gcp"
import * as pulumi from "@pulumi/pulumi"
import type { DeployTarget, ServerDeployArgs, ServerDeployResult } from "../target"

const deployServer = ({ serviceName, appVersion }: ServerDeployArgs): ServerDeployResult => {
  const location = gcp.config.region ?? "europe-west1"

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

  const service = new gcp.cloudrunv2.Service(serviceName, {
    location,
    ingress: "INGRESS_TRAFFIC_ALL",
    template: {
      containers: [
        {
          image: image.ref,
          envs: [{ name: "APP_VERSION", value: appVersion }],
        },
      ],
    },
  })

  new gcp.cloudrunv2.ServiceIamMember("public-invoker", {
    name: service.name,
    location,
    role: "roles/run.invoker",
    member: "allUsers",
  })

  return { url: service.uri }
}

export const gcpTarget = (): DeployTarget => ({ deployServer })
