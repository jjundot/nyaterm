import { useCallback } from "react";
import {
  MdAdd,
  MdCloud,
  MdCloudOff,
  MdCloudUpload,
  MdCreateNewFolder,
  MdDelete,
  MdDriveFileRenameOutline,
  MdExpandMore,
  MdFolder,
  MdFolderOpen,
  MdLock,
  MdOpenInNew,
  MdPublic,
} from "react-icons/md";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useApp } from "@/context/AppContext";
import { invoke } from "@/lib/invoke";
import type { GroupSyncType } from "@/types/global";
import ConnectionItem from "./ConnectionItem";
import type { GroupNode } from "./context";
import { useSavedConnectionsContext } from "./context";

interface GroupNodeItemProps {
  node: GroupNode;
  depth: number;
}

export default function GroupNodeItem({ node, depth }: GroupNodeItemProps) {
  const {
    isDragEnabled,
    dragTarget,
    expandedGroups,
    toggleGroup,
    onNewConnection,
    openNewFolderDialog,
    openRenameFolderDialog,
    requestOpenGroupConnections,
    setDeleteFolderTarget,
    toggleGroupSyncExclusion,
    handleDragStart,
    handleDragEnd,
    handleDragEnterItem,
    handleDragOverItem,
    handleDragLeaveItem,
    handleDropItem,
    t,
  } = useSavedConnectionsContext();
  const { refreshConnections } = useApp();

  const collapsed = !expandedGroups.has(node.group.id);
  const isTarget = dragTarget?.id === node.group.id && dragTarget.type === "group";
  const showGroupBefore = isTarget && dragTarget.position === "before";
  const showGroupAfter = isTarget && dragTarget.position === "after";
  const isInside = isTarget && dragTarget.position === "inside";
  const indentPx = `${8 + depth * 16}px`;
  const isShared = node.group.sync_type === "shared";

  const toggleGroupSyncType = useCallback(async () => {
    try {
      const newType: GroupSyncType = isShared ? "private" : "shared";
      await invoke("save_group", {
        group: {
          ...node.group,
          sync_type: newType,
          // Default: don't allow upload for shared groups
          allow_upload: newType === "shared" ? false : undefined,
        },
      });
      refreshConnections();
      toast.success(newType === "shared" ? "已设为公用配置" : "已设为私有配置");
    } catch (e) {
      toast.error(String(e));
    }
  }, [node.group, isShared, refreshConnections]);

  const toggleAllowUpload = useCallback(async () => {
    try {
      await invoke("save_group", {
        group: {
          ...node.group,
          allow_upload: !node.group.allow_upload,
        },
      });
      refreshConnections();
      toast.success(node.group.allow_upload ? "已禁用云端上传" : "已启用云端上传");
    } catch (e) {
      toast.error(String(e));
    }
  }, [node.group, refreshConnections]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative"
          draggable={isDragEnabled}
          onDragStart={
            isDragEnabled ? (e) => handleDragStart(e, "group", node.group.id) : undefined
          }
          onDragEnd={isDragEnabled ? handleDragEnd : undefined}
        >
          {showGroupBefore && (
            <div
              className="absolute top-0 right-2 h-0.5 rounded-full z-10"
              style={{ backgroundColor: "var(--df-primary)", left: indentPx }}
            />
          )}
          <div
            data-group-header
            className={`flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer transition-colors select-none df-hover ${isInside ? "ring-1 ring-primary/60 bg-primary/10" : ""}`}
            style={{ paddingLeft: indentPx }}
            onClick={() => toggleGroup(node.group.id)}
            onDragEnter={
              isDragEnabled ? (e) => handleDragEnterItem(e, node.group.id, "group") : undefined
            }
            onDragOver={
              isDragEnabled ? (e) => handleDragOverItem(e, node.group.id, "group") : undefined
            }
            onDragLeave={
              isDragEnabled ? (e) => handleDragLeaveItem(e, node.group.id, "group") : undefined
            }
            onDrop={isDragEnabled ? (e) => handleDropItem(e, node.group.id, "group") : undefined}
          >
            <MdExpandMore
              className="text-xs transition-transform shrink-0"
              style={{
                color: "var(--df-text-dimmed)",
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              }}
            />
            {collapsed ? (
              <MdFolder
                className="text-sm shrink-0"
                style={{ color: isShared ? "#3b82f6" : "#f59e0b" }}
              />
            ) : (
              <MdFolderOpen
                className="text-sm shrink-0"
                style={{ color: isShared ? "#3b82f6" : "#f59e0b" }}
              />
            )}
            <span
              className="text-xs font-medium flex-1 truncate"
              style={{ color: "var(--df-text-muted)" }}
            >
              {node.group.name}
            </span>
            {/* Sync type indicator */}
            {isShared && (
              <MdPublic
                className="text-xs shrink-0"
                style={{ color: node.group.allow_upload ? "#3b82f6" : "#9ca3af" }}
                title={node.group.allow_upload ? "公用配置 (可上传)" : "公用配置 (只读)"}
              />
            )}
            {!isShared && !node.group.exclude_from_sync && (
              <MdLock
                className="text-xs shrink-0 opacity-50"
                style={{ color: "var(--df-text-dimmed)" }}
                title="私有配置"
              />
            )}
            {/* Upload enabled indicator */}
            {isShared && node.group.allow_upload && (
              <MdCloudUpload
                className="text-xs shrink-0"
                style={{ color: "#3b82f6" }}
                title="允许上传"
              />
            )}
            {/* Legacy sync exclusion indicator (for private groups) */}
            {!isShared && node.group.exclude_from_sync && (
              <MdCloudOff
                className="text-xs shrink-0 opacity-50"
                style={{ color: "var(--df-text-dimmed)" }}
                title={t("savedConnections.syncDisabled")}
              />
            )}
            <span
              className="text-xs tabular-nums shrink-0"
              style={{ color: "var(--df-text-dimmed)" }}
            >
              {node.totalCount}
            </span>
          </div>
          {!collapsed && (
            <div className={depth === 0 ? "mb-1" : ""}>
              {node.children.map((child) => (
                <GroupNodeItem key={child.group.id} node={child} depth={depth + 1} />
              ))}
              {node.connections.map((conn) => (
                <ConnectionItem key={conn.id} conn={conn} indented depth={depth + 1} />
              ))}
            </div>
          )}
          {showGroupAfter && (
            <div
              className="absolute bottom-0 right-2 h-0.5 rounded-full z-10"
              style={{ backgroundColor: "var(--df-primary)", left: indentPx }}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        <ContextMenuItem onClick={() => onNewConnection(node.group.id)}>
          <MdAdd className="text-[0.875rem] text-muted-foreground mr-2" />
          {t("savedConnections.newConnection")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => openNewFolderDialog(node.group.id)}>
          <MdCreateNewFolder className="text-[0.875rem] text-muted-foreground mr-2" />
          {t("savedConnections.newSubfolder")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {node.totalCount > 0 && (
          <ContextMenuItem onClick={() => requestOpenGroupConnections(node)}>
            <MdOpenInNew className="text-[0.875rem] text-muted-foreground mr-2" />
            {t("savedConnections.openAllConnections")}
          </ContextMenuItem>
        )}
        {node.totalCount > 0 && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => openRenameFolderDialog(node.group)}>
          <MdDriveFileRenameOutline className="text-[0.875rem] text-muted-foreground mr-2" />
          {t("savedConnections.renameFolder")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Sync type toggle */}
        <ContextMenuItem onClick={toggleGroupSyncType}>
          {isShared ? (
            <MdLock className="text-[0.875rem] text-muted-foreground mr-2" />
          ) : (
            <MdPublic className="text-[0.875rem] text-muted-foreground mr-2" />
          )}
          {isShared ? "设为私有配置" : "设为公用配置"}
        </ContextMenuItem>
        {/* Upload toggle for shared groups */}
        {isShared && (
          <ContextMenuItem onClick={toggleAllowUpload}>
            {node.group.allow_upload ? (
              <MdCloudOff className="text-[0.875rem] text-muted-foreground mr-2" />
            ) : (
              <MdCloudUpload className="text-[0.875rem] text-muted-foreground mr-2" />
            )}
            {node.group.allow_upload ? "禁用云端上传" : "启用云端上传"}
          </ContextMenuItem>
        )}
        {/* Legacy sync exclusion (only for private groups) */}
        {!isShared && (
          <ContextMenuItem onClick={() => toggleGroupSyncExclusion(node.group)}>
            {node.group.exclude_from_sync ? (
              <MdCloud className="text-[0.875rem] text-muted-foreground mr-2" />
            ) : (
              <MdCloudOff className="text-[0.875rem] text-muted-foreground mr-2" />
            )}
            {node.group.exclude_from_sync
              ? t("savedConnections.includeInSync")
              : t("savedConnections.excludeFromSync")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-red-400" onClick={() => setDeleteFolderTarget(node.group)}>
          <MdDelete className="text-[0.875rem] mr-2" />
          {t("savedConnections.deleteFolder")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
