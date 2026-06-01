import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MdAdd, MdRemove, MdSend, MdStop } from "react-icons/md";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { invoke } from "@/lib/invoke";
import type {
  SendCommandCount,
  SendCommandMode,
  SendCommandPanelDraft,
  SendCommandTarget,
} from "@/lib/sendCommandPanelEvents";
import { buildTerminalCommandInput, sendSessionInput } from "@/lib/sessionInput";

interface SerialSendPanelProps {
  serialSessionId: string | null;
  currentShellSessionId: string | null;
  shellSessionIds: string[];
  draft?: SendCommandPanelDraft | null;
  onDraftConsumed?: () => void;
}

interface ShellSendProgress {
  completedUnits: number;
  totalUnits: number | null;
  unitsPerRound: number;
  totalRounds: number | null;
}

function isValidHex(str: string): boolean {
  return /^[0-9a-fA-F\s]*$/.test(str);
}

function hexStringToBytes(hex: string): number[] {
  const cleaned = hex.replace(/\s+/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = Number.parseInt(cleaned.substring(i, i + 2), 16);
    if (!Number.isNaN(byte)) bytes.push(byte);
  }
  return bytes;
}

const LINE_INTERVAL_SECONDS = 1;
const CHARACTER_INTERVAL_SECONDS = 0.02;

function formatIntervalSeconds(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return value === LINE_INTERVAL_SECONDS ? "1.00" : String(value);
}

function normalizeTextNewlines(value: string): string {
  return value.replace(/\r\n|\r/gu, "\n");
}

function buildShellSendUnits(command: string, mode: SendCommandMode): string[] {
  const normalized = normalizeTextNewlines(command);
  return mode === "line" ? normalized.split("\n") : Array.from(normalized);
}

function getShellUnitInput(unit: string, mode: SendCommandMode): string {
  if (mode === "line") {
    return buildTerminalCommandInput(unit);
  }
  return unit === "\n" ? "\r" : unit;
}

