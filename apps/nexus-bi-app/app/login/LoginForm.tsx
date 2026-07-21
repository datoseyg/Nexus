"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction } from "./actions";

import {
  INITIAL_LOGIN_STATE,
  type LoginActionState,
} from "./action-state";

import styles from "./login.module.css";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className={styles.submit} type="submit" disabled={pending}>
      {pending ? "Ingresando…" : "Ingresar"}
    </button>
  );
}

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, formAction] = useActionState(loginAction, INITIAL_LOGIN_STATE);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="returnTo" value={returnTo} />

      <label className={styles.field}>
        <span>ID de usuario</span>
        <input
          name="userId"
          type="text"
          autoComplete="username"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          required
        />
      </label>

      <label className={styles.field}>
        <span>Contraseña</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={1024}
          required
        />
      </label>

      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
