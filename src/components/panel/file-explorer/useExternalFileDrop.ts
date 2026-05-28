import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { toast } from "sonner";
import { logger } from "@/lib/logger";
import { normalizeDirectoryPath } from "./model";

interface ExternalFileDropEventPayload {
  kind: "enter" | "over" | "leave" | "drop";
  paths: string[];
  position: {
    x: number;
    y: number;
  };
}

const EXTERNAL_FILE_DROP_MESSAGE_KIND = "external-file-drop";
const DRAG_EVENT_CAPTURE_OPTIONS = true;

type WebView2Bridge = {
  postMessageWithAdditionalObjects: (
    message: unknown,
    additionalObjects: ArrayLike<unknown>,
  ) => void;
};

type DataTransferItemWithFileSystemHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<unknown>;
};

type CurrentRef<T> = {
  current: T;
};

declare global {
  interface Window {
    chrome?: {
      webview?: WebView2Bridge;
    };
  }
}

function isDropPositionInsideElement(
  position: { x: number; y: number },
  element: HTMLElement | null,
) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const scale = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const candidates =
    scale === 1 ? [position] : [position, { x: position.x / scale, y: position.y / scale }];

  return candidates.some(
    ({ x, y }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
}

function isExternalFileDragEvent(event: DragEvent) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types ?? []).includes("Files")) {
    return true;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
}

function getDragEventPosition(event: DragEvent) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

function getExternalFileDropBridge() {
  return window.chrome?.webview;
}

function createExternalFileDropBridgeMessage(position: { x: number; y: number }) {
  return JSON.stringify({
    kind: EXTERNAL_FILE_DROP_MESSAGE_KIND,
    position,
  });
}

async function collectExternalDropAdditionalObjects(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return [];
  }

  const fileItems = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
  if (fileItems.length === 0 && dataTransfer.files.length > 0) {
    return Array.from(dataTransfer.files);
  }

  const additionalObjects: unknown[] = [];
  for (const item of fileItems) {
    const file = item.getAsFile();
    if (file) {
      additionalObjects.push(file);
      continue;
    }

    const itemWithHandle = item as DataTransferItemWithFileSystemHandle;
    if (typeof itemWithHandle.getAsFileSystemHandle === "function") {
      try {
        const handle = await itemWithHandle.getAsFileSystemHandle();
        if (handle) {
          additionalObjects.push(handle);
        }
      } catch {
        // Fall back to File objects if the runtime cannot expose FileSystemHandle.
      }
    }
  }

  return additionalObjects;
}

interface UseExternalFileDropParams {
  activeSessionIdRef: CurrentRef<string | null>;
  canBrowseFilesRef: CurrentRef<boolean>;
  currentPathRef: CurrentRef<string>;
  homeDirRef: CurrentRef<string>;
  listContainerRef: CurrentRef<HTMLDivElement | null>;
  resetExternalDropHover: () => void;
  setIsExternalDropActive: (active: boolean) => void;
  processExternalDropPaths: (
    target: { sessionId: string; remoteDir: string },
    dropPaths: string[],
  ) => void | Promise<void>;
  externalDropPathsRequiredMessage: string;
}

