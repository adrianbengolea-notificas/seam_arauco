"use client";

import { resolveFirestoreDatabaseId } from "@/lib/firebase/resolve-firestore-database-id";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

export type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

function readConfig(): FirebaseClientConfig {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    throw new Error(
      "Faltan variables NEXT_PUBLIC_FIREBASE_* en el entorno. Copiá .env.example a .env.local.",
    );
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

let appSingleton: FirebaseApp | undefined;
let authSingleton: Auth | undefined;
let dbSingleton: Firestore | undefined;
let storageSingleton: FirebaseStorage | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (!appSingleton) {
    const cfg = readConfig();
    appSingleton = getApps().length ? getApps()[0]! : initializeApp(cfg);
  }
  return appSingleton;
}

export function getFirebaseAuth(): Auth {
  if (!authSingleton) {
    authSingleton = getAuth(getFirebaseApp());
  }
  return authSingleton;
}

export function getFirebaseDb(): Firestore {
  if (!dbSingleton) {
    const app = getFirebaseApp();
    const databaseId = resolveFirestoreDatabaseId(
      process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID,
    );
    dbSingleton = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
  return dbSingleton;
}

export function getFirebaseStorage(): FirebaseStorage {
  if (!storageSingleton) {
    storageSingleton = getStorage(getFirebaseApp());
  }
  return storageSingleton;
}
