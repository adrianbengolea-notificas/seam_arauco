/**
 * Revisa perfil Firestore + Auth (claims) para diagnosticar permission-denied / panel.
 *
 * Requiere credenciales Admin (como el resto de scripts): `.env.local` con
 * `NEXT_PUBLIC_FIREBASE_PROJECT_ID` y ADC o `FIREBASE_SERVICE_ACCOUNT_KEY`.
 *
 * Uso:
 *   npx tsx scripts/revisar-perfil-usuario.ts --email usuario@dominio.com
 *   npx tsx scripts/revisar-perfil-usuario.ts --uid <firebaseUid>
 *   npx tsx scripts/revisar-perfil-usuario.ts --audit [--limit 300]
 */

/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAdminAuth, getAdminDb } from "@/firebase/firebaseAdmin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { isCentroInKnownList } from "@/lib/config/app-config";
import { tienePermiso, toPermisoRol, type Rol } from "@/lib/permisos/index";
import { centrosEfectivosDelUsuario } from "@/modules/users/centros-usuario";

const KNOWN_ROL_RAW = new Set([
  "tecnico",
  "supervisor",
  "admin",
  "superadmin",
  "super_admin",
  "cliente_arauco",
]);

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.replace(/^\s*export\s+/, "").trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function parseArgs(argv: string[]): {
  email?: string;
  uid?: string;
  audit: boolean;
  limit: number;
} {
  let email: string | undefined;
  let uid: string | undefined;
  let audit = false;
  let limit = 500;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email" && argv[i + 1]) {
      email = argv[++i]!.trim();
    } else if (a === "--uid" && argv[i + 1]) {
      uid = argv[++i]!.trim();
    } else if (a === "--audit") {
      audit = true;
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Math.min(5000, parseInt(argv[++i]!, 10) || 500));
    }
  }
  return { email, uid, audit, limit };
}

function warningsParaPerfil(input: {
  uid: string;
  email: string | null;
  firestore: Record<string, unknown> | null;
  claims: Record<string, unknown> | undefined;
}): string[] {
  const w: string[] = [];
  const { firestore: d, claims } = input;

  if (!d) {
    w.push("CRÍTICO: no existe documento en `users/{uid}` (la app asume técnico sin centro).");
    return w;
  }

  const rawCentro = typeof d.centro === "string" ? d.centro : "";
  if (rawCentro !== rawCentro.trim()) {
    w.push(
      "CRÍTICO: `centro` en Firestore tiene espacios al inicio/fin; las reglas comparan strings crudos entre colecciones (ej. perfil `\" PC01\"` ≠ orden `\"PC01\"`) y suele dar permission-denied. Corregí a trim o volvé a entrar para que `actionBootstrapSession` normalice.",
    );
  }

  const rawRol = typeof d.rol === "string" ? d.rol : "";
  if (!rawRol.trim()) {
    w.push("ADVERTENCIA: campo `rol` vacío (la app normalizará a `tecnico`).");
  } else if (!KNOWN_ROL_RAW.has(rawRol)) {
    w.push(
      `ADVERTENCIA: valor de \`rol\` no canónico en Firestore: "${rawRol}" → UI/rules usan toPermisoRol → "${toPermisoRol(rawRol)}".`,
    );
  }

  const profileLike = {
    centro: typeof d.centro === "string" ? d.centro : "",
    centros_asignados: Array.isArray(d.centros_asignados)
      ? (d.centros_asignados as unknown[]).map((x) => String(x))
      : undefined,
  };
  const centros = centrosEfectivosDelUsuario(profileLike);
  if (centros.length === 0) {
    w.push(
      "CRÍTICO: sin centro operativo (`centro` vacío y sin `centros_asignados` útil): el panel puede quedar sin alcance o disparar queries inválidas.",
    );
  }

  const canon = toPermisoRol(rawRol);
  if (canon !== "superadmin" && centros.some((c) => !isCentroInKnownList(c))) {
    w.push(
      "ADVERTENCIA: algún centro del perfil no está en KNOWN_CENTROS de la app (revisá typo o config).",
    );
  }

  if ((canon === "supervisor" || canon === "admin") && centros.length === 0) {
    w.push(
      "Contexto: supervisor/admin sin centro no pueden listar OTs por planta ni usar vista global (Firestore).",
    );
  }

  const cr = claims?.rol;
  const cc = claims?.centro;
  if (typeof cc === "string" && cc !== cc.trim()) {
    w.push(
      "CRÍTICO: custom claim `centro` tiene espacios colgados; tras arreglar Firestore, forzá refresh de token (relogin o getIdToken(true)).",
    );
  }
  if (claims && Object.keys(claims).length > 0) {
    if (typeof cr === "string" && cr !== rawRol && rawRol) {
      w.push(
        `INCONSISTENCIA: custom claim rol="${cr}" vs Firestore rol="${rawRol}" (las reglas priorizan el doc users; el token puede estar desactualizado).`,
      );
    }
    if (typeof cc === "string" && cc.trim() && centros.length > 0 && !centros.includes(cc.trim())) {
      w.push(
        `INCONSISTENCIA: custom claim centro="${cc}" no está en centros efectivos del doc [${centros.join(", ")}].`,
      );
    }
  }

  const uiRol: Rol = toPermisoRol(rawRol);
  const puedeVerGlobalOt = uiRol === "superadmin";
  const puedeVerTodasCentro = tienePermiso(uiRol, "ot:ver_todas");
  if (!puedeVerGlobalOt && puedeVerTodasCentro && centros.length === 0) {
    w.push(
      "RIESGO: rol con `ot:ver_todas` pero sin centro en perfil → lectura masiva de OTs puede fallar en Firestore (solo superadmin lee cross-centro).",
    );
  }

  return w;
}

