"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface SplitPanelProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number; // percentage (0-100)
  minLeftWidth?: number; // percentage
  maxLeftWidth?: number; // percentage
}

export default function SplitPanel({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 40,
  minLeftWidth = 20,
  maxLeftWidth = 80,
}: SplitPanelProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const newLeftWidth =
        ((e.clientX - containerRect.left) / containerRect.width) * 100;

      const clampedWidth = Math.min(
        maxLeftWidth,
        Math.max(minLeftWidth, newLeftWidth)
      );
      setLeftWidth(clampedWidth);
    },
    [isDragging, minLeftWidth, maxLeftWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", height: "100%", width: "100%" }}
    >
      {/* Left Panel (Chat) */}
      <div
        data-testid="chat-panel"
        style={{
          flexBasis: `${leftWidth}%`,
          flexShrink: 0,
          flexGrow: 0,
          overflow: "auto",
          height: "100%",
          borderRight: "1px solid var(--border-main)",
        }}
      >
        {leftPanel}
      </div>

      {/* Draggable Resizer */}
      <div
        data-testid="panel-resizer"
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={leftWidth}
        aria-valuemin={minLeftWidth}
        aria-valuemax={maxLeftWidth}
        style={{
          width: 4,
          cursor: "col-resize",
          background: isDragging ? "var(--border-input)" : "transparent",
          transition: "background 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--border-input)"; }}
        onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.background = "transparent"; }}
      />

      {/* Right Panel (Preview) */}
      <div
        data-testid="preview-panel"
        style={{ flex: 1, overflow: "auto", height: "100%" }}
      >
        {rightPanel}
      </div>
    </div>
  );
}
