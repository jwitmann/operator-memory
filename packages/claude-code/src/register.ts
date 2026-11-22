import type { ModApi, On } from "./types";

let preamble: Promise<string | null> | null = null;

async function loadPreamble($: ModApi): Promise<string | null> {
  try {
    const cwd = await $.session.cwd();
    const result = await $.process.run(["vcc-brain-helper", "preamble"], { cwd });
    if (result.exitCode === 0) return result.stdout;
  } catch {
    // A missing Helper and a failed subprocess share the same recovery path.
  }

  $.ui.log(
    "VCC Brain could not run vcc-brain-helper preamble. Install or repair @jwitmann/vcc-brain-helper globally, then restart Claude Code.",
  );
  return null;
}

function render($: ModApi): Promise<string | null> {
  preamble ??= loadPreamble($);
  return preamble;
}

export function register(on: On): void {
  on("session.start", async ($, event, next) => {
    void $.process.run(["vcc-brain-helper", "version"], undefined).catch(() => {});
    return next(event);
  });

  on("prompt.compose", async ($, event, next) => {
    const result = await next(event);
    const text = await render($);
    if (text === null) return result;
    return {
      ...result,
      sections: [...result.sections, { id: "vcc-brain:preamble", text, scope: "session" as const }],
    };
  });

  on("agent.spawn", async ($, event, next) => {
    const text = await render($);
    return next(text === null ? event : { ...event, prompt: text + event.prompt });
  });
}
