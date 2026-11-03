# ConfortVets

> **Más tiempo para cuidar.**
> Software para veterinarios independientes, desarrollado por NovaStudio.

Next.js 16 · Supabase (Postgres, Auth, Storage) · Netlify. Un solo código y una sola base de datos sirven a todos los consultorios: cada uno es una **organización**, aislada de las demás por RLS, con módulos y permisos que el super administrador activa o desactiva. Diseño completo en [docs/DISENO.md](docs/DISENO.md).

> **Antes de usarlo con clientes reales:** el marco legal (historia clínica, datos personales, firma, autorizaciones) está en la sección 13 del documento de diseño y **debe ser revisado por un abogado**. Los textos de autorizaciones y la política de datos son de ejemplo.

## 1. Crear el proyecto de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (el plan gratis permite 2 proyectos).
2. En **Project Settings → API** copia `Project URL`, `anon public` y `service_role`.
3. Copia `.env.example` a `.env.local` y complétalo.
4. En el **SQL Editor** ejecuta, en orden, los archivos de [supabase/migrations/](supabase/migrations/) (los nombres empiezan con la fecha; son 11, van de `…0100_core` a `20261102000400_consultation_admin_edit`). También sirve `supabase db push` si usas la CLI.

## 2. Crear el super administrador

Se hace una sola vez, a mano:

```bash
npm install
node --env-file=.env.local scripts/bootstrap-super-admin.mjs <usuario> "<contraseña>" "<Tu nombre>"
```

La contraseña debe tener al menos 10 caracteres, con letras y números.

## 3. Desarrollo local

```bash
npm run dev      # http://localhost:3000
```

Inicia sesión con el super admin → **Nueva organización** → entrega el usuario y la contraseña temporal al veterinario (la cambia al ingresar).

## 4. Desplegar en Netlify

1. Sube el repositorio a GitHub y conéctalo en Netlify (**Add new site → Import an existing project**).
2. En **Site configuration → Environment variables** agrega `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Despliega. **Verifica** que el sitio funciona (inicio de sesión, subir una foto) antes de depender de él: la compatibilidad de Next.js 16 y de `sharp` en Netlify no se probó.
4. Confirma en los términos de Netlify que el plan que uses permite uso comercial.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` / `start` | Servidor de desarrollo, compilación, producción |
| `npm run lint` / `typecheck` | Revisión de código y de tipos |
| `npm test` | Pruebas de la lógica (40) |
| `npm run test:db` | Pruebas de la base de datos (108): requiere un PostgreSQL. Define `TEST_DATABASE_URL`, p. ej. `postgres://postgres:clave@localhost:5432/postgres`. Crea y borra la base `confortvets_test` |

## Respaldo

El plan gratis de Supabase **no hace copias de seguridad** y se pausa tras 7 días sin actividad.

- `scripts/backup.mjs` exporta todas las tablas a un archivo cifrado (AES-256). El flujo [.github/workflows/backup.yml](.github/workflows/backup.yml) lo ejecuta cada domingo y guarda el archivo 90 días. Secretos de GitHub: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSWORD` (mínimo 16 caracteres; **guárdala en un lugar seguro**, sin ella no se abre el respaldo).
- Abrir un respaldo: `BACKUP_PASSWORD="…" node scripts/decrypt-backup.mjs respaldo.json.enc salida.json`.
- No incluye contraseñas ni archivos (fotos y PDF). Con clientes que pagan, pasa el proyecto a **Pro** (copias diarias completas).

## Lista de verificación con tu Supabase real

Esto no se pudo automatizar; hazlo una vez antes de entregar a un cliente:

1. [ ] Iniciar sesión como super admin y crear una organización de prueba.
2. [ ] Entrar como el veterinario: cambiar la contraseña temporal; ver su marca y su logo.
3. [ ] Crear un tutor y un paciente con foto; registrar un peso.
4. [ ] Crear una consulta, subir un PDF de examen, armar una fórmula, cerrarla; probar que ya no se edita; agregar una nota aclaratoria; imprimir la fórmula.
5. [ ] Registrar una vacuna con refuerzo: debe aparecer el recordatorio; enviar por WhatsApp.
6. [ ] Crear una autorización y firmarla en pantalla desde el celular; verificar «contenido no alterado».
7. [ ] Crear un auxiliar con pocos permisos; entrar con él; cambiarle la contraseña desde el administrador.
8. [ ] Como super admin: apagar un módulo, desactivar un auxiliar, vencer la membresía (debe quedar en solo lectura con el aviso) y desactivar la organización.
9. [ ] Descargar la exportación en Excel y JSON.
10. [ ] Ejecutar el respaldo a mano y abrirlo con `decrypt-backup.mjs`.

## Estructura

```
app/                  rutas (login, dashboard, superadmin, api)
components/           interfaz (ui/, print/ para documentos imprimibles)
lib/actions/          server actions por módulo (cada una valida permiso y membresía)
lib/logic/            reglas puras con pruebas
lib/supabase/         clientes (server, admin, proxy de sesión)
supabase/migrations/  esquema versionado (la base se reconstruye desde cero con ellas)
scripts/              super admin, respaldo, pruebas de base de datos
tests/                pruebas de la lógica
docs/DISENO.md        diseño, seguridad y marco legal
```
