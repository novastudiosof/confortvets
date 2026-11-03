-- ConfortVets — módulo Inventario y caja.
-- Productos, existencias por movimientos, lotes, compras, ventas internas con
-- pagos y abonos, y caja con arqueo.
--
-- Principios:
--  * Una entrada SUMA a la existencia; nunca la reemplaza.
--  * La existencia y el costo promedio solo cambian con movimientos, y los
--    movimientos solo se agregan (nunca se editan ni se borran).
--  * Ventas, pagos y movimientos de caja no se editan ni se borran: se anulan
--    con motivo y se revierten con movimientos nuevos.
--  * Toda operación que toca varias tablas es una función (transacción única)
--    que revisa permisos y membresía: los usuarios no escriben esas tablas.
--  * Listo para la DIAN: series con resolución y rango, datos fiscales del
--    cliente, IVA por línea y tipo de documento. Hoy solo se emite el
--    documento interno.

-- ==========================================================================
-- Módulo y permisos
-- ==========================================================================
update modules
   set available = true,
       name = 'Inventario y caja',
       description = 'Productos y existencias, lotes y vencimientos, compras, ventas internas, abonos y caja.'
 where key = 'inventory';

insert into permissions (key, module_key, description, sort_order) values
  ('inventory.read', 'inventory', 'Ver productos, existencias y compras', 500),
  ('inventory.write', 'inventory', 'Agregar existencias, ajustar y registrar compras', 501),
  ('inventory.manage', 'inventory', 'Crear y editar productos, precios y proveedores', 502),
  ('sales.read', 'inventory', 'Ver ventas y caja', 510),
  ('sales.write', 'inventory', 'Registrar ventas y abonos', 511),
  ('cash.manage', 'inventory', 'Abrir y cerrar caja, registrar ingresos y egresos y anular ventas', 512)
on conflict (key) do update
  set module_key = excluded.module_key, description = excluded.description,
      sort_order = excluded.sort_order;

-- ==========================================================================
-- Ajustes, proveedores y productos
-- ==========================================================================
create table inventory_settings (
  organization_id uuid primary key references organizations(id),
  expiry_alert_days int not null default 60 check (expiry_alert_days between 1 and 365),
  allow_negative_stock boolean not null default false,   -- solo productos sin lote
  updated_at timestamptz not null default now()
);
create trigger inventory_settings_updated_at before update on inventory_settings
  for each row execute function set_updated_at();

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  tax_id text,                                  -- NIT o cédula
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index suppliers_name_key on suppliers (organization_id, lower(name));
create trigger suppliers_updated_at before update on suppliers
  for each row execute function set_updated_at();

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  sku text,
  category text not null default 'otro'
    check (category in ('medicamento', 'insumo', 'alimento', 'accesorio', 'servicio', 'otro')),
  unit text not null default 'unidad',
  description text,
  is_service boolean not null default false,    -- los servicios no tienen existencias
  track_lots boolean not null default false,    -- controla lote y vencimiento
  cost_avg numeric(14, 4) not null default 0 check (cost_avg >= 0),
  sale_price numeric(14, 2) not null default 0 check (sale_price >= 0),   -- IVA incluido
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  min_stock numeric(14, 3) not null default 0 check (min_stock >= 0),
  stock numeric(14, 3) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (not (is_service and track_lots))
);
create unique index products_name_key on products (organization_id, lower(name));
create unique index products_sku_key on products (organization_id, lower(sku)) where sku is not null;
create index products_active_idx on products (organization_id, is_active, name);
create trigger products_updated_at before update on products
  for each row execute function set_updated_at();

-- La existencia y el costo promedio los cambian solo los movimientos (que
-- activan una marca dentro de su transacción).
create or replace function products_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('app.stock_write', true) is distinct from '1' then
      new.stock := 0;
    end if;
    return new;
  end if;
  if current_setting('app.stock_write', true) is distinct from '1' then
    if new.stock <> old.stock or new.cost_avg <> old.cost_avg then
      raise exception 'La existencia y el costo promedio solo cambian con movimientos de inventario.'
        using errcode = 'P0001';
    end if;
  end if;
  if (new.track_lots <> old.track_lots or new.is_service <> old.is_service)
     and exists (select 1 from stock_movements m where m.product_id = old.id) then
    raise exception 'No se puede cambiar el tipo de un producto que ya tiene movimientos.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger products_guard before insert or update on products
  for each row execute function products_guard();

create table stock_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  product_id uuid not null,
  lot_code text not null,
  expires_on date,
  quantity numeric(14, 3) not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, product_id, lot_code),
  foreign key (product_id, organization_id) references products (id, organization_id)
);
create index stock_lots_idx on stock_lots (organization_id, product_id, expires_on);

-- ==========================================================================
-- Movimientos (libro de existencias: solo se agrega)
-- ==========================================================================
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  product_id uuid not null,
  lot_id uuid,
  kind text not null check (kind in
    ('entrada', 'compra', 'anulacion_compra', 'ajuste', 'merma', 'uso_consulta', 'venta', 'anulacion_venta')),
  quantity numeric(14, 3) not null check (quantity <> 0),     -- con signo: + entra, - sale
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  balance_after numeric(14, 3),
  reason text,
  ref_type text,                                              -- 'purchase', 'sale', 'consultation'
  ref_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (product_id, organization_id) references products (id, organization_id),
  foreign key (lot_id, organization_id) references stock_lots (id, organization_id)
);
create index stock_movements_product_idx on stock_movements (organization_id, product_id, created_at desc);
create index stock_movements_ref_idx on stock_movements (organization_id, ref_type, ref_id);
create trigger stock_movements_immutable before update or delete on stock_movements
  for each row execute function block_mutation();

