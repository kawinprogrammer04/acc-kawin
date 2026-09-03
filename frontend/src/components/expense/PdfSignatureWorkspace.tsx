import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2, Maximize2 } from "lucide-react";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { expenseRequestsApi } from "@/api/approvals";
import type { ExpenseRequestAttachment } from "@/api/approvals";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Minimal shape we actually use off the pdfjs-dist document proxy — avoids
// importing its full type surface just for two method signatures.
type PdfDocumentHandle = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (params: { scale: number }) => { width: number; height: number };
    render: (params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown>; cancel: () => void };
  }>;
};

// A document only gets a draggable signature box — and only needs to appear in
// the confirmed placements payload — when it's actually required to be signed.
// Everything else the requester uploaded still shows up as a tab so the
// approver can review it here, just without a signature overlay.
function requiresPlacement(document: ExpenseRequestAttachment): boolean {
  return document.attachment_type === "primary" || document.requires_signature;
}
function isPdfAttachment(document: ExpenseRequestAttachment): boolean {
  return document.content_type === "application/pdf" || /\.pdf$/i.test(document.file_name);
}
function isImageAttachment(document: ExpenseRequestAttachment): boolean {
  return Boolean(document.content_type?.startsWith("image/")) || /\.(jpe?g|png|gif|webp)$/i.test(document.file_name);
}

export type SignaturePlacement = {
  attachment_id: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  page_rotation: number;
  coordinate_system: "top_left";
};

type DragState = {
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  placement: SignaturePlacement;
};

export function initialPlacement(document: ExpenseRequestAttachment, stepNo: number): SignaturePlacement {
  if (document.attachment_type === "primary") {
    const cellIndex = Math.max(1, stepNo);
    const column = cellIndex % 4;
    const row = Math.floor(cellIndex / 4);
    return {
      attachment_id: document.id,
      // The primary signature grid is on the final generated page. The
      // sentinel is resolved after PDF.js knows the real number of pages.
      // Keep the default box on the requested signature-line position.
      page_number: 999,
      x: 0.0773 + column * 0.2297,
      y: 0.8250 + row * 0.063,
      width: 0.155,
      height: 0.026,
      page_rotation: 0,
      coordinate_system: "top_left",
    };
  }
  return {
    attachment_id: document.id,
    // HR remembers the last position per required-document setting. New
    // document types start on page 1 at the HR fallback coordinates.
    page_number: Number(document.default_signature_page || 1),
    x: Number(document.default_signature_x ?? 0.62),
    y: Number(document.default_signature_y ?? 0.69),
    width: Number(document.default_signature_width ?? 0.24),
    height: Number(document.default_signature_height ?? 0.075),
    page_rotation: 0,
    coordinate_system: "top_left",
  };
}

