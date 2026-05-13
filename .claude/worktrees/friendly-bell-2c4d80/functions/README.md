# Cloud Functions — crons

Dos funciones programadas (`onSchedule`) llaman por HTTPS a los handlers de Next ya existentes:

- `scheduledActualizarVencimientos` → `GET {CRON_TARGET_URL}/api/cron/actualizar-vencimientos`
- `scheduledMotorOtDiario` → `GET {CRON_TARGET_URL}/api/cron/motor-ot-diario`

Misma cabecera que en local: `Authorization: Bearer <CRON_SECRET>`.

## Requisitos

1. Proyecto Firebase en plan **Blaze**.
2. App Next desplegada (p. ej. **App Hosting**) con URL pública conocida.

## Configuración (primera vez)

### 1. Secreto `CRON_SECRET`

Debe coincidir con el `CRON_SECRET` que usa el servidor Next en producción.

```bash
# Desde la raíz del repo (no dentro de functions/)
printf '%s' "tu-mismo-secreto-que-en-next" | firebase functions:secrets:set CRON_SECRET
```

### 2. Parámetro `CRON_TARGET_URL`

Sin barra final, ejemplo: `https://seam-arauco-xxxxx.web.app` o tu dominio custom.

Con **params** de 2nd gen podés usar un archivo dotenv en `functions/` (ver [config env](https://firebase.google.com/docs/functions/config-env)): por ejemplo `.env.<PROJECT_ID>` con una línea:

```
CRON_TARGET_URL=https://tu-url-real
```

O configurar el parámetro en la consola de Google Cloud al revisar la función desplegada. Al primer `firebase deploy --only functions`, la CLI también puede pedirte los valores faltantes.

## Deploy

Desde la raíz del monorepo:

```bash
cd functions && npm install && npm run build && cd ..
firebase deploy --only functions
```

O confiá en el `predeploy` de `firebase.json`.

## Region y zona horaria

- Región: `southamerica-east1`
- `timeZone`: `America/Argentina/Buenos_Aires`

## Emulador (opcional)

```bash
cd functions && npm run build
firebase emulators:start --only functions
```

Para el emulador necesitás `.env` local con `CRON_SECRET` y `CRON_TARGET_URL` según documentación actual de `firebase-functions` params.
