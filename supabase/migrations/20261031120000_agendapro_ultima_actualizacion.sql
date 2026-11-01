-- Metadatos pequeños de carga. No cambia ni refresca ventas, comisiones ni cachés.
begin;
create index if not exists agenda_sync_runs_success_finished_idx
  on public.agenda_sync_runs(finished_at desc, id desc)
  where status = 'success' and finished_at is not null;
create index if not exists agenda_expense_sync_runs_synced_idx
  on public.agenda_expense_sync_runs(synced_at desc, id desc);

create or replace function public.niki_agendapro_actualizacion()
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $function$
  with domains(key, flag) as (values
    ('ventas'::text, null::text),
    ('dashboard', 'dashboard_refreshed'),
    ('comisiones', 'shadow_refreshed')
  ), latest as (
    select id,status,metadata
    from public.agenda_sync_runs
    order by id desc limit 1
  ), stamps as (
    select d.key, jsonb_build_object(
      'actualizado_en', r.finished_at,
      'desde', r.date_from,
      'hasta', r.date_to,
      'estado', case
        when l.id is null then 'sin_registro'
        when l.status = 'running' then 'en_curso'
        when l.status = 'error' then 'error'
        when d.flag is not null and l.metadata->>d.flag = 'false'
          and l.metadata->>(case d.flag when 'dashboard_refreshed' then 'dashboard_refresh_attempted' else 'shadow_refresh_attempted' end) = 'true' then 'pendiente'
        else 'ok' end
    ) as value
    from domains d
    left join lateral (
      select finished_at,date_from,date_to
      from public.agenda_sync_runs
      where status='success' and finished_at is not null
        and (d.flag is null or metadata->>d.flag='true')
      order by finished_at desc,id desc limit 1
    ) r on true
    left join latest l on true
    union all
    select 'gastos', jsonb_build_object(
      'actualizado_en', r.synced_at,'desde',r.date_from,'hasta',r.date_to,
      'estado',case when r.synced_at is null then 'sin_registro' else 'ok' end
    ) from (values(1)) x(n)
    left join lateral (
      select synced_at,date_from,date_to from public.agenda_expense_sync_runs
      order by synced_at desc,id desc limit 1
    ) r on true
  )
  select jsonb_build_object('version',1,'fuentes',jsonb_object_agg(key,value)) from stamps;
$function$;
-- Sólo expone fechas/estados globales: nunca filas de ventas, importes, locales,
-- usuarios ni mensajes de error. No da acceso directo a las tablas de control.
revoke all on function public.niki_agendapro_actualizacion() from public;
grant execute on function public.niki_agendapro_actualizacion() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
