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

function decodeJwtPayload(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function getAuthUser(req: Request) {
  // Esta funcion se despliega con verify_jwt=true (valor por defecto).
  // Supabase ya valido firma y vigencia del JWT antes de ejecutar este handler.
  // Solo leemos las claims verificadas para identificar a la clienta.
  const token = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) {
    publicError("Necesitás verificar tu email para continuar.", 401);
  }

  const claims = decodeJwtPayload(token);
  const id = cleanText(claims?.sub);
  const email = cleanText(claims?.email).toLowerCase();
  const role = cleanText(claims?.role);
  const exp = Number(claims?.exp || 0);
  const now = Math.floor(Date.now() / 1000);

  if (!id || !email || role !== "authenticated" || !exp || exp <= now) {
    publicError("Tu sesión venció. Verificá nuevamente tu email.", 401);
  }

  return { id, email };
}

async function findByAuthUserId(authUserId: string) {
  const rows = await db(`agenda_clientes?select=*&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function findByEmail(email: string) {
  const rows = await db(`agenda_clientes?select=*&email_normalizado=eq.${encodeURIComponent(email)}&order=id.asc&limit=3`);
  return Array.isArray(rows) ? rows : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Método no permitido." }, 405);

  try {
    const authUser = await getAuthUser(req);
    let client = await findByAuthUserId(authUser.id);

    if (!client?.id) {
      const emailMatches = await findByEmail(authUser.email);

      if (emailMatches.length > 1) {
        publicError("Encontramos más de un perfil con este email. Para evitar unir clientes incorrectamente, el perfil debe revisarse antes de continuar.", 409);
      }

      if (emailMatches.length === 1) {
        client = emailMatches[0];
        if (client.auth_user_id && String(client.auth_user_id) !== authUser.id) {
          publicError("Este email ya está asociado a otra identidad.", 409);
        }

        const updated = await db(`agenda_clientes?id=eq.${client.id}`, {
          method: "PATCH",
          body: {
            auth_user_id: authUser.id,
            email: authUser.email,
            email_normalizado: authUser.email,
            email_verificado_en: new Date().toISOString(),
          },
        });
        client = Array.isArray(updated) ? updated[0] || client : updated || client;
      }
    }

    if (!client?.id) {
      return jsonResponse({ ok: true, email: authUser.email, cliente_encontrado: false, cliente: null });
    }

    const nombreCompleto = [cleanText(client.nombre), cleanText(client.apellido)].filter(Boolean).join(" ");
    return jsonResponse({
      ok: true,
      email: authUser.email,
      cliente_encontrado: true,
      cliente: {
        id: client.id,
        nombre: nombreCompleto,
        telefono: cleanText(client.telefono),
        telefono_normalizado: cleanText(client.telefono_normalizado),
        email: authUser.email,
        email_verificado_en: client.email_verificado_en || null,
      },
    });
  } catch (error) {
    const publicErr = error as PublicError;
    const status = publicErr.status || 500;
    const message = status >= 500 ? "No pudimos recuperar tus datos. Intentá nuevamente." : publicErr.message;
    console.error("cliente-publico", error);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
