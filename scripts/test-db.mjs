// Pruebas de la base de datos: aplica las migraciones en un PostgreSQL limpio
// (con un simulador de lo que trae Supabase) y verifica aislamiento entre
// organizaciones, permisos, módulos, membresía, inmutabilidad y recordatorios.
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
//
// Crea (y borra al empezar) la base "confortvets_test" en ese servidor.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres";
const testUrl = new URL(adminUrl);
testUrl.pathname = "/confortvets_test";

// ---------------------------------------------------------------------------
// Base limpia + migraciones
// ---------------------------------------------------------------------------
{
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query("drop database if exists confortvets_test with (force)");
  await c.query("create database confortvets_test");
  await c.end();
  for (const role of ["anon", "authenticated", "service_role"]) {
    const r = new pg.Client({ connectionString: adminUrl });
    await r.connect();
    await r.query(`drop role if exists ${role}`).catch(() => {});
    await r.end();
  }
}

const db = new pg.Client({ connectionString: testUrl.toString() });
await db.connect();
await db.query(readFileSync(join(root, "scripts/test-db/supabase-stub.sql"), "utf8"));
const migDir = join(root, "supabase/migrations");
for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
  try {
    await db.query(readFileSync(join(migDir, f), "utf8"));
  } catch (e) {
    console.error(`✗ Falló la migración ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log("✓ Migraciones aplicadas");

// ---------------------------------------------------------------------------
// Utilidades de prueba
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(cond, name, extra = "") {
  if (cond) passed++;
  else {
    failures.push(name + (extra ? ` — ${extra}` : ""));
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const admin = (sql, params) => db.query(sql, params).then((r) => r.rows);

/** Ejecuta fn como un usuario autenticado (RLS activo). */
async function as(userId, fn, role = "authenticated") {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    const api = {
      q: (sql, params) => db.query(sql, params).then((r) => r.rows),
      /**
       * Devuelve un mensaje si la sentencia quedó BLOQUEADA, o null si funcionó
       * (y la deshace). Bloqueada = error, o un UPDATE/DELETE que RLS dejó en
       * 0 filas (RLS filtra en silencio en vez de lanzar error).
       */
      fails: async (sql, params) => {
        await db.query("savepoint s");
        try {
          const r = await db.query(sql, params);
          await db.query("rollback to s");
          if ((r.command === "UPDATE" || r.command === "DELETE") && r.rowCount === 0) {
            return "0 filas afectadas";
          }
          return null;
        } catch (e) {
          await db.query("rollback to s");
          return e.message;
        }
      },
      /** Como q pero devuelve el mensaje de error si falla (y deja la transacción usable). */
      tryQ: async (sql, params) => {
        await db.query("savepoint t");
        try {
          const r = await db.query(sql, params);
          await db.query("release savepoint t");
          return { rows: r.rows, error: null };
        } catch (e) {
          await db.query("rollback to t");
          return { rows: [], error: e.message };
        }
      },
    };
    const result = await fn(api);
    await db.query("commit");
    return result;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------
const SA = randomUUID();
const OA = randomUUID(); // owner de la org A
const OB = randomUUID(); // owner de la org B
const X1 = randomUUID(); // auxiliar A sin permisos
const X2 = randomUUID(); // auxiliar A con lectura
const X3 = randomUUID(); // auxiliar A que escribe consultas pero no las cierra

async function mkUser(id) {
  await admin("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@x.internal`]);
}
for (const id of [SA, OA, OB, X1, X2, X3]) await mkUser(id);

await admin(
  `insert into profiles (id, organization_id, username, full_name, auth_email, role)
   values ($1, null, 'superadmin', 'Super Admin', $2, 'super_admin')`,
  [SA, `${SA}@x.internal`]
);

const [{ create_organization: orgA }] = await admin(
  `select create_organization('Vet Alfa', 'vet-alfa', $1, 'dueno.alfa', 'Dra. Alfa', $2,
     array['clinical','preventive','consents','agenda','inventory'], null, 5, 100)`,
  [OA, `${OA}@x.internal`]
);
const [{ create_organization: orgB }] = await admin(
  `select create_organization('Vet Beta', 'vet-beta', $1, 'dueno.beta', 'Dr. Beta', $2,
     array[]::text[], null, 1, 100)`,
  [OB, `${OB}@x.internal`]
);

async function mkAux(id, org, username, perms) {
  await admin(
    `insert into profiles (id, organization_id, username, full_name, auth_email, role)
     values ($1, $2, $3, $3, $4, 'auxiliar')`,
    [id, org, username, `${id}@x.internal`]
  );
  for (const p of perms) {
    await admin(
      "insert into auxiliary_permissions (profile_id, organization_id, permission_key) values ($1,$2,$3)",
      [id, org, p]
    );
  }
}
await mkAux(X1, orgA, "aux.uno", []);
await mkAux(X2, orgA, "aux.dos", ["tutors.read", "patients.read"]);
await mkAux(X3, orgA, "aux.tres", ["tutors.read", "patients.read", "clinical.read", "clinical.write"]);

// Un tutor, paciente de cada organización (creados con la llave de servicio).
const [{ id: dogA }] = await admin("select id from species where organization_id=$1 and name='Canino'", [orgA]);
const [{ id: dogB }] = await admin("select id from species where organization_id=$1 and name='Canino'", [orgB]);
const [{ id: tutorA }] = await admin(
  "insert into tutors (organization_id, full_name, document_number) values ($1,'Tutor A','111') returning id",
  [orgA]
);
const [{ id: tutorB }] = await admin(
  "insert into tutors (organization_id, full_name, document_number) values ($1,'Tutor B','222') returning id",
  [orgB]
);
const [{ id: petA }] = await admin(
  "insert into patients (organization_id, tutor_id, name, species_id) values ($1,$2,'Firulais',$3) returning id",
  [orgA, tutorA, dogA]
);
const [{ id: petB }] = await admin(
  "insert into patients (organization_id, tutor_id, name, species_id) values ($1,$2,'Michi',$3) returning id",
  [orgB, tutorB, dogB]
);

