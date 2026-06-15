# Tab Dock 拖拽功能实现总结

## 实现概览

已完整实现方案 A：支持将 tab 标签页拖拽到窗口边缘实现 dock 效果的 split 功能。

## 新增文件

### 1. `src/components/terminal/DropZoneOverlay.tsx`
视觉反馈组件，显示拖拽时的 drop zone 提示：

**功能**：
- 中心区域：显示 "Drop to merge" 提示（合并到现有窗口）
- 边缘区域：显示 "Split Left/Right/Top/Bottom" 提示（创建新的 split）
- 半透明背景 + 主题色高亮边框
- 40% 宽度/高度的预览区域（边缘 split）

**导出类型**：
```typescript
export type DropZoneType = "center" | "edge";
export type DropZoneDirection = "left" | "right" | "top" | "bottom";
export interface DropZone {
  type: DropZoneType;
  direction?: DropZoneDirection;
  leafId: string;
}
```

## 修改的文件

### 2. `src/lib/tabWindows.ts`

**新增导出**：
```typescript
export type SplitEdgeDirection = "left" | "right" | "top" | "bottom";
```

**新增函数**：
```typescript
export function splitLeafWithTab(
  node: TerminalWindowNode,
  tabId: string,
  targetLeafId: string,
  direction: SplitEdgeDirection,
): TerminalWindowNode | null
```

**功能**：
1. 从源 leaf 移除被拖拽的 tab
2. 创建只包含该 tab 的新 leaf
3. 根据 direction 确定 split 方向和顺序：
   - `left/right` → `vertical` split
   - `top/bottom` → `horizontal` split
4. 替换目标 leaf 为新的 split 节点（包含目标 leaf + 新 leaf）

### 3. `src/components/terminal/TabWindowsWorkspace.tsx`

**Props 扩展**：
```typescript
interface TabWindowsWorkspaceProps {
  // ... 现有 props
  onSplitLeafWithTab?: (
    tabId: string,
    targetLeafId: string,
    direction: SplitEdgeDirection,
  ) => void;
}
```

**LeafWindow 组件增强**：

1. **状态管理**：
   ```typescript
   const [dropZone, setDropZone] = useState<DropZone | null>(null);
   const containerRef = useRef<HTMLDivElement | null>(null);
   ```

2. **边缘检测**：
   ```typescript
   const EDGE_THRESHOLD = 100; // 像素阈值
   const detectDropZone = (event: DragEvent): DropZone | null => {
     // 根据鼠标位置返回相应的 drop zone
   }
   ```

3. **拖拽事件处理**：
   - `onDragOver`: 检测并更新 drop zone
   - `onDragLeave`: 清除 drop zone
   - `onDrop`: 根据 drop zone 类型调用相应回调
     - `edge` → `onSplitLeafWithTab`
     - `center` → `onMoveTabToLeaf`

4. **视觉反馈**：
   ```typescript
   {dropZone && <DropZoneOverlay zone={dropZone} />}
   ```

**Props 传递链**：
- `TabWindowsWorkspace` → `WindowNodeView` → `SplitWindow`/`LeafWindow`
- 所有层级都传递 `onSplitLeafWithTab`

### 4. `src/App.tsx`

**导入扩展**：
```typescript
import {
  // ... 现有导入
  splitLeafWithTab,
  type SplitEdgeDirection,
} from "./lib/tabWindows";
```

**新增回调**：
```typescript
const handleSplitLeafWithTab = useCallback(
  (tabId: string, targetLeafId: string, direction: SplitEdgeDirection) => {
    setTerminalWindows((current) => {
      if (!current) return current;
      const next = splitLeafWithTab(current, tabId, targetLeafId, direction);
      return next ?? current;
    });
    setActiveTabId(tabId);
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("nyaterm:refresh-terminals"));
    });
  },
  [setActiveTabId],
);
```

**连接到组件**：
```typescript
<TerminalWorkspace
  workspace={{
    // ... 现有 props
    onSplitLeafWithTab: handleSplitLeafWithTab,
  }}
/>
```

## 工作流程

### 用户操作流程

1. **开始拖拽**：用户在 TabBar 拖拽一个 tab
   - `handleDragStart` 设置 `application/nyaterm-tab` dataTransfer
   
2. **拖拽到目标窗口**：鼠标移动到 LeafWindow 区域
   - `handleDragOver` 实时检测鼠标位置
   - `detectDropZone` 根据位置返回 zone 类型
   - `setDropZone` 更新状态 → `DropZoneOverlay` 显示视觉反馈
   
