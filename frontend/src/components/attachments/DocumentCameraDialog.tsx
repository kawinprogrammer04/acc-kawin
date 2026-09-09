import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface DocumentCameraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (file: File) => void | Promise<void>;
}

export function DocumentCameraDialog({ open, onOpenChange, onCapture }: DocumentCameraDialogProps) {
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCameraError("");
    setCameraReady(false);

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง กรุณาใช้การอัปโหลดไฟล์แทน");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            aspectRatio: { ideal: 3 / 4 },
            width: { ideal: 1440 },
            height: { ideal: 1920 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        if (!cancelled) {
          setCameraError("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการใช้งานกล้อง หรือใช้การอัปโหลดไฟล์แทน");
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
      onOpenChange(false);
      void onCapture(file);
    }, "image/jpeg", 0.9);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-0 bg-transparent shadow-none">
        <DialogHeader>
          <DialogTitle>ถ่ายรูป</DialogTitle>
          <DialogDescription>จัดเอกสารให้เต็มกรอบแนวตั้งแล้วกดถ่าย</DialogDescription>
        </DialogHeader>
        <div className="relative mx-auto aspect-[3/4] max-h-[70vh] w-full">
          {cameraError ? (
            <p className="flex h-full items-center justify-center text-center text-sm text-red-600">{cameraError}</p>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onCanPlay={() => setCameraReady(true)}
              className="h-full w-full rounded-lg border object-cover"
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={capturePhoto} disabled={!!cameraError || !cameraReady}>ถ่าย</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