// ---------------------------------------------------------------------------
section("Datos por defecto");
{
  const [s] = await admin("select count(*)::int n from species where organization_id=$1", [orgA]);
  const [b] = await admin("select count(*)::int n from breeds where organization_id=$1", [orgA]);
  const [c] = await admin("select count(*)::int n from control_types where organization_id=$1", [orgA]);
  const [t] = await admin("select count(*)::int n from consent_templates where organization_id=$1", [orgA]);
  const [r] = await admin("select count(*)::int n from reminder_rules where organization_id=$1", [orgA]);
  check(s.n === 2, "2 especies por defecto");
  check(b.n >= 30, "razas por defecto cargadas", String(b.n));
  check(c.n === 3, "3 tipos de control");
  check(t.n === 5, "5 plantillas de autorización");
  check(r.n === 3, "3 reglas de recordatorio");
  const mods = await admin(
    "select module_key, enabled from organization_modules where organization_id=$1 order by 1", [orgB]);
  check(mods.find((m) => m.module_key === "core")?.enabled === true, "core siempre habilitado");
  check(mods.find((m) => m.module_key === "agenda")?.enabled === false, "un módulo que no se pidió queda apagado");
  check(mods.find((m) => m.module_key === "hospital")?.enabled === false, "módulo no disponible no se habilita");
  const [at] = await admin("select count(*)::int n from appointment_types where organization_id=$1", [orgA]);
  const [ah] = await admin("select count(*)::int n from agenda_hours where organization_id=$1", [orgA]);
  const [as_] = await admin("select slot_minutes, allow_overlap from agenda_settings where organization_id=$1", [orgA]);
  check(at.n === 4, "4 tipos de cita por defecto");
  check(ah.n === 11, "horario por defecto: lunes a viernes (2 franjas) y sábado");
  check(as_.slot_minutes === 30 && as_.allow_overlap === false, "ajustes de agenda por defecto");
}

// ---------------------------------------------------------------------------
section("Aislamiento entre organizaciones");
await as(OB, async ({ q, fails }) => {
  const t = await q("select id from tutors");
  check(t.length === 1 && t[0].id === tutorB, "owner B solo ve su tutor", JSON.stringify(t));
  const pats = await q("select id from patients");
  check(pats.length === 1 && pats[0].id === petB, "owner B solo ve su paciente");
  check((await fails(
    "insert into tutors (organization_id, full_name) values ($1,'Intruso')", [orgA])) !== null,
    "owner B no puede insertar en la organización A");
  const upd = await q("update tutors set full_name='hackeado' where id=$1 returning id", [tutorA]);
  check(upd.length === 0, "owner B no puede editar un tutor de A");
  const orgs = await q("select id from organizations");
  check(orgs.length === 1 && orgs[0].id === orgB, "owner B solo ve su organización");
});
await as(OA, async ({ q }) => {
  const t = await q("select id from tutors");
  check(t.length === 1 && t[0].id === tutorA, "owner A solo ve su tutor");
});

section("Claves compuestas: una fila no puede apuntar a otra organización");
{
  let err = null;
  try {
    await admin(
      "insert into patients (organization_id, tutor_id, name, species_id) values ($1,$2,'Cruce',$3)",
      [orgA, tutorB, dogA]);
  } catch (e) { err = e.message; }
  check(err !== null && /foreign key/i.test(err), "paciente de A con tutor de B es rechazado por la FK", err ?? "");
}

// ---------------------------------------------------------------------------
section("Módulos");
await as(OB, async ({ tryQ }) => {
  const r = await tryQ("select id from consultations");
  check(r.rows.length === 0, "B sin módulo clínico no lee consultas");
  const ins = await tryQ(
    `insert into consultations (organization_id, patient_id, professional_name)
     values ($1,$2,'Dr. Beta')`, [orgB, petB]);
  check(ins.error !== null, "B sin módulo clínico no crea consultas");
});
await as(SA, async ({ q }) => {
  await q("update organization_modules set enabled=true where organization_id=$1 and module_key='clinical'", [orgB]);
});
await as(OB, async ({ tryQ }) => {
  const ins = await tryQ(
    `insert into consultations (organization_id, patient_id, professional_name)
     values ($1,$2,'Dr. Beta') returning id`, [orgB, petB]);
  check(ins.error === null, "al activar el módulo, B ya puede crear consultas", ins.error ?? "");
});
await as(SA, async ({ q }) => {
  await q("update organization_modules set enabled=false where organization_id=$1 and module_key='clinical'", [orgB]);
});

// ---------------------------------------------------------------------------
section("Permisos de auxiliares");
await as(X1, async ({ q }) => {
  check((await q("select id from tutors")).length === 0, "auxiliar sin permisos no lee tutores");
  check((await q("select id from patients")).length === 0, "auxiliar sin permisos no lee pacientes");
});
await as(X2, async ({ q, fails }) => {
  check((await q("select id from patients")).length === 1, "auxiliar con lectura ve pacientes");
  check((await fails(
    "insert into tutors (organization_id, full_name) values ($1,'x')", [orgA])) !== null,
    "auxiliar con solo lectura no crea tutores");
  check((await q("select id from consultations")).length === 0, "sin clinical.read no ve consultas");
});

section("Restricción del super admin por organización");
await as(SA, async ({ q }) => {
  await q("insert into organization_permissions (organization_id, permission_key, enabled) values ($1,'tutors.write',false)", [orgA]);
});
await as(OA, async ({ fails }) => {
  check((await fails("insert into tutors (organization_id, full_name) values ($1,'x')", [orgA])) !== null,
    "owner no puede usar un permiso restringido por el super admin");
});
await as(SA, async ({ q }) => {
  await q("delete from organization_permissions where organization_id=$1", [orgA]);
});

// ---------------------------------------------------------------------------
section("El super admin no ve datos clínicos ni de tutores");
await as(SA, async ({ q, fails }) => {
  for (const t of ["tutors", "patients", "consultations", "vaccinations", "consents", "files"]) {
    check((await q(`select 1 from ${t}`)).length === 0, `super admin no lee ${t}`);
  }
  check((await q("select id from organizations")).length === 2, "super admin ve las organizaciones");
  check((await q("select id from profiles")).length >= 5, "super admin ve los perfiles");
  const usage = await q("select * from org_usage()");
  const a = usage.find((u) => u.organization_id === orgA);
  check(a && Number(a.tutors_count) === 1 && Number(a.patients_count) === 1, "org_usage cuenta filas", JSON.stringify(a));
  check((await fails("insert into tutors (organization_id, full_name) values ($1,'x')", [orgA])) !== null,
    "super admin no escribe tutores");
});
await as(OA, async ({ fails }) => {
  check((await fails("select * from org_usage()")) !== null, "un owner no puede usar org_usage()");
});

// ---------------------------------------------------------------------------
section("Membresía vencida (solo lectura) y organización inactiva");
await admin("update organizations set valid_until = current_date - 1 where id=$1", [orgA]);
await as(OA, async ({ q, fails }) => {
  check((await q("select id from tutors")).length === 1, "membresía vencida: todavía lee");
  check((await fails("insert into tutors (organization_id, full_name) values ($1,'x')", [orgA])) !== null,
    "membresía vencida: no crea");
  const upd = await q("update tutors set notes='x' where id=$1 returning id", [tutorA]);
  check(upd.length === 0, "membresía vencida: no edita");
});
await admin("update organizations set valid_until = null, is_active = false where id=$1", [orgA]);
await as(OA, async ({ q }) => {
  check((await q("select id from tutors")).length === 0, "organización inactiva: no lee nada");
});
await admin("update organizations set is_active = true where id=$1", [orgA]);

