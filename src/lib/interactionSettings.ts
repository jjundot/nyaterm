function normalizeInteger(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.trunc(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const DEFAULT_COMMAND_SUGGESTION_MIN_CHARS = 2;
export const MIN_COMMAND_SUGGESTION_MIN_CHARS = 1;
export const MAX_COMMAND_SUGGESTION_MIN_CHARS = 500;
export const DEFAULT_COMMAND_SUGGESTION_MAX_CHARS = 64;
export const MIN_COMMAND_SUGGESTION_MAX_CHARS = 1;
export const MAX_COMMAND_SUGGESTION_MAX_CHARS = 500;

export function normalizeCommandSuggestionMinChars(
  value: number | null | undefined,
  maxValue: number | null | undefined = MAX_COMMAND_SUGGESTION_MIN_CHARS,
): number {
  const normalizedMax = clamp(
    normalizeInteger(maxValue, MAX_COMMAND_SUGGESTION_MIN_CHARS),
    MIN_COMMAND_SUGGESTION_MIN_CHARS,
    MAX_COMMAND_SUGGESTION_MIN_CHARS,
  );

  return clamp(
    normalizeInteger(value, DEFAULT_COMMAND_SUGGESTION_MIN_CHARS),
    MIN_COMMAND_SUGGESTION_MIN_CHARS,
    normalizedMax,
  );
}

export function normalizeCommandSuggestionMaxChars(
  value: number | null | undefined,
  minValue: number | null | undefined = MIN_COMMAND_SUGGESTION_MAX_CHARS,
): number {
  const normalizedMin = clamp(
    normalizeInteger(minValue, MIN_COMMAND_SUGGESTION_MAX_CHARS),
    MIN_COMMAND_SUGGESTION_MAX_CHARS,
    MAX_COMMAND_SUGGESTION_MAX_CHARS,
  );

  return clamp(
    normalizeInteger(value, DEFAULT_COMMAND_SUGGESTION_MAX_CHARS),
    normalizedMin,
    MAX_COMMAND_SUGGESTION_MAX_CHARS,
  );
}
