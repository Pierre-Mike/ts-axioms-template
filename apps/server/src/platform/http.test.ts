/**
 * Unit test for the HTTP error-mapping boundary: the `STATUS_BY_TAG`
 * allowlist behaviour of `errorEnvelope`, and the defect-catching
 * `onUnexpectedError` Hono error handler.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { decodeApiErrorBody } from "@ts-axioms/shared"
import { Hono } from "hono"
import { errorEnvelope, onUnexpectedError, type TaggedError } from "./http"

let consoleErrorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe("errorEnvelope", () => {
  it("passes a registered tag's real payload through at its mapped status", () => {
    // Not an inline literal at the call site — TaggedError's excess-property check
    // would otherwise reject the tag-specific `received` payload field.
    const error: TaggedError & { readonly received: string } = {
      _tag: "InvalidVerboseFlag",
      received: "banana",
    }
    const { body, status } = errorEnvelope(error)
    expect(status).toBe(400)
    expect(body).toEqual({ ok: false, error })
  })

  it("redacts an unregistered tag to a generic 500 and logs the real error server-side", () => {
    const error: TaggedError & { readonly secret: string } = {
      _tag: "SomethingInternal",
      secret: "x",
    }
    const { body, status } = errorEnvelope(error)
    expect(status).toBe(500)
    expect(body).toEqual({ ok: false, error: { _tag: "InternalServerError" } })
    expect(body.error).not.toHaveProperty("secret")
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})

describe("onUnexpectedError", () => {
  it("catches a thrown defect and returns the redacted envelope at 500", async () => {
    const app = new Hono().onError(onUnexpectedError).get("/boom", () => {
      throw new Error("kaboom")
    })

    const res = await app.request("/boom")
    expect(res.status).toBe(500)
    const body = decodeApiErrorBody(await res.json())
    expect(body).toEqual({ ok: false, error: { _tag: "InternalServerError" } })
    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
