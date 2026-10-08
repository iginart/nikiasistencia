const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIME_ZONE = "America/Argentina/Buenos_Aires";
type PublicError = Error & { status?: number };
type DbRow = Record<string, any>;

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
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";

async function db(path: string) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }

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

async function findClient(authUserId: string) {
  return await first(
    `agenda_clientes?select=id,nombre,apellido&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
  );
}

async function mapByIds(table: string, select: string, ids: number[]) {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (!uniqueIds.length) return new Map<number, DbRow>();

  const rows = await db(
    `${table}?select=${select}&id=in.(${uniqueIds.join(",")})`,
  );
  return new Map(
    (rows || []).map((row: DbRow) => [Number(row.id), row]),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Método no permitido." }, 405);
  }

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
      `agenda_turnos?select=id,fecha,inicio,fin,estado,local_id,user_id,servicio_id,precio,precio_efectivo,reserva_grupo_id,reserva_item_orden,reserva_es_principal,reserva_metadata&cliente_id=eq.${cliente.id}&fecha=gte.${todayKey()}&order=fecha.asc,inicio.asc,reserva_item_orden.asc`,
    );

    if (!turnos?.length) {
      return jsonResponse({
        ok: true,
        cliente_encontrado: true,
        mensaje: "No tenés próximos turnos registrados.",
        turnos: [],
      });
    }

    const locales = await mapByIds(
      "locales",
      "*",
      turnos.map((turno: DbRow) => Number(turno.local_id)),
    );
    const profesionales = await mapByIds(
      "users",
      "id,nombre",
      turnos.map((turno: DbRow) => Number(turno.user_id)),
    );
    const servicios = await mapByIds(
      "agenda_servicios",
      "id,nombre,tipo,es_retiro",
      turnos.map((turno: DbRow) => Number(turno.servicio_id)),
    );

    const groups = new Map<string, DbRow[]>();
    for (const turno of turnos) {
      const key = cleanText(turno.reserva_grupo_id) || `legacy-${turno.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(turno);
    }

    const reservations = Array.from(groups.entries()).map(([groupId, items]) => {
      items.sort((a, b) => {
        const orderA = Number(a.reserva_item_orden || 999);
        const orderB = Number(b.reserva_item_orden || 999);
        if (orderA !== orderB) return orderA - orderB;
        return cleanText(a.inicio).localeCompare(cleanText(b.inicio));
      });

      const principal =
        items.find((item) => item.reserva_es_principal === true) || items[0];
      const local = locales.get(Number(principal.local_id));
      const principalProfessional = profesionales.get(Number(principal.user_id));
      const principalService = servicios.get(Number(principal.servicio_id));

      const serviceItems = items.map((item) => {
        const service = servicios.get(Number(item.servicio_id));
        const professional = profesionales.get(Number(item.user_id));
        return {
          turno_id: item.id,
          servicio_id: item.servicio_id,
          nombre: service?.nombre || "Servicio",
          tipo: service?.tipo || "",
          es_retiro: service?.es_retiro === true,
          es_principal: item.reserva_es_principal === true,
          inicio: cleanText(item.inicio).slice(0, 5),
          fin: cleanText(item.fin).slice(0, 5),
          precio: Number(item.precio ?? item.precio_efectivo ?? 0),
          profesional: professional
            ? { id: professional.id, nombre: professional.nombre }
            : null,
        };
      });

      const metadata = principal.reserva_metadata || {};
      return {
        turno_id: principal.id,
        reserva_grupo_id: groupId.startsWith("legacy-") ? null : groupId,
        fecha: items[0].fecha,
        inicio: cleanText(items[0].inicio).slice(0, 5),
        fin: cleanText(items.at(-1)?.fin).slice(0, 5),
        estado: principal.estado || "",
        local: local
          ? {
              id: local.id,
              nombre: local.nombre,
              direccion: cleanText(
                local.direccion || local.domicilio || local.address,
              ),
            }
          : null,
        manicura: principalProfessional
          ? {
              id: principalProfessional.id,
              nombre: principalProfessional.nombre,
            }
          : null,
        servicio: principalService
          ? {
              id: principalService.id,
              nombre: principalService.nombre,
            }
          : null,
        servicios: serviceItems,
        retiro: metadata?.retiro || null,
        precio: serviceItems.reduce(
          (sum, item) => sum + Number(item.precio || 0),
          0,
        ),
      };
    });

    reservations.sort((a, b) =>
      `${a.fecha} ${a.inicio}`.localeCompare(`${b.fecha} ${b.inicio}`)
    );

    return jsonResponse({
      ok: true,
      cliente_encontrado: true,
      mensaje: "Encontramos tus próximos turnos.",
      turnos: reservations,
    });
  } catch (error) {
    const publicErr = error as PublicError;
    const status = publicErr.status || 500;
    const message =
      status >= 500
        ? "No pudimos consultar tus turnos. Intentá nuevamente."
        : publicErr.message;

    console.error("consultar-turnos-cliente", error);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
