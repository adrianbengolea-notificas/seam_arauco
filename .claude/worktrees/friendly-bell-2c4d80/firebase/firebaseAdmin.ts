import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { resolveFirestoreDatabaseId } from "@/lib/firebase/resolve-firestore-database-id";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let adminApp: App | undefined;

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Inicializa Firebase Admin una sola vez. Usa ADC (GOOGLE_APPLICATION_CREDENTIALS) o FIREBASE_SERVICE_ACCOUNT_KEY.
 */
export function getFirebaseAdminApp(): App {
  if (adminApp) return adminApp;

  const existing = getApps()[0];
  if (existing) {
    adminApp = existing;
    return adminApp;
  }

  const jsonAccount = parseServiceAccountFromEnv();
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (jsonAccount) {
    adminApp = initializeApp({
      credential: cert(jsonAccount),
      storageBucket: bucket,
      projectId: projectId ?? jsonAccount.projectId,
    });
    return adminApp;
  }

  // Cadena vacía hace que el SDK intente un archivo inválido en lugar de usar ADC (usuario gcloud).
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() === "") {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  const adcProjectId = projectId?.trim();
  if (!adcProjectId) {
    throw new Error(
      "Firebase Admin (ADC): falta NEXT_PUBLIC_FIREBASE_PROJECT_ID en el entorno del servidor. Sin projectId explícito, verifyIdToken puede fallar o validar contra el proyecto equivocado.",
    );
  }

  adminApp = initializeApp({
    credential: applicationDefault(),
    projectId: adcProjectId,
    storageBucket: bucket,
  });

  return adminApp;
}

export function getAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}

export function getAdminDb() {
  const app = getFirebaseAdminApp();
  const databaseId = resolveFirestoreDatabaseId(
    process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID,
  );
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

export function getAdminStorage() {
  return getStorage(getFirebaseAdminApp());
}
