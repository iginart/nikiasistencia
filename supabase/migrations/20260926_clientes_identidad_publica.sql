-- Identidad publica de clientas para reservas online.
-- Separa identidad verificada (email) de los datos operativos de agenda_clientes.

create or replace function public.niki_normalizar_telefono_ar(p_valor text)
returns text
language plpgsql
immutable
as $$
declare
  v text := regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g');
  i integer;
begin
  if v = '' then
    return null;
  end if;

  if left(v, 4) = '0054' then
    v := substr(v, 5);
  elsif left(v, 2) = '54' then
    v := substr(v, 3);
  end if;

  if left(v, 1) = '0' then
    v := substr(v, 2);
  end if;

  -- Formato internacional movil: 9 + codigo de area + numero.
  if length(v) = 11 and left(v, 1) = '9' then
    v := substr(v, 2);
  end if;

  -- Formato nacional historico: codigo de area + 15 + numero.
  if length(v) = 12 then
    for i in 3..5 loop
      if substr(v, i, 2) = '15' then
        v := substr(v, 1, i - 1) || substr(v, i + 2);
        exit;
      end if;
    end loop;
  end if;

  -- "15 xxxx xxxx" sin codigo de area es ambiguo y no se normaliza.
  if length(v) = 10 and left(v, 2) = '15' then
    return null;
  end if;

  if length(v) <> 10 then
    return null;
  end if;

  return '+549' || v;
end;
$$;

alter table if exists public.agenda_clientes
  add column if not exists auth_user_id uuid,
  add column if not exists email_normalizado text,
  add column if not exists telefono_normalizado text,
  add column if not exists email_verificado_en timestamptz;

update public.agenda_clientes
set
  email_normalizado = nullif(lower(trim(email)), ''),
  telefono_normalizado = public.niki_normalizar_telefono_ar(telefono)
where
  email_normalizado is distinct from nullif(lower(trim(email)), '')
  or telefono_normalizado is distinct from public.niki_normalizar_telefono_ar(telefono);

create or replace function public.agenda_clientes_normalizar_identidad()
returns trigger
language plpgsql
as $$
begin
  new.email_normalizado := nullif(lower(trim(new.email)), '');
  new.telefono_normalizado := public.niki_normalizar_telefono_ar(new.telefono);
  return new;
end;
$$;

drop trigger if exists trg_agenda_clientes_normalizar_identidad on public.agenda_clientes;
create trigger trg_agenda_clientes_normalizar_identidad
before insert or update of email, telefono
on public.agenda_clientes
for each row
execute function public.agenda_clientes_normalizar_identidad();

create unique index if not exists ux_agenda_clientes_auth_user_id
  on public.agenda_clientes(auth_user_id)
  where auth_user_id is not null;

create index if not exists ix_agenda_clientes_email_normalizado
  on public.agenda_clientes(email_normalizado);

create index if not exists ix_agenda_clientes_telefono_normalizado
  on public.agenda_clientes(telefono_normalizado);
