# cliente-publico

Devuelve el perfil de la clienta asociado al usuario autenticado de Supabase Auth.

- Requiere un JWT de Supabase Auth en `Authorization: Bearer ...`.
- Si encuentra una fila previa por email, la vincula a `auth_user_id`.
- No crea una clienta nueva: la creación queda en `crear-turno-publico` al confirmar la primera reserva.

Despliegue:

```bash
supabase functions deploy cliente-publico
```

Para usar código OTP en lugar de magic link, configurá en Supabase Auth > Email Templates el template de Magic Link para mostrar `{{ .Token }}`.
