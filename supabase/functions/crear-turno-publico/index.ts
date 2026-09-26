const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLOT_STEP_MINUTES = 10;
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

function toInt(value: unknown) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function isActive(row: Record<string, unknown> | null | undefined) {
  return row?.activo !== false && row?.activa !== false;
}

function agendaMin(time: string) {
  const [h, m] = String(time || "").slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function agendaTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function overlaps(start: number, end: number, busyStart: number, busyEnd: number) {
  return start < busyEnd && end > busyStart;
}

function localNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + minute,
  };
}

function splitClientName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nombre: fullName, apellido: "" };
  return { nombre: parts.slice(0, -1).join(" "), apellido: parts.at(-1) || "" };
}

function validateDate(value: unknown) {
  const date = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) publicError("Datos incompletos: fecha invalida.");
  return date;
}

function validateTime(value: unknown) {
  const time = cleanText(value).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(time)) publicError("Datos incompletos: horario invalido.");
  const min = agendaMin(time);
  if (min % SLOT_STEP_MINUTES !== 0) publicError("Horario no disponible: los turnos online se ofrecen cada 10 minutos.", 409);
  return time;
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

async function getDefaultListAndPrice(localId: number, serviceId: number) {
  const rels = await db(`agenda_local_listas?select=local_id,lista_id,predeterminada,activo&local_id=eq.${localId}&activo=eq.true`);
  const rel = Array.isArray(rels) ? (rels.find((row) => row.predeterminada) || rels[0]) : null;
  if (!rel?.lista_id) return { lista: null, precioLista: 0, precioEfectivo: 0 };

  const lista = await first(`agenda_listas_precios?select=*&id=eq.${rel.lista_id}&limit=1`);
  if (!lista || !isActive(lista)) return { lista: null, precioLista: 0, precioEfectivo: 0 };

  const price = await first(`agenda_precios_servicios?select=precio_lista,precio_efectivo&lista_id=eq.${lista.id}&servicio_id=eq.${serviceId}&limit=1`);
  return {
    lista,
    precioLista: Number(price?.precio_lista || 0),
    precioEfectivo: Number(price?.precio_efectivo || 0),
  };
}

async function findOrCreateClient(cliente: { nombre: string; email: string; telefono: string }) {
  if (cliente.email) {
    const byEmail = await first(`agenda_clientes?select=*&email=ilike.${encodeURIComponent(cliente.email)}&limit=1`);
    if (byEmail?.id) return byEmail;
  }
  if (cliente.telefono) {
    const byPhone = await first(`agenda_clientes?select=*&telefono=eq.${encodeURIComponent(cliente.telefono)}&limit=1`);
    if (byPhone?.id) return byPhone;
  }

  const name = splitClientName(cliente.nombre);
  const created = await db("agenda_clientes", {
    method: "POST",
    body: {
      nombre: name.nombre,
      apellido: name.apellido,
      email: cliente.email,
      telefono: cliente.telefono,
      activo: true,
    },
  });
  return Array.isArray(created) ? created[0] : created;
}

