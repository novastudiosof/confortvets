-- ConfortVets — almacenamiento privado de archivos.
-- Ruta: <organization_id>/<tipo>/<uuid>.<ext>
-- Las subidas y borrados los hace el servidor con la llave de servicio (para
-- aplicar la cuota y comprimir imágenes); los usuarios solo pueden leer
-- archivos de su propia organización.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-files', 'org-files', false, 5242880,
  array['application/pdf', 'image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists org_files_select on storage.objects;
create policy org_files_select on storage.objects for select to authenticated
  using (
    bucket_id = 'org-files'
    and (storage.foldername(name))[1] = (select current_org())::text
    and (select is_org_member())
  );

-- Verifica que una autorización firmada no haya sido alterada: recalcula la
-- huella con los datos guardados y la compara con la registrada al firmar.
create or replace function consent_hash_matches(p_consent uuid)
returns boolean
language sql
security invoker
stable
as $$
  select c.content_hash is not null
    and c.content_hash = encode(sha256(convert_to(
      c.title || E'\n' || c.body || E'\n' || coalesce(c.procedure_description, '')
      || E'\n' || c.signer_name || E'\n' || c.signer_document
      || E'\n' || to_char(c.signed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'UTF8')), 'hex')
  from consents c
  where c.id = p_consent and c.status = 'firmada'
$$;
