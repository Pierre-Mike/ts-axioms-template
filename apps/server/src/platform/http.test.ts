/**
 * Unit test for the HTTP error-mapping boundary: the `STATUS_BY_TAG`
 * allowlist behaviour of `errorEnvelope`, and the defect-catching
 * `onUnexpectedError` Hono error handler.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { decodeApiErrorBody } from "@ts-axioms/shared"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { validator } from "hono/validator"
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

  it("respects an HTTPException's status instead of redacting it to 500 (malformed JSON → 400)", async () => {
    // Same wiring as api.ts: onError + a validator("json") route. Hono's
    // validator throws HTTPException(400) on an unparsable body.
    const app = new Hono().onError(onUnexpectedError).post(
      "/notes",
      validator("json", (value) => value),
      (c) => c.json({ ok: true as const }),
    )

    const res = await app.request("/notes", {
      method: "POST",
      body: "{bad",
      headers: { "Content-Type": "application/json" },
    })
    expect(res.status).toBe(400)
    const body = decodeApiErrorBody(await res.json())
    expect(body.error._tag).toBe("HttpError")
    expect(body.error.status).toBe(400)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it("returns a custom HTTPException response verbatim (middleware-set headers survive)", async () => {
    const app = new Hono().onError(onUnexpectedError).get("/auth", () => {
      throw new HTTPException(401, {
        res: new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="notes"' },
        }),
      })
    })

    const res = await app.request("/auth")
    expect(res.status).toBe(401)
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="notes"')
  })
})