// ---------------------------------------------------------------------------
section("Perfiles: no se pueden escalar privilegios");
await as(OA, async ({ q }) => {
  const upd = await q("update profiles set role='super_admin' where id=$1 returning id", [OA]);
  check(upd.length === 0, "un usuario no puede cambiar su propio rol");
});
await as(null, async ({ fails }) => {
  check((await fails("select * from tutors")) !== null, "el rol anónimo no lee tablas");
}, "anon");

// ---------------------------------------------------------------------------
section("Historia clínica: borrador → cerrada → anulada");
let consId;
await as(OA, async ({ q, fails, tryQ }) => {
  const [c] = await q(
    `insert into consultations (organization_id, patient_id, professional_name, reason, anamnesis)
     values ($1,$2,'Dra. Alfa','Vómito','Hace 2 días') returning id, status`, [orgA, petA]);
  consId = c.id;
  check(c.status === "borrador", "la consulta nace como borrador");
  check((await fails(
    `insert into consultations (organization_id, patient_id, professional_name, status)
     values ($1,$2,'x','cerrada')`, [orgA, petA])) !== null, "no se puede crear ya cerrada");

  await q("update consultations set reason='Vómito y diarrea' where id=$1", [consId]);

  // fórmula mientras es borrador
  const [p1] = await q(
    `insert into prescriptions (organization_id, consultation_id, patient_id, professional_name)
     values ($1,$2,$3,'Dra. Alfa') returning id, number`, [orgA, consId, petA]);
  check(p1.number === 1, "primera fórmula = consecutivo 1", String(p1.number));
  await q(
    `insert into prescription_items (organization_id, prescription_id, medication_name, dose)
     values ($1,$2,'Suero oral','10 ml')`, [orgA, p1.id]);

  const closed = await q("update consultations set status='cerrada', next_control_date = current_date + 10, control_type_id = (select id from control_types where organization_id=$1 and name like 'Chequeo%') where id=$2 returning status, closed_at, closed_by", [orgA, consId]);
  check(closed[0].status === "cerrada" && closed[0].closed_at && closed[0].closed_by === OA, "cierre registra fecha y usuario");

  check((await fails("update consultations set reason='cambio' where id=$1", [consId])) !== null,
    "consulta cerrada no se edita");
  check((await fails("delete from consultations where id=$1", [consId])) !== null,
    "consulta no se borra");
  check((await fails("delete from prescription_items where prescription_id=$1", [p1.id])) !== null,
    "fórmula de consulta cerrada no se edita");

  const add = await tryQ(
    `insert into consultation_addenda (organization_id, consultation_id, content, author_name)
     values ($1,$2,'Se corrige el peso','Dra. Alfa')`, [orgA, consId]);
  check(add.error === null, "se agrega nota aclaratoria a consulta cerrada", add.error ?? "");
  check((await fails("update consultation_addenda set content='x'")) !== null, "la nota aclaratoria no se edita");
  check((await fails("delete from consultation_addenda")) !== null, "la nota aclaratoria no se borra");

  check((await fails("update consultations set status='anulada' where id=$1", [consId])) !== null,
    "anular sin motivo falla");
  const v = await q("update consultations set status='anulada', void_reason='Paciente equivocado' where id=$1 returning voided_at, voided_by", [consId]);
  check(v[0].voided_at && v[0].voided_by === OA, "anulación registra fecha y usuario");
  check((await fails("update consultations set status='cerrada' where id=$1", [consId])) !== null,
    "una consulta anulada no se reabre");
});

section("Recordatorio de control generado al cerrar");
{
  const r = await admin("select kind, status, due_date, remind_from, title from reminders where source_type='consultation' and source_id=$1", [consId]);
  check(r.length === 1 && r[0].kind === "control", "se creó el recordatorio de control");
  check(r[0]?.title === "Chequeo preventivo", "usa el nombre del tipo de control", r[0]?.title);
  const diff = (new Date(r[0].due_date) - new Date(r[0].remind_from)) / 86400000;
  check(diff === 3, "avisa 3 días antes (regla de control)", String(diff));
  check(r[0].status === "descartado", "anular la consulta descarta su recordatorio", r[0].status);
}

section("Historia clínica: corrección del administrador");
let adminConsId;
const newControlDate = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
await as(OA, async ({ q, fails }) => {
  const [c] = await q(
    `insert into consultations (organization_id, patient_id, professional_name, reason, definitive_diagnosis)
     values ($1,$2,'Dra. Alfa','Cojera','Esguince') returning id`, [orgA, petA]);
  adminConsId = c.id;
  await q("update consultations set status='cerrada', next_control_date = current_date + 10 where id=$1", [c.id]);

  check((await fails("update consultations set definitive_diagnosis='Otro' where id=$1", [c.id])) !== null,
    "una consulta cerrada no se edita con un UPDATE directo, ni siquiera el administrador");
  check((await fails("select consultation_admin_edit($1, $2::jsonb, '')", [c.id, JSON.stringify({ definitive_diagnosis: "Fractura" })])) !== null,
    "la corrección exige un motivo");
  check((await fails("select consultation_admin_edit($1, $2::jsonb, 'Error de digitación')", [c.id, JSON.stringify({ patient_id: petA })])) !== null,
    "la corrección no puede cambiar el paciente ni otros datos fijos");
  check((await fails("select consultation_admin_edit($1, $2::jsonb, 'Error de digitación')", [c.id, JSON.stringify({ status: "borrador" })])) !== null,
    "la corrección no puede reabrir la consulta");

  await q("select consultation_admin_edit($1, $2::jsonb, 'Error de digitación en el diagnóstico')",
    [c.id, JSON.stringify({ definitive_diagnosis: "Fractura", treatment: "Reposo", next_control_date: newControlDate })]);
  const [after] = await q("select status, definitive_diagnosis, treatment, edit_count, last_edited_by, reason from consultations where id=$1", [c.id]);
  check(after.status === "cerrada" && after.definitive_diagnosis === "Fractura" && after.treatment === "Reposo", "la corrección cambia el contenido y la consulta sigue cerrada");
  check(after.edit_count === 1 && after.last_edited_by === OA, "queda constancia de quién y cuántas veces se editó");
  check(after.reason === "Cojera", "lo que no se envió no cambia");
  const [rev] = await q("select snapshot->>'definitive_diagnosis' d, reason, revision from consultation_revisions where consultation_id=$1", [c.id]);
  check(rev.d === "Esguince" && rev.revision === 1 && /digitación/.test(rev.reason), "se guarda la versión anterior con el motivo");
  check((await fails("update consultation_revisions set reason='x' where consultation_id=$1", [c.id])) !== null, "el historial de ediciones no se modifica");
  check((await fails("delete from consultation_revisions where consultation_id=$1", [c.id])) !== null, "el historial de ediciones no se borra");

  await q("select consultation_admin_edit($1, $2::jsonb, 'Segunda corrección')", [c.id, JSON.stringify({ treatment: "Reposo y analgésico" })]);
  const [again] = await q("select edit_count from consultations where id=$1", [c.id]);
  check(again.edit_count === 2, "cada corrección suma una versión");
});
{
  const r = await admin("select due_date::text d, remind_from, due_date from reminders where source_type='consultation' and source_id=$1", [adminConsId]);
  check(r.length === 1 && r[0].d === newControlDate, "el recordatorio sigue la nueva fecha del próximo control", JSON.stringify(r));
}
await as(X3, async ({ fails }) => {
  check((await fails("select consultation_admin_edit($1, $2::jsonb, 'Quiero corregir esto')", [adminConsId, JSON.stringify({ treatment: "x" })])) !== null,
    "un auxiliar no puede editar una historia cerrada");
});

