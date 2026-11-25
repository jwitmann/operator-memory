import { Effect, Result } from "effect";
import { afterEach, expect, test, vi } from "vitest";

import { NpmRegistry } from "../src/npm-registry.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("resolves a concrete latest package version", async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ version: "2.3.4" }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetch);

  const version = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* NpmRegistry.Service;
      return yield* registry.latestVersion("@jwitmann/vcc-brain-opencode-v2");
    }).pipe(Effect.provide(NpmRegistry.layer)),
  );

  expect(version).toBe("2.3.4");
  expect(fetch).toHaveBeenCalledWith(
    "https://registry.npmjs.org/%40jwitmann%2Fvcc-brain-opencode-v2/latest",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("returns a typed failure for an invalid registry response", async () => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 200 })));

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* NpmRegistry.Service;
      return yield* registry.latestVersion("@jwitmann/vcc-brain-helper");
    }).pipe(Effect.result, Effect.provide(NpmRegistry.layer)),
  );

  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure.message).toContain("Registry response has no version");
  }
});
