import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PurchaseEditor } from "@/components/purchase-editor";
import { Notice, PageHeader } from "@/components/ui/misc";
import { receivePurchase } from "@/lib/actions/inventory";
import { can, requireAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Registrar compra" };

export default async function NewPurchasePage() {
  const ctx = await requireAccess("inventory.write");
  const supabase = await createClient();
  const [{ data: products }, { data: suppliers }] = await Promise.all([
    supabase.from("products").select("id, name, unit, track_lots, cost_avg").eq("is_active", true).eq("is_service", false).order("name").limit(3000),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader
        back={
          <Link href="/dashboard/inventario?tab=compras" className="mb-2 inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-4 w-4" /> Compras
          </Link>
        }
        title="Registrar compra"
        description="Lo que compres se suma a las existencias que ya tienes."
      />
      {ctx.readOnly ? (
        <Notice tone="warning">Tu membresía venció: no puedes registrar compras.</Notice>
      ) : (products ?? []).length === 0 ? (
        <Notice tone="info">
          Primero crea los productos en{" "}
          <Link href="/dashboard/inventario" className="font-medium text-brand-dark underline">
            Inventario
          </Link>
          {can(ctx, "inventory.manage") ? "." : " (pide al administrador que los cree)."}
        </Notice>
      ) : (
        <PurchaseEditor
          action={receivePurchase}
          products={(products ?? []).map((p) => ({ ...p, cost_avg: Number(p.cost_avg) })) as never[]}
          suppliers={(suppliers ?? []) as { id: string; name: string }[]}
          today={ctx.today}
          currency={ctx.settings.currency}
        />
      )}
    </>
  );
}
