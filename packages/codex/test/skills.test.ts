import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "vitest";

const skills = [
  {
    command: "vcc-brain-helper user init",
    directory: "vcc-brain-user-init",
    name: "vcc-brain-user-init",
  },
  {
    command: "vcc-brain-helper project init",
    directory: "vcc-brain-project-init",
    name: "vcc-brain-project-init",
  },
  {
    command: "vcc-brain-helper index init",
    directory: "vcc-brain-index",
    name: "vcc-brain-index",
  },
] as const;

test("does not ship the retired repair skill", async () => {
  await expect(
    readFile(resolve(import.meta.dirname, "../skills/vcc-brain-repair/SKILL.md"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(skills)(
  "registers $name for explicit invocation",
  async ({ command, directory, name }) => {
    const skillDirectory = resolve(import.meta.dirname, "../skills", directory);
    const [instructions, metadata] = await Promise.all([
      readFile(resolve(skillDirectory, "SKILL.md"), "utf8"),
      readFile(resolve(skillDirectory, "agents/openai.yaml"), "utf8"),
    ]);

    expect(instructions).toContain(`name: ${name}`);
    expect(directory).toBe(name);
    expect(instructions).toContain("1. Run `vcc-brain-helper version`");
    expect(instructions).toContain("run `vcc-brain-helper upgrade` before continuing");
    expect(instructions).toContain(command);
    expect(instructions).toContain("npm package `@jwitmann/vcc-brain-helper` globally");
    expect(instructions).not.toContain("ask them to invoke");
    expect(instructions).not.toContain("vcc-brain-helper index status");
    expect(instructions).not.toContain("vcc-brain-helper user guide");
    expect(instructions).not.toContain("vcc-brain-helper project guide");
    expect(instructions).not.toContain("vcc-brain-helper index guide");
    expect(instructions).not.toContain("<vcc-brain-command>");
    expect(metadata).toContain("allow_implicit_invocation: false");
  },
);
