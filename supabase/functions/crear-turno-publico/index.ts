const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLOT_STEP_MINUTES = 10;
const TIME_ZONE = "America/Argentina/Buenos_Aires";

type PublicError = Error & { status?: number };
type DbRow = Record<string, any>;

type ServiceSegment = {
  serviceId: number;
  service: DbRow;
  user: DbRow;
  inicio: string;
  fin: string;
  duration: number;
  kind: "retiro" | "principal" | "complementario";
};

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

function isActive(row: DbRow | null | undefined) {
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
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

function splitClientName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { nombre: fullName, apellido: "" };
  return {
    nombre: parts.slice(0, -1).join(" "),
    apellido: parts.at(-1) || "",
  };
}

function normalizeArgentineMobilePhone(value: unknown) {
  let v = cleanText(value).replace(/\D/g, "");
  if (!v) return "";

  if (v.startsWith("0054")) v = v.slice(4);
  else if (v.startsWith("54")) v = v.slice(2);

  if (v.length === 11 && v.startsWith("9")) v = v.slice(1);
  if (v.startsWith("0")) v = v.slice(1);

  if (v.length === 12) {
    for (let i = 2; i <= 4; i += 1) {
      if (v.slice(i, i + 2) === "15") {
        v = v.slice(0, i) + v.slice(i + 2);
        break;
      }
    }
  }

  if (v.length === 10 && v.startsWith("15")) return "";
  if (v.length !== 10) return "";
  return `+549${v}`;
}

function validateDate(value: unknown) {
  const date = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    publicError("Datos incompletos: fecha inválida.");
  }
  return date;
}

function validateTime(value: unknown) {
  const time = cleanText(value).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(time)) {
    publicError("Datos incompletos: horario inválido.");
  }
  if (agendaMin(time) % SLOT_STEP_MINUTES !== 0) {
    publicError(
      "Horario no disponible: los turnos online se ofrecen cada 10 minutos.",
      409,
    );
  }
  return time;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";

async function db(
  path: string,
  options: { method?: string; body?: unknown; prefer?: string } = {},
) {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }

  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  if (options.prefer !== "") {
    headers.Prefer = options.prefer || "return=representation";
  }

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

