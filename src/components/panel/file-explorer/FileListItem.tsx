import { useTranslation } from "react-i18next";
import {
  MdAutoAwesome,
  MdContentCopy,
  MdCopyAll,
  MdDelete,
  MdDownload,
  MdDriveFileMove,
  MdDriveFolderUpload,
  MdEdit,
  MdFileOpen,
  MdFolderCopy,
  MdInfo,
  MdKeyboardArrowRight,
  MdKeyboardDoubleArrowRight,
  MdKeyboardReturn,
  MdOpenInNew,
  MdRefresh,
  MdUpload,
} from "react-icons/md";
import { getFileIcon } from "@/components/icons";
import { formatSize } from "@/lib/utils";
import type { AICustomActionConfig, FileEntry } from "@/types/global";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../ui/context-menu";

interface FileListItemProps {
  entry: FileEntry;
  isSelected: boolean;
  isParentDirectoryEntry?: boolean;
  activeSessionId: string | null;
  columnTemplate: string;
  rowWidth: number;
  onSelectionStart: (entry: FileEntry, event: React.MouseEvent) => void;
  onSelectionDrag: (entry: FileEntry, event: React.MouseEvent) => void;
  onContextMenuSelect: (entry: FileEntry, event: React.MouseEvent) => void;
  onItemClick: (entry: FileEntry) => void;
  onOpenDefault: (entry: FileEntry) => void;
  onRefresh: () => void;
  onUpload: () => void;
  onUploadFolder: () => void;
  onDownload: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onCopyPath: (entry: FileEntry, mode: "dir" | "name" | "full") => void;
  onSendToTerminal: (entry: FileEntry, mode: "dir" | "name" | "full") => void;
  onProperties: (entry: FileEntry) => void;
  aiActions: AICustomActionConfig[];
  onAIAction: (entry: FileEntry, action: AICustomActionConfig) => void;
}

function formatModifiedTime(unix: number): string {
  if (!unix) return "-";
  const d = new Date(unix * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FileListItem({
  entry,
  isSelected,
  isParentDirectoryEntry = false,
  activeSessionId,
  columnTemplate,
  rowWidth,
  onSelectionStart,
  onSelectionDrag,
  onContextMenuSelect,
  onItemClick,
  onOpenDefault,
  onRefresh,
  onUpload,
  onUploadFolder,
  onDownload,
  onRename,
  onMove,
  onDelete,
  onCopyPath,
  onSendToTerminal,
  onProperties,
  aiActions,
  onAIAction,
}: FileListItemProps) {
  const { t } = useTranslation();
  const entryIcon = getFileIcon(entry);
  const modifiedTime = formatModifiedTime(entry.mtime);
  const fileSize = isParentDirectoryEntry || entry.is_dir ? "-" : formatSize(entry.size);
  const permissions = isParentDirectoryEntry ? "" : entry.permissions || "-";
  const owner = isParentDirectoryEntry ? "" : entry.owner || "-";
  const group = isParentDirectoryEntry ? "" : entry.group || "-";
  const itemTitle = isParentDirectoryEntry
    ? t("fileExplorer.goUp")
    : `${permissions} ${fileSize} ${modifiedTime} ${owner}:${group}`;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className="grid h-[30px] items-center rounded transition-colors cursor-pointer select-none"
          style={{
            gridTemplateColumns: columnTemplate,
            width: rowWidth,
            backgroundColor: isSelected
              ? "color-mix(in srgb, var(--df-primary) 10%, transparent)"
              : undefined,
            color: isSelected ? "var(--df-primary)" : "var(--df-text)",
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.backgroundColor = "var(--df-bg-hover)";
            onSelectionDrag(entry, e);
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.backgroundColor = "";
          }}
          onMouseDown={(e) => onSelectionStart(entry, e)}
          onDoubleClick={() => {
            if (entry.is_dir) {
              onItemClick(entry);
            } else {
              onOpenDefault(entry);
            }
          }}
          onContextMenu={(e) => onContextMenuSelect(entry, e)}
          title={itemTitle}
        >
          <div className="flex min-w-0 items-center gap-2 px-2">
            <entryIcon.icon
              className="shrink-0 text-base"
              style={{ color: isSelected ? "var(--df-primary)" : entryIcon.color }}
            />
            <span className="min-w-0 flex-1 truncate text-xs">{entry.name}</span>
          </div>
          <span
            className="truncate px-2 font-mono text-[0.625rem] tabular-nums"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {isParentDirectoryEntry ? "" : modifiedTime}
          </span>
          <span
            className="truncate px-2 text-right text-[0.625rem] tabular-nums"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {isParentDirectoryEntry ? "" : fileSize}
          </span>
          <span
            className="truncate px-2 font-mono text-[0.625rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {permissions}
          </span>
          <span
            className="truncate px-2 text-[0.625rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {owner}
          </span>
          <span
            className="truncate px-2 text-[0.625rem]"
            style={{ color: "var(--df-text-dimmed)" }}
          >
            {group}
          </span>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px]">
        {isParentDirectoryEntry ? (
          <>
            <ContextMenuItem onClick={() => onItemClick(entry)}>
              <MdFileOpen className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.goUp")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRefresh}>
              <MdRefresh className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmRefresh")}
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => onItemClick(entry)}>
              <MdFileOpen className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmOpen")}
            </ContextMenuItem>
            {!entry.is_dir && (
              <ContextMenuItem onClick={() => onOpenDefault(entry)}>
                <MdOpenInNew className="text-[0.875rem] text-muted-foreground mr-2" />
                {t("fileExplorer.cmOpenDefault")}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRefresh}>
              <MdRefresh className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmRefresh")}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <MdUpload className="text-[0.875rem] text-muted-foreground mr-2" />
                {t("fileExplorer.cmUpload")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48">
                <ContextMenuItem onClick={onUpload}>
                  <MdUpload className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.upload")}
                </ContextMenuItem>
                <ContextMenuItem onClick={onUploadFolder}>
                  <MdDriveFolderUpload className="text-[0.875rem] text-muted-foreground mr-2" />
                  {t("fileExplorer.uploadFolder")}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onClick={() => onDownload(entry)}>
              <MdDownload className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmDownload")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => activeSessionId && onRename(entry)}>
              <MdEdit className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmRename")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => activeSessionId && onMove(entry)}>
              <MdDriveFileMove className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmMove")}
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => onDelete(entry)}>
              <MdDelete className="text-[0.875rem] mr-2" />
              {t("fileExplorer.cmDelete")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onCopyPath(entry, "full")}>
              <MdContentCopy className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmCopyPath")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCopyPath(entry, "name")}>
              <MdCopyAll className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmCopyName")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCopyPath(entry, "dir")}>
              <MdFolderCopy className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmCopyDirPath")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onSendToTerminal(entry, "full")}>
              <MdKeyboardReturn className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmTerminalPath")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSendToTerminal(entry, "name")}>
              <MdKeyboardArrowRight className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmTerminalName")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onSendToTerminal(entry, "dir")}>
              <MdKeyboardDoubleArrowRight className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmTerminalDirPath")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {aiActions.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <MdAutoAwesome className="text-[0.875rem] text-muted-foreground mr-2" />
                  AI
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {aiActions.map((action) => (
                    <ContextMenuItem key={action.id} onClick={() => onAIAction(entry, action)}>
                      {action.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => activeSessionId && onProperties(entry)}>
              <MdInfo className="text-[0.875rem] text-muted-foreground mr-2" />
              {t("fileExplorer.cmProperties")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
