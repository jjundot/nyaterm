import type { IBufferLine, IDecoration, IDisposable, IMarker, Terminal as XTerm } from "@xterm/xterm";
import type { ResolvedHighlightRule } from "./keywordHighlightPresets";
import { XTERM_PERFORMANCE_CONFIG } from "./xtermPerformance";

interface CompiledRule {
  regex: RegExp;
  color: string;
}

interface CachedDecoration {
  decoration: IDecoration;
  marker: IMarker;
}

/**
 * Manages terminal decorations for keyword highlighting.
 *
 * Optimizations over a naive implementation:
 * - Decoration caching: reuses existing IDecoration/IMarker objects for lines that
 *   remain visible between viewport refreshes instead of dispose+recreate on every scroll.
 * - Fast ASCII path: skips building the wide-char cell map for lines with only ASCII chars.
 * - Deduplicates scroll/render events: onRender viewport-Y check replaces the redundant onScroll.
 * - Auto-invalidation: each decoration subscribes to its own onDispose so the cache stays
 *   consistent when xterm evicts lines that scroll off the scrollback buffer.
 * - Alternate buffer guard: clears decorations immediately when TUI apps (vim, htop) take over.
 */
export class KeywordHighlighter implements IDisposable {
  private term: XTerm;
  private compiledRules: CompiledRule[] = [];
  private decorationCache = new Map<string, CachedDecoration>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private disposables: IDisposable[] = [];
  private lastViewportY = -1;

  constructor(term: XTerm) {
    this.term = term;

    this.disposables.push(
      // Refresh when new output arrives
      this.term.onWriteParsed(() => this.triggerRefresh()),
      // Refresh on terminal resize (column/row count changes)
      this.term.onResize(() => this.triggerRefresh()),
      // onRender fires after every render cycle (cursor blink, scroll, data flush).
      // Viewport Y check avoids redundant work on cursor-blink-only redraws, and
      // makes a separate onScroll listener unnecessary.
      this.term.onRender(() => {
        const currentViewportY = this.term.buffer.active?.viewportY ?? 0;
        if (currentViewportY !== this.lastViewportY) {
          this.lastViewportY = currentViewportY;
          this.triggerRefresh();
        }
      }),
    );
  }

  public setRules(rules: ResolvedHighlightRule[], enabled: boolean): void {
    this.enabled = enabled;

    this.compiledRules = [];
    for (const rule of rules) {
      if (!rule.enabled || rule.patterns.length === 0) continue;
      for (const pattern of rule.patterns) {
        const trimmed = pattern.trim();
        if (!trimmed) continue;
        try {
          this.compiledRules.push({ regex: new RegExp(trimmed, "gi"), color: rule.color });
        } catch {
          // silently skip invalid regex
        }
      }
    }

    this.clearAllDecorations();
    if (this.enabled && this.compiledRules.length > 0) {
      this.triggerRefresh();
    }
  }