section("Permisos: auxiliar que escribe pero no cierra");
await as(X3, async ({ q, fails }) => {
  const [c] = await q(
    `insert into consultations (organization_id, patient_id, professional_name, reason)
     values ($1,$2,'Aux','Control') returning id`, [orgA, petA]);
  check((await fails("update consultations set status='cerrada' where id=$1", [c.id])) !== null,
    "sin clinical.close no se puede cerrar");
  check((await q("select id from vaccinations")).length === 0, "sin preventive.read no ve vacunas");
});

section("Fórmulas: consecutivo por organización");
await as(OB, async () => {});
await admin("update organization_modules set enabled=true where organization_id=$1 and module_key='clinical'", [orgB]);
await as(OB, async ({ q }) => {
  const [c] = await q(
    `insert into consultations (organization_id, patient_id, professional_name, reason)
     values ($1,$2,'Dr. Beta','x') returning id`, [orgB, petB]);
  const [p] = await q(
    `insert into prescriptions (organization_id, consultation_id, patient_id, professional_name)
     values ($1,$2,$3,'Dr. Beta') returning number`, [orgB, c.id, petB]);
  check(p.number === 1, "la organización B tiene su propio consecutivo", String(p.number));
});
await admin("update organization_modules set enabled=false where organization_id=$1 and module_key='clinical'", [orgB]);

// ---------------------------------------------------------------------------
section("Preventivo: vacunas, desparasitación y recordatorios");
let vacId;
await as(OA, async ({ q, fails }) => {
  const [v] = await q(
    `insert into vaccinations (organization_id, patient_id, vaccine_name, applied_at, lot, next_due_at)
     values ($1,$2,'Antirrábica', current_date, 'L123', current_date + 365) returning id`,
    [orgA, petA]);
  vacId = v.id;
  const r = await q("select kind, status, remind_from, due_date from reminders where source_id=$1", [vacId]);
  check(r.length === 1 && r[0].kind === "vacuna" && r[0].status === "pendiente", "la vacuna genera su recordatorio");
  const diff = (new Date(r[0].due_date) - new Date(r[0].remind_from)) / 86400000;
  check(diff === 7, "avisa 7 días antes (regla de vacuna)", String(diff));

  check((await fails("update vaccinations set lot='OTRO' where id=$1", [vacId])) !== null, "una vacuna no se edita");
  check((await fails("delete from vaccinations where id=$1", [vacId])) !== null, "una vacuna no se borra");

  check((await fails(
    `insert into vaccinations (organization_id, patient_id, vaccine_name, applied_at, next_due_at)
     values ($1,$2,'X', current_date, current_date - 1)`, [orgA, petA])) !== null,
    "la próxima fecha no puede ser anterior a la aplicación");

  // el usuario solo puede cambiar el estado del recordatorio
  check((await fails("update reminders set due_date = current_date where source_id=$1", [vacId])) !== null,
    "no se puede cambiar la fecha de un recordatorio");
  const sent = await q("update reminders set status='enviado', sent_at=now(), sent_by=$2 where source_id=$1 returning status", [vacId, OA]);
  check(sent[0]?.status === "enviado", "se puede marcar como enviado");

  // Aplicar de nuevo la misma vacuna deja el recordatorio anterior como "hecho"
  const [v2] = await q(
    `insert into vaccinations (organization_id, patient_id, vaccine_name, applied_at, next_due_at)
     values ($1,$2,'Antirrábica', current_date, current_date + 365) returning id`, [orgA, petA]);
  const old = await q("select status from reminders where source_id=$1", [vacId]);
  check(old[0].status === "hecho", "al re-aplicar, el recordatorio anterior queda hecho", old[0].status);

  // Anular la vacuna descarta su recordatorio
  const vo = await q("update vaccinations set status='anulada', void_reason='Error de registro' where id=$1 returning voided_by", [v2.id]);
  check(vo[0].voided_by === OA, "anular una vacuna registra quién");
  const r2 = await q("select status from reminders where source_id=$1", [v2.id]);
  check(r2[0].status === "descartado", "anular descarta el recordatorio");

  const [d] = await q(
    `insert into dewormings (organization_id, patient_id, kind, product_name, applied_at, next_due_at)
     values ($1,$2,'interna','Desparasitante interno', current_date, current_date + 90) returning id`, [orgA, petA]);
  const rd = await q("select kind from reminders where source_id=$1", [d.id]);
  check(rd[0]?.kind === "desparasitante", "la desparasitación genera su recordatorio");
});
await as(OB, async ({ q }) => {
  check((await q("select id from reminders")).length === 0, "B no ve recordatorios de A");
});

