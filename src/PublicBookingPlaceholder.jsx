import { useEffect, useMemo, useState } from "react";
import { COLORS, LogoMark, SUPABASE_KEY, SUPABASE_URL } from "./App.jsx";

const STEPS = [
  { id: "local", label: "Local" },
  { id: "tipo", label: "Tipo" },
  { id: "servicio", label: "Servicio" },
  { id: "modalidad", label: "Horario" },
  { id: "datos", label: "Datos" },
  { id: "confirmacion", label: "Confirmación" },
];

const SERVICE_TYPE_LABELS = {
  manos: "Manos",
  pies: "Pies",
  "cejas y pestañas": "Cejas y pestañas",
  otros: "Otros",
};

const SLOT_STEP_MINUTES = 10;
const FIRST_AVAILABLE_MAX_DAYS = 5;
const FIRST_AVAILABLE_MAX_SLOTS = 28;

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const normalizeText = (value) => String(value || "").trim();
const normalizeId = (value) => (value === null || value === undefined || value === "" ? "" : String(value));
const isActive = (row) => row?.activo !== false && row?.activa !== false;
const toNumber = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

function formatMoney(value) {
  const n = toNumber(value);
  if (!n) return "A confirmar";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(value) {
  if (!value) return "Sin fecha elegida";
  const [y, m, d] = String(value).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function getLocalAddress(local) {
  return normalizeText(local?.direccion || local?.domicilio || local?.address);
}

function formatTimeRange(inicio, fin) {
  const start = String(inicio || "").slice(0, 5);
  const end = String(fin || "").slice(0, 5);
  return [start, end].filter(Boolean).join(" - ") || "Horario a confirmar";
}

function formatContact(telefono, email) {
  return [normalizeText(telefono), normalizeText(email)].filter(Boolean).join(" - ") || "Sin contacto";
}

function buildBookingSummaryText({
  turnoId,
  localName,
  localAddress,
  serviceName,
  fecha,
  inicio,
  fin,
  manicureName,
  clientName,
  telefono,
  email,
  precio,
  precioLista,
  precioEfectivo,
}) {
  const lines = [
    "Turno confirmado - Niki Beauty Bar",
    `Nro: #${turnoId || "A confirmar"}`,
    `Local: ${[localName || "A confirmar", localAddress].filter(Boolean).join(" - ")}`,
    `Servicio: ${serviceName || "A confirmar"}`,
  ];
  if (precio) lines.push(`Precio: ${formatMoney(precio)}`);
  if (precioLista) lines.push(`Precio lista: ${formatMoney(precioLista)}`);
  if (precioEfectivo) lines.push(`Precio efectivo: ${formatMoney(precioEfectivo)}`);
  lines.push(
    `Fecha: ${formatDate(fecha)}`,
    `Horario: ${formatTimeRange(inicio, fin)}`,
    `Manicura: ${manicureName || "A confirmar"}`
  );
  if (clientName) lines.push(`Cliente: ${clientName}`);
  if (telefono) lines.push(`Teléfono: ${telefono}`);
  if (email) lines.push(`Email: ${email}`);
  return lines.join("\n");
}

function toIcsDate(fecha, hora) {
  const day = String(fecha || "").replace(/-/g, "");
  const time = String(hora || "00:00").slice(0, 5).replace(":", "");
  return `${day}T${time}00`;
}

function toIcsStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function safeFileName(value) {
  return String(value || "turno-niki")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "turno-niki";
}

function downloadIcsEvent({ uid, title, fecha, inicio, fin, location, description }) {
  if (!fecha || !inicio || !fin) throw new Error("Faltan fecha u horario para el calendario.");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Niki Beauty Bar//Turnos//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid || `niki-${fecha}-${inicio}`)}`,
    `DTSTAMP:${toIcsStamp()}`,
    `DTSTART;TZID=America/Argentina/Buenos_Aires:${toIcsDate(fecha, inicio)}`,
    `DTEND;TZID=America/Argentina/Buenos_Aires:${toIcsDate(fecha, fin)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(uid || title)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyPlainText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("No se pudo copiar.");
}

function groupBookingsByDate(turnos = []) {
  const groups = new Map();
  turnos.forEach((turno) => {
    const fecha = turno.fecha || "sin-fecha";
    if (!groups.has(fecha)) groups.set(fecha, []);
    groups.get(fecha).push(turno);
  });
  return Array.from(groups.entries()).map(([fecha, items]) => ({ fecha, items }));
}

function agendaMin(time) {
  if (!time) return 0;
  const [h, m] = String(time).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function agendaTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function ceilToStep(minutes, step = SLOT_STEP_MINUTES) {
  return Math.ceil(minutes / step) * step;
}

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function overlaps(start, end, busyStart, busyEnd) {
  return start < busyEnd && end > busyStart;
}

function typeLabel(type) {
  const key = normalizeText(type).toLowerCase() || "otros";
  return SERVICE_TYPE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

async function publicGet(path, signal) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "GET",
    signal,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "No se pudieron cargar los datos.");
  return text ? JSON.parse(text) : [];
}

async function publicGetOptional(path, signal) {
  try {
    return { data: await publicGet(path, signal), error: null };
  } catch (error) {
    return { data: [], error };
  }
}

async function createPublicBooking(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/crear-turno-publico`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || "No se pudo confirmar el turno.");
  }
  return data;
}

