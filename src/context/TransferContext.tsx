import { listen } from "@tauri-apps/api/event";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { invoke } from "@/lib/invoke";

export type TransferDirection = "upload" | "download";
export type TransferKind = "file" | "directory";
export type TransferStatus = "transferring" | "paused" | "completed" | "error" | "cancelled";

export interface TransferItem {
  id: string;
  sessionId: string;
  fileName: string;
  remotePath: string;
  localPath: string;
  direction: TransferDirection;
  kind: TransferKind;
  parentId?: string;
  status: TransferStatus;
  size: number;
  bytesTransferred: number;
  totalSize: number;
  itemCountTotal?: number;
  itemCountCompleted?: number;
  error?: string;
  timestamp: number;
}

interface TransferContextValue {
  transfers: TransferItem[];
  clearCompleted: () => void;
  clearAll: () => void;
  removeTransfer: (id: string) => void;
  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  retryTransfer: (item: TransferItem) => Promise<void>;
}

const TransferContext = createContext<TransferContextValue | null>(null);

/** Backend event payload shape. */
interface TransferEventPayload {
  id: string;
  session_id: string;
  file_name: string;
  remote_path: string;
  local_path: string;
  direction: string;
  kind?: string;
  parent_id?: string;
  status: string;
  size: number;
  bytes_transferred: number;
  total_size: number;
  item_count_total?: number;
  item_count_completed?: number;
  error_msg?: string;
}

export function TransferProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [transferMap, setTransferMap] = useState<Map<string, TransferItem>>(() => new Map());

  const transfers = useMemo(() => Array.from(transferMap.values()), [transferMap]);

  useEffect(() => {
    const unlisten = listen<TransferEventPayload>("transfer-event", (e) => {
      const p = e.payload;
      const kind = (p.kind ?? "file") as TransferKind;

      if (p.status === "started") {
        if (p.parent_id) {
          return;
        }
        setTransferMap((prev) => {
          const next = new Map(prev);
          next.set(p.id, {
            id: p.id,
            sessionId: p.session_id,
            fileName: p.file_name,
            remotePath: p.remote_path,
            localPath: p.local_path,
            direction: p.direction as TransferDirection,
            kind,
            parentId: p.parent_id,
            status: "transferring",
            size: 0,
            bytesTransferred: 0,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total,
            itemCountCompleted: p.item_count_completed,
            timestamp: Date.now(),
          });
          return next;
        });
        return;
      }

      setTransferMap((prev) => {
        const existing = prev.get(p.id);
        if (!existing) return prev;
        const next = new Map(prev);
        let updated: TransferItem;

        if (p.status === "progress") {
          updated = {
            ...existing,
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
          };
        } else if (p.status === "paused") {
          updated = {
            ...existing,
            status: "paused",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
          };
        } else if (p.status === "resumed") {
          updated = {
            ...existing,
            status: "transferring",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
          };
        } else if (p.status === "cancelled") {
          updated = {
            ...existing,
            status: "cancelled",
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
            error: undefined,
          };
        } else {
          updated = {
            ...existing,
            status: p.status as TransferStatus,
            size: p.size,
            bytesTransferred: p.bytes_transferred,
            totalSize: p.total_size,
            itemCountTotal: p.item_count_total ?? existing.itemCountTotal,
            itemCountCompleted: p.item_count_completed ?? existing.itemCountCompleted,
            error: p.error_msg,
          };
        }

        next.set(p.id, updated);
        return next;
      });

      if (p.status === "completed" && p.direction === "download" && !p.parent_id) {
        toast.success(
          kind === "directory"
            ? t("fileTransfer.downloadFolderCompleted")
            : t("fileTransfer.downloadCompleted"),
          {
            description: p.local_path,
          },
        );
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  const clearCompleted = useCallback(() => {
    setTransferMap((prev) => {
      const next = new Map(prev);
      for (const [id, t] of prev) {
        if (t.status === "completed") next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setTransferMap(new Map());
  }, []);

  const removeTransfer = useCallback((id: string) => {
    setTransferMap((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const pauseTransfer = useCallback(async (id: string) => {
    try {
      await invoke("pause_transfer", { transferId: id });
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const resumeTransfer = useCallback(async (id: string) => {
    try {
      await invoke("resume_transfer", { transferId: id });
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const cancelTransfer = useCallback(async (id: string) => {
    try {
      await invoke("cancel_transfer", { transferId: id });
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const retryTransfer = useCallback(async (item: TransferItem) => {
    try {
      if (item.direction === "upload") {
        if (item.kind === "directory") {
          await invoke("upload_local_directory", {
            sessionId: item.sessionId,
            localPath: item.localPath,
            remotePath: item.remotePath,
          });
        } else {
          await invoke("upload_local_file", {
            sessionId: item.sessionId,
            localPath: item.localPath,
            remotePath: item.remotePath,
          });
        }
      } else if (item.kind === "directory") {
        await invoke("download_remote_directory", {
          sessionId: item.sessionId,
          remotePath: item.remotePath,
          localPath: item.localPath,
        });
      } else {
        await invoke("download_remote_file", {
          sessionId: item.sessionId,
          remotePath: item.remotePath,
          localPath: item.localPath,
        });
      }
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const contextValue = useMemo(
    () => ({
      transfers,
      clearCompleted,
      clearAll,
      removeTransfer,
      pauseTransfer,
      resumeTransfer,
      cancelTransfer,
      retryTransfer,
    }),
    [transfers, clearCompleted, clearAll, removeTransfer, pauseTransfer, resumeTransfer, cancelTransfer, retryTransfer],
  );

  return (
    <TransferContext.Provider value={contextValue}>
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer(): TransferContextValue {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfer must be used within TransferProvider");
  return ctx;
}
