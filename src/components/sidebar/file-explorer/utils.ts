import {
    MdApps,
    MdArticle,
    MdAudioFile,
    MdCode,
    MdCoPresent,
    MdCss,
    MdDataObject,
    MdDescription,
    MdFolder,
    MdFolderZip,
    MdHtml,
    MdImage,
    MdInsertDriveFile,
    MdJavascript,
    MdLink,
    MdLock,
    MdMovie,
    MdPictureAsPdf,
    MdSettings,
    MdStorage,
    MdTableChart,
    MdTerminal,
} from "react-icons/md";
import { FileEntry } from "./types";
import { ElementType } from "react";

export function getFileIcon(entry: FileEntry): { icon: ElementType; color: string } {
    if (entry.is_dir) return { icon: MdFolder, color: "#fbbf24" }; // amber-400
    if (entry.is_symlink) return { icon: MdLink, color: "#67e8f9" }; // cyan-300

    const ext = entry.name.includes(".") ? (entry.name.split(".").pop()?.toLowerCase() ?? "") : "";

    switch (ext) {
        // --- Web & Scripting ---
        case "js":
        case "jsx":
            return { icon: MdJavascript, color: "#facc15" }; // yellow-400
        case "ts":
        case "tsx":
            return { icon: MdCode, color: "#60a5fa" }; // blue-400
        case "html":
        case "htm":
            return { icon: MdHtml, color: "#f97316" }; // orange-500
        case "css":
        case "scss":
        case "less":
            return { icon: MdCss, color: "#38bdf8" }; // sky-400
        case "py":
        case "pyc":
        case "sh":
        case "bash":
        case "zsh":
        case "bat":
        case "ps1":
            return { icon: MdTerminal, color: "#4ade80" }; // green-400

        case "rs":
        case "go":
        case "c":
        case "cpp":
        case "java":
            return { icon: MdCode, color: "#f87171" }; // red-400

        // --- Data & Config ---
        case "json":
        case "yaml":
        case "yml":
        case "toml":
        case "xml":
            return { icon: MdDataObject, color: "#a78bfa" }; // violet-400
        case "ini":
        case "env":
        case "conf":
        case "config":
            return { icon: MdSettings, color: "var(--df-text-muted)" };
        case "sql":
        case "db":
        case "sqlite":
            return { icon: MdStorage, color: "#94a3b8" }; // slate-400

        // --- Text & Documents ---
        case "md":
        case "mdx":
        case "txt":
        case "rtf":
            return { icon: MdArticle, color: "var(--df-text-dimmed)" };
        case "doc":
        case "docx":
            return { icon: MdDescription, color: "#3b82f6" }; // blue-500
        case "pdf":
            return { icon: MdPictureAsPdf, color: "#ef4444" }; // red-500
        case "xls":
        case "xlsx":
        case "csv":
            return { icon: MdTableChart, color: "#16a34a" }; // green-600
        case "ppt":
        case "pptx":
            return { icon: MdCoPresent, color: "#ea580c" }; // orange-600

        // --- Media ---
        case "png":
        case "jpg":
        case "jpeg":
        case "gif":
        case "webp":
        case "svg":
        case "ico":
            return { icon: MdImage, color: "#ec4899" }; // pink-500
        case "mp4":
        case "mkv":
        case "avi":
        case "mov":
        case "webm":
            return { icon: MdMovie, color: "#8b5cf6" }; // violet-500
        case "mp3":
        case "wav":
        case "ogg":
        case "flac":
            return { icon: MdAudioFile, color: "#f59e0b" }; // amber-500

        // --- Archives ---
        case "zip":
        case "rar":
        case "7z":
        case "tar":
        case "gz":
        case "bz2":
        case "xz":
            return { icon: MdFolderZip, color: "#f59e0b" }; // amber-500

        // --- Misc ---
        case "exe":
        case "apk":
        case "dmg":
        case "iso":
            return { icon: MdApps, color: "#14b8a6" }; // teal-500
        case "lock":
            return { icon: MdLock, color: "var(--df-text-muted)" };

        default:
            if (entry.name.startsWith(".")) {
                return { icon: MdSettings, color: "var(--df-text-muted)" };
            }
            return { icon: MdInsertDriveFile, color: "var(--df-text-muted)" };
    }
}

export function formatSize(bytes: number): string {
    if (bytes === 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
