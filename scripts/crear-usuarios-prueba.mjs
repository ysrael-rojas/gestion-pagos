// Bootstrap de los usuarios de prueba.
//
// Crea (o actualiza) dos Usuarios en Supabase Auth con la Admin API y deja su
// perfil en public.users con nombre, rol y active = true. Idempotente: si el
// correo ya existe, no falla; actualiza el perfil.
//
// Uso: node --env-file=.env scripts/crear-usuarios-prueba.mjs

import { createClient } from "@supabase/supabase-js";

const CONTRASENA_TEMPORAL = "Prueba1234!";

const USUARIOS = [
  {
    email: "ysrael@google.com",
    name: "Ysrael Rojas",
    role: "administrador",
  },
  {
    email: "operador@google.com",
    name: "Operador de Prueba",
    role: "operador",
  },
];

function leerCredenciales() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. Ejecuta el script con `node --env-file=.env`.",
    );
  }

  return { url, serviceRoleKey };
}

async function buscarPorCorreo(admin, correo) {
  const porPagina = 200;
  let pagina = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: porPagina,
    });

    if (error) {
      throw new Error(`No se pudo listar los Usuarios de Auth: ${error.message}`);
    }

    const encontrado = data.users.find(
      (usuario) => usuario.email?.toLowerCase() === correo.toLowerCase(),
    );

    if (encontrado) {
      return encontrado;
    }

    if (data.users.length < porPagina) {
      return null;
    }

    pagina += 1;
  }
}

async function asegurarUsuario(admin, { email, name, role }) {
  const existente = await buscarPorCorreo(admin, email);

  let id;

  if (existente) {
    id = existente.id;
    console.log(`= ${email}: ya existe en Auth (${id})`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: CONTRASENA_TEMPORAL,
      email_confirm: true,
      app_metadata: { name },
    });

    if (error || !data.user) {
      throw new Error(`No se pudo crear ${email}: ${error?.message ?? "sin usuario"}`);
    }

    id = data.user.id;
    console.log(`+ ${email}: creado en Auth (${id})`);
  }

  const { error: errorPerfil } = await admin
    .from("users")
    .upsert({ id, name, role, active: true }, { onConflict: "id" });

  if (errorPerfil) {
    throw new Error(`No se pudo actualizar el perfil de ${email}: ${errorPerfil.message}`);
  }

  console.log(`  ${email}: perfil ${role}, activo, nombre "${name}"`);
}

async function main() {
  const { url, serviceRoleKey } = leerCredenciales();
  const admin = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  for (const usuario of USUARIOS) {
    await asegurarUsuario(admin, usuario);
  }

  console.log(
    `\nListo. Contraseña de los usuarios de prueba: ${CONTRASENA_TEMPORAL}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
