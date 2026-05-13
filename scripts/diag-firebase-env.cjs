/* eslint-disable no-console */
const fs = require("fs");
const os = require("os");
const path = require("path");

function applicationDefaultCredentialsPath() {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Roaming", "gcloud", "application_default_credentials.json");
  }
  return path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function parseEnvLocalKeys(raw) {
  let pub = "";
  let fsDb = "";
  let gacLinePresent = false;
  let gacValueEmpty = false;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.replace(/^\s*export\s+/, "");
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k === "NEXT_PUBLIC_FIREBASE_PROJECT_ID") pub = v;
    if (k === "NEXT_PUBLIC_FIREBASE_FIRESTORE_DATABASE_ID") fsDb = v;
    if (k === "GOOGLE_APPLICATION_CREDENTIALS") {
      gacLinePresent = true;
      if (v.trim() === "") gacValueEmpty = true;
    }
  }
  return { pub, fsDb, gacLinePresent, gacValueEmpty };
}

function loadApplicationDefaultCredentialsMeta(adcPath) {
  const meta = { path: adcPath, exists: fs.existsSync(adcPath) };
  if (!meta.exists) return meta;
  try {
    const j = JSON.parse(fs.readFileSync(adcPath, "utf8"));
    meta.type = j.type ?? "(no type)";
    meta.hasRefreshToken = typeof j.refresh_token === "string" && j.refresh_token.length > 0;
    meta.quota_project_id = j.quota_project_id ?? null;
    if (j.type === "service_account") meta.project_id = j.project_id ?? null;
  } catch (e) {
    meta.readError = e instanceof Error ? e.message : String(e);
  }
  return meta;
}

async function probeAdcAccessToken(projectId) {
  try {
    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({
      projectId: projectId && projectId !== "MISSING" ? projectId : undefined,
    });
    const client = await auth.getClient();
    const t = await client.getAccessToken();
    const token = t?.token;
    if (!token) return "OK (sin token en respuesta)";
    return `OK (prefijo ${token.slice(0, 12)}…)`;
  } catch (e) {
    return `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function main() {
  const envPath = path.join(process.cwd(), ".env.local");
  const hasEnvLocal = fs.existsSync(envPath);
  const adcPath = applicationDefaultCredentialsPath();
  const adcFile = loadApplicationDefaultCredentialsMeta(adcPath);

  let pub = "";
  let fsDb = "";
  let gacLinePresent = false;
  let gacValueEmpty = false;
  let raw = "";
  let adminProj = null;
  let keyParseError = null;
  let keyLine = null;
  let gacLine = null;
  let gacProj = null;
  let gacError = null;

  if (hasEnvLocal) {
    raw = fs.readFileSync(envPath, "utf8");
    const parsed = parseEnvLocalKeys(raw);
    pub = parsed.pub;
    fsDb = parsed.fsDb;
    gacLinePresent = parsed.gacLinePresent;
    gacValueEmpty = parsed.gacValueEmpty;

    keyLine = raw.split(/\r?\n/).find((l) => l.trimStart().startsWith("FIREBASE_SERVICE_ACCOUNT_KEY="));
    if (keyLine) {
      const jsonPart = keyLine.slice(keyLine.indexOf("=") + 1).trim();
      try {
        adminProj = JSON.parse(jsonPart).project_id ?? null;
      } catch (e) {
        keyParseError = e instanceof Error ? e.message : String(e);
      }
    }

    gacLine = raw.split(/\r?\n/).find((l) => /^GOOGLE_APPLICATION_CREDENTIALS=/.test(l.trimStart()));
    if (gacLine) {
      let gacPath = gacLine.slice(gacLine.indexOf("=") + 1).trim();
      if ((gacPath.startsWith('"') && gacPath.endsWith('"')) || (gacPath.startsWith("'") && gacPath.endsWith("'"))) {
        gacPath = gacPath.slice(1, -1);
      }
      if (gacPath.trim() === "") {
        gacError = "valor vacío: trampa — Admin no usará ADC; borrá la línea o unset en shell";
      } else {
        try {
          const j = JSON.parse(fs.readFileSync(gacPath, "utf8"));
          gacProj = j.project_id ?? null;
        } catch (e) {
          gacError = e instanceof Error ? e.message : String(e);
        }
      }
    }
  }

  const shellGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let shellGacProj = null;
  let shellGacErr = null;
  if (shellGac && fs.existsSync(shellGac)) {
    try {
      shellGacProj = JSON.parse(fs.readFileSync(shellGac, "utf8")).project_id ?? null;
    } catch (e) {
      shellGacErr = e instanceof Error ? e.message : String(e);
    }
  } else if (shellGac) {
    shellGacErr = "path missing or unreadable";
  }

  const nextPublicProjectId = pub || "MISSING";
  const adcTokenProbe = await probeAdcAccessToken(nextPublicProjectId);

  let identityToolkitQuotaHint = null;
  if (adcFile.type === "authorized_user" && pub && nextPublicProjectId !== "MISSING") {
    const q = adcFile.quota_project_id;
    if (!q) {
      identityToolkitQuotaHint = `Sin proyecto de cuota en ADC. Identity Toolkit (verifyIdToken) puede devolver 403. Ejecutá: gcloud auth application-default set-quota-project ${pub} (tu usuario necesita serviceusage.services.use en ese proyecto; ver error al ejecutar).`;
    } else if (q !== pub) {
      identityToolkitQuotaHint = `ADC quota_project_id (${q}) ≠ NEXT_PUBLIC_FIREBASE_PROJECT_ID (${pub}). Puede fallar verifyIdToken; alineá con set-quota-project ${pub}.`;
    } else {
      identityToolkitQuotaHint = "quota_project_id en ADC coincide con el proyecto Firebase público.";
    }
  }

  console.log(
    JSON.stringify(
      {
        hasEnvLocal,
        nextPublicProjectId,
        firestoreDatabaseIdEnv: fsDb || "(empty → default db)",
        serviceAccountKeyProjectId: adminProj ?? (keyParseError ? `PARSE_ERROR: ${keyParseError}` : "(unset)"),
        gacProjectId: gacProj ?? (gacError ? `READ_ERROR: ${gacError}` : "(unset)"),
        publicVsServiceKeyMatch:
          pub && adminProj ? pub === adminProj : adminProj == null && !keyLine ? "n/a" : null,
        publicVsGacMatch: pub && gacProj ? pub === gacProj : gacProj == null && !gacLine ? "n/a" : null,
        shellGOOGLE_APPLICATION_CREDENTIALS: shellGac || "(unset in process env)",
        shellGacProjectId: shellGacProj ?? (shellGacErr ? `ERROR: ${shellGacErr}` : null),
        publicVsShellGacMatch: pub && shellGacProj ? pub === shellGacProj : null,
        adminCredentialSource: keyLine
          ? "FIREBASE_SERVICE_ACCOUNT_KEY"
          : gacLine
            ? "GOOGLE_APPLICATION_CREDENTIALS (.env.local)"
            : shellGac
              ? "GOOGLE_APPLICATION_CREDENTIALS (shell env)"
              : "ADC only (gcloud application-default)",
        applicationDefaultCredentialsFile: adcFile,
        googleApplicationCredentialsEmptyInEnvLocal: gacLinePresent && gacValueEmpty ? "sí — borrá la línea o asigná ruta válida" : "no",
        adcAccessTokenProbe: adcTokenProbe,
        identityToolkitQuotaHint,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