create or replace function stock_movements_apply()
returns trigger
language plpgsql
as $$
declare
  v_prod products%rowtype;
  v_lot stock_lots%rowtype;
  v_allow boolean;
  v_new_stock numeric;
  v_avg numeric;
begin
  select * into v_prod from products
    where id = new.product_id and organization_id = new.organization_id for update;
  if not found then
    raise exception 'Producto no encontrado.' using errcode = 'P0001';
  end if;
  if v_prod.is_service then
    raise exception 'Los servicios no tienen existencias.' using errcode = 'P0001';
  end if;

  if v_prod.track_lots then
    if new.lot_id is null then
      raise exception 'Indica el lote de %.', v_prod.name using errcode = 'P0001';
    end if;
    select * into v_lot from stock_lots
      where id = new.lot_id and organization_id = new.organization_id and product_id = new.product_id for update;
    if not found then
      raise exception 'El lote no corresponde al producto.' using errcode = 'P0001';
    end if;
    if v_lot.quantity + new.quantity < 0 then
      raise exception 'No hay existencias suficientes en el lote % de % (disponible: %).',
        v_lot.lot_code, v_prod.name, v_lot.quantity using errcode = 'P0001';
    end if;
    update stock_lots set quantity = quantity + new.quantity where id = new.lot_id;
  elsif new.lot_id is not null then
    raise exception '% no maneja lotes.', v_prod.name using errcode = 'P0001';
  end if;

  select allow_negative_stock into v_allow from inventory_settings where organization_id = new.organization_id;
  v_new_stock := v_prod.stock + new.quantity;
  if v_new_stock < 0 and not (coalesce(v_allow, false) and not v_prod.track_lots) then
    raise exception 'No hay existencias suficientes de % (disponible: %).', v_prod.name, v_prod.stock
      using errcode = 'P0001';
  end if;

  v_avg := v_prod.cost_avg;
  if new.quantity > 0 and new.unit_cost is not null and new.kind in ('entrada', 'compra') then
    if v_prod.stock <= 0 then
      v_avg := new.unit_cost;
    else
      v_avg := (v_prod.stock * v_prod.cost_avg + new.quantity * new.unit_cost) / (v_prod.stock + new.quantity);
    end if;
  end if;

  perform set_config('app.stock_write', '1', true);
  update products set stock = v_new_stock, cost_avg = round(v_avg, 4) where id = v_prod.id;
  perform set_config('app.stock_write', '0', true);

  new.balance_after := v_new_stock;
  return new;
end;
$$;
create trigger stock_movements_apply before insert on stock_movements
  for each row execute function stock_movements_apply();

-- ==========================================================================
-- Compras
-- ==========================================================================
create table purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  supplier_id uuid,
  invoice_number text,                           -- número de la factura del proveedor
  purchased_on date not null default current_date,
  notes text,
  total numeric(14, 2) not null default 0 check (total >= 0),
  status text not null default 'registrada' check (status in ('registrada', 'anulada')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (supplier_id, organization_id) references suppliers (id, organization_id)
);
create index purchases_idx on purchases (organization_id, purchased_on desc);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  purchase_id uuid not null,
  product_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 4) not null check (unit_cost >= 0),
  lot_code text,
  expires_on date,
  line_total numeric(14, 2) not null,
  foreign key (purchase_id, organization_id) references purchases (id, organization_id),
  foreign key (product_id, organization_id) references products (id, organization_id)
);
create index purchase_items_idx on purchase_items (organization_id, purchase_id);
create trigger purchase_items_immutable before update or delete on purchase_items
  for each row execute function block_mutation();

create or replace function purchases_guard()
returns trigger
language plpgsql
as $$
declare
  v_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Las compras no se borran: anúlalas con un motivo.' using errcode = 'P0001';
  end if;
  if old.status = 'anulada' then
    raise exception 'La compra ya está anulada.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - v_keys) <> (to_jsonb(old) - v_keys) then
    raise exception 'Una compra registrada no se modifica: anúlala y registra otra.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger purchases_guard before update or delete on purchases
  for each row execute function purchases_guard();

-- ==========================================================================
-- Series de documentos (listas para la numeración con resolución de la DIAN)
-- ==========================================================================
create table document_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  doc_type text not null default 'interno'
    check (doc_type in ('interno', 'factura_electronica', 'nota_credito')),
  prefix text not null default 'V',
  next_number int not null default 1 check (next_number >= 1),
  resolution_number text,                        -- resolución de numeración (DIAN)
  range_from int,
  range_to int,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, doc_type, prefix)
);

-- ==========================================================================
-- Caja
-- ==========================================================================
create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  status text not null default 'abierta' check (status in ('abierta', 'cerrada')),
  opened_at timestamptz not null default now(),
  opened_by uuid default auth.uid(),
  opening_amount numeric(14, 2) not null default 0 check (opening_amount >= 0),
  closed_at timestamptz,
  closed_by uuid,
  expected_cash numeric(14, 2),
  counted_cash numeric(14, 2),
  difference numeric(14, 2),
  notes text,
  unique (id, organization_id)
);
-- Una sola caja abierta a la vez por consultorio.
create unique index cash_sessions_one_open on cash_sessions (organization_id) where status = 'abierta';
create index cash_sessions_idx on cash_sessions (organization_id, opened_at desc);

