import { failure, type Result, success } from "./utils.ts";

// Shared plugin-option readers. Every `vcc-brain.<block>` surface parses
// through these so absent blocks fall back to defaults while wrong-typed
// values fail loudly instead of running with unintended thresholds. The
// legacy `operator` key is still accepted when `vcc-brain` is absent.

export type OptionError = {
  readonly message: string;
};

export function readOptionBlock(
  options: unknown,
  block: string,
): Result<Record<string, unknown> | null, OptionError> {
  if (typeof options !== "object" || options === null) {
    return success(null);
  }
  const primary = "vcc-brain" in options ? options["vcc-brain"] : undefined;
  const legacy = "operator" in options ? options.operator : undefined;
  const source = primary ?? legacy ?? null;
  if (source === null || source === undefined) {
    return success(null);
  }
  if (typeof source !== "object" || Array.isArray(source)) {
    return failure({
      message: 'The "vcc-brain" (legacy "operator") plugin option must be an object.',
    });
  }
  const section = block in source ? (source as Record<string, unknown>)[block] : null;
  if (section === null || section === undefined) {
    return success(null);
  }
  if (typeof section !== "object" || Array.isArray(section)) {
    return failure({ message: `The "vcc-brain.${block}" option must be an object.` });
  }
  return success(section as Record<string, unknown>);
}

export function readOptionNumber(
  path: string,
  block: Record<string, unknown>,
  key: string,
  defaultValue: number,
): Result<number, OptionError> {
  const value = block[key];
  if (value === undefined) {
    return success(defaultValue);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return failure({ message: `The "${path}.${key}" option must be a number.` });
  }
  return success(value);
}

export function readOptionString(
  path: string,
  block: Record<string, unknown>,
  key: string,
  defaultValue: string,
): Result<string, OptionError> {
  const value = block[key];
  if (value === undefined) {
    return success(defaultValue);
  }
  if (typeof value !== "string") {
    return failure({ message: `The "${path}.${key}" option must be a string.` });
  }
  return success(value);
}

export function readOptionBoolean(
  path: string,
  block: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): Result<boolean, OptionError> {
  const value = block[key];
  if (value === undefined) {
    return success(defaultValue);
  }
  if (typeof value !== "boolean") {
    return failure({ message: `The "${path}.${key}" option must be a boolean.` });
  }
  return success(value);
}