// ---------------------------------------------------------------------------
section("Autorizaciones");
await as(OA, async ({ q, fails }) => {
  const [c] = await q(
    `insert into consents (organization_id, kind, patient_id, tutor_id, title, body, procedure_description)
     values ($1,'anestesia',$2,$3,'Autorización','Texto firmado','Castración') returning id, status`,
    [orgA, petA, tutorA]);
  check(c.status === "pendiente", "la autorización nace pendiente");
  check((await fails("update consents set status='firmada', signature_method='pantalla' where id=$1", [c.id])) !== null,
    "no se firma sin nombre, cédula ni firma");

  const [f] = await q(
    `insert into files (organization_id, kind, storage_path, mime_type, size_bytes)
     values ($1,'signature',$2,'image/png',5000) returning id`, [orgA, `${orgA}/signature/${randomUUID()}.png`]);
  const [s] = await q(
    `update consents set status='firmada', signature_method='pantalla', signature_file_id=$2,
            signer_name='Tutor A', signer_document='111', signer_ip='1.2.3.4'
     where id=$1 returning signed_at, content_hash`, [c.id, f.id]);
  check(s.signed_at && s.content_hash && s.content_hash.length === 64, "al firmar se calcula la huella (hash)");
  const [m] = await q("select consent_hash_matches($1) ok", [c.id]);
  check(m.ok === true, "la huella coincide con el contenido");
  check((await fails("update consents set body='Otro texto' where id=$1", [c.id])) !== null,
    "una autorización firmada no se modifica");
  check((await fails("delete from consents where id=$1", [c.id])) !== null, "una autorización no se borra");

  // autorización de datos: marca el consentimiento del tutor
  const [d] = await q(
    `insert into consents (organization_id, kind, tutor_id, title, body)
     values ($1,'datos',$2,'Datos','Autorizo') returning id`, [orgA, tutorA]);
  const [f2] = await q(
    `insert into files (organization_id, kind, storage_path, mime_type, size_bytes)
     values ($1,'signature',$2,'image/png',5000) returning id`, [orgA, `${orgA}/signature/${randomUUID()}.png`]);
  await q(
    `update consents set status='firmada', signature_method='pantalla', signature_file_id=$2,
            signer_name='Tutor A', signer_document='111' where id=$1`, [d.id, f2.id]);
  const [t] = await q("select data_consent, data_consent_at from tutors where id=$1", [tutorA]);
  check(t.data_consent === true && t.data_consent_at, "firmar la autorización de datos marca el consentimiento del tutor");

  // firma en físico: sin archivo adjunto, pero con nombre y cédula
  const [p] = await q(
    `insert into consents (organization_id, kind, tutor_id, title, body)
     values ($1,'datos',$2,'Datos','Autorizo') returning id`, [orgA, tutorA]);
  check((await fails("update consents set status='firmada', signature_method='fisico' where id=$1", [p.id])) !== null,
    "firma en físico: exige nombre y cédula de quien firmó");
  const [pf] = await q(
    `update consents set status='firmada', signature_method='fisico', signer_name='Tutor A', signer_document='111'
     where id=$1 returning content_hash`, [p.id]);
  check(pf.content_hash && pf.content_hash.length === 64, "firma en físico: se calcula la huella");
});
await as(X2, async ({ q }) => {
  check((await q("select id from consents")).length === 0, "sin consents.read no ve autorizaciones");
});