function isSlotFree(params: {
  fecha: string;
  localId: number;
  userId: number;
  inicio: string;
  fin: string;
  horarios: Array<Record<string, unknown>>;
  turnos: Array<Record<string, unknown>>;
  bloqueos: Array<Record<string, unknown>>;
}) {
  const start = agendaMin(params.inicio);
  const end = agendaMin(params.fin);
  const horarioOk = params.horarios.some((horario) => {
    if (toInt(horario.user_id) !== params.userId || horario.trabaja === false) return false;
    return start >= agendaMin(cleanText(horario.entrada)) && end <= agendaMin(cleanText(horario.salida));
  });
  if (!horarioOk) return false;

  const blocked = params.bloqueos.some((bloqueo) => {
    const localApplies = !bloqueo.local_id || toInt(bloqueo.local_id) === params.localId;
    const userApplies = !bloqueo.user_id || toInt(bloqueo.user_id) === params.userId;
    return localApplies && userApplies && overlaps(start, end, agendaMin(cleanText(bloqueo.inicio)), agendaMin(cleanText(bloqueo.fin)));
  });
  if (blocked) return false;

  return !params.turnos.some((turno) => {
    if (toInt(turno.user_id) !== params.userId) return false;
    const estado = cleanText(turno.estado).toLowerCase();
    if (estado === "cancelado" || estado === "no asiste") return false;
    return overlaps(start, end, agendaMin(cleanText(turno.inicio)), agendaMin(cleanText(turno.fin)));
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Metodo no permitido." }, 405);

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") publicError("Datos incompletos.");

    const localId = toInt(body.local_id);
    const serviceId = toInt(body.servicio_id);
    const fecha = validateDate(body.fecha);
    const inicio = validateTime(body.inicio);
    const modalidad = cleanText(body.modalidad || "sin_preferencia");
    const requestedUserId = toInt(body.user_id);
    const cliente = {
      nombre: cleanText(body.cliente?.nombre),
      email: cleanText(body.cliente?.email).toLowerCase(),
      telefono: cleanText(body.cliente?.telefono),
    };

    if (!localId || !serviceId || !fecha || !inicio) publicError("Datos incompletos.");
    if (!["sin_preferencia", "manicura"].includes(modalidad)) publicError("Datos incompletos: modalidad invalida.");
    if (modalidad === "manicura" && !requestedUserId) publicError("Datos incompletos: manicura requerida.");
    if (!cliente.nombre || (!cliente.email && !cliente.telefono)) publicError("Cliente invalido: completa nombre y un contacto.");
    if (cliente.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) publicError("Cliente invalido: email invalido.");

    const now = localNow();
    if (fecha < now.date) publicError("Horario no disponible: la fecha ya paso.", 409);
    if (fecha === now.date && agendaMin(inicio) < now.minutes) publicError("Horario no disponible: el horario ya paso.", 409);

    const local = await first(`locales?select=*&id=eq.${localId}&limit=1`);
    if (!local || !isActive(local)) publicError("Local invalido.", 404);

    const servicio = await first(`agenda_servicios?select=*&id=eq.${serviceId}&limit=1`);
    if (!servicio || !isActive(servicio)) publicError("Servicio no disponible.", 404);

    const feriado = await first(`feriados?select=fecha&fecha=eq.${fecha}&limit=1`);
    if (feriado) publicError("Horario no disponible: el dia seleccionado es feriado.", 409);

    const manicuras = await db(`users?select=id,nombre,rol,local_id,activo&rol=eq.manicura&activo=eq.true&local_id=eq.${localId}&order=nombre`);
    const assignments = await db(`agenda_manicura_servicios?select=user_id,servicio_id,duracion_minutos,activo&servicio_id=eq.${serviceId}&activo=eq.true`);
    const assignmentByUser = new Map((assignments || []).map((rel: Record<string, unknown>) => [toInt(rel.user_id), rel]));

    let candidates = (manicuras || []).filter((manicura: Record<string, unknown>) => assignmentByUser.has(toInt(manicura.id)));
    if (modalidad === "manicura") {
      candidates = candidates.filter((manicura: Record<string, unknown>) => toInt(manicura.id) === requestedUserId);
    }
    if (!candidates.length) publicError("Servicio no disponible para el local o manicura elegida.", 409);

    const horarios = await db(`horarios?select=user_id,fecha,entrada,salida,trabaja&fecha=eq.${fecha}&trabaja=eq.true`);
    const turnos = await db(`agenda_turnos?select=id,user_id,inicio,fin,estado&fecha=eq.${fecha}`);
    const bloqueos = await db(`agenda_bloqueos?select=id,local_id,user_id,inicio,fin,tipo&fecha=eq.${fecha}`);

    let selectedManicura: Record<string, unknown> | null = null;
    let fin = "";
    for (const manicura of candidates) {
      const userId = toInt(manicura.id);
      const assignment = assignmentByUser.get(userId) as Record<string, unknown> | undefined;
      const duration = toInt(assignment?.duracion_minutos) || toInt(servicio.duracion_minutos) || 60;
      const candidateFin = agendaTime(agendaMin(inicio) + duration);
      if (isSlotFree({ fecha, localId, userId, inicio, fin: candidateFin, horarios, turnos, bloqueos })) {
        selectedManicura = manicura;
        fin = candidateFin;
        break;
      }
    }

    if (!selectedManicura) publicError("Horario no disponible. Elegi otro horario.", 409);

    const price = await getDefaultListAndPrice(localId, serviceId);
    const client = await findOrCreateClient(cliente);
    if (!client?.id) publicError("Cliente invalido: no se pudo crear o reutilizar el cliente.", 400);

    const turnoPayload = {
      fecha,
      local_id: localId,
      user_id: toInt(selectedManicura.id),
      cliente_id: toInt(client.id),
      servicio_id: serviceId,
      lista_id: price.lista?.id || null,
      inicio,
      fin,
      estado: "confirmado",
      forma_pago: null,
      cantidad: 1,
      precio: price.precioLista,
      precio_efectivo: price.precioEfectivo,
      precio_cobrado: 0,
      observacion: "Reserva online publica",
    };

    const saved = await db("agenda_turnos", { method: "POST", body: turnoPayload });
    const turno = Array.isArray(saved) ? saved[0] : saved;
    if (!turno?.id) throw new Error("No se pudo crear el turno.");

    return jsonResponse({
      ok: true,
      turno_id: turno.id,
      cliente_id: client.id,
      local: { id: local.id, nombre: local.nombre, direccion: cleanText(local.direccion || local.domicilio || local.address) },
      servicio: { id: servicio.id, nombre: servicio.nombre },
      precio_lista: price.precioLista,
      precio_efectivo: price.precioEfectivo,
      fecha,
      inicio,
      fin,
      manicura: { id: selectedManicura.id, nombre: selectedManicura.nombre },
    });
  } catch (error) {
    const publicErr = error as PublicError;
    const status = publicErr.status || 500;
    const message = status >= 500 ? "No se pudo crear el turno. Intentalo nuevamente." : publicErr.message;
    console.error(error);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
