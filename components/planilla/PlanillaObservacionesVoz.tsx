"use client";

import { actionTranscribePlanillaObservacionesAudio } from "@/app/actions/ai";
import { Button } from "@/components/ui/button";
import { getClientIdToken } from "@/modules/users/hooks";
import { cn } from "@/lib/utils";
import { Loader2, Mic, Square } from "lucide-react";
import { useCallback, useRef, useState } from "react";

const MAX_BLOB_BYTES = 6 * 1024 * 1024;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return undefined;
}

type Props = {
  iaEnabled: boolean;
  readOnly: boolean;
  currentText: string;
  onTranscribed: (text: string) => void;
  otN: string;
  assetLabel: string;
  className?: string;
};

export function PlanillaObservacionesVoz({
  iaEnabled,
  readOnly,
  currentText,
  onTranscribed,
  otN,
  assetLabel,
  className,
}: Props) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const disabled = readOnly || !iaEnabled || busy;
  const canRecord = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const stopTracks = useCallback((mr: MediaRecorder | null) => {
    mr?.stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const startRecording = useCallback(async () => {
    setHint(null);
    if (!canRecord) {
      setHint("Este navegador no permite grabar audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch {
      setHint("No se pudo acceder al micrófono. Revisá permisos del navegador.");
    }
  }, [canRecord]);

  const stopAndSend = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") {
      setRecording(false);
      return;
    }
    await new Promise<void>((resolve) => {
      mr.addEventListener("stop", () => resolve(), { once: true });
      mr.stop();
    });
    stopTracks(mr);
    mediaRecorderRef.current = null;
    setRecording(false);

    const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (blob.size < 256) {
      setHint("La grabación fue muy corta. Probá de nuevo.");
      return;
    }
    if (blob.size > MAX_BLOB_BYTES) {
      setHint("El audio es demasiado largo. Grabá menos de ~2 minutos.");
      return;
    }

    setBusy(true);
    setHint(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Error al leer el audio"));
        r.readAsDataURL(blob);
      });
      const token = await getClientIdToken();
      if (!token) throw new Error("Sin sesión");
      const res = await actionTranscribePlanillaObservacionesAudio(token, {
        audioDataUrl: dataUrl,
        otN,
        assetLabel,
      });
      if (!res.ok) throw new Error(res.error.message);
      const t = res.data.text.trim();
      if (!t) throw new Error("No se obtuvo texto");
      const base = currentText.trim();
      onTranscribed(base ? `${base}\n\n${t}` : t);
      setHint("Texto generado — revisá antes de firmar.");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Error al transcribir");
    } finally {
      setBusy(false);
    }
  }, [assetLabel, currentText, onTranscribed, otN, stopTracks]);

  if (!iaEnabled) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {!recording ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 gap-1.5"
            disabled={disabled || !canRecord}
            onClick={() => void startRecording()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Grabar observaciones (voz)
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="min-h-10 gap-1.5 bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
            disabled={busy}
            onClick={() => void stopAndSend()}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            Detener y transcribir con IA
          </Button>
        )}
      </div>
      {recording ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">Grabando… tocá “Detener” cuando termines.</p>
      ) : null}
      {!canRecord ? (
        <p className="text-[11px] text-zinc-500">La grabación por voz no está disponible en este dispositivo.</p>
      ) : null}
      {hint ? <p className="text-[11px] text-zinc-600 dark:text-zinc-400">{hint}</p> : null}
    </div>
  );
}
