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

function normalizeEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function normalizePhone(value: unknown) {
  return cleanText(value);
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
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

async function findClient(email: string, telefono: string) {
  if (email) {
    const byEmail = await first(`agenda_clientes?select=id,nombre,apellido&email=ilike.${encodeURIComponent(email)}&limit=1`);
    if (byEmail?.id) return byEmail;
  }

  if (telefono) {
    const byPhone = await first(`agenda_clientes?select=id,nombre,apellido&telefono=eq.${encodeURIComponent(telefono)}&limit=1`);
    if (byPhone?.id) return byPhone;

    const digits = phoneDigits(telefono);
    if (digits && digits !== telefono) {
      const byDigits = await first(`agenda_clientes?select=id,nombre,apellido&telefono=eq.${encodeURIComponent(digits)}&limit=1`);
      if (byDigits?.id) return byDigits;
    }
  }

  return null;
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") publicError("Ingresá email o teléfono para consultar tus turnos.");

    const email = normalizeEmail(body.email);
    const telefono = normalizePhone(body.telefono);

    if (!email && !telefono) publicError("Ingresá email o teléfono para consultar tus turnos.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) publicError("El email no parece válido.");

    const cliente = await findClient(email, telefono);
    if (!cliente?.id) {
      return jsonResponse({
        ok: true,
        cliente_encontrado: false,
        mensaje: "No encontramos turnos asociados a ese contacto. Revisá el email o teléfono ingresado.",
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
