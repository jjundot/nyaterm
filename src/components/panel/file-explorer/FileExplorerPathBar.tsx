import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

interface FileExplorerPathBarProps {
  isEditingPath: boolean;
  pathInputText: string;
  pathInputRef: RefObject<HTMLInputElement | null>;
  displayPath: string;
  currentPath: string;
  homeDir: string;
  onPathInputTextChange: (value: string) => void;
  onEditingPathChange: (editing: boolean) => void;
  onLoadDirectory: (path: string) => void;
}

export function FileExplorerPathBar({
  isEditingPath,
  pathInputText,
  pathInputRef,
  displayPath,
  currentPath,
  homeDir,
  onPathInputTextChange,
  onEditingPathChange,
  onLoadDirectory,
}: FileExplorerPathBarProps) {
  const { t } = useTranslation();

  return (
    <div
      className="px-2 py-1 border-b flex items-center"
      style={{ borderColor: "var(--df-border)", minHeight: "26px" }}
    >
      {isEditingPath ? (
        <input
          ref={pathInputRef}
          className="w-full text-[0.625rem] font-mono bg-transparent outline-none m-0 p-0"
          style={{ color: "var(--df-text)" }}
          value={pathInputText}
          onChange={(event) => onPathInputTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              let path = pathInputText.trim();
              if (path) {
                if (path.startsWith("~/") && homeDir) {
                  path = homeDir + path.substring(1);
                } else if (path === "~" && homeDir) {
                  path = homeDir;
                }
                onLoadDirectory(path);
              }
              onEditingPathChange(false);
            } else if (event.key === "Escape") {
              onEditingPathChange(false);
            }
          }}
          onBlur={() => onEditingPathChange(false)}
        />
      ) : (
        <div
          className="text-[0.625rem] font-mono truncate cursor-text transition-colors flex-1"
          style={{ color: "var(--df-text-dimmed)" }}
          onMouseEnter={(event) => (event.currentTarget.style.color = "var(--df-text)")}
          onMouseLeave={(event) => (event.currentTarget.style.color = "var(--df-text-dimmed)")}
          onClick={() => {
            onPathInputTextChange(currentPath || homeDir);
            onEditingPathChange(true);
          }}
          title={t("fileExplorer.editPath")}
        >
          {displayPath}
        </div>
      )}
    </div>
  );
}