create or replace function cash_sessions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las cajas no se borran.' using errcode = 'P0001';
  end if;
  if old.status = 'cerrada' then
    raise exception 'La caja ya está cerrada.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger cash_sessions_guard before update or delete on cash_sessions
  for each row execute function cash_sessions_guard();

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  session_id uuid not null,
  kind text not null check (kind in ('ingreso', 'egreso', 'devolucion')),
  method text not null default 'efectivo'
    check (method in ('efectivo', 'transferencia', 'tarjeta', 'nequi', 'daviplata', 'otro')),
  amount numeric(14, 2) not null check (amount > 0),
  concept text not null,
  sale_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (session_id, organization_id) references cash_sessions (id, organization_id)
);
create index cash_movements_idx on cash_movements (organization_id, session_id);
create trigger cash_movements_immutable before update or delete on cash_movements
  for each row execute function block_mutation();

-- ==========================================================================
-- Ventas internas
-- ==========================================================================
create table sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  series_id uuid not null,
  number int not null,
  full_number text not null,
  doc_type text not null default 'interno'
    check (doc_type in ('interno', 'factura_electronica', 'nota_credito')),
  sold_at timestamptz not null default now(),
  customer_tutor_id uuid,
  customer_name text,
  customer_doc_type text,                        -- CC, NIT, CE, pasaporte... (para la DIAN)
  customer_doc_number text,
  customer_email text,
  customer_address text,
  patient_id uuid,
  consultation_id uuid,
  notes text,
  subtotal numeric(14, 2) not null check (subtotal >= 0),     -- base gravable (sin IVA)
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14, 2) not null default 0 check (tax_total >= 0),
  total numeric(14, 2) not null check (total >= 0),
  paid_total numeric(14, 2) not null default 0 check (paid_total >= 0),
  balance numeric(14, 2) not null default 0 check (balance >= 0),
  status text not null default 'pagada' check (status in ('pagada', 'pendiente', 'anulada')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  -- Reservado para la facturación electrónica (el proveedor tecnológico los llena).
  einvoice_status text,
  einvoice_cufe text,
  einvoice_payload jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, series_id, number),
  foreign key (series_id, organization_id) references document_series (id, organization_id),
  foreign key (customer_tutor_id, organization_id) references tutors (id, organization_id),
  foreign key (patient_id, organization_id) references patients (id, organization_id),
  foreign key (consultation_id, organization_id) references consultations (id, organization_id)
);
create index sales_idx on sales (organization_id, sold_at desc);
create index sales_status_idx on sales (organization_id, status);
create index sales_customer_idx on sales (organization_id, customer_tutor_id);
create trigger sales_updated_at before update on sales
  for each row execute function set_updated_at();

create or replace function sales_guard()
returns trigger
language plpgsql
as $$
declare
  v_keys text[] := array['status', 'paid_total', 'balance', 'voided_at', 'voided_by', 'void_reason',
                         'einvoice_status', 'einvoice_cufe', 'einvoice_payload', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Las ventas no se borran: anúlalas con un motivo.' using errcode = 'P0001';
  end if;
  if old.status = 'anulada' then
    raise exception 'La venta está anulada.' using errcode = 'P0001';
  end if;
  -- sale_create arma la venta (encabezado, líneas y pagos) y al final fija los
  -- totales con esta marca, dentro de su misma transacción.
  if current_setting('app.sale_write', true) = '1' then
    return new;
  end if;
  if (to_jsonb(new) - v_keys) <> (to_jsonb(old) - v_keys) then
    raise exception 'Una venta registrada no se modifica: anúlala y registra otra.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger sales_guard before update or delete on sales
  for each row execute function sales_guard();

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sale_id uuid not null,
  product_id uuid,
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),   -- IVA incluido
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  tax_rate numeric(5, 2) not null default 0,
  base_amount numeric(14, 2) not null,                           -- sin IVA
  tax_amount numeric(14, 2) not null,
  line_total numeric(14, 2) not null,                            -- con IVA, ya con descuento
  unit_cost numeric(14, 4),                                      -- costo al vender (margen)
  sort_order int not null default 0,
  foreign key (sale_id, organization_id) references sales (id, organization_id),
  foreign key (product_id, organization_id) references products (id, organization_id)
);
create index sale_items_idx on sale_items (organization_id, sale_id);
create trigger sale_items_immutable before update or delete on sale_items
  for each row execute function block_mutation();

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sale_id uuid not null,
  session_id uuid,
  method text not null
    check (method in ('efectivo', 'transferencia', 'tarjeta', 'nequi', 'daviplata', 'otro')),
  amount numeric(14, 2) not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (sale_id, organization_id) references sales (id, organization_id),
  foreign key (session_id, organization_id) references cash_sessions (id, organization_id)
);
create index payments_sale_idx on payments (organization_id, sale_id);
create index payments_session_idx on payments (organization_id, session_id);
create trigger payments_immutable before update or delete on payments
  for each row execute function block_mutation();

-- ==========================================================================
-- Funciones internas (no las ejecutan los usuarios)
-- ==========================================================================

-- Verifica sesión, membresía y permiso; devuelve la organización.
create or replace function inv_require(p_permission text)
returns uuid
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org uuid := current_org();
begin
  if v_org is null or not has_permission(p_permission) then
    raise exception 'No tienes permiso para hacer esto.' using errcode = '42501';
  end if;
  if not is_membership_active() then
    raise exception 'Tu membresía venció: solo puedes consultar.' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- Saca existencias de un producto (primero los lotes que vencen antes).
