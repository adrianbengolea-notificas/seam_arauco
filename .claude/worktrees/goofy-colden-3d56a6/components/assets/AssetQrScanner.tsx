"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CameraOff } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";

const QrScannerComponent = dynamic(
  () => import("react-qr-scanner").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-48 items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-500 dark:bg-zinc-900">
        Iniciando cámara…
      </div>
    ),
  },
);

function routeFromQrText(text: string): string | null {
  const t = text.trim();
  try {
    const u = new URL(t);
    if (u.pathname.startsWith("/activos/")) {
      return `${u.pathname}${u.search}`;
    }
  } catch {
    if (t.startsWith("/activos/")) {
      return t;
    }
  }
  return null;
}

export function AssetQrScanner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleScan = (data: { text: string } | null) => {
    if (!data?.text) return;
    const path = routeFromQrText(data.text);
    if (path) {
      router.push(path);
    }
  };

  const handleError = (err: unknown) => {
    console.error(err);
    setError("No se pudo usar la cámara. Revisá los permisos del navegador.");
  };

  if (error) {
    return (
      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-800 dark:text-red-200">
            <CameraOff className="h-5 w-5" />
            Cámara no disponible
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => router.refresh()}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-zinc-200 bg-black dark:border-zinc-800">
        <QrScannerComponent
          delay={400}
          onError={handleError}
          onScan={handleScan}
          constraints={{
            video: { facingMode: "environment" },
          }}
          style={{ width: "100%" }}
        />
      </div>
      <p className="text-xs text-zinc-500">
        El QR debe apuntar a una ruta <span className="font-mono">/activos/…</span> de esta app.
      </p>
    </div>
  );
}
