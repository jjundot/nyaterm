import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellIntegrationState } from "@/hooks/useShellIntegration";
import type { FuzzyResult } from "@/types/global";

interface XTermCoreWithRenderDimensions {
  _core?: {
    _renderService?: {
      dimensions?: {
        css: {
          cell: {
            height: number;
            width: number;
          };
        };
      };
    };
  };
}

export function useCommandHistory(
  sessionId: string,
  terminalRef: React.RefObject<Terminal | null>,
  currentLineRef: React.RefObject<string>,
  shellIntegrationRef: React.RefObject<ShellIntegrationState>,
  readBufferCommand: () => string,
  enabled: boolean,
) {
  const [suggestions, setSuggestions] = useState<FuzzyResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ top: 0, left: 0 });

  const suggestionsRef = useRef<FuzzyResult[]>([]);
  const selectedIndexRef = useRef(-1);
  const showSuggestionsRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const getCursorViewportPosition = useCallback((): { top: number; left: number } => {
    try {
      const terminal = terminalRef.current;
      if (!terminal) return { top: 0, left: 0 };
      const core = (terminal as Terminal & XTermCoreWithRenderDimensions)._core;
      const dims = core?._renderService?.dimensions;
      if (!dims) return { top: 0, left: 0 };
      const cellHeight: number = dims.css.cell.height;
      const cellWidth: number = dims.css.cell.width;

      const cursorY = terminal.buffer.active.cursorY;
      const cursorX = terminal.buffer.active.cursorX;

      const screenEl = terminal.element?.querySelector(".xterm-screen");
      if (!screenEl) return { top: 0, left: 0 };

      const screenRect = screenEl.getBoundingClientRect();

      return {
        top: screenRect.top + (cursorY + 1) * cellHeight,
        left: screenRect.left + cursorX * cellWidth,
      };
    } catch {
      return { top: 0, left: 0 };
    }
  }, [terminalRef]);

  const dismissSuggestions = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (
      !showSuggestionsRef.current &&
      suggestionsRef.current.length === 0 &&
      selectedIndexRef.current === -1
    ) {
      return;
    }
    showSuggestionsRef.current = false;
    suggestionsRef.current = [];
    selectedIndexRef.current = -1;
    setSuggestions([]);
    setSelectedIndex(-1);
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      dismissSuggestions();
    }
  }, [enabled, dismissSuggestions]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const triggerSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!enabledRef.current) {
      dismissSuggestions();
      return;
    }

    if (currentLineRef.current.length === 0) {
      dismissSuggestions();
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      if (!enabledRef.current) {
        dismissSuggestions();
        return;
      }

      const pattern = readBufferCommand();
      if (!pattern.trim()) {
        dismissSuggestions();
        return;
      }
      try {
        // Parallel search across all suggestion providers.
        // To add a new provider, append another invoke() call here.
        const [historyResults, commandResults] = await Promise.all([
          invoke<FuzzyResult[]>("fuzzy_search_history", { pattern, limit: 8 }),
          invoke<FuzzyResult[]>("fuzzy_search_commands", { pattern, limit: 8 }),
        ]);

        // Merge, sort by score descending, and cap total
        const merged = [...historyResults, ...commandResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, 12);

        if (!enabledRef.current) {
          dismissSuggestions();
          return;
        }

        suggestionsRef.current = merged;
        selectedIndexRef.current = -1;
        showSuggestionsRef.current = merged.length > 0;
        setSuggestions(merged);
        setSelectedIndex(-1);
        setShowSuggestions(merged.length > 0);

        if (merged.length > 0) {
          setCursorPosition(getCursorViewportPosition());
        }
      } catch {
        // Ignore errors
      }
    }, 80);
  }, [readBufferCommand, dismissSuggestions, currentLineRef, getCursorViewportPosition]);

  const handleSelectSuggestion = useCallback(
    (command: string) => {
      const actualCmd = readBufferCommand();
      const eraseChars = "\x7f".repeat(actualCmd.length);
      invoke("write_to_session", {
        sessionId,
        data: `${eraseChars + command}\r`,
      }).catch(() => {});
      invoke("add_command_history", { sessionId, command }).catch(() => {});
      currentLineRef.current = "";
      shellIntegrationRef.current.fallbackNeedsDetection = true;

      dismissSuggestions();
      terminalRef.current?.focus();
    },
    [
      sessionId,
      readBufferCommand,
      dismissSuggestions,
      currentLineRef,
      shellIntegrationRef,
      terminalRef,
    ],
  );

  return {
    suggestions,
    selectedIndex,
    setSelectedIndex,
    showSuggestions,
    cursorPosition,
    suggestionsRef,
    selectedIndexRef,
    showSuggestionsRef,
    searchTimerRef,
    triggerSearch,
    dismissSuggestions,
    handleSelectSuggestion,
  };
}
