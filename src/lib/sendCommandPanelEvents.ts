export const OPEN_SEND_COMMAND_PANEL_EVENT = "nyaterm:open-send-command-panel";

export type SendCommandMode = "line" | "character";
export type SendCommandTarget = "current" | "all";
export type SendCommandCount = number | null;

export interface SendCommandPanelDraft {
  text: string;
  sourceSessionId: string | null;
  sendMode: SendCommandMode;
  count: SendCommandCount;
  intervalSeconds: number;
  target: SendCommandTarget;
}

export function openSendCommandPanel(draft: SendCommandPanelDraft): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SendCommandPanelDraft>(OPEN_SEND_COMMAND_PANEL_EVENT, { detail: draft }),
  );
}

export function listenOpenSendCommandPanel(
  handler: (draft: SendCommandPanelDraft) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<SendCommandPanelDraft>;
    if (!customEvent.detail) return;
    handler(customEvent.detail);
  };

  window.addEventListener(OPEN_SEND_COMMAND_PANEL_EVENT, listener);
  return () => {
    window.removeEventListener(OPEN_SEND_COMMAND_PANEL_EVENT, listener);
  };
}