async function findByAuthUserId(authUserId: string) {
  return await first(
    `agenda_clientes?select=*&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
  );
}

async function findByEmail(email: string) {
  const rows = await db(
    `agenda_clientes?select=*&email_normalizado=eq.${encodeURIComponent(email)}&order=id.asc&limit=3`,
  );
  return Array.isArray(rows) ? rows : [];
}

async function findByPhone(phone: string) {
  const rows = await db(
    `agenda_clientes?select=*&telefono_normalizado=eq.${encodeURIComponent(phone)}&order=id.asc&limit=3`,
  );
  return Array.isArray(rows) ? rows : [];
}

async function findOrCreateClient(
  cliente: { nombre: string; telefono: string },
  authUser: { id: string; email: string },
) {
  const canonicalPhone = normalizeArgentineMobilePhone(cliente.telefono);
  if (!canonicalPhone) {
    publicError(
      "El teléfono no parece válido. Ingresalo con código de área, por ejemplo 11 5555 5555.",
      400,
    );
  }

  const splitName = splitClientName(cliente.nombre);
  const verifiedAt = new Date().toISOString();
  let client = await findByAuthUserId(authUser.id);

  if (client?.id) {
    const updated = await db(`agenda_clientes?id=eq.${client.id}`, {
      method: "PATCH",
      body: {
        nombre: splitName.nombre,
        apellido: splitName.apellido,
        email: authUser.email,
        telefono: canonicalPhone,
        auth_user_id: authUser.id,
        email_normalizado: authUser.email,
        telefono_normalizado: canonicalPhone,
        email_verificado_en: client.email_verificado_en || verifiedAt,
      },
    });
    return Array.isArray(updated) ? updated[0] || client : updated || client;
  }

  const emailMatches = await findByEmail(authUser.email);
  if (emailMatches.length > 1) {
    publicError(
      "Encontramos más de un perfil con este email. Para evitar unir clientes incorrectamente, el perfil debe revisarse antes de continuar.",
      409,
    );
  }

  if (emailMatches.length === 1) {
    client = emailMatches[0];
    if (client.auth_user_id && String(client.auth_user_id) !== authUser.id) {
      publicError("Este email ya está asociado a otra identidad.", 409);
    }

    const updated = await db(`agenda_clientes?id=eq.${client.id}`, {
      method: "PATCH",
      body: {
        nombre: splitName.nombre,
        apellido: splitName.apellido,
        email: authUser.email,
        telefono: canonicalPhone,
        auth_user_id: authUser.id,
        email_normalizado: authUser.email,
        telefono_normalizado: canonicalPhone,
        email_verificado_en: verifiedAt,
      },
    });
    return Array.isArray(updated) ? updated[0] || client : updated || client;
  }

  const phoneMatches = await findByPhone(canonicalPhone);
  if (phoneMatches.length > 0) {
    publicError(
      "Este teléfono ya está asociado a otro perfil. Para evitar duplicados, revisá los datos o pedí al local que actualice tu perfil.",
      409,
    );
  }

  const created = await db("agenda_clientes", {
    method: "POST",
    body: {
      nombre: splitName.nombre,
      apellido: splitName.apellido,
      email: authUser.email,
      telefono: canonicalPhone,
      auth_user_id: authUser.id,
      email_normalizado: authUser.email,
      telefono_normalizado: canonicalPhone,
      email_verificado_en: verifiedAt,
      activo: true,
    },
  });

  return Array.isArray(created) ? created[0] : created;
}

async function getDefaultList(localId: number) {
  const rels = await db(
    `agenda_local_listas?select=local_id,lista_id,predeterminada,activo&local_id=eq.${localId}&activo=eq.true`,
  );
  const rel = Array.isArray(rels)
    ? rels.find((row: DbRow) => row.predeterminada) || rels[0]
    : null;

  if (!rel?.lista_id) return null;

  const lista = await first(
    `agenda_listas_precios?select=*&id=eq.${rel.lista_id}&limit=1`,
  );
  return lista && isActive(lista) ? lista : null;
}

async function getPrices(listaId: number | null, serviceIds: number[]) {
  const result = new Map<number, { precioLista: number; precioEfectivo: number }>();
  if (!listaId || !serviceIds.length) return result;

  const rows = await db(
    `agenda_precios_servicios?select=servicio_id,precio_lista,precio_efectivo&lista_id=eq.${listaId}&servicio_id=in.(${serviceIds.join(",")})`,
  );

  for (const row of rows || []) {
    result.set(toInt(row.servicio_id), {
      precioLista: Number(row.precio_lista || 0),
      precioEfectivo: Number(row.precio_efectivo || 0),
    });
  }
  return result;
}

function isUserFree(params: {
  localId: number;
  userId: number;
  inicioMin: number;
  finMin: number;
  horarios: DbRow[];
  turnos: DbRow[];
  bloqueos: DbRow[];
}) {
  const horarioOk = params.horarios.some((horario) => {
    if (toInt(horario.user_id) !== params.userId || horario.trabaja === false) {
      return false;
    }
    return (
      params.inicioMin >= agendaMin(cleanText(horario.entrada)) &&
      params.finMin <= agendaMin(cleanText(horario.salida))
    );
  });

  if (!horarioOk) return false;

  const blocked = params.bloqueos.some((bloqueo) => {
    const localApplies =
      !bloqueo.local_id || toInt(bloqueo.local_id) === params.localId;
    const userApplies =
      !bloqueo.user_id || toInt(bloqueo.user_id) === params.userId;

    return (
      localApplies &&
      userApplies &&
      overlaps(
        params.inicioMin,
        params.finMin,
        agendaMin(cleanText(bloqueo.inicio)),
        agendaMin(cleanText(bloqueo.fin)),
      )
    );
  });

  if (blocked) return false;

  return !params.turnos.some((turno) => {
    if (toInt(turno.user_id) !== params.userId) return false;
    const estado = cleanText(turno.estado).toLowerCase();
    if (["cancelado", "no asiste"].includes(estado)) return false;

    return overlaps(
      params.inicioMin,
      params.finMin,
      agendaMin(cleanText(turno.inicio)),
      agendaMin(cleanText(turno.fin)),
    );
  });
}

function buildPlan(params: {
  startMin: number;
  localId: number;
  primaryServiceId: number;
  requestedUserId: number;
  sequence: Array<{ service: DbRow; kind: ServiceSegment["kind"] }>;
  users: DbRow[];
  assignments: DbRow[];
  horarios: DbRow[];
  turnos: DbRow[];
  bloqueos: DbRow[];
}) {
  let cursor = params.startMin;
  const plan: ServiceSegment[] = [];

  for (const item of params.sequence) {
    const serviceId = toInt(item.service.id);
    const serviceAssignments = params.assignments.filter(
      (rel) => toInt(rel.servicio_id) === serviceId && rel.activo !== false,
    );

    let candidates = params.users.filter((user) =>
      serviceAssignments.some((rel) => toInt(rel.user_id) === toInt(user.id))
    );

    const isPrimary = serviceId === params.primaryServiceId;
    if (isPrimary && params.requestedUserId) {
      candidates = candidates.filter(
        (user) => toInt(user.id) === params.requestedUserId,
      );
    } else if (params.requestedUserId) {
      candidates = [...candidates].sort((a, b) => {
        const aPreferred = toInt(a.id) === params.requestedUserId ? 0 : 1;
        const bPreferred = toInt(b.id) === params.requestedUserId ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
        return cleanText(a.nombre).localeCompare(cleanText(b.nombre), "es");
      });
    }

    let selected: ServiceSegment | null = null;

    for (const user of candidates) {
      const assignment = serviceAssignments.find(
        (rel) => toInt(rel.user_id) === toInt(user.id),
      );
      const duration =
        toInt(assignment?.duracion_minutos) ||
        toInt(item.service.duracion_minutos) ||
        60;
      const end = cursor + duration;

      if (
        isUserFree({
          localId: params.localId,
          userId: toInt(user.id),
          inicioMin: cursor,
          finMin: end,
          horarios: params.horarios,
          turnos: params.turnos,
          bloqueos: params.bloqueos,
        })
      ) {
        selected = {
          serviceId,
          service: item.service,
          user,
          inicio: agendaTime(cursor),
          fin: agendaTime(end),
          duration,
          kind: item.kind,
        };
        cursor = end;
        break;
      }
    }

    if (!selected) return null;
    plan.push(selected);
  }

  return plan;
}

async function evaluateRetiroFree(params: {
  clientId: number;
  fecha: string;
  origin: string;
  primaryService: DbRow;
  currentPrimaryPrice: number;
}) {
  if (params.origin !== "niki") {
    return {
      sinCargo: false,
      validacionPendiente: false,
      previousPrice: null,
      previousTurnId: null,
    };
  }

  const previousTurns = await db(
    `agenda_turnos?select=id,fecha,inicio,servicio_id,precio,precio_efectivo,estado&cliente_id=eq.${params.clientId}&fecha=lt.${params.fecha}&order=fecha.desc,inicio.desc&limit=30`,
  );

  const validTurns = (previousTurns || []).filter((turno: DbRow) =>
    !["cancelado", "no asiste"].includes(cleanText(turno.estado).toLowerCase())
  );
  const historicalIds = Array.from(
    new Set(validTurns.map((row: DbRow) => toInt(row.servicio_id)).filter(Boolean)),
  );

  if (!historicalIds.length) {
    return {
      sinCargo: true,
      validacionPendiente: true,
      previousPrice: null,
      previousTurnId: null,
    };
  }

  const historicalServices = await db(
    `agenda_servicios?select=id,tipo,es_retiro&id=in.(${historicalIds.join(",")})`,
  );
  const serviceById = new Map(
    (historicalServices || []).map((row: DbRow) => [toInt(row.id), row]),
  );
  const primaryType = cleanText(params.primaryService.tipo).toLowerCase();

  const previous = validTurns.find((turno: DbRow) => {
    const service = serviceById.get(toInt(turno.servicio_id));
    return (
      service &&
      service.es_retiro !== true &&
      cleanText(service.tipo).toLowerCase() === primaryType
    );
  });

  if (!previous) {
    return {
      sinCargo: true,
      validacionPendiente: true,
      previousPrice: null,
      previousTurnId: null,
    };
  }

  const previousPrice = Number(previous.precio ?? previous.precio_efectivo ?? 0);
  return {
    sinCargo: params.currentPrimaryPrice >= previousPrice,
    validacionPendiente: false,
    previousPrice,
    previousTurnId: previous.id,
  };
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") publicError("Datos incompletos.");

    const localId = toInt(body.local_id);
    const primaryServiceId = toInt(body.servicio_id);
    const requestedServiceIds = Array.isArray(body.servicio_ids)
      ? body.servicio_ids.map(toInt).filter(Boolean)
      : [];
    const serviceIds = Array.from(
      new Set([primaryServiceId, ...requestedServiceIds].filter(Boolean)),
    );

    const fecha = validateDate(body.fecha);
    const inicio = validateTime(body.inicio);
    const modalidad = cleanText(body.modalidad || "sin_preferencia");
    const requestedUserId = toInt(body.user_id);
    const cliente = {
      nombre: cleanText(body.cliente?.nombre),
      telefono: cleanText(body.cliente?.telefono),
    };
    const observacion = cleanText(body.observacion);
    const retiroOrigin = cleanText(body.retiro?.origen || "ninguno").toLowerCase();
    const retiroServiceId = toInt(body.retiro?.servicio_id);

    if (!localId || !primaryServiceId || !serviceIds.length || !fecha || !inicio) {
      publicError("Datos incompletos.");
    }
    if (!["sin_preferencia", "manicura"].includes(modalidad)) {
      publicError("Datos incompletos: modalidad inválida.");
    }
    if (modalidad === "manicura" && !requestedUserId) {
      publicError("Datos incompletos: profesional requerida.");
    }
    if (!cliente.nombre) {
      publicError("Cliente inválido: completá nombre y apellido.");
    }
    if (!cliente.telefono) {
      publicError("Cliente inválido: completá el teléfono.");
    }
    if (!["ninguno", "niki", "otro"].includes(retiroOrigin)) {
      publicError("La opción de retiro no es válida.");
    }

    const now = localNow();
    if (fecha < now.date) {
      publicError("Horario no disponible: la fecha ya pasó.", 409);
    }
    if (fecha === now.date && agendaMin(inicio) < now.minutes) {
      publicError("Horario no disponible: el horario ya pasó.", 409);
    }

    const local = await first(`locales?select=*&id=eq.${localId}&limit=1`);
    if (!local || !isActive(local)) publicError("Local inválido.", 404);

    const feriado = await first(`feriados?select=fecha&fecha=eq.${fecha}&limit=1`);
    if (feriado) {
      publicError("Horario no disponible: el día seleccionado es feriado.", 409);
    }

    const allRequestedIds = Array.from(
      new Set([...serviceIds, retiroServiceId].filter(Boolean)),
    );
    const services = await db(
      `agenda_servicios?select=*&id=in.(${allRequestedIds.join(",")})`,
    );
    const serviceById = new Map(
      (services || []).map((row: DbRow) => [toInt(row.id), row]),
    );

    for (const id of serviceIds) {
      const service = serviceById.get(id);
      if (!service || !isActive(service) || service.es_retiro === true) {
        publicError("Uno de los servicios seleccionados ya no está disponible.", 409);
      }
    }

    const primaryService = serviceById.get(primaryServiceId);
    if (!primaryService) publicError("Servicio principal no disponible.", 409);

    let retiroService: DbRow | null = null;
    if (retiroOrigin !== "ninguno" && retiroServiceId) {
      const candidate = serviceById.get(retiroServiceId);
      if (!candidate || !isActive(candidate) || candidate.es_retiro !== true) {
        publicError("El servicio de retiro seleccionado no está disponible.", 409);
      }

      const appliesTo = cleanText(candidate.retiro_aplica_tipo).toLowerCase();
      const primaryType = cleanText(primaryService.tipo).toLowerCase();
      if (appliesTo && appliesTo !== primaryType) {
        publicError("El retiro seleccionado no corresponde al servicio principal.", 409);
      }
      retiroService = candidate;
    }

    const sequence: Array<{ service: DbRow; kind: ServiceSegment["kind"] }> = [];
    if (retiroService) sequence.push({ service: retiroService, kind: "retiro" });
    sequence.push({ service: primaryService, kind: "principal" });
    for (const id of serviceIds) {
      if (id !== primaryServiceId) {
        sequence.push({
          service: serviceById.get(id)!,
          kind: "complementario",
        });
      }
    }

    const sequenceIds = sequence.map((item) => toInt(item.service.id));
    const users = await db(
      `users?select=id,nombre,rol,local_id,activo&rol=eq.manicura&activo=eq.true&local_id=eq.${localId}&order=nombre`,
    );
    const assignments = await db(
      `agenda_manicura_servicios?select=user_id,servicio_id,duracion_minutos,activo&servicio_id=in.(${sequenceIds.join(",")})&activo=eq.true`,
    );
    const horarios = await db(
      `horarios?select=user_id,fecha,entrada,salida,trabaja&fecha=eq.${fecha}&trabaja=eq.true`,
    );
    const turnos = await db(
      `agenda_turnos?select=id,user_id,inicio,fin,estado&fecha=eq.${fecha}`,
    );
    const bloqueos = await db(
      `agenda_bloqueos?select=id,local_id,user_id,inicio,fin,tipo&fecha=eq.${fecha}`,
    );

    const plan = buildPlan({
      startMin: agendaMin(inicio),
      localId,
      primaryServiceId,
      requestedUserId: modalidad === "manicura" ? requestedUserId : 0,
      sequence,
      users: users || [],
      assignments: assignments || [],
      horarios: horarios || [],
      turnos: turnos || [],
      bloqueos: bloqueos || [],
    });

    if (!plan?.length) {
      publicError(
        "Ese horario ya no permite completar todos los servicios elegidos. Elegí otro horario.",
        409,
      );
    }

    const client = await findOrCreateClient(cliente, authUser);
    if (!client?.id) {
      publicError("Cliente inválido: no se pudo crear o reutilizar el cliente.", 400);
    }

    const lista = await getDefaultList(localId);
    const priceByService = await getPrices(lista?.id || null, sequenceIds);
    const primaryPrice = priceByService.get(primaryServiceId) || {
      precioLista: 0,
      precioEfectivo: 0,
    };

    const retiroRule = await evaluateRetiroFree({
      clientId: toInt(client.id),
      fecha,
      origin: retiroOrigin,
      primaryService,
      currentPrimaryPrice: primaryPrice.precioLista,
    });

    const groupId = crypto.randomUUID();
    const metadata = {
      canal: "web",
      retiro: {
        origen: retiroOrigin,
        servicio_id: retiroService ? toInt(retiroService.id) : null,
        sin_cargo: retiroService ? retiroRule.sinCargo : null,
        validacion_pendiente: retiroService ? retiroRule.validacionPendiente : retiroOrigin !== "ninguno",
        servicio_anterior_precio: retiroRule.previousPrice,
        turno_anterior_id: retiroRule.previousTurnId,
      },
      servicios_sugeridos_agregados: serviceIds.filter((id) => id !== primaryServiceId),
    };

    const rows = plan.map((segment, index) => {
      const price = priceByService.get(segment.serviceId) || {
        precioLista: 0,
        precioEfectivo: 0,
      };
      const isRetiro = segment.kind === "retiro";
      const retiroFree = isRetiro && retiroOrigin === "niki" && retiroRule.sinCargo;

      return {
        fecha,
        local_id: localId,
        user_id: toInt(segment.user.id),
        cliente_id: toInt(client.id),
        servicio_id: segment.serviceId,
        lista_id: lista?.id || null,
        inicio: segment.inicio,
        fin: segment.fin,
        estado: "confirmado",
        forma_pago: null,
        cantidad: 1,
        precio: retiroFree ? 0 : price.precioLista,
        precio_efectivo: retiroFree ? 0 : price.precioEfectivo,
        precio_cobrado: 0,
        observacion:
          segment.kind === "principal"
            ? observacion || "Reserva online pública"
            : segment.kind === "retiro"
              ? "Retiro previo - reserva online"
              : "Servicio adicional - reserva online",
        reserva_grupo_id: groupId,
        reserva_item_orden: index + 1,
        reserva_es_principal: segment.kind === "principal",
        reserva_metadata: segment.kind === "principal" ? metadata : { canal: "web" },
      };
    });

    const saved = await db("agenda_turnos", {
      method: "POST",
      body: rows,
    });
    const savedRows = Array.isArray(saved) ? saved : saved ? [saved] : [];
    if (savedRows.length !== rows.length) {
      throw new Error("No se pudieron crear todos los servicios de la reserva.");
    }

    const responseServices = plan.map((segment, index) => {
      const savedRow = savedRows[index] || {};
      const price = rows[index];
      return {
        turno_id: savedRow.id,
        servicio_id: segment.serviceId,
        nombre: cleanText(segment.service.nombre),
        tipo: cleanText(segment.service.tipo),
        clase: segment.kind,
        inicio: segment.inicio,
        fin: segment.fin,
        duracion_minutos: segment.duration,
        precio_lista: Number(price.precio || 0),
        precio_efectivo: Number(price.precio_efectivo || 0),
        profesional: {
          id: segment.user.id,
          nombre: cleanText(segment.user.nombre),
        },
      };
    });

    const principal = responseServices.find((item) => item.clase === "principal") || responseServices[0];
    const totalLista = responseServices.reduce((sum, item) => sum + Number(item.precio_lista || 0), 0);
    const totalEfectivo = responseServices.reduce((sum, item) => sum + Number(item.precio_efectivo || 0), 0);

    return jsonResponse({
      ok: true,
      reserva_grupo_id: groupId,
      turno_id: principal?.turno_id || savedRows[0]?.id,
      turno_ids: savedRows.map((row: DbRow) => row.id),
      cliente_id: client.id,
      local: {
        id: local.id,
        nombre: local.nombre,
        direccion: cleanText(local.direccion || local.domicilio || local.address),
      },
      servicio: {
        id: primaryService.id,
        nombre: primaryService.nombre,
      },
      servicios: responseServices,
      retiro: metadata.retiro,
      precio_lista: totalLista,
      precio_efectivo: totalEfectivo,
      fecha,
      inicio: plan[0].inicio,
      fin: plan.at(-1)?.fin || plan[0].fin,
      manicura: principal?.profesional || null,
    });
  } catch (error) {
    const publicErr = error as PublicError;
    const status = publicErr.status || 500;
    const message =
      status >= 500
        ? "No se pudo crear el turno. Intentá nuevamente."
        : publicErr.message;

    console.error("crear-turno-publico", error);
    return jsonResponse({ ok: false, error: message }, status);
  }
});
