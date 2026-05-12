import type { SessionInputPreview } from "@/lib/sessionInput";
import { sanitizeTerminalCommand } from "@/lib/terminalCommand";

export interface TerminalInputState {
  value: string;
  cursor: number;
  desynced: boolean;
  desyncReason: "tab" | "terminal" | null;
  lineRewriteRequired: boolean;
  multiline: boolean;
}

export function createTerminalInputState(): TerminalInputState {
  return {
    value: "",
    cursor: 0,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline: false,
  };
}

function resetState(multiline = false): TerminalInputState {
  return {
    value: "",
    cursor: 0,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline,
  };
}

function insertText(state: TerminalInputState, text: string): TerminalInputState {
  if (!text) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursor)}${text}${state.value.slice(state.cursor)}`,
    cursor: state.cursor + text.length,
  };
}

function deleteLeft(state: TerminalInputState): TerminalInputState {
  if (state.cursor === 0) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursor - 1)}${state.value.slice(state.cursor)}`,
    cursor: state.cursor - 1,
  };
}

function deleteRight(state: TerminalInputState): TerminalInputState {
  if (state.cursor >= state.value.length) {
    return state;
  }

  return {
    ...state,
    value: `${state.value.slice(0, state.cursor)}${state.value.slice(state.cursor + 1)}`,
  };
}

function deletePreviousWord(state: TerminalInputState): TerminalInputState {
  if (state.cursor === 0) {
    return state;
  }

  let start = state.cursor;
  while (start > 0 && /\s/u.test(state.value[start - 1] ?? "")) {
    start -= 1;
  }
  while (start > 0 && !/\s/u.test(state.value[start - 1] ?? "")) {
    start -= 1;
  }

  return {
    ...state,
    value: `${state.value.slice(0, start)}${state.value.slice(state.cursor)}`,
    cursor: start,
  };
}

function markDesynced(
  state: TerminalInputState,
  reason: "tab" | "terminal",
  multiline = false,
): TerminalInputState {
  return {
    ...state,
    desynced: true,
    desyncReason: reason,
    lineRewriteRequired: state.lineRewriteRequired || reason === "tab",
    multiline,
  };
}

function replaceValue(value: string): TerminalInputState {
  return {
    value,
    cursor: value.length,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline: false,
  };
}

function normalizeLineContent(value: string): string {
  return value.replace(/\r?\n/gu, "").trimEnd();
}

function addCandidate(candidates: Set<string>, value: string): void {
  const normalized = normalizeLineContent(value);
  if (normalized.trim()) {
    candidates.add(normalized);
  }
}

function addSuffixCandidate(candidates: Set<string>, source: string, prefix: string): void {
  const normalizedSource = normalizeLineContent(source);
  const normalizedPrefix = normalizeLineContent(prefix);
  if (!normalizedSource || !normalizedPrefix) {
    return;
  }

  const index = normalizedSource.lastIndexOf(normalizedPrefix);
  if (index >= 0) {
    addCandidate(candidates, normalizedSource.slice(index));
  }
}

function chooseTerminalLineCommand(previousValue: string, lineContent: string): string | null {
  const previousCommand = sanitizeTerminalCommand(previousValue);
  const sanitizedLine = sanitizeTerminalCommand(lineContent);
  const candidates = new Set<string>();

  addCandidate(candidates, sanitizedLine);
  addCandidate(candidates, lineContent);
  addSuffixCandidate(candidates, lineContent, previousValue);
  addSuffixCandidate(candidates, lineContent, previousCommand);
  addSuffixCandidate(candidates, sanitizedLine, previousValue);
  addSuffixCandidate(candidates, sanitizedLine, previousCommand);

  let best: { value: string; score: number } | null = null;
  for (const candidate of candidates) {
    const command = sanitizeTerminalCommand(candidate);
    if (!command) {
      continue;
    }

    const score = previousCommand && command.startsWith(previousCommand) ? command.length : 0;
    if (previousCommand && score === 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { value: command, score };
    }
  }

  return best?.value ?? null;
}

export function applyTerminalInputData(
  state: TerminalInputState,
  data: string,
): TerminalInputState {
  if (!data) {
    return state;
  }

  switch (data) {
    case "\r":
      return resetState();
    case "\u0003":
      return resetState();
    case "\u0001":
      return { ...state, cursor: 0 };
    case "\u0005":
      return { ...state, cursor: state.value.length };
    case "\u0015":
      return { ...state, value: state.value.slice(state.cursor), cursor: 0 };
    case "\u0017":
      return deletePreviousWord(state);
    case "\u000b":
      return { ...state, value: state.value.slice(0, state.cursor) };
    case "\u000c":
      return state;
    case "\u007f":
    case "\b":
      return deleteLeft(state);
    case "\x1b[D":
    case "\x1bOD":
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case "\x1b[C":
    case "\x1bOC":
      return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) };
    case "\x1b[H":
    case "\x1bOH":
      return { ...state, cursor: 0 };
    case "\x1b[F":
    case "\x1bOF":
      return { ...state, cursor: state.value.length };
    case "\x1b[3~":
      return deleteRight(state);
    case "\t":
      return markDesynced(state, "tab");
  }

  if (data.includes("\n") || data.includes("\r")) {
    return resetState(true);
  }

  if (data.startsWith("\x1b")) {
    return markDesynced(state, "terminal");
  }

  if (/[\x00-\x1f\x7f]/u.test(data)) {
    return markDesynced(state, "terminal");
  }

  if (state.desynced && state.desyncReason === "tab") {
    return insertText(
      {
        ...state,
        desynced: false,
        desyncReason: null,
        lineRewriteRequired: true,
      },
      data,
    );
  }

  return insertText(state, data);
}

export function applyTerminalInputPreview(
  state: TerminalInputState,
  preview: SessionInputPreview,
): TerminalInputState {
  switch (preview.kind) {
    case "data":
      return applyTerminalInputData(state, preview.data);
    case "replace":
      return replaceValue(preview.value);
    case "replace-and-execute":
      return resetState();
    case "reset":
      return resetState();
  }
}

export function getTrackedCommand(state: TerminalInputState): string {
  if (state.desynced || state.multiline) {
    return "";
  }
  return sanitizeTerminalCommand(state.value);
}

export function canRegisterCommandFromTracker(state: TerminalInputState): boolean {
  return !state.desynced && !state.multiline && !state.lineRewriteRequired;
}

export function getTrackedSubmissionCommand(state: TerminalInputState): string {
  if (!canRegisterCommandFromTracker(state)) {
    return "";
  }

  return sanitizeTerminalCommand(state.value);
}

/**
 * Replace the tracker value with command text read from the terminal buffer.
 * Used after a tab-desync recovery: the terminal line contains the real input
 * including shell-completed text, while the tracker only has stale keystrokes.
 */
export function resyncFromTerminalLine(
  current: TerminalInputState,
  lineContent: string,
): TerminalInputState | null {
  const value = chooseTerminalLineCommand(current.value, lineContent);
  if (!value) {
    return null;
  }

  return {
    value,
    cursor: value.length,
    desynced: false,
    desyncReason: null,
    lineRewriteRequired: false,
    multiline: false,
  };
}

export function canSuggestFromTracker(state: TerminalInputState): boolean {
  return (
    !state.desynced &&
    !state.multiline &&
    state.cursor === state.value.length &&
    getTrackedCommand(state).length > 0
  );
}
