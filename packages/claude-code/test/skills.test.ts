import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const skills = [
  { name: "user-init", command: "user init" },
  { name: "project-init", command: "project init" },
  { name: "index", command: "index init" },
] as const;

test("does not ship the retired repair skill", async () => {
  await expect(
    readFile(resolve(import.meta.dirname, "../skills/repair/SKILL.md"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test.each(skills)(
  "registers /vcc-brain:$name for explicit invocation",
  async ({ name, command }) => {
    const instructions = await readFile(
      resolve(import.meta.dirname, `../skills/${name}/SKILL.md`),
      "utf8",
    );

    expect(instructions).toContain(`name: ${name}\n`);
    expect(instructions).toContain("disable-model-invocation: true");
    expect(instructions).not.toContain("allowed-tools:");
    expect(instructions).toContain("1. Run `vcc-brain-helper version`");
    expect(instructions).toContain("run `vcc-brain-helper upgrade` before continuing");
    expect(instructions).toContain(`2. Run \`vcc-brain-helper ${command}\``);
    expect(instructions).toContain("npm package `@jwitmann/vcc-brain-helper` globally");
    expect(instructions).not.toContain("$vcc-brain-");
    expect(instructions).not.toContain("!`");
  },
);
