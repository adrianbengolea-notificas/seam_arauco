import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

loadEnvConfig(projectRoot);

/** En Firebase App Hosting, BUILD expone FIREBASE_WEBAPP_CONFIG (JSON); el cliente usa NEXT_PUBLIC_FIREBASE_*. */
function publicFirebaseEnvFromWebAppConfig(): Partial<
  Record<
    | "NEXT_PUBLIC_FIREBASE_API_KEY"
    | "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
    | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
    | "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
    | "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
    | "NEXT_PUBLIC_FIREBASE_APP_ID",
    string
  >
> {
  const raw = process.env.FIREBASE_WEBAPP_CONFIG?.trim();
  if (!raw) return {};
  try {
    const cfg = JSON.parse(raw) as {
      apiKey?: string;
      authDomain?: string;
      projectId?: string;
      storageBucket?: string;
      messagingSenderId?: string | number;
      appId?: string;
    };
    return {
      NEXT_PUBLIC_FIREBASE_API_KEY: cfg.apiKey ?? "",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: cfg.authDomain ?? "",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: cfg.projectId ?? "",
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: cfg.storageBucket ?? "",
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
        cfg.messagingSenderId !== undefined && cfg.messagingSenderId !== null
          ? String(cfg.messagingSenderId)
          : "",
      NEXT_PUBLIC_FIREBASE_APP_ID: cfg.appId ?? "",
    };
  } catch {
    return {};
  }
}

function pickPublic(
  key:
    | "NEXT_PUBLIC_FIREBASE_API_KEY"
    | "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
    | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
    | "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
    | "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
    | "NEXT_PUBLIC_FIREBASE_APP_ID",
  fromHosting: Partial<Record<typeof key, string>>,
): string {
  return process.env[key]?.trim() || fromHosting[key] || "";
}

const fromHostingWeb = publicFirebaseEnvFromWebAppConfig();

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
    NEXT_PUBLIC_FIREBASE_API_KEY: pickPublic("NEXT_PUBLIC_FIREBASE_API_KEY", fromHostingWeb),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: pickPublic(
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
      fromHostingWeb,
    ),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: pickPublic("NEXT_PUBLIC_FIREBASE_PROJECT_ID", fromHostingWeb),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: pickPublic(
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
      fromHostingWeb,
    ),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: pickPublic(
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      fromHostingWeb,
    ),
    NEXT_PUBLIC_FIREBASE_APP_ID: pickPublic("NEXT_PUBLIC_FIREBASE_APP_ID", fromHostingWeb),
  },
};

export default nextConfig;
