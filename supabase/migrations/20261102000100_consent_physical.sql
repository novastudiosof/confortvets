-- ConfortVets — firma "en físico" sin copia adjunta.
-- Permite registrar que el tutor ya firmó la autorización en papel aunque no
-- se suba una foto o PDF. Es evidencia más débil que la firma en pantalla o
-- el documento adjunto, y así queda anotado en la autorización.

alter table consents drop constraint if exists consents_signature_method_check;
alter table consents add constraint consents_signature_method_check
  check (signature_method in ('pantalla', 'archivo', 'fisico'));

create or replace function consents_guard()
returns trigger
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_void_keys text[] := array['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Las autorizaciones no se borran: anúlalas con un motivo.' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pendiente' then
      raise exception 'Una autorización nueva siempre empieza pendiente.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if old.status in ('firmada', 'rechazada') then
    if new.status <> 'anulada'
       or (to_jsonb(new) - v_void_keys) <> (to_jsonb(old) - v_void_keys) then
      raise exception 'La autorización ya está resuelta y no se puede modificar.' using errcode = 'P0001';
    end if;
  end if;
  if old.status = 'anulada' then
    raise exception 'La autorización está anulada.' using errcode = 'P0001';
  end if;

  if new.status = 'anulada' then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'Indica el motivo de la anulación.' using errcode = 'P0001';
    end if;
    new.voided_at := now();
    new.voided_by := v_user;
    return new;
  end if;

  if old.status = 'pendiente' and new.status = 'firmada' then
    if v_user is not null and not has_permission('consents.sign') then
      raise exception 'No tienes permiso para registrar firmas.' using errcode = '42501';
    end if;
    if coalesce(btrim(new.signer_name), '') = '' or coalesce(btrim(new.signer_document), '') = '' then
      raise exception 'Faltan el nombre y la cédula de quien firma.' using errcode = 'P0001';
    end if;
    if new.signature_method = 'pantalla' and new.signature_file_id is null then
      raise exception 'Falta la firma.' using errcode = 'P0001';
    end if;
    if new.signature_method = 'archivo' and new.upload_file_id is null then
      raise exception 'Falta el archivo firmado.' using errcode = 'P0001';
    end if;
    if new.signature_method is null then
      raise exception 'Indica cómo se firmó.' using errcode = 'P0001';
    end if;
    new.signed_at := now();
    new.content_hash := encode(sha256(convert_to(
      new.title || E'\n' || new.body || E'\n' || coalesce(new.procedure_description, '')
      || E'\n' || new.signer_name || E'\n' || new.signer_document
      || E'\n' || to_char(new.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'UTF8')), 'hex');
  elsif old.status = 'pendiente' and new.status = 'rechazada' then
    if v_user is not null and not has_permission('consents.sign') then
      raise exception 'No tienes permiso para registrar esta respuesta.' using errcode = '42501';
    end if;
    new.signed_at := now();
  elsif old.status = 'pendiente' and new.status = 'pendiente' then
    -- Se puede ajustar el procedimiento mientras esté pendiente.
    null;
  end if;
  return new;
end;
$$;
