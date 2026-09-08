import { useEffect, useRef } from "react";
import { Eraser } from "lucide-react";

export function SignaturePad({ onChange }: { onChange: (dataUrl?: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext("2d"); if (!context) return;
    const ratio = window.devicePixelRatio || 1; const width = canvas.clientWidth; const height = canvas.clientHeight;
    canvas.width = width * ratio; canvas.height = height * ratio; context.scale(ratio, ratio);
    context.lineWidth = 2; context.lineCap = "round"; context.strokeStyle = "#172033";
  }, []);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => { const context = event.currentTarget.getContext("2d"); if (!context) return; event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const context = event.currentTarget.getContext("2d"); if (!context) return; const p = point(event); context.lineTo(p.x, p.y); context.stroke(); };
  const end = (event: React.PointerEvent<HTMLCanvasElement>) => { event.currentTarget.releasePointerCapture(event.pointerId); onChange(event.currentTarget.toDataURL("image/png")); };
  const clear = () => { const canvas = canvasRef.current; const context = canvas?.getContext("2d"); if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height); onChange(undefined); };
  return <div><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} className="h-32 w-full touch-none rounded-lg border bg-white" aria-label="พื้นที่วาดลายเซ็น" /><button type="button" onClick={clear} className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-semibold text-muted-foreground shadow-sm transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-rose-950/30" aria-label="ล้างลายเซ็นที่วาด"><Eraser className="h-4 w-4" aria-hidden="true" />ล้างลายเซ็น</button></div>;
}
