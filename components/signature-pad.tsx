"use client";

import * as React from "react";
import { Eraser } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Recuadro para firmar con el dedo o el mouse. El dibujo viaja al servidor
 * como imagen PNG en el campo oculto `signature`.
 */
export function SignaturePad({ name = "signature" }: { name?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  // El dibujo vive en el estado (campo controlado): React 19 vacía los campos
  // sin control del formulario después de cada envío, y la firma se perdía
  // aunque siguiera visible en el recuadro.
  const [dataUrl, setDataUrl] = React.useState("");
  const hasInk = dataUrl !== "";

  const setup = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  React.useEffect(() => {
    setup();
  }, [setup]);

  function position(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = position(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y + 0.01);
    ctx.stroke();
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = position(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setDataUrl(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setDataUrl("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-[var(--radius-brand-sm)] border-2 border-dashed border-brand-border bg-white">
        <canvas
          ref={canvasRef}
          className="block h-44 w-full touch-none rounded-[var(--radius-brand-sm)]"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label="Recuadro de firma"
        />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-brand-muted">
            Firma aquí
          </span>
        )}
      </div>
      <input type="hidden" name={name} value={dataUrl} readOnly />
      <div>
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser /> Borrar y firmar de nuevo
        </Button>
      </div>
    </div>
  );
}