  public dispose(): void {
    this.clearAllDecorations();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private triggerRefresh(): void {
    if (!this.enabled || this.compiledRules.length === 0) return;

    if (this.term.buffer.active.type === "alternate") {
      this.clearAllDecorations();
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(
      () => this.refreshViewport(),
      XTERM_PERFORMANCE_CONFIG.highlighting.debounceMs,
    );
  }

  /**
   * Clear map before disposing so the per-decoration onDispose callbacks find
   * an empty map and become no-ops, avoiding re-entrant mutation.
   */
  private clearAllDecorations(): void {
    const entries = [...this.decorationCache.values()];
    this.decorationCache.clear();
    for (const { decoration, marker } of entries) {
      decoration.dispose();
      marker.dispose();
    }
  }

  /**
   * Build a string-index → cell-column map for lines that contain multibyte
   * characters (CJK, emoji, combining). For ASCII-only lines this is skipped.
   *
   * Example: "A中B"
   *   String indices:  0='A'  1='中'  2='B'
   *   Cell columns:    0      1(w=2)  3
   *   map → [0, 1, 3, 4]  (sentinel at end for calculating match width)
   */
  private buildStringToCellMap(line: IBufferLine): number[] {
    const map: number[] = [];
    let cellCol = 0;

    for (let col = 0; col < line.length; col++) {
      const cell = line.getCell(col);
      if (!cell) break;

      const chars = cell.getChars();
      const width = cell.getWidth();
      if (width === 0) continue; // continuation cell of a wide char

      for (let i = 0; i < chars.length; i++) {
        map.push(cellCol);
      }
      cellCol += width;
    }

    map.push(cellCol); // sentinel: end position
    return map;
  }

  private refreshViewport(): void {
    if (!this.term?.buffer?.active) return;

    const buffer = this.term.buffer.active;
    const viewportY = buffer.viewportY;
    const rows = this.term.rows;
    const cursorAbsoluteY = buffer.baseY + buffer.cursorY;

    const requiredKeys = new Set<string>();

    for (let y = 0; y < rows; y++) {
      const lineY = viewportY + y;
      const line = buffer.getLine(lineY);
      if (!line) continue;

      const lineText = line.translateToString(true);
      if (!lineText) continue;

      // Only build the wide-char map if actually needed (non-ASCII present)
      const hasMultibyte = /[^\u0000-\u00FF]/.test(lineText);
      let cellMap: number[] | null = null;
      if (hasMultibyte) {
        cellMap = this.buildStringToCellMap(line);
      }

      // Track occupied characters in the string to prevent multi-rule overlapping
      const occupied = new Uint8Array(lineText.length);

      // Pre-fill occupied array with cells that already have a custom foreground color
      // so we don't override the original shell output colors (e.g. from `ls --color`).
      for (let i = 0; i < lineText.length; i++) {
        const cellCol = cellMap ? (cellMap[i] ?? i) : i;
        const cell = line.getCell(cellCol);
        if (cell && !cell.isFgDefault()) {
          occupied[i] = 1;
        }
      }

      for (const { regex, color } of this.compiledRules) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(lineText)) !== null) {
          // Avoid infinite loops on empty matches
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }

          const strStart = match.index;
          const strEnd = strStart + match[0].length;

          // Check for collision with higher-priority matches or existing ANSI colors
          let isOverlapping = false;
          for (let k = strStart; k < strEnd; k++) {
            if (occupied[k]) {
              isOverlapping = true;
              break;
            }
          }
          if (isOverlapping) continue;

          // Mark as occupied
          for (let k = strStart; k < strEnd; k++) {
            occupied[k] = 1;
          }

          let cellStartCol: number;
          let cellEndCol: number;

          if (hasMultibyte) {
            cellStartCol = cellMap![strStart] ?? strStart;
            cellEndCol = cellMap![strEnd] ?? strEnd;
          } else {
            cellStartCol = match.index;
            cellEndCol = match.index + match[0].length;
          }

          const cellWidth = cellEndCol - cellStartCol;
          if (cellWidth <= 0) continue;

          const key = `${lineY}:${cellStartCol}:${cellWidth}:${color}`;
          requiredKeys.add(key);

          if (!this.decorationCache.has(key)) {
            const offset = lineY - cursorAbsoluteY;
            const marker = this.term.registerMarker(offset);
            if (!marker) continue;

            const deco = this.term.registerDecoration({
              marker,
              x: cellStartCol,
              width: cellWidth,
              foregroundColor: color,
            });

            if (deco) {
              // Add a fallback background highlight for the DOM renderer.
              // WebGL renderer will natively apply foregroundColor.
              deco.onRender((element: HTMLElement) => {
                // element.style.backgroundColor = color;
                // element.style.opacity = "0.2";
                element.style.pointerEvents = "none";
              });

              // Auto-remove from cache when xterm evicts the line from scrollback
              deco.onDispose(() => this.decorationCache.delete(key));
              this.decorationCache.set(key, { decoration: deco, marker });
            } else {
              marker.dispose();
            }
          }
        }
      }
    }

    // Dispose decorations that are no longer in the visible viewport.
    // Collect stale keys first to avoid mutating the map while iterating.
    const staleKeys: string[] = [];
    for (const key of this.decorationCache.keys()) {
      if (!requiredKeys.has(key)) staleKeys.push(key);
    }
    for (const key of staleKeys) {
      const entry = this.decorationCache.get(key);
      if (entry) {
        this.decorationCache.delete(key); // remove before dispose to silence onDispose no-op
        entry.decoration.dispose();
        entry.marker.dispose();
      }
    }
  }
}
