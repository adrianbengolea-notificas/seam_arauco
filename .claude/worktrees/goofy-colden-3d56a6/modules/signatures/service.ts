export function validateSignaturePayload(dataUrl: string): void {
  if (!dataUrl.startsWith("data:image/png;base64,") && !dataUrl.startsWith("data:image/jpeg;base64,")) {
    throw new Error("Firma: formato esperado data URL base64 (png/jpeg)");
  }
}
