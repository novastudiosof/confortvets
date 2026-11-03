import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readableTextColor } from "@/lib/logic/colors";
import { readCustomFieldInputs, validateCustomFields, type CustomFieldDef } from "@/lib/logic/custom-fields";
import { addDays, calcAge, daysBetween, formatDate, isIsoDate, todayISO } from "@/lib/logic/dates";
import { membershipStatus } from "@/lib/logic/membership";
import { generateTempPassword, validatePassword } from "@/lib/logic/password";
import { PERMISSIONS, effectivePermissions, permissionsByModule } from "@/lib/logic/permissions";
import { normalizePhone, reminderBucket, whatsappLink } from "@/lib/logic/reminders";
import {
  buildStoragePath,
  checkQuota,
  classifyUpload,
  formatBytes,
  sniffMime,
} from "@/lib/logic/storage";
import { renderTemplate } from "@/lib/logic/templates";
import { normalizeUsername, slugify, validateUsername } from "@/lib/logic/username";

describe("contraseñas", () => {
  it("rechaza contraseñas cortas o sin mezcla", () => {
    expect(validatePassword("corta1")).toMatch(/al menos 10/);
    expect(validatePassword("sololetrasaqui")).toMatch(/letras y números/);
    expect(validatePassword("12345678901")).toMatch(/letras y números/);
  });
  it("acepta una contraseña válida", () => {
    expect(validatePassword("Clave-segura-2026")).toBeNull();
  });
  it("las temporales generadas siempre son válidas", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(12);
      expect(validatePassword(p)).toBeNull();
    }
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});

describe("usuarios", () => {
  it("normaliza y valida", () => {
    expect(normalizeUsername("  Dra.Alfa ")).toBe("dra.alfa");
    expect(validateUsername("dra.alfa")).toBeNull();
    expect(validateUsername("AB")).not.toBeNull();
    expect(validateUsername("con espacio")).not.toBeNull();
    expect(validateUsername("Mayus")).not.toBeNull();
  });
  it("slugify quita tildes y símbolos", () => {
    expect(slugify("Veterinaria El Parque")).toBe("veterinaria-el-parque");
    expect(slugify("  Clínica Ñandú & Co. ")).toBe("clinica-nandu-co");
    expect(slugify("!!!")).toBe("organizacion");
  });
});

