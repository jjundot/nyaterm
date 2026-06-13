import { Fragment, type ReactNode, useRef } from "react";
import ResizeHandle from "@/components/layout/ResizeHandle";

interface PanelStackProps {
  panelIds: string[];
  /** Exclusive panel (e.g. AI assistant) shown on its own instead of the stack. */
  overlayPanelId: string | null;
  sizes: Record<string, number>;
  renderPanel: (panelId: string | null) => ReactNode;
  onResizePair: (aboveId: string, belowId: string, delta: number, containerHeight: number) => void;
}

/**
 * Stacks multiple side panels vertically with draggable dividers.
 * Each panel gets a flex weight from `sizes` (default 1, i.e. equal heights).
 * When `overlayPanelId` is set, that panel is shown alone while the stack stays
 * mounted but hidden, so both keep their state when switching back and forth.
 */
export default function PanelStack({
  panelIds,
  overlayPanelId,
  sizes,
  renderPanel,
  onResizePair,
}: PanelStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayEverShownRef = useRef(false);
  const lastOverlayIdRef = useRef<string | null>(null);
  if (overlayPanelId) {
    overlayEverShownRef.current = true;
    lastOverlayIdRef.current = overlayPanelId;
  }
  const overlayActive = Boolean(overlayPanelId);

  const stack =
    panelIds.length <= 1 ? (
      renderPanel(panelIds[0] ?? null)
    ) : (
      <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden">
        {panelIds.map((panelId, index) => (
          <Fragment key={panelId}>
            {index > 0 && (
              <ResizeHandle
                direction="vertical"
                onResize={(delta) =>
                  onResizePair(
                    panelIds[index - 1],
                    panelId,
                    delta,
                    containerRef.current?.clientHeight ?? 0,
                  )
                }
              />
            )}
            <div
              className="min-h-0 overflow-hidden"
              style={{ flexGrow: sizes[panelId] ?? 1, flexShrink: 1, flexBasis: 0, minHeight: 48 }}
            >
              {renderPanel(panelId)}
            </div>
          </Fragment>
        ))}
      </div>
    );

  if (!overlayEverShownRef.current) {
    return <>{stack}</>;
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className={overlayActive ? "hidden" : "h-full min-h-0"}>{stack}</div>
      <div className={overlayActive ? "h-full min-h-0" : "hidden"}>
        {renderPanel(lastOverlayIdRef.current)}
      </div>
    </div>
  );
}
