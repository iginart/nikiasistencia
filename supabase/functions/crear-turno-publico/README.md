# crear-turno-publico

Edge Function para crear reservas publicas desde `#/turnos`.

Despliegue:

```bash
supabase functions new crear-turno-publico
supabase functions deploy crear-turno-publico
```

La funcion usa `SUPABASE_SERVICE_ROLE_KEY` dentro de Supabase Edge Functions. No debe exponerse en React.
