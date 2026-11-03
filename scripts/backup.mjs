// Respaldo de los datos de la aplicación: exporta todas las tablas a un JSON y
// lo cifra con AES-256-GCM (clave derivada de BACKUP_PASSWORD con scrypt).
//
//   BACKUP_PASSWORD="una clave larga" node --env-file=.env.local scripts/backup.mjs [carpeta]
//
// No incluye las contraseñas (están en Supabase Auth) ni los archivos
// (fotos y PDF, que viven en Storage). Para eso, el plan Pro de Supabase trae
// copias completas diarias. Abrir un respaldo: scripts/decrypt-backup.mjs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { encryptBackup } from "./lib/backup-crypto.mjs";

const TABLES = [
  "organizations", "organization_settings", "organization_modules", "organization_permissions",
  "profiles", "auxiliary_permissions", "species", "breeds", "tutors", "patients", "patient_weights",
  "custom_field_defs", "control_types", "consultations", "consultation_addenda", "exam_files",
  "medications", "text_templates", "prescriptions", "prescription_items", "vaccine_catalog",
  "deworming_products", "vaccinations", "dewormings", "reminder_rules", "message_templates",
  "reminders", "consent_templates", "consents", "files", "activity_log", "org_counters",
  "agenda_settings", "agenda_hours", "agenda_blocks", "appointment_types", "appointments", "agenda_waitlist",
  "consultation_revisions", "inventory_settings", "suppliers", "products", "stock_lots", "stock_movements",
  "purchases", "purchase_items", "document_series", "cash_sessions", "cash_movements", "sales", "sale_items", "payments",
];
const PAGE = 1000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.BACKUP_PASSWORD;
const outDir = process.argv[2] ?? "backups";

if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!password || password.length < 16) {
  console.error("BACKUP_PASSWORD es obligatoria y debe tener al menos 16 caracteres. Guárdala en un lugar seguro: sin ella no se puede abrir el respaldo.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const data = {};
for (const table of TABLES) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) {
      console.error(`Error exportando ${table}: ${error.message}`);
      process.exit(1);
    }
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  data[table] = rows;
  console.log(`  ${table}: ${rows.length}`);
}

const payload = Buffer.from(JSON.stringify({ exported_at: new Date().toISOString(), tables: data }), "utf8");
const file = encryptBackup(payload, password);

mkdirSync(outDir, { recursive: true });
const name = `respaldo-confortvets-${new Date().toISOString().slice(0, 10)}.json.enc`;
writeFileSync(join(outDir, name), file);
console.log(`Respaldo cifrado: ${join(outDir, name)} (${(file.length / 1024).toFixed(0)} KB)`);
