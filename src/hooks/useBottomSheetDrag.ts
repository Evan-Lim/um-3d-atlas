import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { resolveSheetDragOutcome } from '../utils/atlasUtils';

export interface BottomSheetDragResult {
  isDragging: boolean;
  dragStyle: CSSProperties | undefined;
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
}

/**
 * Enables native-feeling vertical drag-to-collapse and drag-to-expand gestures
 * on mobile bottom sheets (<= 900px), plus single-tap toggle on the sheet grip.
 */
export function useBottomSheetDrag(
  collapsed: boolean,
  onChangeCollapsed: (next: boolean) => void,
): BottomSheetDragResult {
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const stateRef = useRef<{
    pointerId: number;
    startY: number;
    startTime: number;
    lastY: number;
    lastTime: number;
    moved: boolean;
    startedOnHandle: boolean;
  } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.innerWidth > 900) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const target = e.target as HTMLElement | null;
    const isHandle = Boolean(target?.closest('.sheet-handle'));
    if (!isHandle && target?.closest('button, a, input, select, textarea, label')) {
      return;
    }

    const now = performance.now();
    stateRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTime: now,
      lastY: e.clientY,
      lastTime: now,
      moved: false,
      startedOnHandle: isHandle,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic events
    }
    setIsDragging(true);
    setDragOffsetY(0);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (!st || st.pointerId !== e.pointerId) return;

      const rawDelta = e.clientY - st.startY;
      if (Math.abs(rawDelta) > 5) {
        st.moved = true;
      }
      st.lastY = e.clientY;
      st.lastTime = performance.now();

      // Apply gentle resistance when dragging past resting limits
      let offset = rawDelta;
      if (!collapsed && offset < 0) {
        offset = offset * 0.22;
      } else if (collapsed && offset > 0) {
        offset = offset * 0.22;
      }
      offset = Math.max(-220, Math.min(280, offset));
      setDragOffsetY(offset);
    },
    [collapsed],
  );

  const finishDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const st = stateRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      stateRef.current = null;

      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore capture release errors
      }

      const deltaY = e.clientY - st.startY;
      const elapsedMs = Math.max(16, performance.now() - st.startTime);
      const velocityY = deltaY / elapsedMs;

      setIsDragging(false);
      setDragOffsetY(0);

      if (cancelled) return;

      if (!st.moved) {
        if (st.startedOnHandle) {
          onChangeCollapsed(!collapsed);
        }
        return;
      }

      const nextCollapsed = resolveSheetDragOutcome(collapsed, deltaY, velocityY);
      if (nextCollapsed !== collapsed) {
        onChangeCollapsed(nextCollapsed);
      }
    },
    [collapsed, onChangeCollapsed],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => finishDrag(e, false),
    [finishDrag],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => finishDrag(e, true),
    [finishDrag],
  );

  const dragStyle: CSSProperties | undefined =
    isDragging && dragOffsetY !== 0
      ? {
          transform: `translateY(${Math.round(dragOffsetY)}px)`,
          transition: 'none',
        }
      : undefined;

  return {
    isDragging,
    dragStyle,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
