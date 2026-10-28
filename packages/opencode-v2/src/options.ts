import { failure, type Result, success } from "./utils.ts";

// Shared plugin-option readers. Every `operator.<block>` surface parses
// through these so absent blocks fall back to defaults while wrong-typed
// values fail loudly instead of running with unintended thresholds.

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
  const operator = "operator" in options ? options.operator : null;
  if (operator === null || operator === undefined) {
    return success(null);
  }
  if (typeof operator !== "object" || Array.isArray(operator)) {
    return failure({ message: 'The "operator" plugin option must be an object.' });
  }
  const section = block in operator ? (operator as Record<string, unknown>)[block] : null;
  if (section === null || section === undefined) {
    return success(null);
  }
  if (typeof section !== "object" || Array.isArray(section)) {
    return failure({ message: `The "operator.${block}" option must be an object.` });
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
