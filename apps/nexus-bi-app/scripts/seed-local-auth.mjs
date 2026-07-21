import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_LOCAL_URL;
const serviceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("Faltan SUPABASE_LOCAL_URL o SUPABASE_LOCAL_SERVICE_ROLE_KEY");
}

const parsedUrl = new URL(url);

if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
  throw new Error(
    `Operación rechazada: el destino no es local (${parsedUrl.hostname})`,
  );
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const identities = [
  {
    email: "gerencia@test.local.cl",
    role: "gerencia",
  },
  {
    email: "administracion@test.local.cl",
    role: "administracion",
  },
];

const {
  data: { users },
  error: listError,
} = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});

if (listError) {
  throw listError;
}

for (const identity of identities) {
  const user = users.find(
    (candidate) =>
      candidate.email?.toLowerCase() === identity.email.toLowerCase(),
  );

  if (!user) {
    throw new Error(`No existe el usuario ${identity.email}`);
  }

  const { error: updateError } =
    await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...user.app_metadata,
        nexus_role: identity.role,
      },
    });

  if (updateError) {
    throw updateError;
  }

  console.log(
    `OK: ${identity.email} → nexus_role=${identity.role}`,
  );
}

console.log("App metadata configurada correctamente.");
