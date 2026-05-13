<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cron / tareas programadas (Firebase, no Vercel)

- El repo expone rutas HTTP en `app/api/cron/*` (p. ej. `motor-ot-diario`, `actualizar-vencimientos`) protegidas con `CRON_SECRET`. Sirven para desarrollo local, pruebas manuales y cualquier scheduler que haga `GET` con `Authorization: Bearer …`.
- **En producción la app vive en el ecosistema Firebase**, no en Vercel Cron: el equivalente es **Cloud Functions (2nd gen)** con trigger **`onSchedule`**, o exponer la misma lógica en una función y programarla con timezone **`America/Argentina/Buenos_Aires`**. El concepto es el mismo que “pegarle a una URL a horario fijo”; solo cambia dónde se registra el horario (Firebase vs `vercel.json`).
- Requiere plan **Blaze** para Cloud Functions con schedule; para pocos jobs diarios/semanales el costo suele ser marginal.
- Si se migra la lógica a Cloud Functions, conviene **extraer el núcleo** a módulos compartidos y que la ruta Next o la función solo sean finos adaptadores, para no duplicar reglas.

### Implementado en este repo

- Carpeta `functions/` con **2nd gen** `onSchedule` (`scheduledActualizarVencimientos`, `scheduledMotorOtDiario`) que hacen `fetch` a `{CRON_TARGET_URL}/api/cron/...` con `Bearer CRON_SECRET`. Ver `functions/README.md` y `firebase.json` → `functions.predeploy`.
