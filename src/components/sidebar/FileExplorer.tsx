import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { join, tempDir } from "@tauri-apps/api/path";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MdArrowUpward,
  MdFolderOff,
  MdRefresh,
  MdSend,
} from "react-icons/md";
import { toast } from "sonner";
import AutoUploadDialog, { type AutoUploadDialogData } from "../dialog/file-explorer/AutoUploadDialog";
import MoveDialog, { type MoveDialogData } from "../dialog/file-explorer/MoveDialog";
import PropertiesDialog, { type PropertiesDialogData } from "../dialog/file-explorer/PropertiesDialog";
import RenameDialog, { type RenameDialogData } from "../dialog/file-explorer/RenameDialog";
import DeleteDialog, { type DeleteDialogData } from "../dialog/file-explorer/DeleteDialog";

import { FileEntry, FileExplorerProps } from "./file-explorer/types";
import { formatSize } from "./file-explorer/utils";
import { FileListItem } from "./file-explorer/FileListItem";

/** Remote file browser for active SSH session. Lists dirs/files, supports navigation. */
export default function FileExplorer({ activeSessionId }: FileExplorerProps) {
  const { t } = useTranslation();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [homeDir, setHomeDir] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInputText, setPathInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [renameDialogData, setRenameDialogData] = useState<RenameDialogData | null>(null);
  const [deleteDialogData, setDeleteDialogData] = useState<DeleteDialogData | null>(null);
  const [moveDialogData, setMoveDialogData] = useState<MoveDialogData | null>(null);
  const [autoUploadDialogData, setAutoUploadDialogData] = useState<AutoUploadDialogData | null>(
    null,
  );
  const [propertiesDialogData, setPropertiesDialogData] = useState<PropertiesDialogData | null>(
    null,
  );
  const [, setAlwaysUploadFiles] = useState<Set<string>>(new Set());

  const sessionCacheRef = useRef<Map<string, { files: FileEntry[]; currentPath: string; homeDir: string }>>(new Map());
  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unlisten = listen<{ session_id: string; local_path: string; remote_path: string }>(
      "file-modified",
      (e) => {
        const { session_id, local_path, remote_path } = e.payload;
        const watchKey = `${session_id}:${local_path}`;

        setAlwaysUploadFiles((prev) => {
          if (prev.has(watchKey)) {
            // File was marked "Always list", just upload silently
            invoke("upload_local_file", {
              sessionId: session_id,
              localPath: local_path,
              remotePath: remote_path,
            }).catch((err) => toast.error(String(err)));
            return prev;
          } else {
            // Trigger the dialog
            setAutoUploadDialogData({
              sessionId: session_id,
              localPath: local_path,
              remotePath: remote_path,
            });
            return prev;
          }
        });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!activeSessionId) return;
      setLoading(true);
      setError(null);

      try {
        const entries = await invoke<FileEntry[]>("list_remote_dir", {
          sessionId: activeSessionId,
          path,
        });
        entries.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(entries);
        setCurrentPath(path);

        const cached = sessionCacheRef.current.get(activeSessionId);
        sessionCacheRef.current.set(activeSessionId, {
          files: entries,
          currentPath: path,
          homeDir: cached?.homeDir ?? homeDir,
        });
      } catch (e) {
        const msg = String(e);
        if (files.length > 0) {
          toast.error(msg);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [activeSessionId, files.length, homeDir],
  );

  useEffect(() => {
    const cache = sessionCacheRef.current;
    const prevId = prevSessionIdRef.current;

    if (prevId && prevId !== activeSessionId) {
      cache.set(prevId, { files, currentPath, homeDir });
    }
    prevSessionIdRef.current = activeSessionId;

    if (!activeSessionId) {
      setFiles([]);
      setCurrentPath("");
      setHomeDir("");
      return;
    }

    const cached = cache.get(activeSessionId);
    if (cached) {
      setFiles(cached.files);
      setCurrentPath(cached.currentPath);
      setHomeDir(cached.homeDir);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const home = await invoke<string>("get_home_dir", { sessionId: activeSessionId });
        if (cancelled) return;
        setHomeDir(home);
        loadDirectory(home);
      } catch {
        if (cancelled) return;
        loadDirectory("~");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  // Move Tauri listeners that do NOT rely on standard React side-effects to the top hook
  useEffect(() => {
    const unlisten = listen<{ session_id: string; local_path: string; remote_path: string }>(
      "file-modified",
      (e) => {
        const { session_id, local_path, remote_path } = e.payload;
        const watchKey = `${session_id}:${local_path}`;

        setAlwaysUploadFiles((prev) => {
          if (prev.has(watchKey)) {
            invoke("upload_local_file", {
              sessionId: session_id,
              localPath: local_path,
              remotePath: remote_path,
            }).catch((err) => toast.error(String(err)));
            return prev;
          } else {
            setAutoUploadDialogData({
              sessionId: session_id,
              localPath: local_path,
              remotePath: remote_path,
            });
            return prev;
          }
        });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleItemClick = (entry: FileEntry) => {
    if (entry.is_dir) {
      const newPath = currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      loadDirectory(newPath);
    } else {
      setSelectedFile(entry.name);
    }
  };

  const handleGoUp = () => {
    if (!currentPath || currentPath === "/") return;
    const parts = currentPath.split("/");
    parts.pop();
    loadDirectory(parts.join("/") || "/");
  };

  const getEntryFullPath = (entry: FileEntry) => {
    return currentPath === "/" ? `/${entry.name}` : `${currentPath}/${entry.name}`;
  };

  const handleCopyPath = (entry: FileEntry, mode: "dir" | "name" | "full") => {
    let text = "";
    if (mode === "dir") text = currentPath;
    else if (mode === "name") text = entry.name;
    else text = getEntryFullPath(entry);
    navigator.clipboard.writeText(text);
  };

  const handleSendToTerminal = (entry: FileEntry, mode: "dir" | "name" | "full") => {
    if (!activeSessionId) return;
    let text = "";
    if (mode === "dir") text = currentPath;
    else if (mode === "name") text = entry.name;
    else text = getEntryFullPath(entry);

    invoke("write_to_session", {
      sessionId: activeSessionId,
      data: text,
    });
    emit(`focus-terminal-${activeSessionId}`);
  };

  const handleDelete = (entry: FileEntry) => {
    if (!activeSessionId) return;
    setDeleteDialogData({
      sessionId: activeSessionId,
      path: getEntryFullPath(entry),
      name: entry.name,
    });
  };

  const handleDownload = async (entry: FileEntry) => {
    if (!activeSessionId || entry.is_dir) return;
    try {
      const localPath = await saveDialog({ defaultPath: entry.name });
      if (!localPath) return;
      await invoke("download_remote_file", {
        sessionId: activeSessionId,
        remotePath: getEntryFullPath(entry),
        localPath,
      });
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleUpload = async () => {
    if (!activeSessionId) return;
    try {
      const localPath = await openDialog({ multiple: false, directory: false });
      if (!localPath || typeof localPath !== "string") return;

      const fileName = localPath.split(/[\\/]/).pop() || "uploaded_file";
      const remotePath = currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;

      setLoading(true);
      await invoke("upload_local_file", {
        sessionId: activeSessionId,
        localPath,
        remotePath,
      });
      await loadDirectory(currentPath);
    } catch (e) {
      toast.error(String(e));
      setLoading(false);
    }
  };

  const handleOpenDefault = async (entry: FileEntry) => {
    if (!activeSessionId || entry.is_dir) return;
    try {
      setLoading(true);
      const tDir = await tempDir();
      const localPath = await join(tDir, "dragonfly", activeSessionId, entry.name);
      await invoke("download_remote_file", {
        sessionId: activeSessionId,
        remotePath: getEntryFullPath(entry),
        localPath,
      });

      // Start watching the file for auto-upload
      await invoke("start_file_watch", {
        sessionId: activeSessionId,
        localPath,
        remotePath: getEntryFullPath(entry),
      });

      await openUrl(localPath);
      setLoading(false);
    } catch (e) {
      toast.error(String(e));
      setLoading(false);
    }
  };

  const displayPath = (() => {
    if (!homeDir || !currentPath) return currentPath || "~";
    if (currentPath === homeDir) return "~";
    if (currentPath.startsWith(`${homeDir}/`)) return `~${currentPath.slice(homeDir.length)}`;
    return currentPath;
  })();

  return (
    <aside
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--df-bg-panel)" }}
    >
      <div
        className="p-2 text-[0.625rem] uppercase tracking-wider font-bold border-b flex justify-between items-center"
        style={{ color: "var(--df-text-muted)", borderColor: "var(--df-border)" }}
      >
        <span>{t("panel.fileExplorer")}</span>
        <div className="flex gap-1">
          {activeSessionId && (
            <>
              <MdArrowUpward
                className="text-sm cursor-pointer hover:opacity-80 transition-opacity"
                style={{ color: "var(--df-text-muted)" }}
                onClick={handleGoUp}
                title={t("fileExplorer.goUp")}
              />
              <MdRefresh
                className="text-sm cursor-pointer hover:opacity-80 transition-opacity"
                style={{ color: "var(--df-text-muted)" }}
                onClick={() => loadDirectory(currentPath)}
                title={t("fileExplorer.refresh")}
              />
            </>
          )}
        </div>
      </div>

      {activeSessionId && (
        <div
          className="px-2 py-1 border-b flex items-center"
          style={{ borderColor: "var(--df-border)", minHeight: "26px" }}
        >
          {isEditingPath ? (
            <input
              autoFocus
              className="w-full text-[0.625rem] font-mono bg-transparent outline-none m-0 p-0"
              style={{ color: "var(--df-text)" }}
              value={pathInputText}
              onChange={(e) => setPathInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  let p = pathInputText.trim();
                  if (p) {
                    if (p.startsWith("~/")) {
                      p = homeDir + p.substring(1);
                    } else if (p === "~") {
                      p = homeDir;
                    }
                    loadDirectory(p);
                  }
                  setIsEditingPath(false);
                } else if (e.key === "Escape") {
                  setIsEditingPath(false);
                }
              }}
              onBlur={() => setIsEditingPath(false)}
            />
          ) : (
            <div
              className="text-[0.625rem] font-mono truncate cursor-text transition-colors flex-1"
              style={{ color: "var(--df-text-dimmed)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--df-text)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--df-text-dimmed)")}
              onClick={() => {
                setPathInputText(currentPath || homeDir);
                setIsEditingPath(true);
              }}
              title={t("fileExplorer.editPath")}
            >
              {displayPath}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 text-sm terminal-scroll">
        {!activeSessionId ? (
          <div className="text-center py-8 text-xs" style={{ color: "var(--df-text-dimmed)" }}>
            <MdFolderOff className="text-xl block mx-auto mb-2" />
            <div className="text-sm block mb-2">{t("fileExplorer.connectToSession")}</div>
          </div>
        ) : loading ? (
          <div className="text-center py-4 text-xs" style={{ color: "var(--df-text-dimmed)" }}>
            {t("fileExplorer.loading")}
          </div>
        ) : error ? (
          <div className="text-center text-red-400 py-4 text-xs">{error}</div>
        ) : files.length === 0 ? (
          <div className="text-center py-4 text-xs" style={{ color: "var(--df-text-dimmed)" }}>
            {t("fileExplorer.emptyDirectory")}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {files.map((entry) => (
              <FileListItem
                key={entry.name}
                entry={entry}
                isSelected={selectedFile === entry.name}
                activeSessionId={activeSessionId}
                onSelect={(entry) => setSelectedFile(entry.name)}
                onItemClick={handleItemClick}
                onOpenDefault={handleOpenDefault}
                onRefresh={() => loadDirectory(currentPath)}
                onUpload={handleUpload}
                onDownload={handleDownload}
                onRename={(entry) => {
                  if (activeSessionId)
                    setRenameDialogData({
                      sessionId: activeSessionId,
                      oldPath: getEntryFullPath(entry),
                      name: entry.name,
                      currentDirPath: currentPath,
                    });
                }}
                onMove={(entry) => {
                  if (activeSessionId)
                    setMoveDialogData({
                      sessionId: activeSessionId,
                      oldPath: getEntryFullPath(entry),
                      name: entry.name,
                    });
                }}
                onDelete={handleDelete}
                onCopyPath={handleCopyPath}
                onSendToTerminal={handleSendToTerminal}
                onProperties={(entry) => {
                  if (activeSessionId) {
                    setPropertiesDialogData({
                      sessionId: activeSessionId,
                      fullPath: getEntryFullPath(entry),
                      name: entry.name,
                      is_dir: entry.is_dir,
                    });
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {activeSessionId &&
        !loading &&
        !error &&
        files.length > 0 &&
        (() => {
          const totalItems = files.length;
          const hasFiles = files.some((f) => !f.is_dir);
          const totalSize = files.filter((f) => !f.is_dir).reduce((sum, f) => sum + f.size, 0);

          return (
            <div
              className="px-2 py-1.5 text-[0.625rem] border-t flex items-center justify-between shrink-0"
              style={{
                color: "var(--df-text-dimmed)",
                borderColor: "var(--df-border)",
                backgroundColor: "var(--df-bg-panel)",
              }}
            >
              <div className="flex gap-4">
                <span>{t("fileExplorer.totalItems", { count: totalItems })}</span>
                {hasFiles && <span>{formatSize(totalSize)}</span>}
              </div>
              <MdSend
                className="text-sm cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-center p-0.5 rounded"
                style={{ color: "var(--df-text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--df-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                onClick={() => {
                  if (activeSessionId && currentPath) {
                    invoke("write_to_session", {
                      sessionId: activeSessionId,
                      data: `${currentPath}`,
                    });
                    emit(`focus-terminal-${activeSessionId}`);
                  }
                }}
                title={t("fileExplorer.sendToTerminal")}
              />
            </div>
          );
        })()}

      {renameDialogData && (
        <RenameDialog
          data={renameDialogData}
          onClose={() => setRenameDialogData(null)}
          onSuccess={() => loadDirectory(currentPath)}
        />
      )}

      {deleteDialogData && (
        <DeleteDialog
          data={deleteDialogData}
          onClose={() => setDeleteDialogData(null)}
          onSuccess={() => loadDirectory(currentPath)}
        />
      )}

      {moveDialogData && (
        <MoveDialog
          data={moveDialogData}
          onClose={() => setMoveDialogData(null)}
          onSuccess={() => loadDirectory(currentPath)}
        />
      )}

      {autoUploadDialogData && (
        <AutoUploadDialog
          data={autoUploadDialogData}
          onClose={() => setAutoUploadDialogData(null)}
          onAlwaysUpload={(sessionId, localPath) => {
            const key = `${sessionId}:${localPath}`;
            setAlwaysUploadFiles((prev) => new Set([...prev, key]));
          }}
        />
      )}

      {propertiesDialogData && (
        <PropertiesDialog
          data={propertiesDialogData}
          onClose={() => setPropertiesDialogData(null)}
        />
      )}
    </aside>
  );
}
