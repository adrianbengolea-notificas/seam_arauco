import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

loadEnvConfig(projectRoot);

const firestoreDatabaseId =
  process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID?.trim() ?? "";

const nextConfig: NextConfig = {
  // Evita que Turbopack infiera la raíz como `app/` (no resuelve `next` package en algunos entornos).
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  serverExternalPackages: ["firebase-admin", "genkit", "@genkit-ai/core", "@genkit-ai/ai"],
  allowedDevOrigins: ["192.168.100.195"],
  env: {
    NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID: firestoreDatabaseId,
  },
};

export default nextConfig;
