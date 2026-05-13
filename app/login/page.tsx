"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { actionBootstrapSession } from "@/app/actions/auth";
import { getFirebaseAuth } from "@/firebase/firebaseClient";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { DEFAULT_LOGIN_EMAIL } from "@/lib/config/app-config";
import { mensajeErrorFirebaseParaUsuario } from "@/lib/firebase/mensaje-error-usuario";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [email, setEmail] = useState(DEFAULT_LOGIN_EMAIL);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "registro">("login");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function afterAuth(user: import("firebase/auth").User) {
    setBusy(true);
    setError(null);
    try {
      let token = await user.getIdToken(true);
      let res = await actionBootstrapSession(token);
      if (!res.ok && res.error.code === "UNAUTHORIZED") {
        token = await user.getIdToken(true);
        res = await actionBootstrapSession(token);
      }
      if (!res.ok) {
        setError(mensajeErrorFirebaseParaUsuario(res.error));
        setBusy(false);
        return;
      }
      await user.getIdToken(true);
      router.replace(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Failed to fetch" || msg.includes("fetch") || msg.includes("NetworkError")) {
        setError(
          "No responde el servidor Next (acción de servidor). Reiniciá con npm run dev y revisá la terminal por errores. Si ves fallos de Firebase Admin, configurá GOOGLE_APPLICATION_CREDENTIALS con la ruta al JSON de cuenta de servicio.",
        );
      } else {
        setError(mensajeErrorFirebaseParaUsuario(e instanceof Error ? e : { message: msg }));
      }
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResetSent(false);
    try {
      const auth = getFirebaseAuth();
      const cred =
        mode === "login"
          ? await signInWithEmailAndPassword(auth, email.trim(), password)
          : await createUserWithEmailAndPassword(auth, email.trim(), password);
      await afterAuth(cred.user);
    } catch (e) {
      setError(mensajeErrorFirebaseParaUsuario(e));
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    setError(null);
    setResetSent(false);
    try {
      const auth = getFirebaseAuth();
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      await afterAuth(cred.user);
    } catch (e) {
      setError(mensajeErrorFirebaseParaUsuario(e));
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Ingresá tu email para recuperar la contraseña.");
      setResetSent(false);
      return;
    }
    setBusy(true);
    setError(null);
    setResetSent(false);
    try {
      const auth = getFirebaseAuth();
      await sendPasswordResetEmail(auth, trimmed);
      setResetSent(true);
    } catch (e) {
      setError(mensajeErrorFirebaseParaUsuario(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-md overflow-hidden shadow-md ring-1 ring-black/5 dark:ring-white/10">
      <div className="h-1 w-full bg-brand" aria-hidden />
      <CardHeader>
        <CardTitle className="text-xl">{mode === "login" ? "Ingresar" : "Crear cuenta"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            className={
              mode === "login"
                ? "border-b-2 border-brand px-2 py-1 font-semibold text-foreground"
                : "px-2 py-1 text-muted hover:text-foreground"
            }
            onClick={() => {
              setMode("login");
              setResetSent(false);
            }}
          >
            Login
          </button>
          <span className="text-border">·</span>
          <button
            type="button"
            className={
              mode === "registro"
                ? "border-b-2 border-brand px-2 py-1 font-semibold text-foreground"
                : "px-2 py-1 text-muted hover:text-foreground"
            }
            onClick={() => {
              setMode("registro");
              setResetSent(false);
            }}
          >
            Registro
          </button>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200/90 bg-red-50/95 px-3 py-2.5 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-100">
            {error}
          </p>
        ) : null}
        {resetSent ? (
          <p className="rounded-lg border border-emerald-200/90 bg-emerald-50/95 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/50 dark:text-emerald-100">
            Si ese correo está registrado, te enviamos un enlace para restablecer la contraseña.
          </p>
        ) : null}

        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder={DEFAULT_LOGIN_EMAIL || "correo@empresa.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="password">
              Contraseña
            </label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "login" ? (
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  className="text-xs font-medium text-brand underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void onForgotPassword()}
                >
                  Olvidé mi contraseña
                </button>
              </div>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Procesando…" : mode === "login" ? "Entrar" : "Registrar"}
          </Button>
        </form>

        <div className="relative py-2 text-center text-xs text-muted before:absolute before:inset-x-0 before:top-1/2 before:-z-10 before:border-t before:border-border">
          <span className="bg-surface px-2">o</span>
        </div>

        <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void onGoogle()}>
          Continuar con Google
        </Button>

        <p className="text-center text-xs text-muted">
          Tras entrar serás redirigido a tu destino (por defecto el panel).
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center gap-8 py-10">
      <header className="text-center sm:text-left">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Arauco-Seam</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Acceso</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Autenticación con email o Google. El acceso del dueño debe darse de alta en Firebase con el
          email configurado en el proyecto.
        </p>
      </header>
      <Suspense fallback={<p className="text-center text-sm text-muted">Cargando…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
