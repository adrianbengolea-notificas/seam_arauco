/**
 * Texto claro en español para errores del SDK web de Firebase (Firestore, Auth, etc.)
 * y mensajes en inglés habituales, evitando mostrar "Missing or insufficient permissions" crudo.
 */
export function mensajeErrorFirebaseParaUsuario(err: unknown): string {
  if (err == null) {
    return "Ocurrió un error. Si continúa, avisá al administrador.";
  }

  const e = err as { code?: string; message?: string };
  const code = typeof e.code === "string" ? e.code : "";
  const raw = typeof e.message === "string" ? e.message.trim() : "";
  const lower = raw.toLowerCase();

  const permisoDenegado =
    code === "permission-denied" ||
    /missing or insufficient permission/.test(lower) ||
    (lower.includes("permission") && (lower.includes("denied") || lower.includes("insufficient")));

  if (permisoDenegado) {
    return "No tenés permiso para ver o modificar estos datos. Si deberías tener acceso, cerrá sesión y volvé a entrar; si no, pedí ayuda a un administrador.";
  }

  if (code === "unauthenticated") {
    return "Necesitás iniciar sesión para continuar.";
  }

  if (code.startsWith("auth/")) {
    if (code === "auth/network-request-failed") {
      return "No hubo conexión con el servicio de inicio de sesión. Revisá tu red e intentá de nuevo.";
    }
    if (code === "auth/too-many-requests") {
      return "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
    }
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return "Correo o contraseña incorrectos.";
    }
    if (code === "auth/user-not-found") {
      return "No existe una cuenta con ese correo.";
    }
    return "No se pudo completar el inicio de sesión. Intentá de nuevo.";
  }

  if (code === "unavailable" || code === "deadline-exceeded") {
    return "El servicio no respondió a tiempo. Intentá de nuevo en un momento.";
  }

  if (code === "not-found") {
    return "No se encontró la información solicitada.";
  }

  // Índices compuestos Firestore: el mismo código puede llegar como "requires an index" (falta crear/deploy)
  // o con texto explícito de índice en construcción. Orden importante: construcción primero.
  const indiceEnConstruccion =
    raw.length > 0 &&
    /currently building|cannot be used yet|building and cannot be used/i.test(lower);
  if (indiceEnConstruccion) {
    return "Firebase está generando el índice compuesto que pide esta consulta (suele tardar de minutos a una hora según el volumen). En Firebase Console → Firestore → Índices, cuando el estado pase a «Enabled», recargá la página. No hace falta cambiar código de la app.";
  }

  if (/requires an index/i.test(raw)) {
    return "Esta consulta necesita un índice compuesto que aún no está disponible en el proyecto de Firebase que estás usando (no se creó, no se publicó a ese proyecto o no es el entorno correcto). Abrí las herramientas de desarrollo del navegador y el error técnico de Firestore: suele incluir un enlace para crear el índice al instante. Quien administre el backend puede publicar los índices del repositorio (`firestore.indexes.json`) al proyecto correcto. Después recargá la página.";
  }

  if (code === "failed-precondition") {
    return "No se cumplen las condiciones para esta operación. Actualizá la página o contactá al administrador.";
  }

  if (code === "already-exists") {
    return "Ese dato ya existe.";
  }

  if (raw.length > 0) {
    return raw;
  }

  return "Ocurrió un error. Si continúa, avisá al administrador.";
}
