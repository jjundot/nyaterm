// ── Resolved rule (single color already chosen for the current theme) ───────

/** Rule shape passed to the highlighting engine after dark/light resolution. */
export interface ResolvedHighlightRule {
  id: string;
  name: string;
  patterns: string[];
  color: string;
  enabled: boolean;
}

// ── Luminance helper ────────────────────────────────────────────────────────

/** Perceived brightness of a "#rrggbb" hex color (0–1). */
export function hexLuminance(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** 在单词边界前后添加空格，避免与现有边界冲突。 */
function requireSpace(pattern: string): string {
  // 去除原有的 \b，避免冲突
  const cleanPattern = pattern.replace(/\\b/g, "");
  // (?<=\s|^) ：左边是空格或行首
  // (?=\s|$)  ：右边是空格或行尾
  return `(?:(?<=\\s|^)${cleanPattern}|${cleanPattern}(?=\\s|$))`;
}

// ── Built-in rule patterns ───────────────────────────────────────────────────
// All patterns are compiled with the `gi` flag (global + case-insensitive).

const BUILTIN_PATTERNS = {
  error:   ["error", "fail(?:ed|ure)?", "fatal", "exception", "traceback", "panic", "critical", "none"].map(requireSpace),
  warn:    ["warn(?:ing)?", "deprecated", "caution"].map(requireSpace),
  success: ["success(?:ful(?:ly)?)?", "ok", "done", "pass(?:ed)?", "complet(?:e|ed)"].map(requireSpace),
  info:    ["info(?:rmation)?", "notice"].map(requireSpace),
  debug:   ["debug", "trace", "verbose"].map(requireSpace),
  datetime: [
    "\\b\\d{4}[-/]\\d{2}[-/]\\d{2}(?:T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?(?:Z|[+-]\\d{2}:?\\d{2})?)?\\b",
    "\\b(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?(?:\\.\\d{1,6})?\\b"
  ],
  number: [
    "(?<![\\w-])[-+]?0x[0-9a-f]+(?![\\w-])",
    "(?<![\\w-])[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[-+]?\\d+)?(?:\\s*%)?(?![\\w-])"
  ],
  constant: [
    "\\b(?:true|false|null|undefined|NaN|Infinity)\\b"
  ],
  address: [
    "\\b(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b",
    "\\b(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}\\b|\\b(?:[a-fA-F0-9]{1,4}:){1,7}:[a-fA-F0-9]{1,4}\\b|\\b:(?::[a-fA-F0-9]{1,4}){1,7}\\b",
    "\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b"
  ],
  url: [
    "\\b(?:https?|ftp|wss?):\\/\\/[-\\w+&@#/%?=~_|!:,.;]*[-\\w+&@#/%=~_|]"
  ],
  uuid: [
    "\\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\b",
    "\\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{13}\\b",
  ],
  string: [
    "\"(?:[^\"\\\\]|\\\\.)*\"|\'(?:[^\'\\\\]|\\\\.)*\'"
  ],
  operator: [
    "[\\[\\]{}()\\-=+$&*]+"
  ],
  version: [
    "\\bv\\d+(?:\\.\\d+){1,2}(?:-[a-z0-9.-]+)?\\b",
    "\\blatest\\b",
    "\\brelease\\b",
    "\\bstable\\b",
    "\\bbeta\\b",
    "\\balpha\\b",
    "\\brevision\\b",
  ],
  size: [
    "\\b\\d+(?:\\.\\d+)?\\s*(?:[kmgtep]i?b|b|bytes?|[kmgtep]bps)\\b"
  ],
  duration: [
    "\\b[-+]?\\d+(?:\\.\\d+)?\\s*(?:[nµum]?s|sec|m|mins?|h|hrs?|d|days?)\\b"
  ],
} as const;

// ── Color sets ───────────────────────────────────────────────────────────────
// Colors chosen to be clearly visible against the respective terminal backgrounds
// while harmonising with each theme family's palette.

/** For dark terminal backgrounds (github-dark, dracula, nord, monokai, catppuccin-mocha …) */
const DARK_RULE_COLORS = {
  error: "#ff7b72", // soft red – github-dark red
  warn: "#e3b341", // amber    – github-dark bright yellow
  success: "#3fb950", // green    – github-dark green
  info: "#79c0ff", // sky blue – github-dark bright blue
  debug: "#d2a8ff", // lavender – github-dark bright magenta
  datetime: "#f1fa8c", // pale yellow – 柔和的黄色，让时间戳在行首清晰但不刺眼
  number: "#bd93f9", // purple – 经典的 Dracula/VSCode 紫色，非常适合强调数字
  constant: "#ffb86c", // orange – 亮橙色，突出 true/false 等布尔值
  address: "#56d364", // bright green – 鲜明的绿色，让 IP 在日志堆里非常醒目
  url: "#8be9fd", // cyan – 经典的终端超链接青色
  uuid: "#ffb86c", // peach/orange – 柔和的橙色，降低长串 UUID 的视觉压迫感
  string: "#f1fa8c", // yellow - 经典的字符串黄色
  operator: "#8b949e", // muted slate (暗青灰色)
  version: "#ff9e64", // soft orange - 在暗色背景下非常显眼且温暖，适合版本号
  size: "#2ac3de",    // cyan/blue - 偏科技感的青蓝色，适合展示容量/速率
  duration: "#f1fa8c", // pale yellow - 柔和的浅黄色，在暗色背景看延迟数据很舒服
};

/** For light terminal backgrounds (github-light, solarized-light, catppuccin-latte …) */
const LIGHT_RULE_COLORS = {
  error: "#cf222e", // dark red    – github-light red
  warn: "#9a6700", // dark amber  – github-light yellow
  success: "#116329", // dark green  – github-light green
  info: "#0969da", // dark blue   – github-light blue
  debug: "#8250df", // dark purple – github-light magenta
  datetime: "#a58900", // dark yellow/olive
  number: "#6f42c1", // dark purple
  constant: "#cb4b16", // deep orange
  address: "#1a7f37", // deep green
  url: "#2aa198", // dark cyan / teal
  uuid: "#bc4c00", // dark orange
  string: "#1a8c8c", // green
  operator: "#57606a", // dim gray (深亚麻灰)
  version: "#b04a00", // deep orange - 亮色背景下的深橙色
  size: "#007197",    // deep cyan - 亮色背景下的深青色
  duration: "#859900", // olive green / dark yellow - 亮色背景下清晰的暗黄绿色
};

// ── Built-in rule factory ────────────────────────────────────────────────────

/**
 * Returns the 5 built-in highlight rules coloured for the current theme family.
 * IDs use the "builtin-" prefix so they never collide with user-created IDs
 * (which are timestamp-based: "kh-<timestamp>").
 */
export function getBuiltinRules(isDark: boolean): ResolvedHighlightRule[] {
  const c = isDark ? DARK_RULE_COLORS : LIGHT_RULE_COLORS;
  return [
    // Higher priority rules (complex structures, exact formats)
    { id: "builtin-version", name: "Version", patterns: [...BUILTIN_PATTERNS.version], color: c.version, enabled: true },
    { id: "builtin-size", name: "Size", patterns: [...BUILTIN_PATTERNS.size], color: c.size, enabled: true },
    { id: "builtin-string", name: "String", patterns: [...BUILTIN_PATTERNS.string], color: c.string, enabled: true },
    { id: "builtin-url", name: "URL", patterns: [...BUILTIN_PATTERNS.url], color: c.url, enabled: true },
    { id: "builtin-uuid", name: "UUID", patterns: [...BUILTIN_PATTERNS.uuid], color: c.uuid, enabled: true },
    { id: "builtin-address", name: "Address", patterns: [...BUILTIN_PATTERNS.address], color: c.address, enabled: true },
    { id: "builtin-datetime", name: "DateTime", patterns: [...BUILTIN_PATTERNS.datetime], color: c.datetime, enabled: true },
    // Logical state and generic matching
    { id: "builtin-error", name: "Error", patterns: [...BUILTIN_PATTERNS.error], color: c.error, enabled: true },
    { id: "builtin-warn", name: "Warning", patterns: [...BUILTIN_PATTERNS.warn], color: c.warn, enabled: true },
    { id: "builtin-success", name: "Success", patterns: [...BUILTIN_PATTERNS.success], color: c.success, enabled: true },
    { id: "builtin-info", name: "Info", patterns: [...BUILTIN_PATTERNS.info], color: c.info, enabled: true },
    { id: "builtin-debug", name: "Debug", patterns: [...BUILTIN_PATTERNS.debug], color: c.debug, enabled: true },
    // Base primitives
    { id: "builtin-duration", name: "Duration", patterns: [...BUILTIN_PATTERNS.duration], color: c.duration, enabled: true },
    { id: "builtin-constant", name: "Constant", patterns: [...BUILTIN_PATTERNS.constant], color: c.constant, enabled: true },
    { id: "builtin-number", name: "Number", patterns: [...BUILTIN_PATTERNS.number], color: c.number, enabled: true },
    { id: "builtin-operator", name: "Operator", patterns: [...BUILTIN_PATTERNS.operator], color: c.operator, enabled: true },
  ];
}

// ── Quick-pick color palettes ─────────────────────────────────────────────────
// Curated from the actual ANSI palettes of the bundled dark / light themes.
// Each row has 6 swatches: error · warning · success · info · debug · accent.

/** 12 colors that stand out on dark terminal backgrounds. */
export const DARK_PALETTE: readonly string[] = [
  // row 1 – semantic tones
  "#ff7b72", "#e3b341", "#3fb950", "#79c0ff", "#d2a8ff", "#ff79c6",
  // row 2 – extended / accent tones
  "#ffa657", "#f1fa8c", "#56d364", "#8be9fd", "#bd93f9", "#ffb86c",
];

/** 12 colors that stand out on light terminal backgrounds. */
export const LIGHT_PALETTE: readonly string[] = [
  // row 1 – semantic tones
  "#cf222e", "#9a6700", "#116329", "#0969da", "#8250df", "#d33682",
  // row 2 – extended / accent tones
  "#bc4c00", "#a58900", "#1a7f37", "#2aa198", "#6f42c1", "#cb4b16",
];