// ---------------------------------------------------------------------------
section("Agenda: citas, cruces, bloqueos y estados");
await as(OA, async ({ q, fails, tryQ }) => {
  const [c1] = await q(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at, reason)
     values ($1,$2,'2027-03-01 15:00+00','2027-03-01 15:30+00','Vacuna') returning id, tutor_id, status`, [orgA, petA]);
  check(c1.tutor_id === tutorA, "la cita toma el tutor del paciente");
  check(c1.status === "programada", "la cita nace programada");

  check((await fails(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-01 15:15+00','2027-03-01 15:45+00')`, [orgA, petA])) !== null,
    "no se cruzan dos citas");
  check((await fails(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-01 15:30+00','2027-03-01 16:00+00')`, [orgA, petA])) === null,
    "una cita puede empezar justo cuando termina otra");
  check((await fails(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-01 17:00+00','2027-03-01 16:00+00')`, [orgA, petA])) !== null,
    "una cita no puede terminar antes de empezar");
  check((await fails(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at, status)
     values ($1,$2,'2027-03-02 15:00+00','2027-03-02 15:30+00','atendida')`, [orgA, petA])) !== null,
    "una cita nueva no puede nacer atendida");

  // bloqueos
  await q(
    `insert into agenda_blocks (organization_id, starts_at, ends_at, reason)
     values ($1,'2027-03-05 00:00+00','2027-03-06 00:00+00','Festivo')`, [orgA]);
  const blocked = await tryQ(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-05 15:00+00','2027-03-05 15:30+00')`, [orgA, petA]);
  check(blocked.error !== null && /bloqueado/i.test(blocked.error), "no se agenda en un periodo bloqueado", blocked.error ?? "");

  // estados
  const [c2] = await q(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-03 15:00+00','2027-03-03 15:30+00') returning id`, [orgA, petA]);
  const conf = await q("update appointments set status='confirmada' where id=$1 returning confirmed_at", [c2.id]);
  check(conf[0].confirmed_at !== null, "al confirmar se anota la fecha de confirmación");
  await q("update appointments set status='cancelada', cancel_reason='El tutor avisó' where id=$1", [c2.id]);
  check((await fails("update appointments set status='programada' where id=$1", [c2.id])) !== null,
    "una cita cancelada no se reabre");
  check((await fails("update appointments set reason='x' where id=$1", [c2.id])) !== null,
    "una cita cerrada no se edita");
  const reuse = await tryQ(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-03 15:00+00','2027-03-03 15:30+00')`, [orgA, petA]);
  check(reuse.error === null, "el horario de una cita cancelada vuelve a quedar libre", reuse.error ?? "");
  check((await fails("delete from appointments where id=$1", [c1.id])) !== null, "las citas no se borran");

  // mover una cita sobre otra
  const [c3] = await q(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-04 15:00+00','2027-03-04 15:30+00') returning id`, [orgA, petA]);
  check((await fails(
    "update appointments set starts_at='2027-03-01 15:00+00', ends_at='2027-03-01 15:30+00' where id=$1", [c3.id])) !== null,
    "mover una cita sobre otra también se bloquea");

  // varias citas a la vez, si la organización lo permite
  await q("update agenda_settings set allow_overlap=true where organization_id=$1", [orgA]);
  const both = await tryQ(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-03-01 15:00+00','2027-03-01 15:30+00')`, [orgA, petA]);
  check(both.error === null, "con 'permitir varias citas' se pueden cruzar", both.error ?? "");
  await q("update agenda_settings set allow_overlap=false where organization_id=$1", [orgA]);

  // lista de espera: toma el tutor del paciente
  const [w] = await q(
    "insert into agenda_waitlist (organization_id, patient_id, notes) values ($1,$2,'Tardes') returning tutor_id, status",
    [orgA, petA]);
  check(w.tutor_id === tutorA && w.status === "esperando", "la lista de espera toma el tutor del paciente");
});
await as(OB, async ({ q, fails }) => {
  check((await q("select id from appointments")).length === 0, "B no ve las citas de A");
  check((await fails(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-04-01 15:00+00','2027-04-01 15:30+00')`, [orgA, petA])) !== null,
    "B no puede crear citas en A");
  check((await q("select id from agenda_hours")).length === 0, "B sin módulo no lee el horario de A");
});
await as(X2, async ({ q, fails }) => {
  check((await q("select id from appointments")).length === 0, "un auxiliar sin agenda.read no ve citas");
  check((await fails(
    `insert into appointments (organization_id, patient_id, starts_at, ends_at)
     values ($1,$2,'2027-05-01 15:00+00','2027-05-01 15:30+00')`, [orgA, petA])) !== null,
    "un auxiliar sin agenda.write no crea citas");
});

// ---------------------------------------------------------------------------
section("Inventario: existencias que suman, lotes y costo promedio");
let invP, invLotP;
await as(OA, async ({ q, fails }) => {
  const [p] = await q(
    `insert into products (organization_id, name, unit, sale_price, tax_rate, min_stock)
     values ($1,'Amoxicilina 500 mg','caja',20000,19,5) returning id, stock`, [orgA]);
  invP = p.id;
  check(Number(p.stock) === 0, "un producto nuevo empieza en 0");
  check((await fails("update products set stock=100 where id=$1", [p.id])) !== null, "la existencia no se edita a mano");
  check((await fails("update products set cost_avg=1 where id=$1", [p.id])) !== null, "el costo promedio no se edita a mano");
  check((await fails(
    `insert into stock_movements (organization_id, product_id, kind, quantity) values ($1,$2,'entrada',50)`, [orgA, p.id])) !== null,
    "los usuarios no insertan movimientos directamente");

  const [a] = await q("select inv_add_stock($1, 10, 1000) s", [p.id]);
  check(Number(a.s) === 10, "agregar 10 deja 10");
  const [b] = await q("select inv_add_stock($1, 5, 1600) s", [p.id]);
  check(Number(b.s) === 15, "agregar 5 SUMA a lo que ya había (15)", String(b.s));
  const [c] = await q("select stock, cost_avg from products where id=$1", [p.id]);
  check(Number(c.cost_avg) === 1200, "el costo promedio ponderado se recalcula (1200)", String(c.cost_avg));
  check((await fails("select inv_add_stock($1, 0, 1)", [p.id])) !== null, "no se agrega una cantidad de cero");
  check((await fails("select inv_adjust_stock($1, -20, 'ajuste', 'conteo')", [p.id])) !== null, "no se deja la existencia negativa");
  check((await fails("select inv_adjust_stock($1, -1, 'merma', '')", [p.id])) !== null, "el ajuste exige motivo");
  const [m] = await q("select inv_adjust_stock($1, -2, 'merma', 'Se rompió el frasco') s", [p.id]);
  check(Number(m.s) === 13, "la merma resta (13)");
  const movs = await q("select kind, quantity, balance_after from stock_movements where product_id=$1", [p.id]);
  const balances = movs.map((x) => Number(x.balance_after)).sort((x, y) => x - y);
  check(movs.length === 3 && balances.join() === "10,13,15", "cada movimiento guarda el saldo", JSON.stringify(movs));
  check((await fails("update stock_movements set quantity=1 where product_id=$1", [p.id])) !== null, "los movimientos no se editan");
  check((await fails("delete from stock_movements where product_id=$1", [p.id])) !== null, "los movimientos no se borran");

  // lotes y vencimientos
  const [lp] = await q(
    `insert into products (organization_id, name, sale_price, track_lots)
     values ($1,'Vacuna polivalente',30000,true) returning id`, [orgA]);
  invLotP = lp.id;
  check((await fails("select inv_add_stock($1, 3, 100)", [lp.id])) !== null, "un producto con lotes exige el lote");
  await q("select inv_add_stock($1, 3, 10000, 'L1', '2027-06-01')", [lp.id]);
  await q("select inv_add_stock($1, 2, 10000, 'L2', '2027-01-01')", [lp.id]);
  await q("select inv_add_stock($1, 2, 10000, 'L2')", [lp.id]);
  const lots = await q("select lot_code, quantity from stock_lots where product_id=$1 order by lot_code", [lp.id]);
  check(lots.length === 2 && Number(lots[1].quantity) === 4, "agregar al mismo lote suma", JSON.stringify(lots));
  const [svc] = await q(
    `insert into products (organization_id, name, sale_price, is_service) values ($1,'Consulta general',50000,true) returning id`, [orgA]);
  check((await fails("select inv_add_stock($1, 1, 1)", [svc.id])) !== null, "un servicio no tiene existencias");
});

section("Compras a proveedor");
await as(OA, async ({ q, fails }) => {
  const [sup] = await q("insert into suppliers (organization_id, name) values ($1,'Distrivet') returning id", [orgA]);
  const payload = { supplier_id: sup.id, invoice_number: 'F-100', items: [{ product_id: invP, quantity: 10, unit_cost: 1000 }] };
  const [pu] = await q("select inv_receive_purchase($1::jsonb) id", [JSON.stringify(payload)]);
  const [st] = await q("select stock from products where id=$1", [invP]);
  check(Number(st.stock) === 23, "la compra suma al inventario (13 + 10)", String(st.stock));
  const [tot] = await q("select total, status from purchases where id=$1", [pu.id]);
  check(Number(tot.total) === 10000 && tot.status === "registrada", "la compra guarda su total");
  check((await fails("update purchases set total=1 where id=$1", [pu.id])) !== null, "una compra no se edita");
  check((await fails("select inv_receive_purchase($1::jsonb)", [JSON.stringify({ items: [] })])) !== null, "una compra necesita productos");
  await q("select inv_void_purchase($1, 'Se registró por error')", [pu.id]);
  const [st2] = await q("select stock from products where id=$1", [invP]);
  check(Number(st2.stock) === 13, "anular la compra devuelve las existencias (13)", String(st2.stock));
  check((await fails("select inv_void_purchase($1, 'Otra vez ya')", [pu.id])) !== null, "una compra no se anula dos veces");
});

section("Ventas, pagos, abonos y caja");
await as(OA, async ({ q, fails }) => {
  const itemsAll = [
    { product_id: invP, quantity: 2 },
    { product_id: invLotP, quantity: 3 },
    { description: "Consulta general", quantity: 1, unit_price: 50000, tax_rate: 0 },
  ];
  const sale = (extra) => JSON.stringify({ items: itemsAll, ...extra });

  check((await fails("select sale_create($1::jsonb)", [sale({ payments: [{ method: "efectivo", amount: 10000 }] })])) !== null,
    "no se cobra con la caja cerrada");
  check((await fails("select sale_create($1::jsonb)", [sale({})])) !== null,
    "una venta con saldo pendiente exige cliente");

  await q("select cash_open(50000, 'Turno mañana')");
  check((await fails("select cash_open(0)")) !== null, "no se abren dos cajas a la vez");

  check((await fails("select sale_create($1::jsonb)", [sale({ payments: [{ method: "efectivo", amount: 999999 }] })])) !== null,
    "los pagos no pueden superar el total");
  check((await fails("select sale_create($1::jsonb)", [JSON.stringify({ items: [{ product_id: invP, quantity: 999 }] })])) !== null,
    "no se vende más de lo que hay");

  const [s] = await q("select sale_create($1::jsonb) id", [sale({
    customer_tutor_id: tutorA,
    payments: [{ method: "efectivo", amount: 100000 }, { method: "transferencia", amount: 50000, reference: "T-1" }],
  })]);
  const [sv] = await q("select * from sales where id=$1", [s.id]);
  check(sv.full_number === "V-0001", "el primer documento es V-0001", sv.full_number);
  check(Number(sv.total) === 180000 && Number(sv.paid_total) === 150000 && Number(sv.balance) === 30000 && sv.status === "pendiente",
    "total 180000, pagado 150000, saldo 30000", JSON.stringify([sv.total, sv.paid_total, sv.balance, sv.status]));
  check(Number(sv.tax_total) === 6386.55 && Number(sv.subtotal) === 173613.45, "IVA y base por línea suman bien", `${sv.tax_total} / ${sv.subtotal}`);
  check(sv.customer_name === "Tutor A" && sv.customer_doc_number === "111", "el cliente toma los datos del tutor");
  const [p1] = await q("select stock from products where id=$1", [invP]);
  check(Number(p1.stock) === 11, "la venta descuenta el inventario (13 - 2)", String(p1.stock));
  const lotsAfter = await q("select lot_code, quantity from stock_lots where product_id=$1 order by lot_code", [invLotP]);
  check(Number(lotsAfter[0].quantity) === 3 && Number(lotsAfter[1].quantity) === 1,
    "primero sale el lote que vence antes (L2 4→1, L1 sigue en 3)", JSON.stringify(lotsAfter));
  const [item] = await q("select unit_cost from sale_items where sale_id=$1 and product_id=$2", [s.id, invP]);
  const [pc] = await q("select cost_avg from products where id=$1", [invP]);
  check(Number(item.unit_cost) > 0 && Number(item.unit_cost) === Number(pc.cost_avg), "la línea guarda el costo del momento", String(item.unit_cost));

  check((await fails("update sales set total=1 where id=$1", [s.id])) !== null, "una venta no se edita");
  check((await fails("delete from sales where id=$1", [s.id])) !== null, "una venta no se borra");
  check((await fails("update payments set amount=1 where sale_id=$1", [s.id])) !== null, "los pagos no se editan");

  await q("select sale_add_payment($1, 'efectivo', 30000, 'Abono final')", [s.id]);
  const [sv2] = await q("select status, balance from sales where id=$1", [s.id]);
  check(sv2.status === "pagada" && Number(sv2.balance) === 0, "el abono completa el pago y la venta queda pagada");
  check((await fails("select sale_add_payment($1, 'efectivo', 1)", [s.id])) !== null, "no hay abono en una venta pagada");

  const [open] = await q("select id from cash_sessions where status='abierta'");
  const [t1] = await q("select cash_session_totals($1) t", [open.id]);
  check(Number(t1.t.expected_cash) === 180000, "efectivo esperado = 50000 + 130000", String(t1.t.expected_cash));
  check(Number(t1.t.payments_by_method.transferencia) === 50000, "la caja separa lo cobrado por medio de pago");

  await q("select cash_add_movement('egreso', 'efectivo', 20000, 'Compra de bolsas')");
  await q("select cash_add_movement('ingreso', 'efectivo', 5000, 'Cambio')");

  // anulación: devuelve inventario y registra la devolución
  check((await fails("select sale_void($1, 'x')", [s.id])) !== null, "anular exige un motivo de al menos 5 caracteres");
  await q("select sale_void($1, 'El cliente devolvió todo')", [s.id]);
  const [p2] = await q("select stock from products where id=$1", [invP]);
  check(Number(p2.stock) === 13, "anular la venta devuelve el inventario (13)", String(p2.stock));
  const lotsBack = await q("select lot_code, quantity from stock_lots where product_id=$1 order by lot_code", [invLotP]);
  check(Number(lotsBack[0].quantity) === 3 && Number(lotsBack[1].quantity) === 4, "y lo devuelve a los mismos lotes", JSON.stringify(lotsBack));
  const [dev] = await q("select coalesce(sum(amount),0) a from cash_movements where kind='devolucion' and method='efectivo'");
  check(Number(dev.a) === 130000, "se registra la devolución del efectivo cobrado");
  check((await fails("select sale_void($1, 'Otra vez ya')", [s.id])) !== null, "una venta no se anula dos veces");

  // cierre con arqueo: 50000 + 130000 + 5000 - 20000 - 130000 = 35000
  const [cl] = await q("select cash_close($1, 34000, 'Faltó') t", [open.id]);
  check(Number(cl.t.expected_cash) === 35000 && Number(cl.t.difference) === -1000,
    "el cierre calcula el esperado y la diferencia", JSON.stringify(cl.t));
  check((await fails("select cash_close($1, 1)", [open.id])) !== null, "una caja cerrada no se cierra otra vez");
  check((await fails("update cash_sessions set counted_cash=1 where id=$1", [open.id])) !== null, "una caja cerrada no se edita");
  check((await fails("select sale_create($1::jsonb)", [sale({ payments: [{ method: "efectivo", amount: 1000 }] })])) !== null,
    "con la caja cerrada no se cobra");

  // venta a crédito sin pagos no necesita caja
  const [cr] = await q("select sale_create($1::jsonb) id", [JSON.stringify({
    customer_tutor_id: tutorA, items: [{ product_id: invP, quantity: 1 }] })]);
  const [crs] = await q("select status, balance, full_number from sales where id=$1", [cr.id]);
  check(crs.status === "pendiente" && Number(crs.balance) === 20000 && crs.full_number === "V-0002", "venta a crédito: pendiente y consecutivo V-0002");
  const pend = await q("select id from sales where status='pendiente'");
  check(pend.length === 1, "la lista de por cobrar tiene una venta");
});
await as(OB, async ({ q, fails }) => {
  check((await q("select id from products")).length === 0, "B no ve los productos de A");
  check((await q("select id from sales")).length === 0, "B no ve las ventas de A");
  check((await fails("select inv_add_stock($1, 1, 1)", [invP])) !== null, "B no puede mover el inventario de A");
  check((await fails("select cash_open(1)")) !== null, "B sin el módulo no abre caja");
});
await as(X2, async ({ q, fails }) => {
  check((await q("select id from products")).length === 0, "un auxiliar sin permisos no ve productos");
  check((await fails("select sale_create($1::jsonb)", [JSON.stringify({ items: [{ product_id: invP, quantity: 1 }] })])) !== null,
    "un auxiliar sin sales.write no vende");
  check((await fails("select cash_open(1)")) !== null, "un auxiliar sin cash.manage no abre caja");
});

// ---------------------------------------------------------------------------
section("Archivos y cuota de almacenamiento");
await admin("update organizations set storage_quota_mb = 1 where id=$1", [orgB]);
{
  let ok1 = true, err2 = null;
  try {
    await admin(`insert into files (organization_id, kind, storage_path, mime_type, size_bytes) values ($1,'exam',$2,'application/pdf',600000)`, [orgB, `${orgB}/exam/${randomUUID()}.pdf`]);
  } catch { ok1 = false; }
  try {
    await admin(`insert into files (organization_id, kind, storage_path, mime_type, size_bytes) values ($1,'exam',$2,'application/pdf',600000)`, [orgB, `${orgB}/exam/${randomUUID()}.pdf`]);
  } catch (e) { err2 = e.message; }
  check(ok1, "el primer archivo cabe en la cuota");
  check(err2 === "storage_quota_exceeded", "el segundo excede la cuota", String(err2));
  await admin("update files set deleted_at = now() where organization_id=$1", [orgB]);
  let ok3 = true;
  try {
    await admin(`insert into files (organization_id, kind, storage_path, mime_type, size_bytes) values ($1,'exam',$2,'application/pdf',600000)`, [orgB, `${orgB}/exam/${randomUUID()}.pdf`]);
  } catch { ok3 = false; }
  check(ok3, "al borrar archivos se libera la cuota");
}
await admin("insert into storage.objects (bucket_id, name) values ('org-files', $1), ('org-files', $2)", [`${orgA}/exam/a.pdf`, `${orgB}/exam/b.pdf`]);
await as(OA, async ({ q }) => {
  const o = await q("select name from storage.objects");
  check(o.length === 1 && o[0].name.startsWith(orgA), "storage: solo ve archivos de su organización", JSON.stringify(o));
});
await as(X1, async ({ q }) => {
  // X1 es miembro: puede leer objetos de su org (el permiso fino lo valida el servidor)
  check((await q("select name from storage.objects")).length === 1, "storage: un auxiliar ve solo su organización");
});
await as(SA, async ({ q }) => {
  check((await q("select name from storage.objects")).length === 0, "storage: el super admin no lee archivos");
});

// ---------------------------------------------------------------------------
section("Usuarios y límites");
{
  let err = null;
  try {
    await mkUser("00000000-0000-0000-0000-0000000000b1");
    await mkAux("00000000-0000-0000-0000-0000000000b1", orgB, "aux.beta", []);
    await mkUser("00000000-0000-0000-0000-0000000000b2");
    await mkAux("00000000-0000-0000-0000-0000000000b2", orgB, "aux.beta2", []);
  } catch (e) { err = e.message; }
  check(err === "max_auxiliares_exceeded", "no se supera el límite de auxiliares", String(err));

  let dup = null;
  try {
    await mkUser("00000000-0000-0000-0000-0000000000c1");
    await admin(
      `insert into profiles (id, organization_id, username, full_name, auth_email, role)
       values ('00000000-0000-0000-0000-0000000000c1', $1, 'dueno.alfa', 'x', 'c1@x', 'auxiliar')`, [orgA]);
  } catch (e) { dup = e.message; }
  check(dup !== null && /profiles_username_key/.test(dup), "el usuario es único sin importar mayúsculas", String(dup));

  let two = null;
  try {
    await mkUser("00000000-0000-0000-0000-0000000000d1");
    await admin(
      `insert into profiles (id, organization_id, username, full_name, auth_email, role)
       values ('00000000-0000-0000-0000-0000000000d1', $1, 'otro.owner', 'x', 'd1@x', 'owner')`, [orgA]);
  } catch (e) { two = e.message; }
  check(two !== null && /profiles_one_owner/.test(two), "una organización solo tiene un owner", String(two));
}

// ---------------------------------------------------------------------------
section("Bitácora");
await as(OA, async ({ q, fails }) => {
  const ins = await q(
    "insert into activity_log (organization_id, user_id, user_name, action) values ($1,$2,'Dra. Alfa','Prueba') returning id",
    [orgA, OA]);
  check(ins.length === 1, "el owner registra en la bitácora");
  check((await fails("update activity_log set action='x'")) !== null, "la bitácora no se edita");
  check((await fails("delete from activity_log")) !== null, "la bitácora no se borra");
  check((await fails(
    "insert into activity_log (organization_id, user_id, action) values ($1,$2,'x')", [orgB, OA])) !== null,
    "no se puede registrar en la bitácora de otra organización");
  check((await q("select id from activity_log")).length >= 1, "el owner lee su bitácora");
});
await as(X3, async ({ q }) => {
  check((await q("select id from activity_log")).length === 0, "un auxiliar no lee la bitácora");
});
await as(OB, async ({ q }) => {
  check((await q("select id from activity_log")).length === 0, "B no lee la bitácora de A");
});

// ---------------------------------------------------------------------------
section("Inmutabilidad en la base de datos (incluso con la llave de servicio)");
{
  async function adminFails(sql, params) {
    try { await admin(sql, params); return null; } catch (e) { return e.message; }
  }
  const [{ id: addId }] = await admin("select id from consultation_addenda limit 1");
  const [{ id: conId }] = await admin("select id from consents where status='firmada' limit 1");
  check(await adminFails("delete from consultations where id=$1", [consId]), "servicio: no borra consultas");
  check(await adminFails("update consultation_addenda set content='x' where id=$1", [addId]), "servicio: no edita notas aclaratorias");
  check(await adminFails("delete from consultation_addenda where id=$1", [addId]), "servicio: no borra notas aclaratorias");
  check(await adminFails("update activity_log set action='x'"), "servicio: no edita la bitácora");
  check(await adminFails("delete from activity_log"), "servicio: no borra la bitácora");
  check(await adminFails("delete from vaccinations where id=$1", [vacId]), "servicio: no borra vacunas");
  check(await adminFails("delete from consents where id=$1", [conId]), "servicio: no borra autorizaciones");
  check(await adminFails("update consents set body='x' where id=$1", [conId]), "servicio: no edita autorizaciones firmadas");
  check(await adminFails("delete from reminders"), "servicio: no borra recordatorios");
}

// ---------------------------------------------------------------------------
section("Catálogos");
await as(X3, async ({ q, fails }) => {
  check((await q("select id from species")).length === 2, "un auxiliar lee los catálogos");
  check((await fails("insert into species (organization_id, name) values ($1,'Conejo')", [orgA])) !== null,
    "sin settings.write no edita catálogos");
});
await as(OA, async ({ q }) => {
  const ins = await q("insert into species (organization_id, name) values ($1,'Conejo') returning id", [orgA]);
  check(ins.length === 1, "el owner agrega una especie");
});

// ---------------------------------------------------------------------------
await db.end();
console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallidas.`);
if (failures.length) {
  console.error("\nFallos:\n- " + failures.join("\n- "));
  process.exit(1);
}