create or replace function inv_consume(
  p_org uuid, p_product uuid, p_qty numeric, p_kind text,
  p_ref_type text, p_ref_id uuid, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod products%rowtype;
  v_lot record;
  v_remaining numeric := p_qty;
  v_take numeric;
begin
  select * into v_prod from products where id = p_product and organization_id = p_org;
  if not found then
    raise exception 'Producto no encontrado.' using errcode = 'P0001';
  end if;
  if v_prod.is_service then
    return;
  end if;

  if v_prod.track_lots then
    for v_lot in
      select id, quantity from stock_lots
      where organization_id = p_org and product_id = p_product and quantity > 0
      order by expires_on asc nulls last, created_at
    loop
      exit when v_remaining <= 0;
      v_take := least(v_lot.quantity, v_remaining);
      insert into stock_movements (organization_id, product_id, lot_id, kind, quantity, reason, ref_type, ref_id)
      values (p_org, p_product, v_lot.id, p_kind, -v_take, p_reason, p_ref_type, p_ref_id);
      v_remaining := v_remaining - v_take;
    end loop;
    if v_remaining > 0 then
      raise exception 'No hay existencias suficientes de % (disponible: %).', v_prod.name, v_prod.stock
        using errcode = 'P0001';
    end if;
  else
    insert into stock_movements (organization_id, product_id, kind, quantity, reason, ref_type, ref_id)
    values (p_org, p_product, p_kind, -p_qty, p_reason, p_ref_type, p_ref_id);
  end if;
end;
$$;

-- ==========================================================================
-- Inventario: funciones para los usuarios
-- ==========================================================================

-- AGREGAR existencias: se suman a las que ya hay.
create or replace function inv_add_stock(
  p_product uuid, p_quantity numeric, p_unit_cost numeric default null,
  p_lot_code text default null, p_expires_on date default null, p_reason text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('inventory.write');
  v_prod products%rowtype;
  v_lot uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a agregar debe ser mayor que cero.' using errcode = 'P0001';
  end if;
  select * into v_prod from products where id = p_product and organization_id = v_org;
  if not found then
    raise exception 'Producto no encontrado.' using errcode = 'P0001';
  end if;

  if v_prod.track_lots then
    if coalesce(btrim(p_lot_code), '') = '' then
      raise exception 'Indica el lote de %.', v_prod.name using errcode = 'P0001';
    end if;
    insert into stock_lots (organization_id, product_id, lot_code, expires_on)
    values (v_org, p_product, btrim(p_lot_code), p_expires_on)
    on conflict (organization_id, product_id, lot_code)
      do update set expires_on = coalesce(stock_lots.expires_on, excluded.expires_on)
    returning id into v_lot;
  end if;

  insert into stock_movements (organization_id, product_id, lot_id, kind, quantity, unit_cost, reason)
  values (v_org, p_product, v_lot, 'entrada', p_quantity, p_unit_cost, p_reason);

  return (select stock from products where id = p_product);
end;
$$;

-- Ajuste o merma (con motivo). p_delta con signo; la merma siempre resta.
create or replace function inv_adjust_stock(
  p_product uuid, p_delta numeric, p_kind text, p_reason text, p_lot_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('inventory.write');
begin
  if p_kind not in ('ajuste', 'merma') then
    raise exception 'Tipo de movimiento no válido.' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad no puede ser cero.' using errcode = 'P0001';
  end if;
  if p_kind = 'merma' and p_delta > 0 then
    raise exception 'Una merma resta existencias.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Indica el motivo.' using errcode = 'P0001';
  end if;

  insert into stock_movements (organization_id, product_id, lot_id, kind, quantity, reason)
  values (v_org, p_product, p_lot_id, p_kind, p_delta, btrim(p_reason));

  return (select stock from products where id = p_product and organization_id = v_org);
end;
$$;

-- Compra a proveedor con varios productos.
create or replace function inv_receive_purchase(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('inventory.write');
  v_purchase uuid;
  v_item jsonb;
  v_qty numeric;
  v_cost numeric;
  v_total numeric := 0;
  v_lot uuid;
  v_prod products%rowtype;
begin
  if jsonb_typeof(p_payload -> 'items') is distinct from 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Agrega al menos un producto a la compra.' using errcode = 'P0001';
  end if;

  select coalesce(sum(round((e ->> 'quantity')::numeric * coalesce((e ->> 'unit_cost')::numeric, 0), 2)), 0)
    into v_total from jsonb_array_elements(p_payload -> 'items') e;

  insert into purchases (organization_id, supplier_id, invoice_number, purchased_on, notes, total)
  values (
    v_org,
    nullif(p_payload ->> 'supplier_id', '')::uuid,
    nullif(btrim(p_payload ->> 'invoice_number'), ''),
    coalesce(nullif(p_payload ->> 'purchased_on', '')::date, current_date),
    nullif(btrim(p_payload ->> 'notes'), ''),
    v_total
  ) returning id into v_purchase;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items') loop
    v_qty := (v_item ->> 'quantity')::numeric;
    v_cost := coalesce((v_item ->> 'unit_cost')::numeric, 0);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Todas las cantidades deben ser mayores que cero.' using errcode = 'P0001';
    end if;
    select * into v_prod from products
      where id = (v_item ->> 'product_id')::uuid and organization_id = v_org;
    if not found then
      raise exception 'Producto no encontrado.' using errcode = 'P0001';
    end if;

    v_lot := null;
    if v_prod.track_lots then
      if coalesce(btrim(v_item ->> 'lot_code'), '') = '' then
        raise exception 'Indica el lote de %.', v_prod.name using errcode = 'P0001';
      end if;
      insert into stock_lots (organization_id, product_id, lot_code, expires_on)
      values (v_org, v_prod.id, btrim(v_item ->> 'lot_code'), nullif(v_item ->> 'expires_on', '')::date)
      on conflict (organization_id, product_id, lot_code)
        do update set expires_on = coalesce(stock_lots.expires_on, excluded.expires_on)
      returning id into v_lot;
    end if;

    insert into purchase_items (organization_id, purchase_id, product_id, quantity, unit_cost, lot_code, expires_on, line_total)
    values (v_org, v_purchase, v_prod.id, v_qty, v_cost, nullif(btrim(v_item ->> 'lot_code'), ''),
            nullif(v_item ->> 'expires_on', '')::date, round(v_qty * v_cost, 2));

    insert into stock_movements (organization_id, product_id, lot_id, kind, quantity, unit_cost, ref_type, ref_id)
    values (v_org, v_prod.id, v_lot, 'compra', v_qty, v_cost, 'purchase', v_purchase);
  end loop;

  return v_purchase;
end;
$$;

-- Anular una compra: devuelve las existencias (falla si ya se vendieron).
create or replace function inv_void_purchase(p_purchase uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('inventory.manage');
  v_p purchases%rowtype;
  v_m record;
begin
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escribe el motivo de la anulación (mínimo 5 caracteres).' using errcode = 'P0001';
  end if;
  select * into v_p from purchases where id = p_purchase and organization_id = v_org for update;
  if not found then
    raise exception 'Compra no encontrada.' using errcode = 'P0001';
  end if;
  if v_p.status = 'anulada' then
    raise exception 'La compra ya está anulada.' using errcode = 'P0001';
  end if;

  for v_m in
    select product_id, lot_id, quantity from stock_movements
    where organization_id = v_org and ref_type = 'purchase' and ref_id = p_purchase and kind = 'compra'
  loop
    insert into stock_movements (organization_id, product_id, lot_id, kind, quantity, reason, ref_type, ref_id)
    values (v_org, v_m.product_id, v_m.lot_id, 'anulacion_compra', -v_m.quantity,
            'Anulación de compra', 'purchase', p_purchase);
  end loop;

  update purchases
     set status = 'anulada', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_purchase;
end;
$$;

-- Descontar del inventario lo usado en una consulta.
create or replace function inv_use_in_consultation(p_consultation uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('inventory.write');
  v_item jsonb;
  v_qty numeric;
begin
  if not exists (select 1 from consultations where id = p_consultation and organization_id = v_org) then
    raise exception 'Consulta no encontrada.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige al menos un producto.' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Todas las cantidades deben ser mayores que cero.' using errcode = 'P0001';
    end if;
    perform inv_consume(v_org, (v_item ->> 'product_id')::uuid, v_qty, 'uso_consulta',
                        'consultation', p_consultation, 'Uso en consulta');
  end loop;
end;
$$;

-- ==========================================================================
-- Caja
-- ==========================================================================
create or replace function cash_open(p_opening numeric, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('cash.manage');
  v_id uuid;
begin
  if p_opening is null or p_opening < 0 then
    raise exception 'El monto inicial no es válido.' using errcode = 'P0001';
  end if;
  if exists (select 1 from cash_sessions where organization_id = v_org and status = 'abierta') then
    raise exception 'Ya hay una caja abierta. Ciérrala antes de abrir otra.' using errcode = 'P0001';
  end if;
  insert into cash_sessions (organization_id, opening_amount, notes)
  values (v_org, p_opening, nullif(btrim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function cash_add_movement(p_kind text, p_method text, p_amount numeric, p_concept text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('cash.manage');
  v_session uuid;
  v_id uuid;
begin
  if p_kind not in ('ingreso', 'egreso') then
    raise exception 'Tipo de movimiento no válido.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El valor debe ser mayor que cero.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_concept), '') = '' then
    raise exception 'Escribe el concepto.' using errcode = 'P0001';
  end if;
  select id into v_session from cash_sessions where organization_id = v_org and status = 'abierta';
  if v_session is null then
    raise exception 'Abre la caja primero.' using errcode = 'P0001';
  end if;
  insert into cash_movements (organization_id, session_id, kind, method, amount, concept)
  values (v_org, v_session, p_kind, coalesce(p_method, 'efectivo'), p_amount, btrim(p_concept))
  returning id into v_id;
  return v_id;
end;
$$;

-- Totales de una caja: lo cobrado por medio de pago y el efectivo esperado.
create or replace function cash_session_totals(p_session uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_s cash_sessions%rowtype;
  v_pay jsonb;
  v_ref jsonb;
  v_cash_in numeric;
  v_ing numeric;
  v_egr numeric;
  v_dev numeric;
begin
  if v_org is null or not (has_permission('sales.read') or has_permission('sales.write') or has_permission('cash.manage')) then
    raise exception 'No tienes permiso para hacer esto.' using errcode = '42501';
  end if;
  select * into v_s from cash_sessions where id = p_session and organization_id = v_org;
  if not found then
    raise exception 'Caja no encontrada.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_pay
    from (select method, sum(amount) total from payments
          where organization_id = v_org and session_id = p_session group by method) t;
  select coalesce(jsonb_object_agg(method, total), '{}'::jsonb) into v_ref
    from (select method, sum(amount) total from cash_movements
          where organization_id = v_org and session_id = p_session and kind = 'devolucion' group by method) t;

  select coalesce(sum(amount), 0) into v_cash_in from payments
    where organization_id = v_org and session_id = p_session and method = 'efectivo';
  select coalesce(sum(amount), 0) into v_ing from cash_movements
    where organization_id = v_org and session_id = p_session and kind = 'ingreso' and method = 'efectivo';
  select coalesce(sum(amount), 0) into v_egr from cash_movements
    where organization_id = v_org and session_id = p_session and kind = 'egreso' and method = 'efectivo';
  select coalesce(sum(amount), 0) into v_dev from cash_movements
    where organization_id = v_org and session_id = p_session and kind = 'devolucion' and method = 'efectivo';

  return jsonb_build_object(
    'opening', v_s.opening_amount,
    'payments_by_method', v_pay,
    'refunds_by_method', v_ref,
    'cash_sales', v_cash_in,
    'cash_in', v_ing,
    'cash_out', v_egr,
    'cash_refunds', v_dev,
    'expected_cash', v_s.opening_amount + v_cash_in + v_ing - v_egr - v_dev
  );
end;
$$;

create or replace function cash_close(p_session uuid, p_counted numeric, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('cash.manage');
  v_s cash_sessions%rowtype;
  v_totals jsonb;
  v_expected numeric;
begin
  if p_counted is null or p_counted < 0 then
    raise exception 'Escribe el efectivo contado.' using errcode = 'P0001';
  end if;
  select * into v_s from cash_sessions where id = p_session and organization_id = v_org for update;
  if not found then
    raise exception 'Caja no encontrada.' using errcode = 'P0001';
  end if;
  if v_s.status <> 'abierta' then
    raise exception 'La caja ya está cerrada.' using errcode = 'P0001';
  end if;

  v_totals := cash_session_totals(p_session);
  v_expected := (v_totals ->> 'expected_cash')::numeric;

  update cash_sessions
     set status = 'cerrada', closed_at = now(), closed_by = auth.uid(),
         expected_cash = v_expected, counted_cash = p_counted,
         difference = p_counted - v_expected, notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_session;

  return v_totals || jsonb_build_object('counted_cash', p_counted, 'difference', p_counted - v_expected);
end;
$$;

-- ==========================================================================
-- Ventas
-- ==========================================================================
create or replace function sale_create(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('sales.write');
  v_series document_series%rowtype;
  v_sale uuid := gen_random_uuid();
  v_session uuid;
  v_item jsonb;
  v_pay jsonb;
  v_prod products%rowtype;
  v_tutor tutors%rowtype;
  v_qty numeric;
  v_price numeric;
  v_disc numeric;
  v_rate numeric;
  v_gross numeric;
  v_base numeric;
  v_tax numeric;
  v_sub numeric := 0;
  v_tax_total numeric := 0;
  v_disc_total numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_amount numeric;
  v_order int := 0;
  v_name text;
  v_doc_type text;
  v_doc_number text;
  v_email text;
  v_address text;
begin
  if jsonb_typeof(p_payload -> 'items') is distinct from 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'Agrega al menos un producto o servicio a la venta.' using errcode = 'P0001';
  end if;

  -- Cliente
  v_name := nullif(btrim(p_payload ->> 'customer_name'), '');
  v_doc_type := nullif(btrim(p_payload ->> 'customer_doc_type'), '');
  v_doc_number := nullif(btrim(p_payload ->> 'customer_doc_number'), '');
  v_email := nullif(btrim(p_payload ->> 'customer_email'), '');
  v_address := nullif(btrim(p_payload ->> 'customer_address'), '');
  if nullif(p_payload ->> 'customer_tutor_id', '') is not null then
    select * into v_tutor from tutors
      where id = (p_payload ->> 'customer_tutor_id')::uuid and organization_id = v_org;
    if not found then
      raise exception 'Tutor no encontrado.' using errcode = 'P0001';
    end if;
    v_name := coalesce(v_name, v_tutor.full_name);
    v_doc_number := coalesce(v_doc_number, v_tutor.document_number);
    v_doc_type := coalesce(v_doc_type, case when v_tutor.document_number is not null then 'CC' end);
    v_email := coalesce(v_email, v_tutor.email);
    v_address := coalesce(v_address, v_tutor.address);
  end if;

  -- Serie y consecutivo
  select * into v_series from document_series
    where organization_id = v_org and doc_type = 'interno' and is_active
    order by prefix limit 1 for update;
  if not found then
    raise exception 'No hay una serie de documentos activa.' using errcode = 'P0001';
  end if;
  update document_series set next_number = next_number + 1 where id = v_series.id;

  -- Encabezado provisional (los totales se ajustan al final por la marca)
  insert into sales (id, organization_id, series_id, number, full_number, customer_tutor_id, customer_name,
                     customer_doc_type, customer_doc_number, customer_email, customer_address,
                     patient_id, consultation_id, notes, subtotal, total, status)
  values (v_sale, v_org, v_series.id, v_series.next_number,
          v_series.prefix || '-' || lpad(v_series.next_number::text, 4, '0'),
          nullif(p_payload ->> 'customer_tutor_id', '')::uuid, v_name, v_doc_type, v_doc_number, v_email, v_address,
          nullif(p_payload ->> 'patient_id', '')::uuid, nullif(p_payload ->> 'consultation_id', '')::uuid,
          nullif(btrim(p_payload ->> 'notes'), ''), 0, 0, 'pendiente');

  -- Líneas
  for v_item in select * from jsonb_array_elements(p_payload -> 'items') loop
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Todas las cantidades deben ser mayores que cero.' using errcode = 'P0001';
    end if;
    v_prod := null;
    if nullif(v_item ->> 'product_id', '') is not null then
      select * into v_prod from products
        where id = (v_item ->> 'product_id')::uuid and organization_id = v_org and is_active;
      if not found then
        raise exception 'Un producto de la venta no existe o está inactivo.' using errcode = 'P0001';
      end if;
    end if;

    v_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_prod.sale_price, 0);
    v_rate := coalesce(nullif(v_item ->> 'tax_rate', '')::numeric, v_prod.tax_rate, 0);
    v_disc := coalesce(nullif(v_item ->> 'discount', '')::numeric, 0);
    if v_price < 0 or v_disc < 0 or v_rate < 0 or v_rate > 100 then
      raise exception 'Hay valores no válidos en una línea de la venta.' using errcode = 'P0001';
    end if;
    v_gross := round(v_qty * v_price - v_disc, 2);
    if v_gross < 0 then
      raise exception 'El descuento no puede superar el valor de la línea.' using errcode = 'P0001';
    end if;
    v_base := round(v_gross / (1 + v_rate / 100), 2);
    v_tax := v_gross - v_base;

    if v_prod.id is null and coalesce(btrim(v_item ->> 'description'), '') = '' then
      raise exception 'Escribe la descripción de la línea.' using errcode = 'P0001';
    end if;

    v_order := v_order + 1;
    insert into sale_items (organization_id, sale_id, product_id, description, quantity, unit_price, discount,
                            tax_rate, base_amount, tax_amount, line_total, unit_cost, sort_order)
    values (v_org, v_sale, v_prod.id, coalesce(nullif(btrim(v_item ->> 'description'), ''), v_prod.name),
            v_qty, v_price, v_disc, v_rate, v_base, v_tax, v_gross, v_prod.cost_avg, v_order);

    if v_prod.id is not null and not v_prod.is_service then
      perform inv_consume(v_org, v_prod.id, v_qty, 'venta', 'sale', v_sale, 'Venta');
    end if;

    v_sub := v_sub + v_base;
    v_tax_total := v_tax_total + v_tax;
    v_disc_total := v_disc_total + v_disc;
    v_total := v_total + v_gross;
  end loop;

  -- Pagos
  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    for v_pay in select * from jsonb_array_elements(p_payload -> 'payments') loop
      v_amount := (v_pay ->> 'amount')::numeric;
      if v_amount is null or v_amount <= 0 then
        continue;
      end if;
      v_paid := v_paid + v_amount;
    end loop;
  end if;
  if v_paid > v_total then
    raise exception 'Los pagos (%) superan el total de la venta (%).', v_paid, v_total using errcode = 'P0001';
  end if;
  if v_paid > 0 then
    select id into v_session from cash_sessions where organization_id = v_org and status = 'abierta';
    if v_session is null then
      raise exception 'Abre la caja antes de cobrar.' using errcode = 'P0001';
    end if;
    for v_pay in select * from jsonb_array_elements(p_payload -> 'payments') loop
      v_amount := (v_pay ->> 'amount')::numeric;
      if v_amount is null or v_amount <= 0 then
        continue;
      end if;
      insert into payments (organization_id, sale_id, session_id, method, amount, reference)
      values (v_org, v_sale, v_session, coalesce(nullif(v_pay ->> 'method', ''), 'efectivo'), v_amount,
              nullif(btrim(v_pay ->> 'reference'), ''));
    end loop;
  end if;
  if v_paid < v_total and v_name is null then
    raise exception 'Para dejar un saldo pendiente indica el cliente.' using errcode = 'P0001';
  end if;

  perform set_config('app.sale_write', '1', true);
  update sales
     set subtotal = v_sub, discount_total = v_disc_total, tax_total = v_tax_total, total = v_total,
         paid_total = v_paid, balance = v_total - v_paid,
         status = case when v_paid >= v_total then 'pagada' else 'pendiente' end
   where id = v_sale;
  perform set_config('app.sale_write', '0', true);
  return v_sale;
end;
$$;

-- Abono a una venta pendiente.
create or replace function sale_add_payment(p_sale uuid, p_method text, p_amount numeric, p_reference text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('sales.write');
  v_s sales%rowtype;
  v_session uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El valor del abono debe ser mayor que cero.' using errcode = 'P0001';
  end if;
  select * into v_s from sales where id = p_sale and organization_id = v_org for update;
  if not found then
    raise exception 'Venta no encontrada.' using errcode = 'P0001';
  end if;
  if v_s.status <> 'pendiente' then
    raise exception 'Esta venta no tiene saldo pendiente.' using errcode = 'P0001';
  end if;
  if p_amount > v_s.balance then
    raise exception 'El abono supera el saldo pendiente (%).', v_s.balance using errcode = 'P0001';
  end if;
  select id into v_session from cash_sessions where organization_id = v_org and status = 'abierta';
  if v_session is null then
    raise exception 'Abre la caja antes de cobrar.' using errcode = 'P0001';
  end if;

  insert into payments (organization_id, sale_id, session_id, method, amount, reference)
  values (v_org, p_sale, v_session, coalesce(nullif(p_method, ''), 'efectivo'), p_amount, nullif(btrim(p_reference), ''));

  update sales
     set paid_total = paid_total + p_amount, balance = balance - p_amount,
         status = case when balance - p_amount <= 0 then 'pagada' else 'pendiente' end
   where id = p_sale;
end;
$$;

-- Anular una venta: devuelve el inventario y registra la devolución de lo cobrado.
create or replace function sale_void(p_sale uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := inv_require('cash.manage');
  v_s sales%rowtype;
  v_session uuid;
  v_m record;
  v_p record;
begin
  if coalesce(length(btrim(p_reason)), 0) < 5 then
    raise exception 'Escribe el motivo de la anulación (mínimo 5 caracteres).' using errcode = 'P0001';
  end if;
  select * into v_s from sales where id = p_sale and organization_id = v_org for update;
  if not found then
    raise exception 'Venta no encontrada.' using errcode = 'P0001';
  end if;
  if v_s.status = 'anulada' then
    raise exception 'La venta ya está anulada.' using errcode = 'P0001';
  end if;

  if v_s.paid_total > 0 then
    select id into v_session from cash_sessions where organization_id = v_org and status = 'abierta';
    if v_session is null then
      raise exception 'Abre la caja para anular una venta que tiene pagos (se registra la devolución).'
        using errcode = 'P0001';
    end if;
    for v_p in
      select method, sum(amount) as amount from payments
      where organization_id = v_org and sale_id = p_sale group by method
    loop
      insert into cash_movements (organization_id, session_id, kind, method, amount, concept, sale_id)
      values (v_org, v_session, 'devolucion', v_p.method, v_p.amount,
              'Devolución por anulación de la venta ' || v_s.full_number, p_sale);
    end loop;
  end if;

  for v_m in
    select product_id, lot_id, quantity from stock_movements
    where organization_id = v_org and ref_type = 'sale' and ref_id = p_sale and kind = 'venta'
  loop
    insert into stock_movements (organization_id, product_id, lot_id, kind, quantity, reason, ref_type, ref_id)
    values (v_org, v_m.product_id, v_m.lot_id, 'anulacion_venta', -v_m.quantity,
            'Anulación de la venta ' || v_s.full_number, 'sale', p_sale);
  end loop;

  update sales
     set status = 'anulada', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_sale;
end;
$$;

-- ==========================================================================
-- RLS: los usuarios leen; las escrituras de existencias, compras, ventas y
-- caja pasan por las funciones de arriba.
-- ==========================================================================
select _apply_tenant_rls('inventory_settings', 'inventory.read', 'inventory.manage');
select _apply_tenant_rls('suppliers', 'inventory.read', 'inventory.write');
select _apply_tenant_rls('products', 'inventory.read', 'inventory.manage');

-- Quien vende necesita ver los productos aunque no administre el inventario.
drop policy if exists products_select on products;
create policy products_select on products for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('inventory.read')) or (select has_permission('sales.write')))
  );

alter table stock_lots enable row level security;
create policy stock_lots_select on stock_lots for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('inventory.read')) or (select has_permission('sales.write')))
  );

alter table stock_movements enable row level security;
create policy stock_movements_select on stock_movements for select to authenticated
  using (organization_id = (select current_org()) and (select has_permission('inventory.read')));

alter table purchases enable row level security;
create policy purchases_select on purchases for select to authenticated
  using (organization_id = (select current_org()) and (select has_permission('inventory.read')));
alter table purchase_items enable row level security;
create policy purchase_items_select on purchase_items for select to authenticated
  using (organization_id = (select current_org()) and (select has_permission('inventory.read')));

alter table document_series enable row level security;
create policy document_series_select on document_series for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('sales.read')) or (select has_permission('sales.write')))
  );

alter table cash_sessions enable row level security;
create policy cash_sessions_select on cash_sessions for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('sales.read')) or (select has_permission('sales.write'))
         or (select has_permission('cash.manage')))
  );
alter table cash_movements enable row level security;
create policy cash_movements_select on cash_movements for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('sales.read')) or (select has_permission('sales.write'))
         or (select has_permission('cash.manage')))
  );