export function PdfSignatureWorkspace({
  requestId,
  documents,
  stepNo,
  signaturePreview,
  onChange,
}: {
  requestId: string;
  documents: ExpenseRequestAttachment[];
  stepNo: number;
  signaturePreview?: string;
  onChange: (placements: SignaturePlacement[]) => void;
}) {
  const requiredDocuments = useMemo(() => documents.filter(requiresPlacement), [documents]);
  const defaults = useMemo(
    () => Object.fromEntries(requiredDocuments.map((document) => [document.id, initialPlacement(document, stepNo)])),
    [requiredDocuments, stepNo],
  );
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(requiredDocuments[0]?.id || "");
  const [placements, setPlacements] = useState<Record<string, SignaturePlacement>>(defaults);
  const [pageCount, setPageCount] = useState(1);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentHandle | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [renderVersion, setRenderVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const activeDocument = requiredDocuments.find((document) => document.id === activeId) || requiredDocuments[0];
  const activePlacement = activeDocument ? placements[activeDocument.id] : undefined;
  const activeIsPdf = activeDocument ? isPdfAttachment(activeDocument) : false;
  const activeIsImage = activeDocument ? isImageAttachment(activeDocument) : false;

  useEffect(() => {
    setPlacements(defaults);
    setActiveId((current) => requiredDocuments.some((document) => document.id === current)
      ? current : requiredDocuments[0]?.id || "");
  }, [defaults]);

  // Load the active document (fetch + parse) — page rendering happens in a
  // separate effect below, once the pages exist in the DOM to draw into.
  useEffect(() => {
    if (!open || !activeDocument) return;
    if (!activeIsPdf && !activeIsImage) {
      // DOC/XLS uploads can't be previewed inline — nothing to render here.
      setLoading(false); setError(""); setImageUrl(undefined); setPdfDoc(null);
      return;
    }
    let disposed = false;
    let documentTask: { promise: Promise<unknown>; destroy: () => Promise<void> } | undefined;
    let objectUrl: string | undefined;

    const load = async () => {
      setLoading(true);
      setError("");
      setImageUrl(undefined);
      setPdfDoc(null);
      try {
        const blob = await expenseRequestsApi.attachmentBlob(requestId, activeDocument.id, true);
        if (disposed) return;
        if (activeIsImage) {
          objectUrl = URL.createObjectURL(blob);
          setImageUrl(objectUrl);
          setPageCount(1);
          setPlacements((current) => current[activeDocument.id]
            ? { ...current, [activeDocument.id]: { ...current[activeDocument.id], page_number: 1 } }
            : current);
          setLoading(false);
          return;
        }
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
        const data = await blob.arrayBuffer();
        if (disposed) return;
        documentTask = pdfjsLib.getDocument({ data });
        const pdf = await documentTask.promise as unknown as PdfDocumentHandle;
        if (disposed) return;
        setPageCount(pdf.numPages);
        setPlacements((current) => {
          const placement = current[activeDocument.id];
          if (!placement) return current;
          const requestedPage = activeDocument.attachment_type === "primary" && placement.page_number === 999
            ? pdf.numPages : placement.page_number;
          const pageNumber = Math.max(1, Math.min(pdf.numPages, requestedPage));
          return pageNumber === placement.page_number
            ? current
            : { ...current, [activeDocument.id]: { ...placement, page_number: pageNumber } };
        });
        setPdfDoc(pdf);
        // Loading is cleared once the selected page finishes drawing.
      } catch (loadError) {
        if (!disposed) {
          setError("เปิดไฟล์ไม่สำเร็จ กรุณาลองเปิดเอกสารตรวจสอบอีกครั้ง");
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      disposed = true;
      documentTask?.destroy();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, activeDocument?.id, activeIsPdf, activeIsImage]);

  // HR renders one page at a time and lets the approver choose the signature
  // page with previous/next controls. Re-render on page change and resize.
  useEffect(() => {
    if (!pdfDoc || !activePlacement) return;
    let disposed = false;

    const renderPage = async () => {
      try {
        const pageNumber = Math.max(1, Math.min(pdfDoc.numPages, activePlacement.page_number));
        const page = await pdfDoc.getPage(pageNumber);
        if (disposed) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(300, (stageRef.current?.clientWidth || 900) - 24);
        const viewport = page.getViewport({ scale: availableWidth / baseViewport.width });
        const context = canvas.getContext("2d");
        if (!context || disposed) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        await page.render({ canvasContext: context, viewport }).promise;
      } catch (renderError) {
        if (!disposed) setError("แสดงตัวอย่างเอกสารไม่สำเร็จ กรุณาลองเปิดเอกสารตรวจสอบอีกครั้ง");
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    renderPage();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, activePlacement?.page_number, renderVersion]);

  useEffect(() => {
    if (!open) return;
    const rerender = () => setRenderVersion((value) => value + 1);
    window.addEventListener("resize", rerender);
    return () => window.removeEventListener("resize", rerender);
  }, [open]);

  const publish = (next: Record<string, SignaturePlacement>) => {
    setPlacements(next);
  };

  const updatePlacement = (changes: Partial<SignaturePlacement>) => {
    if (!activeDocument || !activePlacement) return;
    publish({ ...placements, [activeDocument.id]: { ...activePlacement, ...changes } });
  };

  const changePage = (pageNumber: number) => {
    if (!activePlacement) return;
    updatePlacement({ page_number: Math.max(1, Math.min(pageCount, pageNumber)) });
    setLoading(true);
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    if (!activePlacement) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      placement: { ...activePlacement },
    };
  };

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || !activePlacement) return;
    const canvas = activeIsImage ? undefined : canvasRef.current;
    const rect = (canvas || event.currentTarget.parentElement)?.getBoundingClientRect();
    if (!rect) return;
    const deltaX = (event.clientX - state.startX) / rect.width;
    const deltaY = (event.clientY - state.startY) / rect.height;
    if (state.mode === "move") {
      updatePlacement({
        x: Math.max(0, Math.min(1 - state.placement.width, state.placement.x + deltaX)),
        y: Math.max(0, Math.min(1 - state.placement.height, state.placement.y + deltaY)),
      });
    } else {
      updatePlacement({
        width: Math.max(0.04, Math.min(1 - state.placement.x, state.placement.width + deltaX)),
        height: Math.max(0.02, Math.min(1 - state.placement.y, state.placement.height + deltaY)),
      });
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  if (!requiredDocuments.length) return null;

  const signatureOverlay = (
    <div
      role="img"
      aria-label="ตำแหน่งลายเซ็น"
      onPointerDown={(event) => beginDrag(event, "move")}
      onPointerMove={drag}
      onPointerUp={endDrag}
      className="absolute z-10 flex cursor-move touch-none items-center justify-center border-2 border-primary bg-white/70 shadow"
      style={{
        left: `${(activePlacement?.x || 0) * 100}%`,
        top: `${(activePlacement?.y || 0) * 100}%`,
        width: `${(activePlacement?.width || 0) * 100}%`,
        height: `${(activePlacement?.height || 0) * 100}%`,
      }}
    >
      {signaturePreview ? (
        <img src={signaturePreview} alt="ลายเซ็นของคุณ" className="h-full w-full object-contain" draggable={false} />
      ) : (
        <span className="px-1 text-center text-[10px] font-medium text-primary">ลายเซ็นที่บันทึกไว้</span>
      )}
      <div
        aria-label="ย่อหรือขยายลายเซ็น"
        onPointerDown={(event) => beginDrag(event, "resize")}
        onPointerMove={drag}
        onPointerUp={endDrag}
        className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-primary shadow"
      />
    </div>
  );

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Maximize2 className="h-4 w-4" />
        เปิดหน้าต่างวางตำแหน่ง
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <DialogTitle>วางตำแหน่งลายเซ็น</DialogTitle>
            <DialogDescription>เลือกเอกสารและหน้าที่ต้องการ จากนั้นลากกรอบลายเซ็นไปยังตำแหน่งเดียวกับแบบฟอร์ม HR กรอบสีน้ำเงินสามารถลากและย่อหรือขยายได้</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {requiredDocuments.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  onClick={() => setActiveId(document.id)}
                  className={`max-w-64 truncate rounded-full border px-3 py-2 text-xs font-medium ${
                    activeDocument?.id === document.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {document.file_name}
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    activeDocument?.id === document.id ? "bg-white/25" : "bg-amber-100 text-amber-700"
                  }`}>ต้องเซ็น</span>
                </button>
              ))}
            </div>
            {activeIsPdf && (
              <div className="flex items-center gap-2" aria-label="เลือกหน้าเอกสาร">
                <Button type="button" size="icon" variant="outline" aria-label="หน้าก่อนหน้า"
                  disabled={loading || !activePlacement || activePlacement.page_number <= 1}
                  onClick={() => changePage((activePlacement?.page_number || 1) - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-24 text-center text-sm font-medium">
                  หน้า {Math.min(activePlacement?.page_number || 1, pageCount)} / {pageCount}
                </span>
                <Button type="button" size="icon" variant="outline" aria-label="หน้าถัดไป"
                  disabled={loading || !activePlacement || activePlacement.page_number >= pageCount}
                  onClick={() => changePage((activePlacement?.page_number || 1) + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div ref={stageRef} className="min-h-0 flex-1 overflow-auto bg-slate-200 p-3 dark:bg-slate-950">
            {error && <div className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
            {!activeIsPdf && !activeIsImage && !loading && !error && activeDocument && (
              <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg bg-white p-6 text-center">
                <p className="text-sm text-muted-foreground">ไฟล์นี้ ({activeDocument.file_name}) แสดงตัวอย่างในหน้าต่างนี้ไม่ได้ กดปุ่มด้านล่างเพื่อเปิดดู</p>
                {requiresPlacement(activeDocument) && (
                  <p className="text-sm font-medium text-rose-600">ไฟล์นี้ต้องเซ็นแต่ไม่ใช่ PDF ระบบลงลายเซ็นให้ไม่ได้ — กรุณาลบและอัปโหลดใหม่เป็นไฟล์ PDF</p>
                )}
                <Button type="button" variant="outline" onClick={() => expenseRequestsApi.openAttachment(requestId, activeDocument.id)}>
                  <Eye className="h-4 w-4" /> เปิดไฟล์
                </Button>
              </div>
            )}

            {activeIsImage && (
              <div className={`relative mx-auto w-fit max-w-full bg-white shadow ${loading ? "hidden" : ""}`}>
                {imageUrl && <img src={imageUrl} alt={activeDocument?.file_name} className="block max-w-full" />}
                {activePlacement && activePlacement.page_number === 1 && !loading && !error && signatureOverlay}
              </div>
            )}

            {activeIsPdf && (
              <div className={`relative mx-auto w-fit max-w-full bg-white shadow ${loading ? "invisible" : ""}`}>
                <canvas ref={canvasRef} className="block max-w-full" />
                {activePlacement && !loading && !error && signatureOverlay}
              </div>
            )}

            {loading && (activeIsPdf || activeIsImage) && (
              <div className="flex min-h-72 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
          </div>

          <DialogFooter className="border-t">
            <Button
              type="button"
              disabled={loading || !!error}
              onClick={() => { onChange(Object.values(placements)); setOpen(false); }}
            >
              ยืนยันตำแหน่ง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
