import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { logActivity } from "@/lib/activity";
import { can, getContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Tabla exportable y permiso que hace falta para incluirla. */
const EXPORT_TABLES: { table: string; permission: string; order: string }[] = [
  { table: "tutors", permission: "tutors.read", order: "created_at" },
  { table: "patients", permission: "patients.read", order: "created_at" },
  { table: "patient_weights", permission: "patients.read", order: "created_at" },
  { table: "consultations", permission: "clinical.read", order: "created_at" },
  { table: "consultation_addenda", permission: "clinical.read", order: "created_at" },
  { table: "consultation_revisions", permission: "clinical.read", order: "edited_at" },
  { table: "prescriptions", permission: "clinical.read", order: "created_at" },
  { table: "prescription_items", permission: "clinical.read", order: "sort_order" },
  { table: "vaccinations", permission: "preventive.read", order: "created_at" },
  { table: "dewormings", permission: "preventive.read", order: "created_at" },
  { table: "reminders", permission: "preventive.read", order: "created_at" },
  { table: "consents", permission: "consents.read", order: "created_at" },
  { table: "appointments", permission: "agenda.read", order: "starts_at" },
  { table: "agenda_waitlist", permission: "agenda.read", order: "created_at" },
  { table: "products", permission: "inventory.read", order: "created_at" },
  { table: "suppliers", permission: "inventory.read", order: "created_at" },
  { table: "stock_lots", permission: "inventory.read", order: "created_at" },
  { table: "stock_movements", permission: "inventory.read", order: "created_at" },
  { table: "purchases", permission: "inventory.read", order: "created_at" },
  { table: "purchase_items", permission: "inventory.read", order: "id" },
  { table: "sales", permission: "sales.read", order: "created_at" },
  { table: "sale_items", permission: "sales.read", order: "sort_order" },
  { table: "payments", permission: "sales.read", order: "paid_at" },
  { table: "cash_sessions", permission: "sales.read", order: "opened_at" },
  { table: "cash_movements", permission: "sales.read", order: "created_at" },
];

const PAGE_SIZE = 1000;

/**
 * Exporta los datos de la organización (JSON o Excel). Funciona aunque la
 * membresía esté vencida: los datos son del cliente. Usa la sesión del
 * usuario, así RLS limita lo exportado a su organización y a sus permisos.
 */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || !ctx.org || !ctx.org.is_active) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  if (!can(ctx, "data.export")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "json";
  const supabase = await createClient();

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const { table, permission, order } of EXPORT_TABLES) {
    if (!can(ctx, permission)) continue;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order(order, { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        return NextResponse.json({ error: `No se pudo exportar ${table}` }, { status: 500 });
      }
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
    tables[table] = rows;
  }

  await logActivity(ctx, "Exportó los datos de la organización", { detail: format });

  const baseName = `confortvets-${ctx.org.slug}-${ctx.today}`;

  if (format === "json") {
    const body = JSON.stringify(
      { exported_at: new Date().toISOString(), organization: ctx.org.name, tables },
      null,
      2
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ConfortVets";
  workbook.created = new Date();
  for (const [name, rows] of Object.entries(tables)) {
    const sheet = workbook.addWorksheet(name);
    const columns = rows.length ? Object.keys(rows[0]) : ["(sin registros)"];
    sheet.columns = columns.map((key) => ({ header: key, key, width: Math.min(Math.max(key.length + 2, 14), 40) }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) {
      const flat: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        flat[key] = value !== null && typeof value === "object" ? JSON.stringify(value) : value;
      }
      sheet.addRow(flat);
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
