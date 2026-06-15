import { memo } from "react";

export type DropZoneType = "center" | "edge";
export type DropZoneDirection = "left" | "right" | "top" | "bottom";

export interface DropZone {
  type: DropZoneType;
  direction?: DropZoneDirection;
  leafId: string;
}

interface DropZoneOverlayProps {
  zone: DropZone;
}

function DropZoneOverlay({ zone }: DropZoneOverlayProps) {
  if (zone.type === "center") {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
        style={{
          backgroundColor: "color-mix(in srgb, var(--df-primary) 12%, transparent)",
          border: "2px solid var(--df-primary)",
          borderRadius: "8px",
        }}
      >
        <div
          className="rounded-lg px-4 py-2 text-sm font-semibold shadow-lg"
          style={{
            backgroundColor: "var(--df-primary)",
            color: "white",
          }}
        >
          Drop to merge
        </div>
      </div>
    );
  }

  // Edge drop zones
  const getEdgeStyle = () => {
    const baseStyle = {
      position: "absolute" as const,
      backgroundColor: "color-mix(in srgb, var(--df-primary) 20%, transparent)",
      border: "2px solid var(--df-primary)",
      borderRadius: "4px",
      zIndex: 50,
    };

    switch (zone.direction) {
      case "left":
        return {
          ...baseStyle,
          top: "8px",
          left: "8px",
          bottom: "8px",
          width: "40%",
        };
      case "right":
        return {
          ...baseStyle,
          top: "8px",
          right: "8px",
          bottom: "8px",
          width: "40%",
        };
      case "top":
        return {
          ...baseStyle,
          top: "8px",
          left: "8px",
          right: "8px",
          height: "40%",
        };
      case "bottom":
        return {
          ...baseStyle,
          bottom: "8px",
          left: "8px",
          right: "8px",
          height: "40%",
        };
      default:
        return baseStyle;
    }
  };

  const getDirectionLabel = () => {
    switch (zone.direction) {
      case "left":
        return "Split Left";
      case "right":
        return "Split Right";
      case "top":
        return "Split Top";
      case "bottom":
        return "Split Bottom";
      default:
        return "Split";
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      <div style={getEdgeStyle()}>
        <div className="flex h-full items-center justify-center">
          <div
            className="rounded-lg px-4 py-2 text-sm font-semibold shadow-lg"
            style={{
              backgroundColor: "var(--df-primary)",
              color: "white",
            }}
          >
            {getDirectionLabel()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(DropZoneOverlay);
