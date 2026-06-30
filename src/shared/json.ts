import { failure, success, type Result } from "./result";

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

const MAX_JSON_DEPTH = 64;

export const parseJsonValue = (
  input: unknown,
  depth = 0,
): Result<JsonValue> => {
  if (depth > MAX_JSON_DEPTH) {
    return failure(`JSON value exceeds maximum depth ${MAX_JSON_DEPTH}`);
  }
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return success(input);
  }
  if (typeof input === "number") {
    return Number.isFinite(input)
      ? success(input)
      : failure("JSON numbers must be finite");
  }
  if (Array.isArray(input)) {
    const output: JsonValue[] = [];
    for (let index = 0; index < input.length; index += 1) {
      if (!(index in input)) {
        return failure("Sparse arrays are not supported");
      }
      const item = parseJsonValue(input[index], depth + 1);
      if (!item.ok) return item;
      output.push(item.value);
    }
    return success(output);
  }
  if (typeof input !== "object" || input === undefined) {
    return failure("Value is not JSON serializable");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return failure("JSON objects must be plain objects");
  }
  const output: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    const item = parseJsonValue(value, depth + 1);
    if (!item.ok) return failure(`${key}: ${item.error}`);
    output[key] = item.value;
  }
  return success(output);
};

export const canonicalizeJson = (value: JsonValue): string => {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("Value is not JSON serializable");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const object = value as JsonObject;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(object[key]!)}`);
  return `{${entries.join(",")}}`;
};