async function fetchClientBookings(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/consultar-turnos-cliente`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || "No pudimos consultar tus turnos.");
  }
  return data;
}

function normalizeLocal(row) {
  return {
    id: row.id,
    nombre: row.nombre || row.name || `Local ${row.id}`,
    direccion: row.direccion || row.domicilio || row.address || "",
    activo: isActive(row),
  };
}

function normalizeService(row) {
  return {
    id: row.id,
    nombre: row.nombre || "Servicio",
    descripcion: row.descripcion || "",
    tipo: row.tipo || "otros",
    duracionMinutos: Number(row.duracion_minutos || row.duracionMinutos || 60),
    activo: isActive(row),
  };
}

function normalizeList(row) {
  return {
    id: row.id,
    localId: row.local_id ?? row.localId ?? null,
    nombre: row.nombre || "Lista",
    descripcion: row.descripcion || "",
    activo: isActive(row),
  };
}

function normalizeLocalList(row) {
  return {
    localId: row.local_id ?? row.localId,
    listaId: row.lista_id ?? row.listaId,
    predeterminada: row.predeterminada === true,
    activo: isActive(row),
  };
}

function normalizePrice(row) {
  return {
    listaId: row.lista_id ?? row.listaId,
    servicioId: row.servicio_id ?? row.servicioId,
    precioLista: toNumber(row.precio_lista ?? row.precioLista),
    precioEfectivo: toNumber(row.precio_efectivo ?? row.precioEfectivo),
  };
}

function normalizeManicura(row) {
  return {
    id: row.id,
    nombre: row.nombre || "Manicura",
    rol: row.rol || "",
    localId: row.local_id ?? row.localId ?? null,
    activo: isActive(row),
  };
}

function normalizeHorario(row) {
  return {
    userId: row.user_id ?? row.userId,
    fecha: row.fecha,
    entrada: String(row.entrada || "").slice(0, 5),
    salida: String(row.salida || "").slice(0, 5),
    trabaja: row.trabaja !== false,
  };
}

function normalizeTurno(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    localId: row.local_id ?? row.localId,
    userId: row.user_id ?? row.userId,
    inicio: String(row.inicio || "").slice(0, 5),
    fin: String(row.fin || "").slice(0, 5),
    estado: row.estado || "pendiente",
  };
}

function normalizeBloqueo(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    localId: row.local_id ?? row.localId ?? null,
    userId: row.user_id ?? row.userId ?? null,
    inicio: String(row.inicio || "").slice(0, 5),
    fin: String(row.fin || "").slice(0, 5),
    tipo: row.tipo || "no_disponible",
  };
}

function normalizeManicuraServicio(row) {
  return {
    userId: row.user_id ?? row.userId,
    servicioId: row.servicio_id ?? row.servicioId,
    duracionMinutos: row.duracion_minutos ?? row.duracionMinutos ?? null,
    activo: isActive(row),
  };
}

function CardButton({ selected, children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        minHeight: 92,
        textAlign: "left",
        background: selected ? "#fff3f7" : "#fff",
        border: selected ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.14)",
        borderRadius: 8,
        padding: 16,
        boxShadow: selected ? "0 10px 24px rgba(212,83,126,0.15)" : "0 6px 18px rgba(64,30,42,0.06)",
        color: "#351821",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.56 : 1,
        transition: "border 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7, color: "#5f3a49", fontSize: 13, fontWeight: 700 }}>
      {label}
      {children}
    </label>
  );
}

function SummaryRow({ label, value, subtle }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid rgba(114,36,62,0.1)" }}>
      <span style={{ color: "#7b5b67", fontSize: 13 }}>{label}</span>
      <strong style={{ color: subtle ? "#7b5b67" : "#351821", fontSize: 13, textAlign: "right" }}>{value}</strong>
    </div>
  );
}

export default function PublicBookingApp() {
  const [publicView, setPublicView] = useState("reservar");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [priceWarning, setPriceWarning] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);
  const [lookup, setLookup] = useState({ email: "", telefono: "" });
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [copiedTurnId, setCopiedTurnId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState({
    locales: [],
    servicios: [],
    listas: [],
    localListas: [],
    precios: [],
    manicuras: [],
    horarios: [],
    turnos: [],
    bloqueos: [],
    manicuraServicios: [],
    feriados: [],
  });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    localId: "",
    tipo: "",
    servicioId: "",
    modalidad: "primer",
    manicuraId: "",
    slot: null,
    fecha: todayKey(),
    nombre: "",
    telefono: "",
    email: "",
    observacion: "",
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadPublicData() {
      setLoading(true);
      setError("");
      setPriceWarning("");
      try {
        const today = todayKey();
        const [
          localesRows,
          serviciosRows,
          manicurasRows,
          horariosRows,
          turnosRows,
          bloqueosRows,
          manicuraServiciosRows,
          feriadosRows,
          listasRes,
          localListasRes,
          preciosRes,
        ] = await Promise.all([
          publicGet("locales?select=*&order=id", controller.signal),
          publicGet("agenda_servicios?select=*&order=nombre", controller.signal),
          publicGet("users?select=id,nombre,rol,local_id,activo&rol=eq.manicura&activo=eq.true&order=nombre", controller.signal),
          publicGet(`horarios?select=user_id,fecha,entrada,salida,trabaja&fecha=gte.${today}&order=fecha.asc`, controller.signal),
          publicGet(`agenda_turnos?select=id,fecha,local_id,user_id,inicio,fin,estado&fecha=gte.${today}&order=fecha.asc,inicio.asc`, controller.signal),
          publicGet(`agenda_bloqueos?select=id,fecha,local_id,user_id,inicio,fin,tipo&fecha=gte.${today}&order=fecha.asc,inicio.asc`, controller.signal),
          publicGet("agenda_manicura_servicios?select=user_id,servicio_id,duracion_minutos,activo", controller.signal),
          publicGet(`feriados?select=fecha&fecha=gte.${today}`, controller.signal),
          publicGetOptional("agenda_listas_precios?select=*&order=nombre", controller.signal),
          publicGetOptional("agenda_local_listas?select=*", controller.signal),
          publicGetOptional("agenda_precios_servicios?select=*", controller.signal),
        ]);

        if (controller.signal.aborted) return;

        const optionalFailures = [listasRes.error, localListasRes.error, preciosRes.error].filter(Boolean);
        if (optionalFailures.length) {
          setPriceWarning("Algunos precios no se pudieron cargar. Los servicios pueden aparecer con precio a confirmar.");
        }

        setData({
          locales: (localesRows || []).map(normalizeLocal).filter((l) => l.activo),
          servicios: (serviciosRows || []).map(normalizeService).filter((s) => s.activo),
          listas: (listasRes.data || []).map(normalizeList).filter((l) => l.activo),
          localListas: (localListasRes.data || []).map(normalizeLocalList).filter((l) => l.activo),
          precios: (preciosRes.data || []).map(normalizePrice),
          manicuras: (manicurasRows || []).map(normalizeManicura).filter((m) => m.activo && m.rol === "manicura"),
          horarios: (horariosRows || []).map(normalizeHorario).filter((h) => h.fecha && h.entrada && h.salida && h.trabaja),
          turnos: (turnosRows || []).map(normalizeTurno).filter((t) => t.fecha && t.inicio && t.fin),
          bloqueos: (bloqueosRows || []).map(normalizeBloqueo).filter((b) => b.fecha && b.inicio && b.fin),
          manicuraServicios: (manicuraServiciosRows || []).map(normalizeManicuraServicio).filter((rel) => rel.activo),
          feriados: (feriadosRows || []).map((row) => row.fecha).filter(Boolean),
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err?.message || "No se pudieron cargar los datos de reservas.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadPublicData();
    return () => controller.abort();
  }, [reloadKey]);

  const selectedLocal = useMemo(
    () => data.locales.find((local) => normalizeId(local.id) === normalizeId(form.localId)) || null,
    [data.locales, form.localId]
  );

  const selectedService = useMemo(
    () => data.servicios.find((service) => normalizeId(service.id) === normalizeId(form.servicioId)) || null,
    [data.servicios, form.servicioId]
  );

  const selectedManicura = useMemo(
    () => data.manicuras.find((manicura) => normalizeId(manicura.id) === normalizeId(form.manicuraId)) || null,
    [data.manicuras, form.manicuraId]
  );

  const feriadosSet = useMemo(() => new Set(data.feriados), [data.feriados]);

  const serviceAssignmentByKey = useMemo(() => {
    const assignments = new Map();
    data.manicuraServicios.forEach((rel) => {
      assignments.set(`${rel.userId}-${rel.servicioId}`, rel);
    });
    return assignments;
  }, [data.manicuraServicios]);

  const activeManicurasForLocal = useMemo(() => {
    const lid = parseInt(form.localId, 10);
    if (!lid) return [];
    return data.manicuras.filter((manicura) => parseInt(manicura.localId, 10) === lid && manicura.activo);
  }, [data.manicuras, form.localId]);

  const servicesAvailableForLocal = useMemo(() => {
    const manicuraIds = new Set(activeManicurasForLocal.map((manicura) => normalizeId(manicura.id)));
    const serviceIds = new Set(
      data.manicuraServicios
        .filter((rel) => rel.activo && manicuraIds.has(normalizeId(rel.userId)))
        .map((rel) => normalizeId(rel.servicioId))
    );
    return data.servicios.filter((service) => serviceIds.has(normalizeId(service.id)));
  }, [activeManicurasForLocal, data.manicuraServicios, data.servicios]);

  const compatibleManicuras = useMemo(() => {
    if (!selectedService) return [];
    return activeManicurasForLocal.filter((manicura) => serviceAssignmentByKey.has(`${manicura.id}-${selectedService.id}`));
  }, [activeManicurasForLocal, selectedService, serviceAssignmentByKey]);

  const servicesByType = useMemo(() => {
    const grouped = new Map();
    servicesAvailableForLocal.forEach((service) => {
      const key = normalizeText(service.tipo).toLowerCase() || "otros";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(service);
    });
    return Array.from(grouped.entries())
      .map(([tipo, servicios]) => ({ tipo, label: typeLabel(tipo), servicios }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [servicesAvailableForLocal]);

  const servicesForType = useMemo(
    () => servicesAvailableForLocal.filter((service) => (normalizeText(service.tipo).toLowerCase() || "otros") === form.tipo),
    [servicesAvailableForLocal, form.tipo]
  );

  const priceByKey = useMemo(() => {
    const prices = new Map();
    data.precios.forEach((price) => prices.set(`${price.listaId}-${price.servicioId}`, price));
    return prices;
  }, [data.precios]);

  const getDefaultList = (localId) => {
    const lid = parseInt(localId, 10);
    const rels = data.localListas.filter((rel) => parseInt(rel.localId, 10) === lid && rel.activo);
    const selectedRel = rels.find((rel) => rel.predeterminada) || rels[0];
    if (selectedRel) {
      const assigned = data.listas.find((list) => normalizeId(list.id) === normalizeId(selectedRel.listaId) && list.activo);
      if (assigned) return assigned;
    }
    return data.listas.find((list) => parseInt(list.localId, 10) === lid && list.activo) || null;
  };

  const getPriceForService = (serviceId = form.servicioId, localId = form.localId) => {
    const list = getDefaultList(localId);
    const price = list ? priceByKey.get(`${list.id}-${serviceId}`) : null;
    return {
      list,
      price,
      precioLista: price?.precioLista || 0,
      precioEfectivo: price?.precioEfectivo || 0,
    };
  };

  const getDurationForManicura = (userId) => {
    if (!selectedService) return 0;
    const assignment = serviceAssignmentByKey.get(`${userId}-${selectedService.id}`);
    return parseInt(assignment?.duracionMinutos || selectedService.duracionMinutos || 60, 10) || 60;
  };

  const getApplicableBloqueos = (fecha, userId) => {
    const lid = parseInt(form.localId, 10);
    const uid = parseInt(userId, 10);
    return data.bloqueos.filter((bloqueo) => {
      if (bloqueo.fecha !== fecha) return false;
      const localApplies = !bloqueo.localId || parseInt(bloqueo.localId, 10) === lid;
      const userApplies = !bloqueo.userId || parseInt(bloqueo.userId, 10) === uid;
      return localApplies && userApplies;
    });
  };

  const getAvailableSlotsForDate = (fecha) => {
    if (!selectedService || !form.localId || !fecha || feriadosSet.has(fecha)) return [];
    if (fecha < todayKey()) return [];

    const today = todayKey();
    const minStartToday = fecha === today ? ceilToStep(currentMinutes()) : 0;
    const requestedUserId = normalizeId(form.manicuraId);
    const manicuras = requestedUserId
      ? compatibleManicuras.filter((manicura) => normalizeId(manicura.id) === requestedUserId)
      : compatibleManicuras;

    const slots = [];
    manicuras.forEach((manicura) => {
      const duration = getDurationForManicura(manicura.id);
      const horarios = data.horarios.filter((horario) => horario.fecha === fecha && normalizeId(horario.userId) === normalizeId(manicura.id));
      const turnos = data.turnos.filter(
        (turno) =>
          turno.fecha === fecha &&
          normalizeId(turno.userId) === normalizeId(manicura.id) &&
          !["cancelado", "no asiste"].includes(String(turno.estado || "").toLowerCase())
      );
      const bloqueos = getApplicableBloqueos(fecha, manicura.id);

      horarios.forEach((horario) => {
        const rangeStart = Math.max(agendaMin(horario.entrada), minStartToday);
        const rangeEnd = agendaMin(horario.salida);
        if (!duration || rangeStart + duration > rangeEnd) return;

        for (let start = ceilToStep(rangeStart); start + duration <= rangeEnd; start += SLOT_STEP_MINUTES) {
          const end = start + duration;
          const overlapsTurno = turnos.some((turno) => overlaps(start, end, agendaMin(turno.inicio), agendaMin(turno.fin)));
          const overlapsBloqueo = bloqueos.some((bloqueo) => overlaps(start, end, agendaMin(bloqueo.inicio), agendaMin(bloqueo.fin)));
          if (!overlapsTurno && !overlapsBloqueo) {
            slots.push({
              fecha,
              inicio: agendaTime(start),
              fin: agendaTime(end),
              userId: manicura.id,
              manicuraNombre: manicura.nombre,
              duracionMinutos: duration,
            });
          }
        }
      });
    });

    return slots.sort((a, b) => `${a.fecha} ${a.inicio} ${a.manicuraNombre}`.localeCompare(`${b.fecha} ${b.inicio} ${b.manicuraNombre}`, "es"));
  };

  const futureScheduleDates = useMemo(() => {
    const today = todayKey();
    return Array.from(new Set(data.horarios.filter((horario) => horario.fecha >= today).map((horario) => horario.fecha))).sort();
  }, [data.horarios]);

  const daySlots = useMemo(() => getAvailableSlotsForDate(form.fecha), [form.fecha, form.localId, form.manicuraId, selectedService, compatibleManicuras, data.horarios, data.turnos, data.bloqueos, feriadosSet]);

  const firstAvailableGroups = useMemo(() => {
    if (!selectedService || !form.localId || !compatibleManicuras.length) return [];
    const groups = [];
    let totalSlots = 0;
    for (const fecha of futureScheduleDates) {
      if (feriadosSet.has(fecha)) continue;
      const slots = getAvailableSlotsForDate(fecha);
      if (!slots.length) continue;
      const visibleSlots = slots.slice(0, Math.max(4, FIRST_AVAILABLE_MAX_SLOTS - totalSlots));
      groups.push({ fecha, slots: visibleSlots });
      totalSlots += visibleSlots.length;
      if (groups.length >= FIRST_AVAILABLE_MAX_DAYS || totalSlots >= FIRST_AVAILABLE_MAX_SLOTS) break;
    }
    return groups;
  }, [selectedService, form.localId, form.manicuraId, compatibleManicuras, futureScheduleDates, data.horarios, data.turnos, data.bloqueos, feriadosSet]);

  const selectSlot = (slot) => {
    setBookingError("");
    setBookingResult(null);
    setForm((prev) => ({ ...prev, slot }));
    setStep(STEPS.findIndex((item) => item.id === "datos"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selectedPrice = selectedService ? getPriceForService(selectedService.id, form.localId) : null;
  const currentStep = STEPS[step];
  const isFinal = currentStep.id === "confirmacion";

  const canContinue = () => {
    if (currentStep.id === "local") return !!form.localId;
    if (currentStep.id === "tipo") return !!form.tipo;
    if (currentStep.id === "servicio") return !!form.servicioId;
    if (currentStep.id === "modalidad") return !!form.slot;
    if (currentStep.id === "datos") return normalizeText(form.nombre) && (normalizeText(form.telefono) || normalizeText(form.email));
    return true;
  };

  const setLocal = (localId) => {
    setBookingError("");
    setBookingResult(null);
    setForm((prev) => ({ ...prev, localId, tipo: "", servicioId: "", manicuraId: "", slot: null }));
  };

  const setType = (tipo) => {
    setBookingError("");
    setBookingResult(null);
    setForm((prev) => ({ ...prev, tipo, servicioId: "", manicuraId: "", slot: null }));
  };

  const goNext = () => {
    if (!canContinue()) return;
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setStep((value) => Math.max(value - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetFlow = () => {
    setBookingError("");
    setBookingResult(null);
    setCopyFeedback("");
    setActionError("");
    setCopiedTurnId("");
    setStep(0);
    setForm({
      localId: "",
      tipo: "",
      servicioId: "",
      modalidad: "primer",
      manicuraId: "",
      slot: null,
      fecha: todayKey(),
      nombre: "",
      telefono: "",
      email: "",
      observacion: "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const switchView = (view) => {
    setPublicView(view);
    setBookingError("");
    setLookupError("");
    setActionError("");
    setCopyFeedback("");
    setCopiedTurnId("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const consultMyBookings = async () => {
    setLookupError("");
    setLookupResult(null);
    setActionError("");
    setCopyFeedback("");
    setCopiedTurnId("");
    if (!normalizeText(lookup.email) && !normalizeText(lookup.telefono)) {
      setLookupError("Ingresá email o teléfono para consultar tus turnos.");
      return;
    }
    setLookupLoading(true);
    try {
      const result = await fetchClientBookings({
        email: normalizeText(lookup.email),
        telefono: normalizeText(lookup.telefono),
      });
      setLookupResult(result);
    } catch (err) {
      setLookupError(err?.message || "No pudimos consultar tus turnos.");
    } finally {
      setLookupLoading(false);
    }
  };

  const confirmPublicBooking = async () => {
    if (!form.slot || !selectedService || !selectedLocal) return;
    setBookingLoading(true);
    setBookingError("");
    setActionError("");
    setCopyFeedback("");
    try {
      const payload = {
        local_id: parseInt(form.localId, 10),
        servicio_id: parseInt(form.servicioId, 10),
        fecha: form.slot.fecha,
        inicio: form.slot.inicio,
        modalidad: form.manicuraId ? "manicura" : "sin_preferencia",
        ...(form.manicuraId ? { user_id: parseInt(form.manicuraId, 10) } : {}),
        cliente: {
          nombre: normalizeText(form.nombre),
          email: normalizeText(form.email),
          telefono: normalizeText(form.telefono),
        },
      };
      const result = await createPublicBooking(payload);
      setBookingResult(result);
    } catch (err) {
      setBookingResult(null);
      setBookingError(err?.message || "No se pudo confirmar el turno. Elegí otro horario.");
      setForm((prev) => ({ ...prev, slot: null }));
      setStep(STEPS.findIndex((item) => item.id === "modalidad"));
      setReloadKey((value) => value + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBookingLoading(false);
    }
  };

  const showCopyFeedback = (message, turnId = "") => {
    setActionError("");
    setCopyFeedback(message);
    setCopiedTurnId(turnId ? String(turnId) : "");
    window.setTimeout(() => {
      setCopyFeedback("");
      setCopiedTurnId("");
    }, 1800);
  };

  const handleCopyText = async (text, message = "Datos copiados", turnId = "") => {
    try {
      await copyPlainText(text);
      showCopyFeedback(message, turnId);
    } catch {
      setCopyFeedback("");
      setCopiedTurnId("");
      setActionError("No pudimos copiar los datos. Probá seleccionarlos manualmente.");
    }
  };

  const handleDownloadCalendar = (event) => {
    try {
      downloadIcsEvent(event);
      setActionError("");
    } catch {
      setActionError("No pudimos descargar el calendario. Intentá nuevamente.");
    }
  };

  const inputStyle = {
    width: "100%",
    border: "1px solid rgba(114,36,62,0.18)",
    borderRadius: 8,
    padding: "13px 14px",
    fontSize: 15,
    color: "#32151f",
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
  };

  const primaryButtonStyle = {
    border: "none",
    borderRadius: 8,
    padding: "13px 18px",
    background: canContinue() ? COLORS.pink : "#d7c5cc",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    cursor: canContinue() ? "pointer" : "not-allowed",
    width: "100%",
  };

  const secondaryButtonStyle = {
    border: "1px solid rgba(114,36,62,0.16)",
    borderRadius: 8,
    padding: "13px 18px",
    background: "#fff",
    color: COLORS.pinkDark,
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    width: "100%",
  };

  const actionButtonStyle = {
    ...primaryButtonStyle,
    background: COLORS.pink,
    cursor: "pointer",
    minHeight: 48,
  };

  const outlineActionButtonStyle = {
    ...secondaryButtonStyle,
    minHeight: 48,
  };

  const renderLoading = () => (
    <section style={{ background: "#fff", borderRadius: 8, padding: 22, boxShadow: "0 10px 30px rgba(64,30,42,0.08)" }}>
      <div style={{ height: 12, width: "42%", background: "#f3dbe4", borderRadius: 8, marginBottom: 16 }} />
      <div style={{ height: 44, background: "#faedf2", borderRadius: 8, marginBottom: 12 }} />
      <div style={{ height: 44, background: "#faedf2", borderRadius: 8, marginBottom: 12 }} />
      <div style={{ height: 44, background: "#faedf2", borderRadius: 8 }} />
    </section>
  );

  const renderError = () => (
    <section style={{ background: "#fff", borderRadius: 8, padding: 22, boxShadow: "0 10px 30px rgba(64,30,42,0.08)" }}>
      <p style={{ margin: "0 0 8px", color: COLORS.pinkDark, fontWeight: 800 }}>No pudimos cargar el portal</p>
      <p style={{ margin: "0 0 18px", color: "#6a4b58", fontSize: 14, lineHeight: 1.5 }}>{error}</p>
      <button type="button" onClick={() => setReloadKey((value) => value + 1)} style={secondaryButtonStyle}>
        Reintentar
      </button>
    </section>
  );

  const renderMyBookingsView = () => {
    const bookingGroups = groupBookingsByDate(lookupResult?.turnos || []);

    return (
      <section
        style={{
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(114,36,62,0.1)",
          borderRadius: 8,
          padding: 16,
          boxShadow: "0 14px 34px rgba(64,30,42,0.08)",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 22, lineHeight: 1.15 }}>
            Consultar mis turnos
          </h2>
          <p style={{ margin: 0, color: "#735260", fontSize: 14, lineHeight: 1.45 }}>
            Ingresá el email o teléfono que usaste al reservar. Por ahora esta vista solo permite consultar.
          </p>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Email">
            <input
              type="email"
              value={lookup.email}
              onChange={(event) => setLookup((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="tu@email.com"
              style={inputStyle}
            />
          </Field>
          <Field label="WhatsApp o teléfono">
            <input
              value={lookup.telefono}
              onChange={(event) => setLookup((prev) => ({ ...prev, telefono: event.target.value }))}
              placeholder="Ej: 11 5555 5555"
              style={inputStyle}
            />
          </Field>
          {lookupError && (
            <div style={{ background: "#fff0f3", color: COLORS.pinkDark, border: "1px solid rgba(212,83,126,0.28)", borderRadius: 8, padding: "11px 13px", fontSize: 13 }}>
              {lookupError}
            </div>
          )}
          {actionError && (
            <div style={{ background: "#fff0f3", color: COLORS.pinkDark, border: "1px solid rgba(212,83,126,0.28)", borderRadius: 8, padding: "11px 13px", fontSize: 13 }}>
              {actionError}
            </div>
          )}
          {copyFeedback && (
            <div style={{ background: "#f8fff7", color: "#2f6b3d", border: "1px solid rgba(72,150,88,0.24)", borderRadius: 8, padding: "11px 13px", fontSize: 13, fontWeight: 800 }}>
              {copyFeedback}
            </div>
          )}
          <button
            type="button"
            onClick={consultMyBookings}
            disabled={lookupLoading}
            style={{
              ...actionButtonStyle,
              cursor: lookupLoading ? "not-allowed" : "pointer",
              opacity: lookupLoading ? 0.72 : 1,
            }}
          >
            {lookupLoading ? "Consultando..." : "Buscar turnos"}
          </button>
        </div>

        {lookupResult && (
          <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
            <p style={{ margin: 0, color: "#735260", fontSize: 14, lineHeight: 1.45 }}>
              {lookupResult.mensaje || (lookupResult.turnos?.length ? "Encontramos tus próximos turnos." : "No encontramos próximos turnos.")}
            </p>
            {bookingGroups.map((group) => (
              <section key={group.fecha} style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 16 }}>{formatDate(group.fecha)}</h3>
                <div style={{ display: "grid", gap: 12 }}>
                  {group.items.map((turno) => {
                    const localName = turno.local?.nombre || "A confirmar";
                    const localAddress = getLocalAddress(turno.local);
                    const serviceName = turno.servicio?.nombre || "A confirmar";
                    const manicureName = turno.manicura?.nombre || "A confirmar";
                    const location = [localName, localAddress].filter(Boolean).join(" - ");
                    const summaryText = buildBookingSummaryText({
                      turnoId: turno.turno_id,
                      localName,
                      localAddress,
                      serviceName,
                      fecha: turno.fecha,
                      inicio: turno.inicio,
                      fin: turno.fin,
                      manicureName,
                      precio: turno.precio,
                    });
                    const calendarDescription = [
                      `Turno #${turno.turno_id}`,
                      `Estado: ${turno.estado || "pendiente"}`,
                      `Manicura: ${manicureName}`,
                      `Local: ${location}`,
                    ].join("\n");

                    return (
                      <article
                        key={turno.turno_id}
                        style={{
                          background: "#fff",
                          border: "1px solid rgba(114,36,62,0.12)",
                          borderRadius: 8,
                          padding: 14,
                          boxShadow: "0 8px 22px rgba(64,30,42,0.06)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
                          <div>
                            <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 17 }}>{formatTimeRange(turno.inicio, turno.fin)}</strong>
                            <span style={{ display: "block", color: "#775866", fontSize: 13, marginTop: 3 }}>
                              Turno #{turno.turno_id}
                            </span>
                          </div>
                          <span
                            style={{
                              background: COLORS.pinkLight,
                              color: COLORS.pinkDark,
                              borderRadius: 8,
                              padding: "6px 9px",
                              fontSize: 12,
                              fontWeight: 800,
                              textTransform: "capitalize",
                            }}
                          >
                            {turno.estado || "pendiente"}
                          </span>
                        </div>
                        <SummaryRow label="Local" value={localAddress ? `${localName} - ${localAddress}` : localName} />
                        <SummaryRow label="Servicio" value={serviceName} />
                        <SummaryRow label="Manicura" value={manicureName} />
                        <SummaryRow label="Precio" value={formatMoney(turno.precio)} />
                        <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
                          <button
                            type="button"
                            onClick={() => handleCopyText(summaryText, "Turno copiado", turno.turno_id)}
                            style={outlineActionButtonStyle}
                          >
                            {copiedTurnId === String(turno.turno_id) ? "Turno copiado" : "Copiar turno"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadCalendar({
                                uid: `niki-turno-${turno.turno_id}`,
                                title: `Niki Beauty Bar - ${serviceName}`,
                                fecha: turno.fecha,
                                inicio: turno.inicio,
                                fin: turno.fin,
                                location,
                                description: calendarDescription,
                              })
                            }
                            style={actionButtonStyle}
                          >
                            Agregar al calendario
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderLocalStep = () => (
    <div style={{ display: "grid", gap: 12 }}>
      {data.locales.map((local) => {
        const list = getDefaultList(local.id);
        return (
          <CardButton key={local.id} selected={normalizeId(form.localId) === normalizeId(local.id)} onClick={() => setLocal(local.id)}>
            <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 17, marginBottom: 5 }}>{local.nombre}</strong>
            {local.direccion && <span style={{ display: "block", color: "#6d4f5b", fontSize: 13, lineHeight: 1.45 }}>{local.direccion}</span>}
            <span style={{ display: "block", color: "#9a7483", fontSize: 12, marginTop: 10 }}>
              {list ? `Lista de precios: ${list.nombre}` : "Precios a confirmar"}
            </span>
          </CardButton>
        );
      })}
      {!data.locales.length && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 18, color: "#6d4f5b", border: "1px solid rgba(114,36,62,0.12)" }}>
          No hay locales activos para mostrar.
        </div>
      )}
    </div>
  );

  const renderTypeStep = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
      {servicesByType.map((group) => (
        <CardButton key={group.tipo} selected={form.tipo === group.tipo} onClick={() => setType(group.tipo)}>
          <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 16, marginBottom: 8 }}>{group.label}</strong>
          <span style={{ color: "#775866", fontSize: 13 }}>
            {group.servicios.length} {group.servicios.length === 1 ? "servicio" : "servicios"}
          </span>
        </CardButton>
      ))}
      {!servicesByType.length && (
        <div style={{ gridColumn: "1 / -1", background: "#fff", borderRadius: 8, padding: 18, color: "#6d4f5b", border: "1px solid rgba(114,36,62,0.12)" }}>
          No hay servicios activos para mostrar.
        </div>
      )}
    </div>
  );

  const renderServiceStep = () => (
    <div style={{ display: "grid", gap: 12 }}>
      {servicesForType.map((service) => {
        const servicePrice = getPriceForService(service.id, form.localId);
        return (
          <CardButton
            key={service.id}
            selected={normalizeId(form.servicioId) === normalizeId(service.id)}
            onClick={() => setForm((prev) => ({ ...prev, servicioId: service.id, manicuraId: "", slot: null }))}
          >
            <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 16, marginBottom: 5 }}>{service.nombre}</strong>
                {service.descripcion && <span style={{ display: "block", color: "#775866", fontSize: 13, lineHeight: 1.45 }}>{service.descripcion}</span>}
                <span style={{ display: "block", color: "#9a7483", fontSize: 12, marginTop: 9 }}>{service.duracionMinutos || 60} min</span>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={{ display: "block", color: COLORS.pinkDark, fontSize: 12, fontWeight: 800 }}>Lista</span>
                <strong style={{ display: "block", color: "#351821", fontSize: 14 }}>{formatMoney(servicePrice.precioLista)}</strong>
                <span style={{ display: "block", color: COLORS.success, fontSize: 12, fontWeight: 800, marginTop: 6 }}>Efectivo</span>
                <strong style={{ display: "block", color: "#351821", fontSize: 14 }}>{formatMoney(servicePrice.precioEfectivo)}</strong>
              </div>
            </div>
          </CardButton>
        );
      })}
      {!servicesForType.length && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 18, color: "#6d4f5b", border: "1px solid rgba(114,36,62,0.12)" }}>
          No encontramos servicios para este tipo.
        </div>
      )}
    </div>
  );

  const renderSlotButton = (slot) => (
    <button
      key={`${slot.fecha}-${slot.inicio}-${slot.userId}`}
      type="button"
      onClick={() => selectSlot(slot)}
      style={{
        border: "1px solid rgba(212,83,126,0.24)",
        borderRadius: 8,
        background: "#fff",
        color: "#351821",
        padding: "10px 11px",
        textAlign: "left",
        cursor: "pointer",
        boxShadow: "0 6px 16px rgba(64,30,42,0.05)",
      }}
    >
      <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 15 }}>{slot.inicio}</strong>
      <span style={{ display: "block", color: "#775866", fontSize: 12, marginTop: 3 }}>
        {slot.manicuraNombre}
      </span>
    </button>
  );

  const renderAvailabilityGroup = (group) => (
    <section key={group.fecha} style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 15 }}>{formatDate(group.fecha)}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 8 }}>
        {group.slots.map(renderSlotButton)}
      </div>
    </section>
  );

  const renderAvailabilityResults = () => {
    if (!selectedService || !form.localId) return null;
    if (!compatibleManicuras.length) return null;

    const groups = form.modalidad === "primer"
      ? firstAvailableGroups
      : [{ fecha: form.fecha, slots: daySlots }];
    const hasSlots = groups.some((group) => group.slots.length > 0);
    const noSlotsText = form.modalidad === "primer"
      ? "No encontramos disponibilidad futura para este servicio y manicura. Probá con otra manicura o servicio."
      : feriadosSet.has(form.fecha)
        ? "El día elegido figura como feriado y no tiene turnos online disponibles."
        : "No encontramos horarios disponibles para ese día. Probá con otra fecha o manicura.";

    return (
      <div style={{ background: "#fff", border: "1px solid rgba(114,36,62,0.12)", borderRadius: 8, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 12 }}>
          <p style={{ margin: 0, color: COLORS.pinkDark, fontSize: 13, fontWeight: 800 }}>Horarios disponibles</p>
          <span style={{ color: "#9a7483", fontSize: 12 }}>{SLOT_STEP_MINUTES} min</span>
        </div>
        {hasSlots ? (
          <div style={{ display: "grid", gap: 18 }}>
            {groups.filter((group) => group.slots.length > 0).map(renderAvailabilityGroup)}
          </div>
        ) : (
          <p style={{ margin: 0, color: "#775866", fontSize: 13, lineHeight: 1.45 }}>
            {noSlotsText}
          </p>
        )}
      </div>
    );
  };

  const renderModeStep = () => (
    <div style={{ display: "grid", gap: 12 }}>
      <CardButton selected={form.modalidad === "primer"} onClick={() => setForm((prev) => ({ ...prev, modalidad: "primer", slot: null }))}>
        <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 16, marginBottom: 6 }}>Primer turno disponible</strong>
        <span style={{ color: "#775866", fontSize: 13, lineHeight: 1.45 }}>
          Te mostramos los horarios próximos con agenda disponible.
        </span>
      </CardButton>
      <CardButton selected={form.modalidad === "dia"} onClick={() => setForm((prev) => ({ ...prev, modalidad: "dia", slot: null }))}>
        <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 16, marginBottom: 6 }}>Buscar un día puntual</strong>
        <span style={{ color: "#775866", fontSize: 13, lineHeight: 1.45 }}>Podés elegir desde hoy en adelante.</span>
      </CardButton>
      {form.modalidad === "dia" && (
        <div style={{ background: "#fff", border: "1px solid rgba(114,36,62,0.12)", borderRadius: 8, padding: 14 }}>
          <Field label="Día preferido">
            <input
              type="date"
              min={todayKey()}
              value={form.fecha}
              onChange={(event) => setForm((prev) => ({ ...prev, fecha: event.target.value, slot: null }))}
              style={inputStyle}
            />
          </Field>
        </div>
      )}
      <div style={{ background: "#fff", border: "1px solid rgba(114,36,62,0.12)", borderRadius: 8, padding: 14 }}>
        <p style={{ margin: "0 0 10px", color: COLORS.pinkDark, fontSize: 13, fontWeight: 800 }}>Manicura</p>
        {compatibleManicuras.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, manicuraId: "", slot: null }))}
              style={{
                border: !form.manicuraId ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.14)",
                borderRadius: 8,
                background: !form.manicuraId ? COLORS.pinkLight : "#fff",
                color: COLORS.pinkDark,
                padding: "9px 12px",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Sin preferencia
            </button>
            {compatibleManicuras.map((manicura) => (
              <button
                key={manicura.id}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, manicuraId: manicura.id, slot: null }))}
                style={{
                  border: normalizeId(form.manicuraId) === normalizeId(manicura.id) ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.14)",
                  borderRadius: 8,
                  background: normalizeId(form.manicuraId) === normalizeId(manicura.id) ? COLORS.pinkLight : "#fff",
                  color: COLORS.pinkDark,
                  padding: "9px 12px",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {manicura.nombre}
              </button>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: "#775866", fontSize: 13, lineHeight: 1.45 }}>
            No encontramos manicuras habilitadas para este servicio en el local elegido.
          </p>
        )}
      </div>
      {renderAvailabilityResults()}
    </div>
  );

  const renderClientStep = () => (
    <div style={{ display: "grid", gap: 14 }}>
      <Field label="Nombre y apellido">
        <input
          value={form.nombre}
          onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))}
          placeholder="Ej: Martina Pérez"
          style={inputStyle}
        />
      </Field>
      <Field label="WhatsApp o teléfono">
        <input
          value={form.telefono}
          onChange={(event) => setForm((prev) => ({ ...prev, telefono: event.target.value }))}
          placeholder="Ej: 11 5555 5555"
          style={inputStyle}
        />
      </Field>
      <Field label="Email">
        <input
          type="email"
          value={form.email}
          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          placeholder="tu@email.com"
          style={inputStyle}
        />
      </Field>
      <Field label="Observaciones">
        <textarea
          value={form.observacion}
          onChange={(event) => setForm((prev) => ({ ...prev, observacion: event.target.value }))}
          placeholder="Contanos si necesitás algo especial"
          style={{ ...inputStyle, minHeight: 92, resize: "vertical" }}
        />
      </Field>
      <p style={{ margin: 0, color: "#8a6875", fontSize: 12, lineHeight: 1.45 }}>
        Para seguir, completá nombre y al menos un contacto.
      </p>
    </div>
  );

  const renderConfirmationStep = () => {
    if (bookingResult?.ok) {
      const confirmedLocal = bookingResult.local || selectedLocal || {};
      const confirmedLocalName = confirmedLocal.nombre || selectedLocal?.nombre || "Sin local";
      const confirmedLocalAddress = getLocalAddress(confirmedLocal) || getLocalAddress(selectedLocal);
      const confirmedServiceName = bookingResult.servicio?.nombre || selectedService?.nombre || "Sin servicio";
      const confirmedManicureName = bookingResult.manicura?.nombre || form.slot?.manicuraNombre || "Sin preferencia";
      const confirmedContact = formatContact(form.telefono, form.email);
      const confirmedPrecioLista = selectedPrice?.precioLista || bookingResult.precio_lista || 0;
      const confirmedPrecioEfectivo = selectedPrice?.precioEfectivo || bookingResult.precio_efectivo || 0;
      const location = [confirmedLocalName, confirmedLocalAddress].filter(Boolean).join(" - ");
      const summaryText = buildBookingSummaryText({
        turnoId: bookingResult.turno_id,
        localName: confirmedLocalName,
        localAddress: confirmedLocalAddress,
        serviceName: confirmedServiceName,
        fecha: bookingResult.fecha,
        inicio: bookingResult.inicio,
        fin: bookingResult.fin,
        manicureName: confirmedManicureName,
        clientName: form.nombre,
        telefono: form.telefono,
        email: form.email,
        precioLista: confirmedPrecioLista,
        precioEfectivo: confirmedPrecioEfectivo,
      });
      const calendarDescription = [
        `Turno #${bookingResult.turno_id}`,
        `Manicura: ${confirmedManicureName}`,
        `Cliente: ${form.nombre || "Sin nombre"}`,
        `Contacto: ${confirmedContact}`,
      ].join("\n");

      return (
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              background: COLORS.pinkLight,
              border: `1px solid rgba(212,83,126,0.28)`,
              borderRadius: 8,
              padding: 18,
              textAlign: "center",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 42,
                height: 42,
                borderRadius: "50%",
                background: COLORS.pink,
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 800,
                marginBottom: 10,
              }}
            >
              ✓
            </div>
            <h2 style={{ margin: "0 0 8px", color: COLORS.pinkDark, fontSize: 22 }}>Turno confirmado</h2>
            <p style={{ margin: 0, color: "#6c4857", fontSize: 14, lineHeight: 1.5 }}>
              Tu número de turno es <strong>#{bookingResult.turno_id}</strong>.
            </p>
          </div>

          {actionError && (
            <div style={{ background: "#fff0f3", color: COLORS.pinkDark, border: "1px solid rgba(212,83,126,0.28)", borderRadius: 8, padding: "11px 13px", fontSize: 13 }}>
              {actionError}
            </div>
          )}
          {copyFeedback && (
            <div style={{ background: "#f8fff7", color: "#2f6b3d", border: "1px solid rgba(72,150,88,0.24)", borderRadius: 8, padding: "11px 13px", fontSize: 13, fontWeight: 800 }}>
              {copyFeedback}
            </div>
          )}

          <div style={{ background: "#fff", border: "1px solid rgba(114,36,62,0.12)", borderRadius: 8, padding: "8px 16px" }}>
            <SummaryRow label="Número" value={`#${bookingResult.turno_id}`} />
            <SummaryRow label="Local" value={confirmedLocalName} />
            {confirmedLocalAddress && <SummaryRow label="Dirección" value={confirmedLocalAddress} />}
            <SummaryRow label="Servicio" value={confirmedServiceName} />
            {confirmedPrecioLista ? <SummaryRow label="Precio lista" value={formatMoney(confirmedPrecioLista)} /> : null}
            {confirmedPrecioEfectivo ? <SummaryRow label="Precio efectivo" value={formatMoney(confirmedPrecioEfectivo)} /> : null}
            <SummaryRow label="Fecha" value={formatDate(bookingResult.fecha)} />
            <SummaryRow label="Horario" value={formatTimeRange(bookingResult.inicio, bookingResult.fin)} />
            <SummaryRow label="Manicura" value={confirmedManicureName} />
            <SummaryRow label="Clienta" value={form.nombre || "Sin nombre"} />
            <SummaryRow label="Contacto" value={confirmedContact} subtle />
          </div>

          <div style={{ background: "#fff7fa", border: "1px solid rgba(114,36,62,0.1)", borderRadius: 8, padding: 14, color: "#6c4857", fontSize: 13, lineHeight: 1.55 }}>
            <p style={{ margin: "0 0 6px" }}>Te recomendamos llegar 5 minutos antes.</p>
            <p style={{ margin: "0 0 6px" }}>Si necesitás modificar o cancelar el turno, comunicate con el local.</p>
            <p style={{ margin: 0 }}>Guardá esta información para consultar tu turno más adelante.</p>
          </div>

          <div style={{ display: "grid", gap: 9 }}>
            <button type="button" onClick={() => handleCopyText(summaryText, "Datos copiados")} style={actionButtonStyle}>
              Copiar datos del turno
            </button>
            <button
              type="button"
              onClick={() =>
                handleDownloadCalendar({
                  uid: `niki-turno-${bookingResult.turno_id}`,
                  title: `Niki Beauty Bar - ${confirmedServiceName}`,
                  fecha: bookingResult.fecha,
                  inicio: bookingResult.inicio,
                  fin: bookingResult.fin,
                  location,
                  description: calendarDescription,
                })
              }
              style={outlineActionButtonStyle}
            >
              Agregar al calendario
            </button>
            <button type="button" onClick={resetFlow} style={outlineActionButtonStyle}>
              Reservar otro turno
            </button>
            <button
              type="button"
              onClick={() => {
                setLookup((prev) => ({
                  email: form.email || prev.email,
                  telefono: form.telefono || prev.telefono,
                }));
                switchView("mis_turnos");
              }}
              style={outlineActionButtonStyle}
            >
              Consultar mis turnos
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          background: COLORS.pinkLight,
          border: `1px solid rgba(212,83,126,0.28)`,
          borderRadius: 8,
          padding: 18,
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: COLORS.pink,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 10,
          }}
        >
          ✓
        </div>
        <h2 style={{ margin: "0 0 8px", color: COLORS.pinkDark, fontSize: 22 }}>Confirmá tu turno</h2>
        <p style={{ margin: 0, color: "#6c4857", fontSize: 14, lineHeight: 1.5 }}>
          Vamos a revalidar la disponibilidad antes de guardarlo.
        </p>
      </div>
      <div style={{ background: "#fff", border: "1px solid rgba(114,36,62,0.12)", borderRadius: 8, padding: "8px 16px" }}>
        <SummaryRow label="Local" value={selectedLocal?.nombre || "Sin local"} />
        <SummaryRow label="Servicio" value={selectedService?.nombre || "Sin servicio"} />
        <SummaryRow label="Tipo" value={selectedService ? typeLabel(selectedService.tipo) : "Sin tipo"} />
        <SummaryRow label="Modalidad" value={form.modalidad === "primer" ? "Primer turno disponible" : `Día puntual: ${formatDate(form.fecha)}`} />
        <SummaryRow label="Fecha" value={formatDate(form.slot?.fecha)} />
        <SummaryRow label="Hora" value={form.slot ? `${form.slot.inicio} - ${form.slot.fin}` : "Sin horario"} />
        <SummaryRow label="Manicura" value={form.slot?.manicuraNombre || selectedManicura?.nombre || "Sin preferencia"} />
        <SummaryRow label="Precio lista" value={formatMoney(selectedPrice?.precioLista)} />
        <SummaryRow label="Precio efectivo" value={formatMoney(selectedPrice?.precioEfectivo)} />
        <SummaryRow label="Clienta" value={form.nombre || "Sin nombre"} />
        <SummaryRow label="Contacto" value={formatContact(form.telefono, form.email)} subtle />
      </div>
      <button
        type="button"
        onClick={confirmPublicBooking}
        disabled={bookingLoading}
        style={{
          ...primaryButtonStyle,
          cursor: bookingLoading ? "not-allowed" : "pointer",
          opacity: bookingLoading ? 0.72 : 1,
        }}
      >
        {bookingLoading ? "Confirmando..." : "Confirmar turno"}
      </button>
      <button type="button" onClick={resetFlow} style={secondaryButtonStyle}>
        Reservar otro turno
      </button>
    </div>
    );
  };

  const renderStep = () => {
    if (currentStep.id === "local") return renderLocalStep();
    if (currentStep.id === "tipo") return renderTypeStep();
    if (currentStep.id === "servicio") return renderServiceStep();
    if (currentStep.id === "modalidad") return renderModeStep();
    if (currentStep.id === "datos") return renderClientStep();
    return renderConfirmationStep();
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #fff7fa 0%, #fbeaf0 48%, #fff 100%)",
        color: "#351821",
        fontFamily: "'Montserrat', sans-serif",
        padding: "18px 14px 32px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 980, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 0 20px",
          }}
        >
          <LogoMark size={54} variant="light" />
          <div>
            <p style={{ margin: "0 0 3px", color: COLORS.pinkDark, fontSize: 13, fontWeight: 800 }}>Niki Beauty Bar</p>
            <h1 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 28, lineHeight: 1.05, fontWeight: 800 }}>
              Reservá tu turno
            </h1>
          </div>
        </header>

        <nav style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => switchView("reservar")}
            style={{
              border: publicView === "reservar" ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.16)",
              borderRadius: 8,
              background: publicView === "reservar" ? COLORS.pinkLight : "#fff",
              color: COLORS.pinkDark,
              padding: "11px 12px",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Reservar turno
          </button>
          <button
            type="button"
            onClick={() => switchView("mis_turnos")}
            style={{
              border: publicView === "mis_turnos" ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.16)",
              borderRadius: 8,
              background: publicView === "mis_turnos" ? COLORS.pinkLight : "#fff",
              color: COLORS.pinkDark,
              padding: "11px 12px",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Consultar mis turnos
          </button>
        </nav>

        {publicView === "mis_turnos" ? (
          renderMyBookingsView()
        ) : (
          <>
        <section
          style={{
            background: "rgba(255,255,255,0.78)",
            border: "1px solid rgba(114,36,62,0.1)",
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            boxShadow: "0 12px 30px rgba(64,30,42,0.08)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 5, marginBottom: 12 }}>
            {STEPS.map((item, index) => (
              <div
                key={item.id}
                style={{
                  height: 5,
                  borderRadius: 8,
                  background: index <= step ? COLORS.pink : "#efd2dc",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <span style={{ color: COLORS.pinkDark, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
              Paso {step + 1} de {STEPS.length}
            </span>
            <span style={{ color: "#8a6875", fontSize: 12, fontWeight: 700 }}>{currentStep.label}</span>
          </div>
        </section>

        {priceWarning && !loading && !error && (
          <div style={{ background: "#fff7df", color: "#805817", border: "1px solid #ead38d", borderRadius: 8, padding: "11px 13px", fontSize: 13, marginBottom: 14 }}>
            {priceWarning}
          </div>
        )}

        {bookingError && !loading && !error && (
          <div style={{ background: "#fff0f3", color: COLORS.pinkDark, border: "1px solid rgba(212,83,126,0.28)", borderRadius: 8, padding: "11px 13px", fontSize: 13, marginBottom: 14 }}>
            {bookingError}
          </div>
        )}

        {loading ? (
          renderLoading()
        ) : error ? (
          renderError()
        ) : (
          <section
            style={{
              background: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(114,36,62,0.1)",
              borderRadius: 8,
              padding: 16,
              boxShadow: "0 14px 34px rgba(64,30,42,0.08)",
            }}
          >
            <div style={{ marginBottom: 18 }}>
              <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 22, lineHeight: 1.15 }}>
                {currentStep.id === "local" && "Elegí el local"}
                {currentStep.id === "tipo" && "Elegí el tipo de servicio"}
                {currentStep.id === "servicio" && "Elegí el servicio"}
                {currentStep.id === "modalidad" && "Elegí cómo buscar turno"}
                {currentStep.id === "datos" && "Tus datos"}
                {currentStep.id === "confirmacion" && "Resumen"}
              </h2>
              <p style={{ margin: 0, color: "#735260", fontSize: 14, lineHeight: 1.45 }}>
                {currentStep.id === "local" && "Seleccioná dónde querés atenderte."}
                {currentStep.id === "tipo" && "Los servicios están agrupados por categoría."}
                {currentStep.id === "servicio" && "Los precios se muestran según la lista disponible para el local."}
                {currentStep.id === "modalidad" && "Elegí un horario disponible para avanzar con tus datos."}
                {currentStep.id === "datos" && "Usamos estos datos para registrar y consultar tu turno."}
                {currentStep.id === "confirmacion" && "Revisá los datos antes de confirmar la reserva."}
              </p>
            </div>

            {renderStep()}

            {!isFinal && (
              <div style={{ display: "grid", gridTemplateColumns: step === 0 ? "1fr" : "1fr 1fr", gap: 10, marginTop: 20 }}>
                {step > 0 && (
                  <button type="button" onClick={goBack} style={secondaryButtonStyle}>
                    Volver
                  </button>
                )}
                <button type="button" onClick={goNext} disabled={!canContinue()} style={primaryButtonStyle}>
                  Continuar
                </button>
              </div>
            )}
            {isFinal && step > 0 && !bookingResult && (
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={goBack} style={secondaryButtonStyle}>
                  Volver
                </button>
              </div>
            )}
          </section>
        )}
          </>
        )}
      </div>
    </main>
  );
}
