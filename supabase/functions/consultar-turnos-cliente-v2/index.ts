const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIME_ZONE = "America/Argentina/Buenos_Aires";

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

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

async function db(path: string) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Error Supabase ${res.status}`);
  return text ? JSON.parse(text) : [];
}

async function first(path: string) {
  const rows = await db(path);
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function getAuthUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) publicError("Necesitás verificar tu email para consultar tus turnos.", 401);
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) publicError("Tu sesión venció. Verificá nuevamente tu email.", 401);
  const user = await res.json();
  if (!user?.id) publicError("No pudimos validar tu identidad.", 401);
  return { id: String(user.id) };
}

async function findClient(authUserId: string) {
  return await first(
    `agenda_clientes?select=id,nombre,apellido&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`
  );
}

async function mapByIds(table: string, select: string, ids: Array<number>) {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  if (!uniqueIds.length) return new Map<number, Record<string, unknown>>();
  const rows = await db(`${table}?select=${select}&id=in.(${uniqueIds.join(",")})`);
  return new Map((rows || []).map((row: Record<string, unknown>) => [Number(row.id), row]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Metodo no permitido." }, 405);

  try {
    const authUser = await getAuthUser(req);
    const cliente = await findClient(authUser.id);
    if (!cliente?.id) {
      return jsonResponse({
        ok: true,
        cliente_encontrado: false,
        mensaje: "Todavía no encontramos un perfil de clienta asociado a tu cuenta.",
        turnos: [],
      });
    }

    const turnos = await db(
      `agenda_turnos?select=id,fecha,inicio,fin,estado,local_id,user_id,servicio_id,precio,precio_efectivo&cliente_id=eq.${cliente.id}&fecha=gte.${todayKey()}&order=fecha.asc,inicio.asc`
    );

    if (!turnos?.length) {
      return jsonResponse({
        ok: true,
        cliente_encontrado: true,
        mensaje: "No tenés próximos turnos registrados con ese contacto.",
        turnos: [],
      });
    }

    const locales = await mapByIds("locales", "*", turnos.map((turno: Record<string, unknown>) => Number(turno.local_id)));
    const manicuras = await mapByIds("users", "id,nombre", turnos.map((turno: Record<string, unknown>) => Number(turno.user_id)));
    const servicios = await mapByIds("agenda_servicios", "id,nombre", turnos.map((turno: Record<string, unknown>) => Number(turno.servicio_id)));

    return jsonResponse({
      ok: true,
      cliente_encontrado: true,
      mensaje: "Encontramos tus próximos turnos.",
      turnos: turnos.map((turno: Record<string, unknown>) => {
        const local = locales.get(Number(turno.local_id));
        const manicura = manicuras.get(Number(turno.user_id));
        const servicio = servicios.get(Number(turno.servicio_id));
        return {
          turno_id: turno.id,
          fecha: turno.fecha,
          inicio: String(turno.inicio || "").slice(0, 5),
          fin: String(turno.fin || "").slice(0, 5),
          estado: turno.estado || "",
          local: local ? { id: local.id, nombre: local.nombre, direccion: cleanText(local.direccion || local.domicilio || local.address) } : null,
          manicura: manicura ? { id: manicura.id, nombre: manicura.nombre } : null,
          servicio: servicio ? { id: servicio.id, nombre: servicio.nombre } : null,
          precio: Number(turno.precio || turno.precio_efectivo || 0),
        };
      }),
    });
  } catch (error) {
    const publicErr = error as PublicError;
    const status = publicErr.status || 500;
    const message = status >= 500 ? "No pudimos consultar tus turnos. Intentá nuevamente." : publicErr.message;
    console.error(error);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
