"use client";

import { cn } from "@/lib/utils";
import { validateSignaturePayload } from "@/modules/signatures/service";
import { useEffect, useRef } from "react";

type Props = {
  className?: string;
  width?: number;
  height?: number;
  onChange?: (dataUrlOrEmpty: string | null) => void;
};

/**
 * Canvas de firma; exporta PNG data URL (base64) para almacenar en OT.
 */
export function SignaturePad({ className, width = 320, height = 160, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    onChange?.(null);
  }, [width, height, onChange]);

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    const url = canvas.toDataURL("image/png");
    try {
      validateSignaturePayload(url);
      onChange(url);
    } catch {
      onChange(null);
    }
  }

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ touchAction: "none" }}
      className={cn(
        "max-w-full rounded-md border border-zinc-300 bg-white shadow-inner dark:border-zinc-700",
        className,
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const ctx = e.currentTarget.getContext("2d");
        if (!ctx) return;
        const p = pos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      }}
      onPointerUp={(e) => {
        drawing.current = false;
        emit();
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onPointerCancel={() => {
        drawing.current = false;
        emit();
      }}
      onPointerLeave={() => {
        drawing.current = false;
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const ctx = e.currentTarget.getContext("2d");
        if (!ctx) return;
        const p = pos(e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }}
    />
  );
}
