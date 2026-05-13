"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { Asset } from "@/modules/assets/types";
import { Printer, QrCode } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const QRCodeSvg = dynamic(() => import("react-qr-code"), { ssr: false });

type AssetQrCardProps = {
  asset: Asset;
};

export function AssetQrCard({ asset }: AssetQrCardProps) {
  const [qrValue, setQrValue] = useState("");
  const qrWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQrValue(`${window.location.origin}/activos/${asset.id}`);
  }, [asset.id]);

  const handlePrint = () => {
    if (!qrWrapRef.current || !qrValue) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>QR ${asset.codigo_nuevo}</title></head>
      <body style="margin:0;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
        <div style="text-align:center;padding:24px">
          <h1 style="font-size:18px;margin:0 0 8px">${asset.denominacion}</h1>
          <p style="margin:0 0 16px;color:#52525b;font-size:14px">${asset.codigo_nuevo} · ${asset.ubicacion_tecnica}</p>
          <div>${qrWrapRef.current.innerHTML}</div>
          <p style="margin-top:16px;font-size:11px;word-break:break-all;color:#71717a">${qrValue}</p>
        </div>
        <script>setTimeout(function(){print();close();},400);</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-5 w-5" />
          Código QR del activo
        </CardTitle>
        <CardDescription>Escaneá para abrir la ficha en Arauco-Seam.</CardDescription>
      </CardHeader>
      <CardContent>
        <div ref={qrWrapRef} className="flex justify-center rounded-lg bg-white p-4">
          {qrValue ? (
            <QRCodeSvg value={qrValue} size={200} viewBox="0 0 256 256" />
          ) : (
            <div className="aspect-square w-[200px] animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          )}
        </div>
        <p className="mt-2 break-all text-center text-xs text-zinc-500">{qrValue || "…"}</p>
      </CardContent>
      <CardFooter>
        <Button type="button" variant="secondary" className="w-full" disabled={!qrValue} onClick={handlePrint}>
          <Printer className="h-4 w-4" />
          Imprimir etiqueta
        </Button>
      </CardFooter>
    </Card>
  );
}
