// Type check file for dock drag-and-drop implementation
import type { SplitEdgeDirection } from "./src/lib/tabWindows";
import type { DropZone, DropZoneDirection, DropZoneType } from "./src/components/terminal/DropZoneOverlay";

// Test that types are properly exported and compatible
const testDirection: SplitEdgeDirection = "left";
const testDropZone: DropZone = {
  type: "edge",
  direction: "right",
  leafId: "test-leaf-123",
};

const testDropZoneCenter: DropZone = {
  type: "center",
  leafId: "test-leaf-456",
};

// Test all valid directions
const directions: SplitEdgeDirection[] = ["left", "right", "top", "bottom"];
const dropTypes: DropZoneType[] = ["center", "edge"];
const dropDirections: DropZoneDirection[] = ["left", "right", "top", "bottom"];

console.log("Type checks passed!");