async function revisarUnUsuario(email?: string, uidArg?: string): Promise<void> {
  const auth = getAdminAuth();
  const db = getAdminDb();

  let uid = uidArg?.trim() || "";
  let emailResolved: string | null = null;

  if (!uid && email) {
    try {
      const u = await auth.getUserByEmail(email);
      uid = u.uid;
      emailResolved = u.email ?? email;
    } catch (e) {
      console.error(`No se encontró usuario Auth con email ${email}:`, e);
      process.exitCode = 1;
      return;
    }
  }

  if (!uid) {
    console.error("Pasá --email o --uid.");
    process.exitCode = 1;
    return;
  }

  const userRecord = await auth.getUser(uid);
  emailResolved = userRecord.email ?? emailResolved;

  const ref = db.collection(COLLECTIONS.users).doc(uid);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;

  const claims = userRecord.customClaims as Record<string, unknown> | undefined;

  console.log("\n=== Firebase Auth ===");
  console.log(JSON.stringify({ uid, email: emailResolved, disabled: userRecord.disabled }, null, 2));
  console.log("\n=== Custom claims ===");
  console.log(JSON.stringify(claims ?? {}, null, 2));

  console.log("\n=== Firestore users/{uid} ===");
  if (!data) {
    console.log("(no existe)");
  } else {
    const { created_at: _c, updated_at: _u, ...rest } = data;
    console.log(JSON.stringify(rest, null, 2));
  }

  const centros = centrosEfectivosDelUsuario(
    data
      ? {
          centro: typeof data.centro === "string" ? data.centro : "",
          centros_asignados: Array.isArray(data.centros_asignados)
            ? (data.centros_asignados as unknown[]).map((x) => String(x))
            : undefined,
        }
      : null,
  );
  const rawRol = data && typeof data.rol === "string" ? data.rol : "";
  const canon = toPermisoRol(rawRol);

  console.log("\n=== Derivado (igual que panel / permisos) ===");
  console.log(
    JSON.stringify(
      {
        centros_efectivos: centros,
        rol_firestore_raw: rawRol || null,
        rol_canonico_ui: canon,
        puede_consulta_ot_global_superadmin: canon === "superadmin",
        tiene_ot_ver_todas: tienePermiso(canon, "ot:ver_todas"),
      },
      null,
      2,
    ),
  );

  const ws = warningsParaPerfil({
    uid,
    email: emailResolved,
    firestore: data,
    claims,
  });
  console.log("\n=== Alertas ===");
  if (ws.length === 0) {
    console.log("Ninguna alerta automática (revisá igualmente reglas desplegadas y proyecto).");
  } else {
    for (const line of ws) console.log(`- ${line}`);
  }
  console.log("");
}

async function auditar(limit: number): Promise<void> {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.users).limit(limit).get();
  console.log(`\nAudit: ${snap.size} documentos users (limit=${limit}).\n`);

  let crit = 0;
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const email = typeof d.email === "string" ? d.email : doc.id;
    const ws = warningsParaPerfil({
      uid: doc.id,
      email,
      firestore: d,
      claims: undefined,
    });
    const bloqueantes = ws.filter(
      (x) => x.startsWith("CRÍTICO") || x.startsWith("RIESGO") || x.startsWith("INCONSISTENCIA"),
    );
    if (bloqueantes.length === 0) continue;
    crit++;
    console.log(`--- ${email} (${doc.id}) ---`);
    for (const w of ws) console.log(`  ${w}`);
    console.log("");
  }

  if (crit === 0) {
    console.log(
      "Sin CRÍTICO/RIESGO/INCONSISTENCIA en este lote (claims no se comparan en --audit; usá --email para un usuario).",
    );
  }
  console.log("");
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { email, uid, audit, limit } = parseArgs(process.argv);

  if (audit) {
    await auditar(limit);
    return;
  }

  if (!email && !uid) {
    console.error(`Uso:
  npx tsx scripts/revisar-perfil-usuario.ts --email correo@dominio.com
  npx tsx scripts/revisar-perfil-usuario.ts --uid <uid>
  npx tsx scripts/revisar-perfil-usuario.ts --audit [--limit 500]
`);
    process.exitCode = 1;
    return;
  }

  await revisarUnUsuario(email, uid);
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
