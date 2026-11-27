import { expect, test } from "vitest";

import {
  detectExternalCompactionProvider,
  findExternalCompactionProvider,
} from "../src/provider-detect.ts";

test("detects foreign recall tools by exact name", () => {
  expect(
    detectExternalCompactionProvider([], [{ name: "vcc-recall", description: "recall" }]),
  ).toMatchObject({ kind: "tool" });
  expect(
    detectExternalCompactionProvider([], [{ name: "vcc-search", description: "search" }]),
  ).toMatchObject({ kind: "tool" });
});

test("ignores our own tools and unrelated tools", () => {
  expect(
    detectExternalCompactionProvider(
      [],
      [{ name: "vcc-brain-recall" }, { name: "recall-notes" }, { name: "grep" }],
    ),
  ).toBeNull();
});

test("detects the external engine by plugin id or local path", () => {
  expect(
    detectExternalCompactionProvider(
      [{ id: "opencode-vcc-port", source: { type: "local", path: "/x" }, state: {} }],
      [],
    ),
  ).toMatchObject({ kind: "plugin" });
  expect(
    detectExternalCompactionProvider(
      [{ source: { type: "local", path: "/home/u/opencode-vcc-port" }, state: {} }],
      [],
    ),
  ).toMatchObject({ kind: "plugin" });
  expect(
    detectExternalCompactionProvider(
      [{ id: "other", source: { type: "local", path: "/home/u/other-port" }, state: {} }],
      [],
    ),
  ).toBeNull();
});

test("findExternalCompactionProvider fails closed without list APIs", async () => {
  expect(await findExternalCompactionProvider({} as never)).toBeNull();
  expect(
    await findExternalCompactionProvider({
      plugin: { list: () => Promise.reject(new Error("down")) },
      tool: { list: () => Promise.resolve([]) },
    } as never),
  ).toBeNull();
});

test("findExternalCompactionProvider reads host listings", async () => {
  const context = {
    plugin: {
      list: () =>
        Promise.resolve({
          location: { directory: "/project" },
          data: [{ source: { type: "local", path: "/home/u/opencode-vcc-port" }, state: {} }],
        }),
    },
    tool: { list: () => Promise.resolve([]) },
  } as never;
  expect(await findExternalCompactionProvider(context)).toMatchObject({ kind: "plugin" });
});
