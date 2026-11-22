import { expect, test } from "vitest";

import { renderTable } from "../src/output.ts";

test("renders borderless plaintext tables", () => {
  expect(
    renderTable([
      ["Name", "Status"],
      ["VCC Brain", "Ready"],
    ]),
  ).toBe("Name       Status\nVCC Brain  Ready");
});
