# consultar-turnos-cliente

Edge Function para consultar proximos turnos desde el portal publico `#/turnos`.

Despliegue:

```bash
supabase functions new consultar-turnos-cliente
supabase functions deploy consultar-turnos-cliente
```

La funcion solo lee datos y no permite cancelar ni modificar turnos.