describe("fechas", () => {
  it("valida fechas ISO reales", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("28/02/2026")).toBe(false);
  });
  it("suma días y los cuenta", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
    expect(daysBetween("2026-03-01", "2026-01-01")).toBe(-59);
  });
  it("formatea dd/mm/aaaa", () => {
    expect(formatDate("2026-10-31")).toBe("31/10/2026");
    expect(formatDate(null)).toBe("—");
  });
  it("hoy respeta la zona horaria", () => {
    // 2026-11-01 03:00 UTC sigue siendo 31 de octubre en Bogotá (UTC-5)
    expect(todayISO("America/Bogota", new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
    expect(todayISO("UTC", new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
  });
  it("calcula la edad", () => {
    expect(calcAge("2023-08-15", "2026-10-31")).toBe("3 años 2 meses");
    expect(calcAge("2025-10-31", "2026-10-31")).toBe("1 año");
    expect(calcAge("2026-05-31", "2026-10-31")).toBe("5 meses");
    expect(calcAge("2026-10-10", "2026-10-31")).toBe("3 semanas");
    expect(calcAge("2026-10-29", "2026-10-31")).toBe("2 días");
    expect(calcAge("2027-01-01", "2026-10-31")).toBeNull();
    expect(calcAge(null, "2026-10-31")).toBeNull();
  });
});

describe("membresía", () => {
  it("sin vencimiento siempre está activa", () => {
    expect(membershipStatus(null, "2026-10-31")).toEqual({ state: "active", daysLeft: null });
  });
  it("vale hasta el final del día de vencimiento", () => {
    expect(membershipStatus("2026-10-31", "2026-10-31").state).toBe("expiring");
    expect(membershipStatus("2026-10-30", "2026-10-31").state).toBe("expired");
  });
  it("avisa 7 días antes", () => {
    expect(membershipStatus("2026-11-07", "2026-10-31").state).toBe("expiring");
    expect(membershipStatus("2026-11-08", "2026-10-31").state).toBe("active");
  });
});

describe("recordatorios y WhatsApp", () => {
  it("normaliza teléfonos colombianos", () => {
    expect(normalizePhone("319 303 4610")).toBe("573193034610");
    expect(normalizePhone("+57 319 303 4610")).toBe("573193034610");
    expect(normalizePhone("573193034610")).toBe("573193034610");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("arma el enlace con el mensaje codificado", () => {
    const link = whatsappLink("3193034610", "Hola ñandú & más");
    expect(link).toBe("https://wa.me/573193034610?text=Hola%20%C3%B1and%C3%BA%20%26%20m%C3%A1s");
    expect(whatsappLink("abc", "x")).toBeNull();
  });
  it("clasifica los pendientes", () => {
    const today = "2026-10-31";
    expect(reminderBucket("2026-10-20", "2026-10-13", today)).toBe("vencido");
    expect(reminderBucket("2026-10-31", "2026-10-24", today)).toBe("hoy");
    expect(reminderBucket("2026-11-03", "2026-10-27", today)).toBe("proximo");
    expect(reminderBucket("2026-12-01", "2026-11-24", today)).toBeNull();
  });
});

describe("plantillas de texto", () => {
  it("reemplaza variables conocidas", () => {
    expect(renderTemplate("Hola {tutor}, {paciente} el {fecha}", { tutor: "Ana", paciente: "Rex", fecha: "01/11/2026" }))
      .toBe("Hola Ana, Rex el 01/11/2026");
  });
  it("las conocidas sin valor quedan vacías y las desconocidas se conservan", () => {
    expect(renderTemplate("A {procedimiento} B {inventada}", {})).toBe("A  B {inventada}");
  });
});

describe("archivos y cuota", () => {
  it("clasifica los archivos permitidos", () => {
    expect(classifyUpload("application/pdf", 1000, true, false)).toEqual({ ok: true, type: "pdf" });
    expect(classifyUpload("image/png", 1000, false, true)).toEqual({ ok: true, type: "image" });
    expect(classifyUpload("image/png", 1000, true, false).ok).toBe(false);
    expect(classifyUpload("application/pdf", 6 * 1024 * 1024, true, true).ok).toBe(false);
    expect(classifyUpload("application/zip", 1000, true, true).ok).toBe(false);
    expect(classifyUpload("image/png", 0, true, true).ok).toBe(false);
  });
  it("controla la cuota", () => {
    const ok = checkQuota(50 * 1024 * 1024, 100, 10 * 1024 * 1024);
    expect(ok.ok).toBe(true);
    const bad = checkQuota(95 * 1024 * 1024, 100, 10 * 1024 * 1024);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/No hay espacio/);
    expect(checkQuota(0, 0, 1).ok).toBe(false);
  });
  it("formatea bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("arma la ruta por organización", () => {
    expect(buildStoragePath("org-1", "exam", "pdf", "abc")).toBe("org-1/exam/abc.pdf");
  });
  it("detecta el tipo real por la firma del archivo", () => {
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(new TextEncoder().encode("MZ executable"))).toBeNull();
  });
});

describe("campos personalizados", () => {
  const defs: CustomFieldDef[] = [
    { key: "condicion", label: "Condición", field_type: "select", options: ["Buena", "Regular"], required: true },
    { key: "peso_ideal", label: "Peso ideal", field_type: "number", options: [], required: false },
    { key: "agresivo", label: "Agresivo", field_type: "boolean", options: [], required: false },
    { key: "ultima", label: "Última visita", field_type: "date", options: [], required: false },
    { key: "nota", label: "Nota", field_type: "text", options: [], required: false },
    { key: "oculto", label: "Oculto", field_type: "text", options: [], required: true, is_active: false },
  ];
  it("acepta valores correctos y convierte tipos", () => {
    const r = validateCustomFields(defs, {
      condicion: "Buena", peso_ideal: "12,5", agresivo: "on", ultima: "2026-10-01", nota: " hola ",
    });
    expect(r.errors).toEqual([]);
    expect(r.values).toEqual({
      condicion: "Buena", peso_ideal: 12.5, agresivo: true, ultima: "2026-10-01", nota: "hola",
    });
  });
  it("reporta obligatorios, opciones y formatos inválidos", () => {
    const r = validateCustomFields(defs, { condicion: "", peso_ideal: "abc", ultima: "31/10/2026" });
    expect(r.errors).toEqual([
      "Condición es obligatorio",
      "Peso ideal debe ser un número",
      "Última visita debe ser una fecha válida",
    ]);
    expect(validateCustomFields(defs, { condicion: "Mala" }).errors).toEqual(["Condición: opción no válida"]);
  });
  it("ignora los campos desactivados", () => {
    expect(validateCustomFields(defs, { condicion: "Buena" }).errors).toEqual([]);
  });
  it("lee las entradas del formulario con prefijo cf_", () => {
    const fd = new FormData();
    fd.set("cf_condicion", "Buena");
    fd.set("otro", "x");
    expect(readCustomFieldInputs(fd, defs)).toEqual({ condicion: "Buena" });
  });
});

describe("permisos", () => {
  const all = new Set(["core", "clinical", "preventive", "consents"]);
  it("el super admin no tiene permisos de negocio", () => {
    expect(effectivePermissions({ role: "super_admin", enabledModules: all, grants: new Set(), restricted: new Set() }).size).toBe(0);
  });
  it("el owner tiene todos los de módulos habilitados", () => {
    const p = effectivePermissions({ role: "owner", enabledModules: new Set(["core"]), grants: new Set(), restricted: new Set() });
    expect(p.has("tutors.write")).toBe(true);
    expect(p.has("clinical.read")).toBe(false);
  });
  it("el auxiliar solo tiene lo asignado dentro de módulos activos", () => {
    const p = effectivePermissions({
      role: "auxiliar",
      enabledModules: new Set(["core"]),
      grants: new Set(["tutors.read", "clinical.read"]),
      restricted: new Set(),
    });
    expect([...p]).toEqual(["tutors.read"]);
  });
  it("la restricción del super admin aplica incluso al owner", () => {
    const p = effectivePermissions({ role: "owner", enabledModules: all, grants: new Set(), restricted: new Set(["clinical.void"]) });
    expect(p.has("clinical.void")).toBe(false);
    expect(p.has("clinical.close")).toBe(true);
  });
  it("agrupa por módulo habilitado", () => {
    const g = permissionsByModule(new Set(["core", "consents"]));
    expect(g.map((x) => x.module)).toEqual(["core", "consents"]);
  });
  it("el catálogo coincide con el de la base de datos", () => {
    const files = ["20261101000700_seed_and_hardening.sql", "20261102000200_agenda.sql"];
    const dbPerms = files
      .flatMap((file) => {
        const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
        const start = sql.indexOf("insert into permissions");
        const block = sql.slice(start, sql.indexOf("on conflict (key) do update", start));
        return [...block.matchAll(/\('([a-z_.]+)', '([a-z]+)'/g)].map((m) => `${m[1]}@${m[2]}`);
      })
      .sort();
    const codePerms = PERMISSIONS.map((p) => `${p.key}@${p.module}`).sort();
    expect(codePerms).toEqual(dbPerms);
  });
});

describe("colores", () => {
  it("elige texto legible sobre el color de la marca", () => {
    expect(readableTextColor("#3B82F6")).toBe("#FFFFFF");
    expect(readableTextColor("#FACC15")).toBe("#0B1020");
    expect(readableTextColor("azul")).toBe("#FFFFFF");
  });
});

describe("datos del tutor", () => {
  it("avisa qué datos faltan sin exigirlos", async () => {
    const { missingTutorFields, missingTutorMessage } = await import("@/lib/logic/tutor");
    expect(missingTutorFields({})).toEqual(["cédula", "teléfono o WhatsApp", "dirección", "barrio"]);
    expect(missingTutorFields({ document_number: "123", whatsapp: "3001234567", address: "Cra 1", neighborhood: "Centro" })).toEqual([]);
    expect(missingTutorFields({ document_number: "123", phone: "  ", address: "x", neighborhood: "y" })).toEqual(["teléfono o WhatsApp"]);
    expect(missingTutorMessage({ document_number: "1", phone: "2", address: "3", neighborhood: "4" })).toBeNull();
    expect(missingTutorMessage({})).toContain("Faltan datos por completar");
  });
});

describe("agenda", () => {
  it("convierte hora local de Bogotá a instante y de vuelta", async () => {
    const { zonedToUtc, localParts } = await import("@/lib/logic/agenda");
    const d = zonedToUtc("2027-03-01", "15:00", "America/Bogota");
    expect(d.toISOString()).toBe("2027-03-01T20:00:00.000Z");
    expect(localParts(d, "America/Bogota")).toEqual({ date: "2027-03-01", time: "15:00" });
    // cerca de medianoche cambia de día
    expect(localParts(new Date("2027-03-02T03:30:00Z"), "America/Bogota")).toEqual({ date: "2027-03-01", time: "22:30" });
  });

  it("calcula el rango de un día y la semana", async () => {
    const { dayRange, weekStart, weekdayOf } = await import("@/lib/logic/agenda");
    const r = dayRange("2027-03-01", "America/Bogota");
    expect(r.from.toISOString()).toBe("2027-03-01T05:00:00.000Z");
    expect(r.to.toISOString()).toBe("2027-03-02T05:00:00.000Z");
    expect(weekdayOf("2027-03-01")).toBe(1); // lunes
    expect(weekStart("2027-03-07")).toBe("2027-03-01"); // domingo -> lunes anterior
    expect(weekStart("2027-03-03")).toBe("2027-03-01");
  });

  it("genera los espacios dentro de las franjas", async () => {
    const { generateSlots, fitsInHours, hasOverlappingRanges } = await import("@/lib/logic/agenda");
    const ranges = [
      { start: "08:00", end: "09:30" },
      { start: "14:00", end: "15:00" },
    ];
    expect(generateSlots(ranges, 30)).toEqual(["08:00", "08:30", "09:00", "14:00", "14:30"]);
    expect(fitsInHours("09:00", 30, ranges)).toBe(true);
    expect(fitsInHours("09:00", 60, ranges)).toBe(false); // se pasa del cierre
    expect(fitsInHours("12:00", 30, ranges)).toBe(false); // fuera de horario
    expect(hasOverlappingRanges([...ranges, { start: "09:00", end: "10:00" }])).toBe(true);
    expect(hasOverlappingRanges(ranges)).toBe(false);
  });

  it("ordena citas, bloqueos y espacios libres", async () => {
    const { buildTimeline } = await import("@/lib/logic/agenda");
    const slots = ["08:00", "08:30", "09:00", "09:30"];
    const entries = buildTimeline(
      slots,
      30,
      [
        { id: "a1", status: "programada", startMin: 8 * 60 + 30, endMin: 9 * 60 + 30 },
        { id: "a2", status: "cancelada", startMin: 8 * 60, endMin: 8 * 60 + 30 },
      ],
      [{ id: "b1", startMin: 9 * 60 + 30, endMin: 10 * 60 }],
      false
    );
    // 08:00 libre (la cancelada no ocupa) y su cita cancelada; 08:30 y 09:00 ocupados; 09:30 bloqueado
    expect(entries.map((e) => (e.kind === "free" ? `free-${e.start}` : `${e.kind}-${e.id}`))).toEqual([
      "appointment-a2",
      "free-08:00",
      "appointment-a1",
      "block-b1",
    ]);
  });

  it("minutos del día acotados", async () => {
    const { minutesInDay } = await import("@/lib/logic/agenda");
    expect(minutesInDay("2027-03-01T20:00:00Z", "2027-03-01", "America/Bogota")).toBe(15 * 60);
    expect(minutesInDay("2027-03-01T03:00:00Z", "2027-03-01", "America/Bogota")).toBe(0);
    expect(minutesInDay("2027-03-03T03:00:00Z", "2027-03-01", "America/Bogota")).toBe(1440);
  });
});

describe("inventario y ventas", () => {
  it("calcula el IVA incluido en el precio, como la base de datos", async () => {
    const { computeLine, computeTotals } = await import("@/lib/logic/inventory");
    expect(computeLine({ quantity: 2, unitPrice: 20000, discount: 0, taxRate: 19 })).toEqual({ gross: 40000, base: 33613.45, tax: 6386.55 });
    expect(computeLine({ quantity: 1, unitPrice: 50000, discount: 5000, taxRate: 0 })).toEqual({ gross: 45000, base: 45000, tax: 0 });
    const t = computeTotals([
      { quantity: 2, unitPrice: 20000, discount: 0, taxRate: 19 },
      { quantity: 3, unitPrice: 30000, discount: 0, taxRate: 0 },
      { quantity: 1, unitPrice: 50000, discount: 0, taxRate: 0 },
    ]);
    expect(t).toEqual({ gross: 180000, base: 173613.45, tax: 6386.55, discount: 0 });
  });

  it("clasifica existencias y vencimientos", async () => {
    const { stockState, expiryState, inventoryValue, formatMoney, formatQty } = await import("@/lib/logic/inventory");
    expect(stockState(0, 5, false)).toBe("agotado");
    expect(stockState(5, 5, false)).toBe("bajo");
    expect(stockState(6, 5, false)).toBe("ok");
    expect(stockState(0, 5, true)).toBe("ok");
    expect(stockState(2, 0, false)).toBe("ok");
    expect(expiryState("2027-01-01", "2027-03-01", 60)).toBe("vencido");
    expect(expiryState("2027-04-15", "2027-03-01", 60)).toBe("por_vencer");
    expect(expiryState("2027-12-01", "2027-03-01", 60)).toBe("ok");
    expect(expiryState(null, "2027-03-01", 60)).toBe("sin_fecha");
    expect(inventoryValue([{ stock: 10, cost_avg: 1200 }, { stock: "2.5", cost_avg: "100" }])).toBe(12250);
    expect(formatQty("3.000")).toBe("3");
    expect(formatMoney(20000)).toContain("20.000");
  });
});
