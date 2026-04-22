import type { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef } from "react";
import { KeywordHighlighter } from "../lib/keywordHighlighter";
import { getBuiltinRules } from "../lib/keywordHighlightPresets";
import type { AppSettings, KeywordHighlightRule } from "../types/global";

/**
 * Creates and manages a KeywordHighlighter tied to the terminal session lifecycle.
 *
 * Rule priority: built-in rules are compiled first, user rules last.
 * xterm registers decorations in that order, so user-rule decorations render
 * on top and visually override built-in ones when patterns overlap.
 *
 * isDark should be derived from the current theme's background luminance so
 * built-in rule colors switch automatically when the user changes themes.
 */
export function useKeywordHighlighter(
  terminalRef: React.RefObject<Terminal | null>,
  terminalSettings: AppSettings["terminal"],
  sessionId: string,
  isDark: boolean,
  suspended = false,
): void {
  const highlighterRef = useRef<KeywordHighlighter | null>(null);
  const enabled = terminalSettings.keyword_highlights_enabled ?? false;

  // Merge user rules (higher priority) + built-in rules (lower priority).
  // User rules carry two color fields; pick the right one for the current theme
  // so the highlighter engine always receives a single resolved color.
  const mergedRules = useMemo(() => {
    const builtin = getBuiltinRules(isDark);
    const user = (terminalSettings.keyword_highlights ?? []).map((r: KeywordHighlightRule) => ({
      id: r.id,
      name: r.name,
      patterns: r.patterns,
      color: isDark ? r.color_dark : r.color_light,
      enabled: r.enabled,
    }));
    // User rules go first so they match and occupy string positions before built-ins
    return [...user, ...builtin];
  }, [isDark, terminalSettings.keyword_highlights]);

  // Create the highlighter once per terminal session.
  // Relies on XTerminal's terminal-creation effect running first (same dep).
  useEffect(() => {
    if (!enabled) {
      highlighterRef.current?.dispose();
      highlighterRef.current = null;
      return;
    }

    const term = terminalRef.current;
    if (!term) return;

    const highlighter = new KeywordHighlighter(term);
    highlighter.setRules(
      mergedRules,
      enabled,
      terminalSettings.keyword_highlights_across_wrapped_lines ?? false,
    );
    highlighter.setSuspended(suspended);
    highlighterRef.current = highlighter;

    return () => {
      highlighter.dispose();
      highlighterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, enabled]);

  // Re-push rules whenever settings change or theme family switches.
  useEffect(() => {
    const highlighter = highlighterRef.current;
    if (!highlighter) return;
    highlighter.setRules(
      mergedRules,
      enabled,
      terminalSettings.keyword_highlights_across_wrapped_lines ?? false,
    );
  }, [
    mergedRules,
    enabled,
    terminalSettings.keyword_highlights_across_wrapped_lines,
  ]);

  useEffect(() => {
    highlighterRef.current?.setSuspended(suspended);
  }, [suspended]);
}