alter table sales enable row level security;
create policy sales_select on sales for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('sales.read')) or (select has_permission('sales.write')))
  );
alter table sale_items enable row level security;
create policy sale_items_select on sale_items for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('sales.read')) or (select has_permission('sales.write')))
  );
alter table payments enable row level security;
create policy payments_select on payments for select to authenticated
  using (
    organization_id = (select current_org())
    and ((select has_permission('sales.read')) or (select has_permission('sales.write')))
  );

-- ==========================================================================
-- Datos por defecto (cada organización recibe su propia copia)
-- ==========================================================================
create or replace function seed_inventory_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into inventory_settings (organization_id) values (p_org) on conflict (organization_id) do nothing;
  insert into document_series (organization_id, doc_type, prefix, next_number)
  values (p_org, 'interno', 'V', 1)
  on conflict (organization_id, doc_type, prefix) do nothing;
end;
$$;

create or replace function trg_org_inventory_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_inventory_defaults(new.id);
  return new;
end;
$$;
create trigger organizations_inventory_defaults after insert on organizations
  for each row execute function trg_org_inventory_defaults();

select seed_inventory_defaults(id) from organizations;

-- Las funciones internas no las ejecutan los usuarios.
revoke execute on function seed_inventory_defaults(uuid) from public, anon, authenticated;
revoke execute on function trg_org_inventory_defaults() from public, anon, authenticated;
revoke execute on function inv_consume(uuid, uuid, numeric, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function inv_require(text) from public, anon, authenticated;