export function useExternalFileDrop({
  activeSessionIdRef,
  canBrowseFilesRef,
  currentPathRef,
  homeDirRef,
  listContainerRef,
  resetExternalDropHover,
  setIsExternalDropActive,
  processExternalDropPaths,
  externalDropPathsRequiredMessage,
}: UseExternalFileDropParams) {
  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    const updateExternalDropState = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      const isOverDropTarget = isDropPositionInsideElement(
        getDragEventPosition(event),
        listContainerRef.current,
      );
      const isActive =
        canBrowseFilesRef.current && !!activeSessionIdRef.current && isOverDropTarget;

      setIsExternalDropActive(isActive);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = event.type === "dragenter" || isActive ? "copy" : "none";
      }
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();

      const leftWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;

      if (
        leftWindow ||
        !isDropPositionInsideElement(getDragEventPosition(event), listContainerRef.current)
      ) {
        resetExternalDropHover();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!isExternalFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      const dropPosition = getDragEventPosition(event);
      const isOverDropTarget = isDropPositionInsideElement(dropPosition, listContainerRef.current);
      resetExternalDropHover();

      const currentSessionId = activeSessionIdRef.current;
      if (!canBrowseFilesRef.current || !currentSessionId || !isOverDropTarget) {
        return;
      }

      const dataTransfer = event.dataTransfer;
      if (dataTransfer?.files && dataTransfer.files.length > 0) {
        try {
          bridge.postMessageWithAdditionalObjects(
            createExternalFileDropBridgeMessage(dropPosition),
            dataTransfer.files,
          );
        } catch (error) {
          logger.error({
            domain: "ui.error",
            event: "file_explorer.external_drop_filelist_bridge_failed",
            message:
              "Failed to bridge external file drop FileList through WebView2 additional objects",
            ids: { session_id: currentSessionId },
            data: {
              remote_dir:
                normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
              file_count: dataTransfer.files.length,
            },
            error,
          });
          toast.error(String(error));
        }
        return;
      }

      void (async () => {
        try {
          const additionalObjects = await collectExternalDropAdditionalObjects(dataTransfer);
          if (additionalObjects.length === 0) {
            logger.warn({
              domain: "ui.error",
              event: "file_explorer.external_drop_objects_unavailable",
              message: "External file drop did not expose any transferable WebView2 objects",
              ids: { session_id: currentSessionId },
              data: {
                remote_dir:
                  normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
                item_count: dataTransfer?.items.length ?? 0,
                file_count: dataTransfer?.files.length ?? 0,
              },
            });
            toast.error(externalDropPathsRequiredMessage);
            return;
          }

          bridge.postMessageWithAdditionalObjects(
            createExternalFileDropBridgeMessage(dropPosition),
            additionalObjects,
          );
        } catch (error) {
          logger.error({
            domain: "ui.error",
            event: "file_explorer.external_drop_bridge_failed",
            message: "Failed to bridge external file drop through WebView2 additional objects",
            ids: { session_id: currentSessionId },
            data: {
              remote_dir:
                normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/",
            },
            error,
          });
          toast.error(String(error));
        }
      })();
    };

    const handleWindowBlur = () => {
      resetExternalDropHover();
    };

    window.addEventListener("dragenter", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragover", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("dragleave", handleWindowDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("drop", handleWindowDrop, DRAG_EVENT_CAPTURE_OPTIONS);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      resetExternalDropHover();
      window.removeEventListener("dragenter", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragover", updateExternalDropState, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("dragleave", handleWindowDragLeave, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("drop", handleWindowDrop, DRAG_EVENT_CAPTURE_OPTIONS);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    activeSessionIdRef,
    canBrowseFilesRef,
    currentPathRef,
    externalDropPathsRequiredMessage,
    homeDirRef,
    listContainerRef,
    resetExternalDropHover,
    setIsExternalDropActive,
  ]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (!bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    let cancelled = false;

    const unlistenPromise = listen<ExternalFileDropEventPayload>("external-file-drop", (event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload;
      if (payload.kind === "leave") {
        resetExternalDropHover();
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(
        payload.position,
        listContainerRef.current,
      );
      const currentSessionId = activeSessionIdRef.current;
      const isActive = canBrowseFilesRef.current && !!currentSessionId && isOverDropTarget;

      if (payload.kind === "enter" || payload.kind === "over") {
        setIsExternalDropActive(isActive);
        return;
      }

      if (payload.kind !== "drop") {
        return;
      }

      resetExternalDropHover();

      if (!isActive || !currentSessionId) {
        return;
      }

      const remoteDir = normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/";
      void processExternalDropPaths({ sessionId: currentSessionId, remoteDir }, payload.paths);
    });

    return () => {
      cancelled = true;
      resetExternalDropHover();
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    activeSessionIdRef,
    canBrowseFilesRef,
    currentPathRef,
    homeDirRef,
    listContainerRef,
    processExternalDropPaths,
    resetExternalDropHover,
    setIsExternalDropActive,
  ]);

  useEffect(() => {
    const bridge = getExternalFileDropBridge();
    if (bridge?.postMessageWithAdditionalObjects) {
      return;
    }

    let cancelled = false;

    const handleWindowBlur = () => {
      resetExternalDropHover();
    };

    window.addEventListener("blur", handleWindowBlur);

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (cancelled) {
        return;
      }

      const payload = event.payload;
      if (payload.type === "leave") {
        resetExternalDropHover();
        return;
      }

      const isOverDropTarget = isDropPositionInsideElement(
        payload.position,
        listContainerRef.current,
      );
      const isActive =
        canBrowseFilesRef.current && !!activeSessionIdRef.current && isOverDropTarget;

      if (payload.type === "enter" || payload.type === "over") {
        setIsExternalDropActive(isActive);
        return;
      }

      resetExternalDropHover();

      if (!isActive) {
        return;
      }

      const currentSessionId = activeSessionIdRef.current;
      if (!currentSessionId) {
        return;
      }

      const remoteDir = normalizeDirectoryPath(currentPathRef.current) || homeDirRef.current || "/";
      void processExternalDropPaths({ sessionId: currentSessionId, remoteDir }, payload.paths);
    });

    return () => {
      cancelled = true;
      resetExternalDropHover();
      window.removeEventListener("blur", handleWindowBlur);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [
    activeSessionIdRef,
    canBrowseFilesRef,
    currentPathRef,
    homeDirRef,
    listContainerRef,
    processExternalDropPaths,
    resetExternalDropHover,
    setIsExternalDropActive,
  ]);
}