export default function SerialSendPanel({
  serialSessionId,
  currentShellSessionId,
  shellSessionIds,
  draft,
  onDraftConsumed,
}: SerialSendPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"serial" | "shell">(serialSessionId ? "serial" : "shell");
  const [serialMode, setSerialMode] = useState<"text" | "hex">("text");
  const [textData, setTextData] = useState("");
  const [hexData, setHexData] = useState("");
  const [shellCommand, setShellCommand] = useState("");
  const [shellSendMode, setShellSendMode] = useState<SendCommandMode>("line");
  const [shellCount, setShellCount] = useState<SendCommandCount>(1);
  const [shellIntervalInput, setShellIntervalInput] = useState("1.00");
  const [shellTarget, setShellTarget] = useState<SendCommandTarget>("current");
  const [draftCurrentSessionId, setDraftCurrentSessionId] = useState<string | null>(null);
  const [isShellSending, setIsShellSending] = useState(false);
  const [shellProgress, setShellProgress] = useState<ShellSendProgress | null>(null);
  const [lineEnding, setLineEnding] = useState<"none" | "cr" | "lf" | "crlf">("crlf");
  const [hexError, setHexError] = useState(false);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const hexInputRef = useRef<HTMLTextAreaElement>(null);
  const shellInputRef = useRef<HTMLTextAreaElement>(null);
  const shellCancelRef = useRef(false);
  const shellSendingRef = useRef(false);
  const shellTimerRef = useRef<number | null>(null);
  const shellTimerResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!serialSessionId && mode === "serial") {
      setMode("shell");
    }
  }, [mode, serialSessionId]);

  const currentTargetSessionId =
    draftCurrentSessionId && shellSessionIds.includes(draftCurrentSessionId)
      ? draftCurrentSessionId
      : currentShellSessionId;

  const targetSessionIds =
    shellTarget === "current"
      ? currentTargetSessionId
        ? [currentTargetSessionId]
        : []
      : shellSessionIds;

  const cancelShellSend = useCallback(() => {
    shellCancelRef.current = true;
    if (shellTimerRef.current !== null) {
      window.clearTimeout(shellTimerRef.current);
      shellTimerRef.current = null;
    }
    shellTimerResolveRef.current?.();
    shellTimerResolveRef.current = null;
  }, []);

  useEffect(() => {
    return () => cancelShellSend();
  }, [cancelShellSend]);

  useEffect(() => {
    if (draftCurrentSessionId && !shellSessionIds.includes(draftCurrentSessionId)) {
      setDraftCurrentSessionId(null);
    }
  }, [draftCurrentSessionId, shellSessionIds]);

  useEffect(() => {
    if (currentTargetSessionId || shellTarget !== "current") return;
    if (shellSessionIds.length > 0) {
      setShellTarget("all");
    }
  }, [currentTargetSessionId, shellSessionIds.length, shellTarget]);

  useEffect(() => {
    if (!draft) return;

    setMode("shell");
    setShellCommand(draft.text);
    setShellSendMode(draft.sendMode);
    setShellCount(draft.count);
    setShellIntervalInput(formatIntervalSeconds(draft.intervalSeconds));
    setShellTarget(draft.target);
    setDraftCurrentSessionId(draft.sourceSessionId);
    onDraftConsumed?.();
    requestAnimationFrame(() => shellInputRef.current?.focus());
  }, [draft, onDraftConsumed]);

  const sendText = useCallback(() => {
    if (!textData || !serialSessionId) return;
    let data = textData;
    if (lineEnding === "cr") data += "\r";
    else if (lineEnding === "lf") data += "\n";
    else if (lineEnding === "crlf") data += "\r\n";
    invoke("write_to_session", { sessionId: serialSessionId, data }).catch(() => {});
    setTextData("");
    textInputRef.current?.focus();
  }, [lineEnding, serialSessionId, textData]);

  const sendHex = useCallback(() => {
    if (!hexData || !serialSessionId) return;
    if (!isValidHex(hexData)) {
      setHexError(true);
      return;
    }
    const bytes = hexStringToBytes(hexData);
    if (bytes.length === 0) return;
    const str = String.fromCharCode(...bytes);
    invoke("write_to_session", { sessionId: serialSessionId, data: str }).catch(() => {});
    setHexData("");
    setHexError(false);
    hexInputRef.current?.focus();
  }, [hexData, serialSessionId]);

  const waitShellInterval = useCallback(async (seconds: number) => {
    if (seconds <= 0 || shellCancelRef.current) return;

    await new Promise<void>((resolve) => {
      shellTimerResolveRef.current = resolve;
      shellTimerRef.current = window.setTimeout(() => {
        shellTimerRef.current = null;
        shellTimerResolveRef.current = null;
        resolve();
      }, seconds * 1000);
    });
  }, []);

  const sendShellCommand = useCallback(async () => {
    if (shellSendingRef.current) return;

    const units = buildShellSendUnits(shellCommand, shellSendMode);
    const intervalSeconds = Number.parseFloat(shellIntervalInput);
    const effectiveInterval = Number.isFinite(intervalSeconds)
      ? Math.max(0, intervalSeconds)
      : shellSendMode === "line"
        ? LINE_INTERVAL_SECONDS
        : CHARACTER_INTERVAL_SECONDS;
    const targets = [...targetSessionIds];
    if (units.length === 0 || targets.length === 0) return;

    shellCancelRef.current = false;
    shellSendingRef.current = true;
    setIsShellSending(true);
    setShellProgress(
      shellCount === null || shellCount > 1
        ? {
            completedUnits: 0,
            totalUnits: shellCount === null ? null : units.length * shellCount,
            unitsPerRound: units.length,
            totalRounds: shellCount,
          }
        : null,
    );

    let failedCount = 0;
    let sendCount = 0;
    let completedUnits = 0;
    let firstUnit = true;
    let cancelled = false;

    try {
      let round = 0;
      while ((shellCount === null || round < shellCount) && !shellCancelRef.current) {
        for (const unit of units) {
          if (shellCancelRef.current) break;
          if (!firstUnit) {
            await waitShellInterval(effectiveInterval);
          }
          if (shellCancelRef.current) break;

          const input = getShellUnitInput(unit, shellSendMode);
          const registerSubmission = shellSendMode === "line" && unit.trim() ? unit : null;
          const results = await Promise.allSettled(
            targets.map((sessionId) =>
              sendSessionInput(sessionId, input, {
                preview: shellSendMode === "line" ? { kind: "reset" } : undefined,
                registerSubmission,
              }),
            ),
          );

          failedCount += results.filter((result) => result.status === "rejected").length;
          sendCount += results.length;
          completedUnits += 1;
          setShellProgress((current) => (current ? { ...current, completedUnits } : current));
          firstUnit = false;
        }
        round += 1;
      }

      cancelled = shellCancelRef.current;
      if (!cancelled) {
        if (sendCount > 0 && failedCount === sendCount) {
          toast.error(t("serialSend.shellSendFailed", "Send failed"));
          return;
        }
        if (failedCount > 0) {
          toast.error(t("serialSend.shellSendPartial", "Some windows did not receive the command"));
        }
        setShellCommand("");
      }
    } finally {
      if (shellTimerRef.current !== null) {
        window.clearTimeout(shellTimerRef.current);
        shellTimerRef.current = null;
      }
      shellTimerResolveRef.current = null;
      shellCancelRef.current = false;
      shellSendingRef.current = false;
      setIsShellSending(false);
      setShellProgress(null);
      shellInputRef.current?.focus();
    }
  }, [
    shellCommand,
    shellCount,
    shellIntervalInput,
    shellSendMode,
    t,
    targetSessionIds,
    waitShellInterval,
  ]);

  const handleShellModeChange = useCallback((value: SendCommandMode) => {
    setShellSendMode(value);
    setShellIntervalInput(value === "line" ? "1.00" : "0.02");
  }, []);

  const handleCountInputChange = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed === "∞" || trimmed.toLowerCase() === "inf") {
      setShellCount(null);
      return;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      setShellCount(Math.max(1, parsed));
    }
  }, []);

  const decrementCount = useCallback(() => {
    setShellCount((current) => {
      if (current === null) return null;
      if (current <= 1) return null;
      return current - 1;
    });
  }, []);

  const incrementCount = useCallback(() => {
    setShellCount((current) => {
      if (current === null) return 1;
      return current + 1;
    });
  }, []);

  const renderUnavailable = useCallback(
    (title: string, description: string) => (
      <div className="h-full flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 text-center">
        <div className="text-xs font-medium text-foreground">{title}</div>
        <div className="text-[0.6875rem] text-muted-foreground">{description}</div>
      </div>
    ),
    [],
  );

  const shellProgressPercent =
    shellProgress?.totalUnits && shellProgress.totalUnits > 0
      ? Math.min(100, Math.round((shellProgress.completedUnits / shellProgress.totalUnits) * 100))
      : null;
  const shellCompletedRounds = shellProgress
    ? Math.floor(shellProgress.completedUnits / shellProgress.unitsPerRound)
    : 0;
  const shellCurrentRound = shellProgress
    ? shellProgress.totalRounds === null
      ? shellCompletedRounds + 1
      : Math.min(shellProgress.totalRounds, shellCompletedRounds + 1)
    : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden px-2 py-1.5 gap-1">
      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value as typeof mode)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex items-center gap-2 shrink-0">
          <TabsList className="h-7">
            <TabsTrigger
              value="serial"
              disabled={!serialSessionId}
              className="text-[0.6875rem] px-2.5 h-6"
            >
              {t("serialSend.serialData", "Serial Data")}
            </TabsTrigger>
            <TabsTrigger value="shell" className="text-[0.6875rem] px-2.5 h-6">
              {t("serialSend.shellCommand", "Shell Command")}
            </TabsTrigger>
          </TabsList>
          <span className="text-[0.625rem] text-muted-foreground ml-auto select-none">
            {t("serialSend.title", "Command Send")}
          </span>
        </div>

        <TabsContent value="serial" className="flex-1 m-0 mt-1 min-h-0">
          {serialSessionId ? (
            <Tabs
              orientation="vertical"
              value={serialMode}
              onValueChange={(value) => setSerialMode(value as typeof serialMode)}
              className="flex h-full min-h-0 gap-1.5"
            >
              <TabsList className="h-auto w-20 shrink-0 flex-col">
                <TabsTrigger value="text" className="text-[0.6875rem] px-2.5 h-7">
                  {t("serialSend.text", "Text")}
                </TabsTrigger>
                <TabsTrigger value="hex" className="text-[0.6875rem] px-2.5 h-7">
                  {t("serialSend.hex", "Hex")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="text" className="flex-1 m-0 min-h-0">
                <div className="h-full flex flex-col gap-1.5 min-h-0">
                  <Textarea
                    ref={textInputRef}
                    className="min-h-0 flex-1 resize-none text-xs md:text-xs"
                    placeholder={t("serialSend.textPlaceholder", "Enter text to send...")}
                    value={textData}
                    onChange={(e) => setTextData(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        sendText();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Select
                      value={lineEnding}
                      onValueChange={(value) => setLineEnding(value as typeof lineEnding)}
                    >
                      <SelectTrigger className="h-7 w-20 text-[0.625rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">
                          {t("serialSend.noLineEnding", "None")}
                        </SelectItem>
                        <SelectItem value="cr" className="text-xs">
                          CR
                        </SelectItem>
                        <SelectItem value="lf" className="text-xs">
                          LF
                        </SelectItem>
                        <SelectItem value="crlf" className="text-xs">
                          CR+LF
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="ml-auto text-[0.625rem] text-muted-foreground select-none">
                      {t("serialSend.sendShortcut", "Ctrl/Cmd + Enter to send")}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="default"
                      className="h-7 w-7 shrink-0"
                      onClick={sendText}
                      disabled={!textData}
                    >
                      <MdSend className="text-sm" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="hex" className="flex-1 m-0 min-h-0">
                <div className="h-full flex flex-col gap-1.5 min-h-0">
                  <Textarea
                    ref={hexInputRef}
                    className={`min-h-0 flex-1 resize-none font-mono text-xs md:text-xs ${hexError ? "border-destructive" : ""}`}
                    placeholder={t("serialSend.hexPlaceholder", "e.g. 48 65 6C 6C 6F")}
                    value={hexData}
                    onChange={(e) => {
                      setHexData(e.target.value);
                      setHexError(false);
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        sendHex();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hexError && (
                      <span className="text-[0.625rem] text-destructive truncate">
                        {t(
                          "serialSend.hexError",
                          "Invalid hex input. Use hex characters (0-9, A-F) separated by spaces.",
                        )}
                      </span>
                    )}
                    <span className="ml-auto text-[0.625rem] text-muted-foreground select-none shrink-0">
                      {t("serialSend.sendShortcut", "Ctrl/Cmd + Enter to send")}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="default"
                      className="h-7 w-7 shrink-0"
                      onClick={sendHex}
                      disabled={!hexData}
                    >
                      <MdSend className="text-sm" />
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            renderUnavailable(
              t(
                "serialSend.serialUnavailable",
                "Serial data send is only available for the active serial session",
              ),
              t(
                "serialSend.serialUnavailableDesc",
                "Switch to a serial tab to send text or hex data here.",
              ),
            )
          )}
        </TabsContent>

        <TabsContent value="shell" className="flex-1 m-0 mt-1 min-h-0">
          {shellSessionIds.length > 0 ? (
            <div className="h-full flex flex-col gap-2 min-h-0">
              <div className="grid shrink-0 grid-cols-2 gap-1.5 lg:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,0.8fr)_minmax(8rem,0.8fr)]">
                <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-md border border-border/70 bg-background/60">
                  <Label className="shrink-0 px-2 text-[0.625rem] text-muted-foreground">
                    {t("serialSend.sendMode", "Send Mode")}
                  </Label>
                  <Select
                    value={shellSendMode}
                    onValueChange={(value) => handleShellModeChange(value as SendCommandMode)}
                    disabled={isShellSending}
                  >
                    <SelectTrigger className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 text-[0.6875rem] shadow-none focus-visible:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="line" className="text-xs">
                        {t("serialSend.lineByLine", "Line by line")}
                      </SelectItem>
                      <SelectItem value="character" className="text-xs">
                        {t("serialSend.characterByCharacter", "Character by character")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-md border border-border/70 bg-background/60">
                  <Label className="shrink-0 px-2 text-[0.625rem] text-muted-foreground">
                    {t("serialSend.target", "Target")}
                  </Label>
                  <Select
                    value={shellTarget}
                    onValueChange={(value) => setShellTarget(value as SendCommandTarget)}
                    disabled={isShellSending}
                  >
                    <SelectTrigger className="h-8 min-w-0 flex-1 border-0 bg-transparent px-2 text-[0.6875rem] shadow-none focus-visible:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="current"
                        disabled={!currentTargetSessionId}
                        className="text-xs"
                      >
                        {t("serialSend.currentSession", "Current session")}
                      </SelectItem>
                      <SelectItem value="all" className="text-xs">
                        {t("serialSend.allSessions", "All sessions")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-md border border-border/70 bg-background/60">
                  <Label className="shrink-0 px-2 text-[0.625rem] text-muted-foreground">
                    {t("serialSend.count", "Count")}
                  </Label>
                  <div className="flex min-w-0 flex-1 items-center border-l border-border/60">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="h-8 w-8 rounded-none text-muted-foreground"
                      onClick={decrementCount}
                      disabled={isShellSending}
                    >
                      <MdRemove className="text-sm" />
                    </Button>
                    <Input
                      className="h-8 min-w-0 rounded-none border-0 bg-transparent px-1 text-center text-[0.75rem] font-medium shadow-none focus-visible:ring-0"
                      value={shellCount === null ? "∞" : String(shellCount)}
                      inputMode="numeric"
                      disabled={isShellSending}
                      aria-label={t("serialSend.count", "Count")}
                      onChange={(e) => handleCountInputChange(e.target.value)}
                      onBlur={() => {
                        if (shellCount !== null && shellCount < 1) setShellCount(1);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="h-8 w-8 rounded-none text-muted-foreground"
                      onClick={incrementCount}
                      disabled={isShellSending}
                    >
                      <MdAdd className="text-sm" />
                    </Button>
                  </div>
                </div>

                <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-md border border-border/70 bg-background/60">
                  <Label className="shrink-0 px-2 text-[0.625rem] text-muted-foreground">
                    {t("serialSend.interval", "Interval")}
                  </Label>
                  <div className="flex min-w-0 flex-1 items-center border-l border-border/60">
                    <Input
                      className="h-8 min-w-0 rounded-none border-0 bg-transparent px-2 text-right text-[0.75rem] font-medium shadow-none focus-visible:ring-0"
                      value={shellIntervalInput}
                      inputMode="decimal"
                      disabled={isShellSending}
                      aria-label={t("serialSend.interval", "Interval")}
                      onChange={(e) => setShellIntervalInput(e.target.value)}
                      onBlur={() => {
                        const parsed = Number.parseFloat(shellIntervalInput);
                        if (!Number.isFinite(parsed) || parsed < 0) {
                          setShellIntervalInput(shellSendMode === "line" ? "1.00" : "0.02");
                        }
                      }}
                    />
                    <span className="shrink-0 pr-2 text-[0.625rem] text-muted-foreground">
                      {t("serialSend.seconds", "s")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="relative min-h-0 flex-1">
                <Textarea
                  ref={shellInputRef}
                  className="min-h-0 h-full resize-none pr-12 pb-10 font-mono text-xs leading-5 md:text-xs"
                  placeholder={t(
                    "serialSend.shellPlaceholder",
                    "Enter text to send...\nCtrl/Cmd + Enter to send",
                  )}
                  value={shellCommand}
                  disabled={isShellSending}
                  onChange={(e) => setShellCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      if (isShellSending) {
                        cancelShellSend();
                      } else {
                        void sendShellCommand();
                      }
                    }
                  }}
                />
                {shellProgress && (
                  <div className="pointer-events-none absolute inset-x-2 top-2 z-10">
                    <div className="rounded-md border border-primary/25 bg-background/95 px-2.5 py-2 shadow-sm backdrop-blur">
                      <div className="mb-1.5 flex min-w-0 items-center gap-2">
                        <span className="truncate text-[0.6875rem] font-medium text-foreground">
                          {shellProgress.totalRounds === null
                            ? t("serialSend.shellProgressInfinite", "Sending round {{current}}", {
                                current: shellCurrentRound,
                              })
                            : t(
                                "serialSend.shellProgressRound",
                                "Sending {{current}} / {{total}}",
                                {
                                  current: shellCurrentRound,
                                  total: shellProgress.totalRounds,
                                },
                              )}
                        </span>
                        <span className="ml-auto shrink-0 text-[0.625rem] tabular-nums text-muted-foreground">
                          {shellProgress.totalUnits === null
                            ? t("serialSend.shellProgressCompleted", "{{count}} sent", {
                                count: shellProgress.completedUnits,
                              })
                            : t(
                                "serialSend.shellProgressUnits",
                                "{{completed}} / {{total}} units",
                                {
                                  completed: shellProgress.completedUnits,
                                  total: shellProgress.totalUnits,
                                },
                              )}
                        </span>
                      </div>
                      {shellProgressPercent !== null ? (
                        <Progress value={shellProgressPercent} className="h-1.5" />
                      ) : (
                        <div className="h-1.5 overflow-hidden rounded-full bg-primary/20">
                          <div className="h-full w-1/3 rounded-full bg-primary/70" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <Button
                  size="icon-xs"
                  variant={isShellSending ? "destructive" : "default"}
                  className="absolute bottom-2 right-2 h-7 w-7 shadow-sm"
                  title={
                    isShellSending ? t("serialSend.stop", "Stop") : t("serialSend.send", "Send")
                  }
                  onClick={() => {
                    if (isShellSending) {
                      cancelShellSend();
                    } else {
                      void sendShellCommand();
                    }
                  }}
                  disabled={!isShellSending && (!shellCommand || targetSessionIds.length === 0)}
                >
                  {isShellSending ? <MdStop className="text-sm" /> : <MdSend className="text-sm" />}
                </Button>
              </div>
            </div>
          ) : (
            renderUnavailable(
              t("serialSend.shellUnavailable", "No active shell windows available"),
              t(
                "serialSend.shellUnavailableDesc",
                "None of the active windows currently contain SSH, local terminal, or Telnet sessions.",
              ),
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
