-- Ejecutar antes de reemplazar App.jsx. No recalcula informes históricos.
begin;

alter table public.informes_diarios
  add column if not exists saldo_agendapro numeric(16,2),
  add column if not exists explicacion_diferencia_caja text;

comment on column public.informes_diarios.saldo_agendapro is
  'Saldo en efectivo según AgendaPro al mismo cierre. NULL = no informado; cero es un saldo válido.';
comment on column public.informes_diarios.explicacion_diferencia_caja is
  'Explicación obligatoria al enviar si abs(efectivo_caja - saldo_agendapro) supera $1.000.';

-- El autoguardado admite borradores incompletos. Los históricos sin saldo
-- AgendaPro permanecen sin dato; no se interpretan como saldo cero.
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.informes_diarios'::regclass
      and conname = 'informes_diarios_conciliacion_caja_ck'
  ) then
    alter table public.informes_diarios
      add constraint informes_diarios_conciliacion_caja_ck check (
        estado is distinct from 'enviado'
        or saldo_agendapro is null
        or (
          efectivo_caja is not null
          and saldo_agendapro <> 'NaN'::numeric
          and efectivo_caja <> 'NaN'::numeric
          and (
            abs(efectivo_caja - saldo_agendapro) <= 1000
            or coalesce(explicacion_diferencia_caja, '') ~ '[^[:space:]]'
          )
        )
      ) not valid;
  end if;
end;
$migration$;

create or replace function public.validar_conciliacion_caja_informe()
returns trigger language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_nuevo_envio boolean := false;
begin
  if new.estado = 'enviado' then
    if tg_op = 'INSERT' then
      v_nuevo_envio := true;
    else
      v_nuevo_envio := old.estado is distinct from 'enviado';
    end if;
    if v_nuevo_envio and (new.saldo_agendapro is null or new.efectivo_caja is null) then
      raise exception using errcode = '23514',
        message = 'Completá el saldo real en efectivo y el saldo según AgendaPro antes de enviar el informe.';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists validar_conciliacion_caja_informe_trg on public.informes_diarios;
create trigger validar_conciliacion_caja_informe_trg
  before insert or update on public.informes_diarios
  for each row execute function public.validar_conciliacion_caja_informe();

notify pgrst, 'reload schema';
commit;
