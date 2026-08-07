#!/usr/bin/env node
// Script LOCAL ad hoc: crea (si falta) o actualiza la contraseña del usuario
// Supabase Auth local que respalda la identidad visible "GERENCIA"
// (lib/auth/identity.ts -> NEXUS_AUTH_GERENCIA_EMAIL). Mismo patrón de guarda
// que scripts/seed-local-auth.mjs y scripts/update-local-user.js (ambos solo
// editan metadata de un usuario ya existente; este además lo crea si no
// existe, y en ambos casos fija la contraseña provista por env var, nunca
// hardcodeada acá).
//
// Uso:
//   SUPABASE_LOCAL_URL=... SUPABASE_LOCAL_SERVICE_ROLE_KEY=... \
//   NEXUS_TARGET_EMAIL=gerencia@test.local.cl NEXUS_TARGET_ROLE=gerencia \
//   NEXUS_NEW_PASSWORD=... node scripts/set-local-gerencia-login.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_LOCAL_URL;
const serviceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const email = process.env.NEXUS_TARGET_EMAIL;
const role = process.env.NEXUS_TARGET_ROLE;
const password = process.env.NEXUS_NEW_PASSWORD;

if (!url || !serviceRoleKey || !email || !role || !password) {
  throw new Error(
    "Faltan SUPABASE_LOCAL_URL, SUPABASE_LOCAL_SERVICE_ROLE_KEY, NEXUS_TARGET_EMAIL, NEXUS_TARGET_ROLE o NEXUS_NEW_PASSWORD"
  );
}

const parsedUrl = new URL(url);
if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
  throw new Error(`Operación rechazada: el destino no es local (${parsedUrl.hostname})`);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

const {
  data: { users },
  error: listError
} = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });

if (listError) throw listError;

const existing = users.find(u => u.email?.toLowerCase() === email.toLowerCase());

if (existing) {
  const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: { ...existing.app_metadata, nexus_role: role }
  });
  if (error) throw error;
  console.log(`OK (actualizado): ${data.user.email} -> nexus_role=${data.user.app_metadata.nexus_role}, id=${data.user.id}`);
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { nexus_role: role }
  });
  if (error) throw error;
  console.log(`OK (creado): ${data.user.email} -> nexus_role=${data.user.app_metadata.nexus_role}, id=${data.user.id}`);
}
