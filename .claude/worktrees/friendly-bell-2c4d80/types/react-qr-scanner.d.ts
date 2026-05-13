declare module "react-qr-scanner" {
  import type { ComponentType, CSSProperties } from "react";

  export interface QrScannerProps {
    delay?: number;
    onError?: (error: unknown) => void;
    onScan?: (data: { text: string } | null) => void;
    constraints?: MediaTrackConstraints | { video: MediaTrackConstraints };
    style?: CSSProperties;
    className?: string;
  }

  const QrScanner: ComponentType<QrScannerProps>;
  export default QrScanner;
}
