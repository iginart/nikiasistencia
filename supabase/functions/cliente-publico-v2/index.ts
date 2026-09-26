const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PublicError = Error & { status?: number };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function publicError(message: string, status = 400): never {
  const error = new Error(message) as PublicError;
  error.status = status;
  throw error;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

async function db(path: string, options: { method?: string; body?: unknown; prefer?: string } = {}) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (options.prefer !== "") headers.Prefer = options.prefer || "return=representation";

  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Error Supabase ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function first(path: string) {
  const rows = await db(path);
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function getAuthUser(req: Request) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Faltan variables de Supabase.");
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) publicError("Necesitás verificar tu email para continuar.", 401);

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) publicError("Tu sesión venció. Verificá nuevamente tu email.", 401);
  const user = await res.json();
  const email = normalizeEmail(user?.email);
  if (!user?.id || !email) publicError("No pudimos validar tu identidad.", 401);
  return { id: String(user.id), email };
}

async function findClient(authUserId: string, email: string) {
  const byAuth = await first(
    `agenda_clientes?select=id,nombre,apellido,email,telefono,email_normalizado,telefono_normalizado,auth_user_id&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`
  );
  if (byAuth?.id) return byAuth;

  const byNormalizedEmail = await first(
    `agenda_clientes?select=id,nombre,apellido,email,telefono,email_normalizado,telefono_normalizado,auth_user_id&email_normalizado=eq.${encodeURIComponent(email)}&order=id.asc&limit=1`
  );
  if (byNormalizedEmail?.id) return byNormalizedEmail;

  return await first(
    `agenda_clientes?select=id,nombre,apellido,email,telefono,email_normalizado,telefono_normalizado,auth_user_id&email=ilike.${encodeURIComponent(email)}&order=id.asc&limit=1`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Metodo no permitido." }, 405);

  try {
    const authUser = await getAuthUser(req);
    const client = await findClient(authUser.id, authUser.email);

    if (!client?.id) {
      return jsonResponse({
        ok: true,
        email: authUser.email,
        cliente_encontrado: false,
        cliente: null,
      });
    }

    if (client.auth_user_id && String(client.auth_user_id) !== authUser.id) {
      publicError("Ese email ya está asociado a otra identidad.", 409);
    }

    const verifiedAt = new Date().toISOString();
    const updated = await db(`agenda_clientes?id=eq.${client.id}`, {
      method: "PATCH",
      body: {
        auth_user_id: authUser.id,
        email: authUser.email,
        email_normalizado: authUser.email,
        email_verificado_en: verifiedAt,
      },
    });
    const saved = Array.isArray(updated) ? updated[0] || client : updated || client;

    const nombreCompleto = [cleanText(saved.nombre), cleanText(saved.apellido)].filter(Boolean).join(" ");
    return jsonResponse({
      ok: true,
      email: authUser.email,
      cliente_encontrado: true,
      cliente: {
        id: saved.id,
        nombre: nombreCompleto,
        telefono: cleanText(saved.telefono),
        telefono_normalizado: cleanText(saved.telefono_normalizado),
        email: authUser.email,
        email_verificado_en: saved.email_verificado_en || verifiedAt,
      },
    });
  } catch (error) {
    const publicErr = error as PublicError;
    const status = publicErr.status || 500;
    const message = status >= 500 ? "No pudimos recuperar tus datos. Intentá nuevamente." : publicErr.message;
    console.error(error);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