3. **释放 (Drop)**：
   - **边缘区域**：
     ```
     onDrop → handleSplitLeafWithTab → splitLeafWithTab
     → 移除 tab → 创建新 leaf → 创建 split 节点
     → 刷新终端布局
     ```
   
   - **中心区域**：
     ```
     onDrop → handleMoveTabToLeaf → moveTabBetweenLeaves
     → 移除 tab → 插入到目标 leaf → 刷新终端布局
     ```

### 边缘检测逻辑

```
┌─────────────────────────────────┐
│  TOP (y < 100)                  │
├─────┬───────────────────┬───────┤
│     │                   │       │
│ L   │                   │   R   │
│ E   │     CENTER        │   I   │
│ F   │                   │   G   │
│ T   │                   │   H   │
│     │                   │   T   │
│ x<  │                   │  >w-  │
│ 100 │                   │  100  │
├─────┴───────────────────┴───────┤
│  BOTTOM (y > h-100)             │
└─────────────────────────────────┘
```

## 特性

### ✅ 已实现

- [x] 四个方向的边缘 split（left/right/top/bottom）
- [x] 中心区域 merge（复用现有功能）
- [x] 实时视觉反馈（半透明预览区域）
- [x] 方向标签提示（Split Left/Right/Top/Bottom）
- [x] 支持跨 leaf 拖拽
- [x] 自动刷新终端布局
- [x] 拖拽后自动激活被拖拽的 tab

### 🎨 样式特点

- 使用 CSS 变量 `var(--df-primary)` 保持主题一致性
- 边缘区域占 40% 宽度/高度，避免遮挡过多内容
- 8px 内边距，4px 圆角，视觉舒适
- 20% 透明度背景 + 2px 实色边框，层次分明

### 🔧 技术亮点

1. **类型安全**：完整的 TypeScript 类型定义
2. **不可变更新**：所有状态更新遵循 React 不可变模式
3. **性能优化**：`requestAnimationFrame` 延迟布局刷新
4. **事件清理**：正确处理 `dragLeave` 避免闪烁
5. **容错处理**：空值检查，返回原状态避免崩溃

## 兼容性

- ✅ 与现有 TabBar 拖拽排序功能共存
- ✅ 与现有 Split Session 功能兼容
- ✅ 与 Unsplit 功能兼容
- ✅ 不影响现有的 tab 管理逻辑

## 测试建议

### 功能测试

1. **基本 dock 功能**：
   - 拖拽 tab 到窗口左边缘 → 应创建左侧 split
   - 拖拽 tab 到窗口右边缘 → 应创建右侧 split
   - 拖拽 tab 到窗口顶部边缘 → 应创建顶部 split
   - 拖拽 tab 到窗口底部边缘 → 应创建底部 split
   - 拖拽 tab 到窗口中心 → 应 merge 到目标窗口

2. **视觉反馈**：
   - 检查 drop zone overlay 是否正确显示
   - 检查方向标签是否正确（Split Left/Right/Top/Bottom）
   - 检查颜色和透明度是否符合设计

3. **边界情况**：
   - 拖拽最后一个 tab 到其他窗口
   - 拖拽回原窗口
   - 快速连续拖拽
   - 拖拽到已有多个 split 的布局

### 性能测试

- 在复杂 split 布局下测试拖拽响应性
- 检查内存泄漏（多次拖拽后）

## 后续优化建议

1. **可配置阈值**：将 `EDGE_THRESHOLD = 100` 移到配置文件
2. **动画过渡**：添加 split 创建时的动画效果
3. **键盘修饰符**：
   - `Shift + 拖拽` → 强制 merge
   - `Ctrl + 拖拽` → 强制 split
4. **多 tab 批量拖拽**：支持选中多个 tab 一起拖拽
5. **预览内容**：在 overlay 中显示被拖拽 tab 的缩略图

## 文件清单

### 新增
- `src/components/terminal/DropZoneOverlay.tsx` (128 行)

### 修改
- `src/lib/tabWindows.ts` (+41 行)
- `src/components/terminal/TabWindowsWorkspace.tsx` (+95 行)
- `src/App.tsx` (+17 行)

**总计**：约 281 行新代码

## 完成状态

✅ 方案 A 完整实现完成

所有核心功能已实现并集成到现有架构中，无需破坏性改动。
