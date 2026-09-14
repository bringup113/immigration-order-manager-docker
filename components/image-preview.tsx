/* eslint-disable @next/next/no-img-element */
"use client";

import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type View = { scale: number; x: number; y: number };
type Size = { width: number; height: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalSize = useRef<Size | null>(null);
  const fitScale = useRef(1);
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const fitToWindow = useCallback(() => {
    const container = containerRef.current;
    const image = naturalSize.current;
    if (!container || !image) return;
    const bounds = container.getBoundingClientRect();
    const nextScale = clamp(Math.min((bounds.width - 32) / image.width, (bounds.height - 32) / image.height), 0.05, 8);
    fitScale.current = nextScale;
    setView({ scale: nextScale, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => fitToWindow());
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToWindow]);

  function zoomAt(nextScale: number, clientX?: number, clientY?: number) {
    const container = containerRef.current;
    if (!container) return;
    const scale = clamp(nextScale, Math.max(0.05, fitScale.current * 0.25), 8);
    setView((current) => {
      if (clientX === undefined || clientY === undefined) return { ...current, scale };
      const bounds = container.getBoundingClientRect();
      const cursorX = clientX - bounds.left - bounds.width / 2;
      const cursorY = clientY - bounds.top - bounds.height / 2;
      const ratio = scale / current.scale;
      return { scale, x: cursorX - (cursorX - current.x) * ratio, y: cursorY - (cursorY - current.y) * ratio };
    });
  }

  return <div className="relative h-full min-h-[420px] overflow-hidden bg-slate-900">
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-slate-950/80 p-1 text-white shadow-lg backdrop-blur">
      <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => zoomAt(view.scale / 1.25)} title="缩小"><Minus size={16}/></Button>
      <span className="w-14 text-center text-xs tabular-nums">{Math.round(view.scale * 100)}%</span>
      <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => zoomAt(view.scale * 1.25)} title="放大"><Plus size={16}/></Button>
      <span className="mx-1 h-5 w-px bg-white/15"/>
      <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={fitToWindow} title="适应窗口"><Maximize2 size={16}/></Button>
      <Button type="button" variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setView({ scale: 1, x: 0, y: 0 })} title="原始大小"><RotateCcw size={16}/></Button>
    </div>
    <div
      ref={containerRef}
      className={`relative h-full w-full touch-none select-none overflow-hidden ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onWheel={(event) => { event.preventDefault(); zoomAt(view.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY); }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        setView((current) => ({ ...current, x: drag.current!.x + event.clientX - drag.current!.clientX, y: drag.current!.y + event.clientY - drag.current!.clientY }));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onDoubleClick={fitToWindow}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
          naturalSize.current = size;
          setImageSize(size);
          fitToWindow();
        }}
        className="pointer-events-none absolute top-1/2 left-1/2 max-w-none max-h-none origin-center shadow-2xl"
        style={{
          width: imageSize?.width,
          height: imageSize?.height,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      />
    </div>
  </div>;
}
