import { useEffect, useMemo, useState } from "react";
import { COLORS, LogoMark, SUPABASE_KEY, SUPABASE_URL } from "./App.jsx";
import PublicClientIdentity, {
  clearPublicClientSession,
  refreshPublicClientSession,
  createPublicBooking as createVerifiedPublicBooking,
  fetchClientBookings as fetchVerifiedClientBookings,
} from "./PublicClientIdentity.jsx";

const STEPS = [
  { id: "local", label: "Local" },
  { id: "servicio", label: "Servicio" },
  { id: "personaliza", label: "Personalizá" },
  { id: "horario", label: "Horario" },
  { id: "datos", label: "Datos" },
  { id: "confirmacion", label: "Confirmación" },
];

const SERVICE_TYPE_LABELS = {
  manos: "Manos",
  pies: "Pies",
  "cejas y pestañas": "Cejas y pestañas",
  otros: "Otros",
};

const CROSS_SELL_TYPES = {
  manos: ["pies", "cejas y pestañas"],
  pies: ["manos", "cejas y pestañas"],
  "cejas y pestañas": ["manos", "pies"],
  otros: ["manos", "pies"],
};

const DAY_PARTS = [
  { id: "manana", label: "Mañana", from: 0, to: 12 * 60 },
  { id: "mediodia", label: "Mediodía y primera tarde", from: 12 * 60, to: 16 * 60 },
  { id: "tarde", label: "Tarde", from: 16 * 60, to: 24 * 60 },
];

const SLOT_STEP_MINUTES = 10;
const FIRST_AVAILABLE_MAX_DAYS = 5;
const FIRST_AVAILABLE_MAX_SLOTS = 36;
const MAX_COMPLEMENTARY_SERVICES = 2;

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

function formatMoney(value, zeroLabel = "A confirmar") {
  const n = toNumber(value);
  if (!n) return zeroLabel;
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

function typeKey(value) {
  return normalizeText(value).toLowerCase() || "otros";
}

function typeLabel(value) {
  const key = typeKey(value);
  return SERVICE_TYPE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
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
  return [normalizeText(telefono), normalizeText(email)].filter(Boolean).join(" · ") || "Sin contacto";
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

function groupSlotsByDayPart(slots = []) {
  return DAY_PARTS.map((part) => ({
    ...part,
    slots: slots.filter((slot) => {
      const min = agendaMin(slot.inicio);
      return min >= part.from && min < part.to;
    }),
  })).filter((part) => part.slots.length > 0);
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
    esRetiro: row.es_retiro === true,
    retiroAplicaTipo: normalizeText(row.retiro_aplica_tipo).toLowerCase(),
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
    nombre: row.nombre || "Profesional",
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

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "grid", gap: 7, color: "#5f3a49", fontSize: 13, fontWeight: 800 }}>
      <span>{label}</span>
      {children}
      {hint ? <span style={{ color: "#9a7483", fontSize: 11, fontWeight: 500 }}>{hint}</span> : null}
    </label>
  );
}

function SummaryRow({ label, value, strong = false }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid rgba(114,36,62,0.08)" }}>
      <span style={{ color: "#80616e", fontSize: 13 }}>{label}</span>
      <span style={{ color: "#351821", fontSize: 13, fontWeight: strong ? 900 : 700, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function SoftCard({ selected = false, onClick, children, disabled = false, style = {} }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        textAlign: "left",
        border: selected ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.11)",
        borderRadius: 16,
        background: selected ? "linear-gradient(135deg,#fff3f7,#fff)" : "#fff",
        color: "#351821",
        padding: 16,
        boxShadow: selected ? "0 12px 30px rgba(212,83,126,0.14)" : "0 8px 24px rgba(64,30,42,0.055)",
        cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
        opacity: disabled ? 0.55 : 1,
        font: "inherit",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

function Pill({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: selected ? `1.5px solid ${COLORS.pink}` : "1px solid rgba(114,36,62,0.13)",
        borderRadius: 999,
        background: selected ? COLORS.pinkLight : "#fff",
        color: COLORS.pinkDark,
        padding: "9px 13px",
        fontSize: 13,
        fontWeight: 850,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
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
  const [clientSession, setClientSession] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [copiedTurnId, setCopiedTurnId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [step, setStep] = useState(0);
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
  const [form, setForm] = useState({
    localId: "",
    tipo: "",
    servicioId: "",
    serviciosExtraIds: [],
    retiroOrigen: "ninguno",
    retiroServicioId: "",
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

        if ([listasRes.error, localListasRes.error, preciosRes.error].filter(Boolean).length) {
          setPriceWarning("Algunos precios no se pudieron cargar. Los servicios pueden aparecer con precio a confirmar.");
        }

        setData({
          locales: (localesRows || []).map(normalizeLocal).filter((x) => x.activo),
          servicios: (serviciosRows || []).map(normalizeService).filter((x) => x.activo),
          listas: (listasRes.data || []).map(normalizeList).filter((x) => x.activo),
          localListas: (localListasRes.data || []).map(normalizeLocalList).filter((x) => x.activo),
          precios: (preciosRes.data || []).map(normalizePrice),
          manicuras: (manicurasRows || []).map(normalizeManicura).filter((x) => x.activo && x.rol === "manicura"),
          horarios: (horariosRows || []).map(normalizeHorario).filter((x) => x.fecha && x.entrada && x.salida && x.trabaja),
          turnos: (turnosRows || []).map(normalizeTurno).filter((x) => x.fecha && x.inicio && x.fin),
          bloqueos: (bloqueosRows || []).map(normalizeBloqueo).filter((x) => x.fecha && x.inicio && x.fin),
          manicuraServicios: (manicuraServiciosRows || []).map(normalizeManicuraServicio).filter((x) => x.activo),
          feriados: (feriadosRows || []).map((row) => row.fecha).filter(Boolean),
        });
      } catch (err) {
        if (!controller.signal.aborted) setError(err?.message || "No se pudieron cargar los datos de reservas.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadPublicData();
    return () => controller.abort();
  }, [reloadKey]);

  const handleClientIdentity = (session, profile) => {
    setClientSession(session);
    setClientProfile(profile);

    if (!session) {
      setForm((prev) => ({ ...prev, nombre: "", telefono: "", email: "" }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      email: profile?.email || session?.user?.email || prev.email,
      nombre: profile?.cliente?.nombre || prev.nombre,
      telefono: profile?.cliente?.telefono || prev.telefono,
    }));
  };

  const selectedLocal = useMemo(
    () => data.locales.find((local) => normalizeId(local.id) === normalizeId(form.localId)) || null,
    [data.locales, form.localId]
  );

  const selectedService = useMemo(
    () => data.servicios.find((service) => normalizeId(service.id) === normalizeId(form.servicioId)) || null,
    [data.servicios, form.servicioId]
  );

  const selectedExtraServices = useMemo(
    () => form.serviciosExtraIds.map((id) => data.servicios.find((service) => normalizeId(service.id) === normalizeId(id))).filter(Boolean),
    [form.serviciosExtraIds, data.servicios]
  );

  const selectedRetiroService = useMemo(
    () => data.servicios.find((service) => normalizeId(service.id) === normalizeId(form.retiroServicioId)) || null,
    [data.servicios, form.retiroServicioId]
  );

  const selectedManicura = useMemo(
    () => data.manicuras.find((manicura) => normalizeId(manicura.id) === normalizeId(form.manicuraId)) || null,
    [data.manicuras, form.manicuraId]
  );

  const feriadosSet = useMemo(() => new Set(data.feriados), [data.feriados]);

  const serviceAssignmentByKey = useMemo(() => {
    const map = new Map();
    data.manicuraServicios.forEach((rel) => map.set(`${rel.userId}-${rel.servicioId}`, rel));
    return map;
  }, [data.manicuraServicios]);

  const activeManicurasForLocal = useMemo(() => {
    const lid = parseInt(form.localId, 10);
    if (!lid) return [];
    return data.manicuras.filter((m) => parseInt(m.localId, 10) === lid && m.activo);
  }, [data.manicuras, form.localId]);

  const servicesAvailableForLocal = useMemo(() => {
    const userIds = new Set(activeManicurasForLocal.map((m) => normalizeId(m.id)));
    const serviceIds = new Set(
      data.manicuraServicios
        .filter((rel) => rel.activo && userIds.has(normalizeId(rel.userId)))
        .map((rel) => normalizeId(rel.servicioId))
    );
    return data.servicios.filter((service) => serviceIds.has(normalizeId(service.id)) && service.activo);
  }, [activeManicurasForLocal, data.manicuraServicios, data.servicios]);

  const mainServicesForLocal = useMemo(
    () => servicesAvailableForLocal.filter((service) => !service.esRetiro),
    [servicesAvailableForLocal]
  );

  const serviceTypes = useMemo(() => {
    const counts = new Map();
    mainServicesForLocal.forEach((service) => {
      const key = typeKey(service.tipo);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([tipo, count]) => ({ tipo, label: typeLabel(tipo), count }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [mainServicesForLocal]);

  const servicesForType = useMemo(() => {
    const selectedType = form.tipo || serviceTypes[0]?.tipo || "";
    return mainServicesForLocal.filter((service) => typeKey(service.tipo) === selectedType);
  }, [mainServicesForLocal, form.tipo, serviceTypes]);

  const retiroServices = useMemo(() => {
    if (!selectedService) return [];
    const key = typeKey(selectedService.tipo);
    return servicesAvailableForLocal.filter(
      (service) => service.esRetiro && (!service.retiroAplicaTipo || service.retiroAplicaTipo === key)
    );
  }, [servicesAvailableForLocal, selectedService]);

  const suggestedServices = useMemo(() => {
    if (!selectedService) return [];
    const allowedTypes = CROSS_SELL_TYPES[typeKey(selectedService.tipo)] || [];
    const selectedExtraIds = new Set(form.serviciosExtraIds.map(normalizeId));
    const candidates = mainServicesForLocal.filter(
      (service) =>
        allowedTypes.includes(typeKey(service.tipo)) &&
        normalizeId(service.id) !== normalizeId(selectedService.id)
    );

    const selectedRows = candidates.filter((service) => selectedExtraIds.has(normalizeId(service.id)));
    const byType = new Map();
    for (const service of candidates.filter((service) => !selectedExtraIds.has(normalizeId(service.id)))) {
      const key = typeKey(service.tipo);
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(service);
    }

    const result = [...selectedRows];
    for (const type of allowedTypes) {
      const rows = (byType.get(type) || []).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      result.push(...rows.slice(0, 2));
    }
    return result.slice(0, 4);
  }, [selectedService, mainServicesForLocal, form.serviciosExtraIds]);

  const primaryCompatibleManicuras = useMemo(() => {
    if (!selectedService) return [];
    return activeManicurasForLocal.filter((m) => serviceAssignmentByKey.has(`${m.id}-${selectedService.id}`));
  }, [selectedService, activeManicurasForLocal, serviceAssignmentByKey]);

  const priceByKey = useMemo(() => {
    const map = new Map();
    data.precios.forEach((price) => map.set(`${price.listaId}-${price.servicioId}`, price));
    return map;
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

  const getPriceForService = (serviceId) => {
    const list = getDefaultList(form.localId);
    const price = list ? priceByKey.get(`${list.id}-${serviceId}`) : null;
    return {
      list,
      precioLista: price?.precioLista || 0,
      precioEfectivo: price?.precioEfectivo || 0,
    };
  };

  const bookingServices = useMemo(() => {
    const rows = [];
    if (selectedRetiroService && form.retiroOrigen !== "ninguno") rows.push({ service: selectedRetiroService, kind: "retiro" });
    if (selectedService) rows.push({ service: selectedService, kind: "principal" });
    selectedExtraServices.forEach((service) => rows.push({ service, kind: "complementario" }));
    return rows;
  }, [selectedRetiroService, selectedService, selectedExtraServices, form.retiroOrigen]);

  const estimatedDuration = useMemo(
    () => bookingServices.reduce((sum, item) => sum + Number(item.service.duracionMinutos || 0), 0),
    [bookingServices]
  );

  const estimatedPrices = useMemo(() => {
    let lista = 0;
    let efectivo = 0;
    bookingServices.forEach((item) => {
      const p = getPriceForService(item.service.id);
      const freeRetiro = item.kind === "retiro" && form.retiroOrigen === "niki";
      if (!freeRetiro) {
        lista += p.precioLista;
        efectivo += p.precioEfectivo;
      }
    });
    return { lista, efectivo };
  }, [bookingServices, form.localId, form.retiroOrigen, priceByKey, data.localListas, data.listas]);

  const getDurationForUserService = (userId, service) => {
    const rel = serviceAssignmentByKey.get(`${userId}-${service.id}`);
    return parseInt(rel?.duracionMinutos || service.duracionMinutos || 60, 10) || 60;
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

  const userIsFree = (fecha, userId, start, end) => {
    const horarios = data.horarios.filter((h) => h.fecha === fecha && normalizeId(h.userId) === normalizeId(userId));
    const insideSchedule = horarios.some((h) => start >= agendaMin(h.entrada) && end <= agendaMin(h.salida));
    if (!insideSchedule) return false;

    const blocked = getApplicableBloqueos(fecha, userId).some((b) => overlaps(start, end, agendaMin(b.inicio), agendaMin(b.fin)));
    if (blocked) return false;

    return !data.turnos.some((turno) => {
      if (turno.fecha !== fecha || normalizeId(turno.userId) !== normalizeId(userId)) return false;
      if (["cancelado", "no asiste"].includes(String(turno.estado || "").toLowerCase())) return false;
      return overlaps(start, end, agendaMin(turno.inicio), agendaMin(turno.fin));
    });
  };

  const buildPlanForStart = (fecha, startMinute) => {
    if (!selectedService || !bookingServices.length) return null;
    let cursor = startMinute;
    const plan = [];

    for (const item of bookingServices) {
      let candidates = activeManicurasForLocal.filter((m) => serviceAssignmentByKey.has(`${m.id}-${item.service.id}`));
      if (item.kind === "principal" && form.manicuraId) {
        candidates = candidates.filter((m) => normalizeId(m.id) === normalizeId(form.manicuraId));
      } else if (form.manicuraId) {
        candidates = [...candidates].sort((a, b) => {
          const pa = normalizeId(a.id) === normalizeId(form.manicuraId) ? 0 : 1;
          const pb = normalizeId(b.id) === normalizeId(form.manicuraId) ? 0 : 1;
          return pa - pb || a.nombre.localeCompare(b.nombre, "es");
        });
      }

      let chosen = null;
      for (const user of candidates) {
        const duration = getDurationForUserService(user.id, item.service);
        const end = cursor + duration;
        if (userIsFree(fecha, user.id, cursor, end)) {
          chosen = {
            ...item,
            userId: user.id,
            userName: user.nombre,
            inicio: agendaTime(cursor),
            fin: agendaTime(end),
            duration,
          };
          cursor = end;
          break;
        }
      }

      if (!chosen) return null;
      plan.push(chosen);
    }

    return plan;
  };

  const getAvailableSlotsForDate = (fecha) => {
    if (!selectedService || !form.localId || !fecha || feriadosSet.has(fecha)) return [];
    if (fecha < todayKey()) return [];

    const daySchedules = data.horarios.filter((h) => h.fecha === fecha && activeManicurasForLocal.some((m) => normalizeId(m.id) === normalizeId(h.userId)));
    if (!daySchedules.length) return [];

    const earliest = Math.min(...daySchedules.map((h) => agendaMin(h.entrada)));
    const latest = Math.max(...daySchedules.map((h) => agendaMin(h.salida)));
    const todayMin = fecha === todayKey() ? ceilToStep(currentMinutes()) : 0;
    const startAt = Math.max(earliest, todayMin);
    const slots = [];
    const seen = new Set();

    for (let start = ceilToStep(startAt); start < latest; start += SLOT_STEP_MINUTES) {
      const plan = buildPlanForStart(fecha, start);
      if (!plan?.length) continue;
      const end = plan.at(-1)?.fin;
      const key = `${fecha}-${agendaTime(start)}-${plan.map((p) => p.userId).join("-")}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const uniquePros = Array.from(new Set(plan.map((p) => p.userName)));
      const primary = plan.find((p) => p.kind === "principal") || plan[0];
      slots.push({
        fecha,
        inicio: agendaTime(start),
        fin: end,
        plan,
        userId: primary.userId,
        manicuraNombre: primary.userName,
        profesionales: uniquePros,
        duracionMinutos: plan.reduce((sum, p) => sum + p.duration, 0),
      });
    }

    return slots.sort((a, b) => a.inicio.localeCompare(b.inicio));
  };

  const futureScheduleDates = useMemo(() => {
    const today = todayKey();
    return Array.from(new Set(data.horarios.filter((h) => h.fecha >= today).map((h) => h.fecha))).sort();
  }, [data.horarios]);

  const daySlots = useMemo(
    () => getAvailableSlotsForDate(form.fecha),
    [form.fecha, form.localId, form.manicuraId, bookingServices, data.horarios, data.turnos, data.bloqueos, feriadosSet]
  );

  const firstAvailableGroups = useMemo(() => {
    if (!selectedService || !form.localId || !bookingServices.length) return [];
    const groups = [];
    let totalSlots = 0;
    for (const fecha of futureScheduleDates) {
      if (feriadosSet.has(fecha)) continue;
      const slots = getAvailableSlotsForDate(fecha);
      if (!slots.length) continue;
      const visible = slots.slice(0, Math.max(4, FIRST_AVAILABLE_MAX_SLOTS - totalSlots));
      groups.push({ fecha, slots: visible });
      totalSlots += visible.length;
      if (groups.length >= FIRST_AVAILABLE_MAX_DAYS || totalSlots >= FIRST_AVAILABLE_MAX_SLOTS) break;
    }
    return groups;
  }, [selectedService, form.localId, form.manicuraId, bookingServices, futureScheduleDates, data.horarios, data.turnos, data.bloqueos, feriadosSet]);

  const currentStep = STEPS[step];
  const isFinal = currentStep.id === "confirmacion";

  const setStepById = (id) => {
    const index = STEPS.findIndex((x) => x.id === id);
    if (index >= 0) setStep(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setLocal = (localId) => {
    setBookingError("");
    setBookingResult(null);
    setForm((prev) => ({
      ...prev,
      localId,
      tipo: "",
      servicioId: "",
      serviciosExtraIds: [],
      retiroOrigen: "ninguno",
      retiroServicioId: "",
      manicuraId: "",
      slot: null,
    }));
    setStepById("servicio");
  };

  const selectService = (service) => {
    setBookingError("");
    setBookingResult(null);
    setForm((prev) => ({
      ...prev,
      tipo: typeKey(service.tipo),
      servicioId: service.id,
      serviciosExtraIds: [],
      retiroOrigen: "ninguno",
      retiroServicioId: "",
      manicuraId: "",
      slot: null,
    }));
    setStepById("personaliza");
  };

  const toggleExtraService = (serviceId) => {
    setForm((prev) => {
      const exists = prev.serviciosExtraIds.some((id) => normalizeId(id) === normalizeId(serviceId));
      if (exists) {
        return { ...prev, serviciosExtraIds: prev.serviciosExtraIds.filter((id) => normalizeId(id) !== normalizeId(serviceId)), slot: null };
      }
      if (prev.serviciosExtraIds.length >= MAX_COMPLEMENTARY_SERVICES) return prev;
      return { ...prev, serviciosExtraIds: [...prev.serviciosExtraIds, serviceId], slot: null };
    });
  };

  const setRetiroOrigin = (origin) => {
    setForm((prev) => ({
      ...prev,
      retiroOrigen: origin,
      retiroServicioId: origin === "ninguno" ? "" : (retiroServices.length === 1 ? retiroServices[0].id : prev.retiroServicioId),
      slot: null,
    }));
  };

  const personalizeCanContinue = () => {
    if (!selectedService) return false;
    if (form.retiroOrigen !== "ninguno" && retiroServices.length > 1 && !form.retiroServicioId) return false;
    return true;
  };

  const selectSlot = (slot) => {
    setBookingError("");
    setBookingResult(null);
    setForm((prev) => ({ ...prev, slot }));
    setStepById("datos");
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
      serviciosExtraIds: [],
      retiroOrigen: "ninguno",
      retiroServicioId: "",
      modalidad: "primer",
      manicuraId: "",
      slot: null,
      fecha: todayKey(),
      nombre: clientProfile?.cliente?.nombre || "",
      telefono: clientProfile?.cliente?.telefono || "",
      email: clientProfile?.email || clientSession?.user?.email || "",
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

    if (!clientSession?.refresh_token) {
      setLookupError("Verificá tu email para consultar tus turnos.");
      return;
    }

    setLookupLoading(true);
    try {
      const fresh = await refreshPublicClientSession({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });
      if (!fresh?.access_token) {
        clearPublicClientSession();
        setClientSession(null);
        setClientProfile(null);
        setLookupError("Tu sesión venció. Verificá nuevamente tu email.");
        return;
      }
      setClientSession(fresh);
      const result = await fetchVerifiedClientBookings({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_KEY,
        accessToken: fresh.access_token,
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
    if (!clientSession?.refresh_token) {
      setBookingError("Verificá tu email antes de confirmar el turno.");
      setStepById("datos");
      return;
    }

    setBookingLoading(true);
    setBookingError("");
    setActionError("");
    setCopyFeedback("");

    try {
      const fresh = await refreshPublicClientSession({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY });
      if (!fresh?.access_token) {
        clearPublicClientSession();
        setClientSession(null);
        setClientProfile(null);
        setBookingError("Tu sesión venció. Verificá nuevamente tu email.");
        setStepById("datos");
        return;
      }
      setClientSession(fresh);

      const payload = {
        local_id: parseInt(form.localId, 10),
        servicio_id: parseInt(form.servicioId, 10),
        servicio_ids: [parseInt(form.servicioId, 10), ...form.serviciosExtraIds.map((id) => parseInt(id, 10))],
        retiro: {
          origen: form.retiroOrigen,
          servicio_id: form.retiroServicioId ? parseInt(form.retiroServicioId, 10) : null,
        },
        fecha: form.slot.fecha,
        inicio: form.slot.inicio,
        modalidad: form.manicuraId ? "manicura" : "sin_preferencia",
        ...(form.manicuraId ? { user_id: parseInt(form.manicuraId, 10) } : {}),
        cliente: {
          nombre: normalizeText(form.nombre),
          email: normalizeText(form.email),
          telefono: normalizeText(form.telefono),
        },
        observacion: normalizeText(form.observacion),
      };

      const result = await createVerifiedPublicBooking({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_KEY,
        accessToken: fresh.access_token,
        payload,
      });
      setBookingResult(result);
    } catch (err) {
      setBookingResult(null);
      const message = err?.message || "No se pudo confirmar el turno.";
      setBookingError(message);

      if (/sesión|email|teléfono|perfil|cliente/i.test(message)) {
        setStepById("datos");
      } else {
        setForm((prev) => ({ ...prev, slot: null }));
        setStepById("horario");
        setReloadKey((value) => value + 1);
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const inputStyle = {
    width: "100%",
    border: "1px solid rgba(114,36,62,0.17)",
    borderRadius: 12,
    padding: "13px 14px",
    fontSize: 15,
    color: "#32151f",
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
  };

  const primaryButtonStyle = {
    border: "none",
    borderRadius: 12,
    padding: "14px 18px",
    background: COLORS.pink,
    color: "#fff",
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
    width: "100%",
    minHeight: 50,
    boxShadow: "0 10px 24px rgba(212,83,126,0.18)",
  };

  const secondaryButtonStyle = {
    border: "1px solid rgba(114,36,62,0.15)",
    borderRadius: 12,
    padding: "13px 18px",
    background: "#fff",
    color: COLORS.pinkDark,
    fontSize: 14,
    fontWeight: 850,
    cursor: "pointer",
    width: "100%",
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
      setActionError("No pudimos copiar los datos.");
    }
  };

  const renderLoading = () => (
    <section style={{ background: "#fff", borderRadius: 18, padding: 24, boxShadow: "0 14px 34px rgba(64,30,42,0.08)" }}>
      <div style={{ height: 15, width: "38%", background: "#f3dbe4", borderRadius: 99, marginBottom: 16 }} />
      <div style={{ height: 76, background: "#faedf2", borderRadius: 16, marginBottom: 12 }} />
      <div style={{ height: 76, background: "#faedf2", borderRadius: 16 }} />
    </section>
  );

  const renderProgress = () => (
    <section style={{ background: "rgba(255,255,255,0.82)", border: "1px solid rgba(114,36,62,0.09)", borderRadius: 16, padding: 14, marginBottom: 16, boxShadow: "0 10px 28px rgba(64,30,42,0.06)" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 6, marginBottom: 10 }}>
        {STEPS.map((item, index) => (
          <div key={item.id} style={{ height: 5, borderRadius: 99, background: index <= step ? COLORS.pink : "#efd8df" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <strong style={{ color: COLORS.pinkDark, fontSize: 12, textTransform: "uppercase" }}>Paso {step + 1} de {STEPS.length}</strong>
        <span style={{ color: "#8d6b78", fontSize: 12, fontWeight: 800 }}>{currentStep.label}</span>
      </div>
    </section>
  );

  const renderMiniSummary = () => {
    if (!selectedService || currentStep.id === "local" || currentStep.id === "servicio") return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <span style={{ background: "#fff", border: "1px solid rgba(114,36,62,0.1)", borderRadius: 999, padding: "8px 11px", color: COLORS.pinkDark, fontSize: 12, fontWeight: 850 }}>
          {selectedService.nombre}
        </span>
        {selectedExtraServices.map((service) => (
          <span key={service.id} style={{ background: COLORS.pinkLight, borderRadius: 999, padding: "8px 11px", color: COLORS.pinkDark, fontSize: 12, fontWeight: 800 }}>
            + {service.nombre}
          </span>
        ))}
        {form.retiroOrigen !== "ninguno" && (
          <span style={{ background: "#fff9e9", borderRadius: 999, padding: "8px 11px", color: "#7e5d1c", fontSize: 12, fontWeight: 800 }}>
            + Retiro previo
          </span>
        )}
        <span style={{ color: "#9a7483", fontSize: 12, fontWeight: 700 }}>
          ~{estimatedDuration || selectedService.duracionMinutos} min
        </span>
      </div>
    );
  };

  const renderLocalStep = () => (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>¿Dónde querés atenderte?</h2>
        <p style={{ margin: 0, color: "#765461", fontSize: 14 }}>Elegí tu Niki y seguimos. No hace falta confirmar cada paso.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        {data.locales.map((local) => (
          <SoftCard key={local.id} onClick={() => setLocal(local.id)}>
            <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 18, marginBottom: 6 }}>{local.nombre}</strong>
            {local.direccion ? <span style={{ color: "#765461", fontSize: 13 }}>{local.direccion}</span> : null}
            <span style={{ display: "block", color: COLORS.pink, marginTop: 14, fontSize: 12, fontWeight: 900 }}>Elegir este local →</span>
          </SoftCard>
        ))}
      </div>
    </div>
  );

  const renderServiceStep = () => {
    const currentType = form.tipo || serviceTypes[0]?.tipo || "";
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>¿Qué querés hacerte?</h2>
          <p style={{ margin: 0, color: "#765461", fontSize: 14 }}>Elegí una categoría y después tu servicio principal.</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {serviceTypes.map((group) => (
            <Pill
              key={group.tipo}
              selected={currentType === group.tipo}
              onClick={() => setForm((prev) => ({ ...prev, tipo: group.tipo }))}
            >
              {group.label} · {group.count}
            </Pill>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 12 }}>
          {servicesForType.map((service) => {
            const p = getPriceForService(service.id);
            return (
              <SoftCard key={service.id} onClick={() => selectService(service)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 17 }}>{service.nombre}</strong>
                    {service.descripcion ? <span style={{ display: "block", color: "#80616e", fontSize: 12, marginTop: 5, lineHeight: 1.45 }}>{service.descripcion}</span> : null}
                    <span style={{ display: "block", color: "#a07e8b", fontSize: 12, marginTop: 9 }}>{service.duracionMinutos} min</span>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <strong style={{ display: "block", color: "#351821", fontSize: 14 }}>{formatMoney(p.precioLista)}</strong>
                    {p.precioEfectivo ? <span style={{ display: "block", color: COLORS.success, fontSize: 11, fontWeight: 850, marginTop: 5 }}>{formatMoney(p.precioEfectivo)} efectivo</span> : null}
                  </div>
                </div>
              </SoftCard>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPersonalizeStep = () => (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>Personalizá tu turno</h2>
        <p style={{ margin: 0, color: "#765461", fontSize: 14 }}>Sólo lo necesario. Podés sumar algo más sin complicar la reserva.</p>
      </div>

      {["manos", "pies"].includes(typeKey(selectedService?.tipo)) && (
        <SoftCard>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 16 }}>¿Necesitás retiro previo?</strong>
              <span style={{ color: "#80616e", fontSize: 12, lineHeight: 1.45 }}>Así reservamos el tiempo correcto desde el principio.</span>
            </div>
            <span style={{ fontSize: 22 }}>✨</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Pill selected={form.retiroOrigen === "ninguno"} onClick={() => setRetiroOrigin("ninguno")}>No necesito</Pill>
            <Pill selected={form.retiroOrigen === "niki"} onClick={() => setRetiroOrigin("niki")}>Sí, hecho en Niki</Pill>
            <Pill selected={form.retiroOrigen === "otro"} onClick={() => setRetiroOrigin("otro")}>Sí, de otro salón</Pill>
          </div>

          {form.retiroOrigen !== "ninguno" && retiroServices.length > 1 && (
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: "0 0 8px", color: "#6f4d59", fontSize: 12, fontWeight: 800 }}>¿Qué retiro necesitás?</p>
              <div style={{ display: "grid", gap: 8 }}>
                {retiroServices.map((service) => (
                  <SoftCard
                    key={service.id}
                    selected={normalizeId(form.retiroServicioId) === normalizeId(service.id)}
                    onClick={() => setForm((prev) => ({ ...prev, retiroServicioId: service.id, slot: null }))}
                    style={{ padding: 12, borderRadius: 12, boxShadow: "none" }}
                  >
                    <strong style={{ color: COLORS.pinkDark, fontSize: 13 }}>{service.nombre}</strong>
                    <span style={{ display: "block", color: "#92717d", fontSize: 11, marginTop: 4 }}>{service.duracionMinutos} min</span>
                  </SoftCard>
                ))}
              </div>
            </div>
          )}

          {form.retiroOrigen === "niki" && (
            <div style={{ background: "#fff8e7", borderRadius: 12, padding: 11, marginTop: 12, color: "#795b1d", fontSize: 12, lineHeight: 1.45 }}>
              Si el producto anterior fue hecho en Niki y volvés a hacerte un servicio de igual o mayor valor, el retiro es sin cargo. Si todavía no tenemos tu historial migrado, lo validamos en el local.
            </div>
          )}
          {form.retiroOrigen === "otro" && selectedRetiroService && (
            <div style={{ background: "#fff7fa", borderRadius: 12, padding: 11, marginTop: 12, color: "#765461", fontSize: 12 }}>
              Retiro estimado: {formatMoney(getPriceForService(selectedRetiroService.id).precioLista)} · {selectedRetiroService.duracionMinutos} min
            </div>
          )}
          {form.retiroOrigen !== "ninguno" && !retiroServices.length && (
            <div style={{ background: "#fff7fa", borderRadius: 12, padding: 11, marginTop: 12, color: "#765461", fontSize: 12, lineHeight: 1.45 }}>
              Lo vamos a dejar indicado en la reserva. Si después configuramos un servicio específico de retiro, NikiOS también sumará automáticamente su tiempo y precio.
            </div>
          )}
        </SoftCard>
      )}

      {suggestedServices.length > 0 && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 18 }}>¿Querés aprovechar la visita?</h3>
              <p style={{ margin: "4px 0 0", color: "#876572", fontSize: 12 }}>Opcional. Elegí hasta {MAX_COMPLEMENTARY_SERVICES} servicios más y buscamos un horario para todo junto.</p>
            </div>
            {form.serviciosExtraIds.length ? <span style={{ color: COLORS.pink, fontSize: 12, fontWeight: 900 }}>{form.serviciosExtraIds.length} agregado{form.serviciosExtraIds.length === 1 ? "" : "s"}</span> : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            {suggestedServices.map((service) => {
              const selected = form.serviciosExtraIds.some((id) => normalizeId(id) === normalizeId(service.id));
              const disabled = !selected && form.serviciosExtraIds.length >= MAX_COMPLEMENTARY_SERVICES;
              const p = getPriceForService(service.id);
              return (
                <SoftCard key={service.id} selected={selected} disabled={disabled} onClick={() => toggleExtraService(service.id)} style={{ padding: 14 }}>
                  <span style={{ display: "block", color: "#9a7483", fontSize: 10, fontWeight: 900, textTransform: "uppercase", marginBottom: 5 }}>{typeLabel(service.tipo)}</span>
                  <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 15 }}>{service.nombre}</strong>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, alignItems: "center" }}>
                    <span style={{ color: "#8b6976", fontSize: 11 }}>{service.duracionMinutos} min · {formatMoney(p.precioLista)}</span>
                    <span style={{ color: selected ? COLORS.success : COLORS.pink, fontSize: 12, fontWeight: 900 }}>{selected ? "✓ Agregado" : "+ Agregar"}</span>
                  </div>
                </SoftCard>
              );
            })}
          </div>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 10 }}>
        <button type="button" onClick={() => setStepById("servicio")} style={secondaryButtonStyle}>Volver</button>
        <button
          type="button"
          onClick={() => setStepById("horario")}
          disabled={!personalizeCanContinue()}
          style={{ ...primaryButtonStyle, opacity: personalizeCanContinue() ? 1 : 0.55, cursor: personalizeCanContinue() ? "pointer" : "not-allowed" }}
        >
          Ver horarios disponibles
        </button>
      </div>
    </div>
  );

  const renderSlotButton = (slot) => (
    <button
      key={`${slot.fecha}-${slot.inicio}-${slot.profesionales.join("-")}`}
      type="button"
      onClick={() => selectSlot(slot)}
      style={{
        border: "1px solid rgba(212,83,126,0.2)",
        borderRadius: 14,
        background: "#fff",
        color: "#351821",
        padding: "11px 12px",
        textAlign: "left",
        cursor: "pointer",
        boxShadow: "0 6px 18px rgba(64,30,42,0.05)",
        minWidth: 110,
      }}
    >
      <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 16 }}>{slot.inicio}</strong>
      <span style={{ display: "block", color: "#94727e", fontSize: 10, marginTop: 3 }}>{slot.fin} · {slot.duracionMinutos} min</span>
      <span style={{ display: "block", color: "#765461", fontSize: 11, marginTop: 5 }}>{slot.profesionales.length > 1 ? "Equipo Niki" : slot.manicuraNombre}</span>
    </button>
  );

  const renderDateAvailability = (group) => {
    const parts = groupSlotsByDayPart(group.slots);
    return (
      <section key={group.fecha} style={{ display: "grid", gap: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h3 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 17 }}>{formatDate(group.fecha)}</h3>
          <span style={{ color: "#a07e8b", fontSize: 11 }}>{group.slots.length} opciones</span>
        </div>
        {parts.map((part) => (
          <div key={part.id} style={{ display: "grid", gap: 8 }}>
            <span style={{ color: "#765461", fontSize: 12, fontWeight: 900 }}>{part.label}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
              {part.slots.map(renderSlotButton)}
            </div>
          </div>
        ))}
      </section>
    );
  };

  const renderHorarioStep = () => {
    const groups = form.modalidad === "primer" ? firstAvailableGroups : [{ fecha: form.fecha, slots: daySlots }];
    const hasSlots = groups.some((g) => g.slots.length);
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>Elegí tu horario</h2>
          <p style={{ margin: 0, color: "#765461", fontSize: 14 }}>Te mostramos únicamente horarios donde podemos hacer todo lo que elegiste, de corrido.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 10 }}>
          <SoftCard selected={form.modalidad === "primer"} onClick={() => setForm((prev) => ({ ...prev, modalidad: "primer", slot: null }))} style={{ padding: 13 }}>
            <strong style={{ color: COLORS.pinkDark, fontSize: 14 }}>Próximos disponibles</strong>
            <span style={{ display: "block", color: "#8c6a77", fontSize: 11, marginTop: 4 }}>La opción más rápida.</span>
          </SoftCard>
          <SoftCard selected={form.modalidad === "dia"} onClick={() => setForm((prev) => ({ ...prev, modalidad: "dia", slot: null }))} style={{ padding: 13 }}>
            <strong style={{ color: COLORS.pinkDark, fontSize: 14 }}>Elegir un día</strong>
            <span style={{ display: "block", color: "#8c6a77", fontSize: 11, marginTop: 4 }}>Buscá una fecha puntual.</span>
          </SoftCard>
        </div>

        {form.modalidad === "dia" && (
          <Field label="Fecha">
            <input type="date" min={todayKey()} value={form.fecha} onChange={(event) => setForm((prev) => ({ ...prev, fecha: event.target.value, slot: null }))} style={inputStyle} />
          </Field>
        )}

        <SoftCard>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 10 }}>
            <strong style={{ color: COLORS.pinkDark, fontSize: 14 }}>¿Tenés una profesional preferida?</strong>
            <span style={{ color: "#9a7483", fontSize: 11 }}>Opcional</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Pill selected={!form.manicuraId} onClick={() => setForm((prev) => ({ ...prev, manicuraId: "", slot: null }))}>Sin preferencia</Pill>
            {primaryCompatibleManicuras.map((m) => (
              <Pill key={m.id} selected={normalizeId(form.manicuraId) === normalizeId(m.id)} onClick={() => setForm((prev) => ({ ...prev, manicuraId: m.id, slot: null }))}>{m.nombre}</Pill>
            ))}
          </div>
          {selectedExtraServices.length > 0 && <p style={{ margin: "10px 0 0", color: "#9a7483", fontSize: 11 }}>La preferencia se aplica al servicio principal. Los servicios adicionales pueden realizarlos otras profesionales para darte más opciones de horario.</p>}
        </SoftCard>

        <SoftCard>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
            <div>
              <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 15 }}>Horarios disponibles</strong>
              <span style={{ color: "#9a7483", fontSize: 11 }}>Divididos por momento del día para encontrarlos más rápido.</span>
            </div>
            <span style={{ background: COLORS.pinkLight, color: COLORS.pinkDark, borderRadius: 999, padding: "7px 10px", fontSize: 11, fontWeight: 900 }}>~{estimatedDuration} min</span>
          </div>
          {hasSlots ? (
            <div style={{ display: "grid", gap: 22 }}>
              {groups.filter((g) => g.slots.length).map(renderDateAvailability)}
            </div>
          ) : (
            <div style={{ background: "#fff7fa", borderRadius: 14, padding: 15, color: "#765461", fontSize: 13, lineHeight: 1.5 }}>
              No encontramos un bloque disponible para todo lo elegido. Probá otra fecha, quitá un servicio adicional o elegí “Sin preferencia”.
            </div>
          )}
        </SoftCard>

        <button type="button" onClick={() => setStepById("personaliza")} style={secondaryButtonStyle}>Volver a personalizar</button>
      </div>
    );
  };

  const renderClientStep = () => (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>Tus datos</h2>
        <p style={{ margin: 0, color: "#765461", fontSize: 14 }}>Verificá tu email una vez. Después este dispositivo te va a reconocer.</p>
      </div>

      <PublicClientIdentity supabaseUrl={SUPABASE_URL} supabaseKey={SUPABASE_KEY} onSessionChange={handleClientIdentity} />

      {clientSession?.access_token && (
        <>
          <Field label="Nombre y apellido">
            <input value={form.nombre} onChange={(event) => setForm((prev) => ({ ...prev, nombre: event.target.value }))} placeholder="Ej: Martina Pérez" style={inputStyle} />
          </Field>
          <Field label="WhatsApp o teléfono" hint="Lo normalizamos para evitar duplicados por +54, 0 o 15.">
            <input value={form.telefono} onChange={(event) => setForm((prev) => ({ ...prev, telefono: event.target.value }))} placeholder="Ej: 11 5555 5555" style={inputStyle} />
          </Field>
          <Field label="¿Querés contarnos algo?" hint="Opcional">
            <textarea value={form.observacion} onChange={(event) => setForm((prev) => ({ ...prev, observacion: event.target.value }))} placeholder="Ej: tengo una uña reparada" style={{ ...inputStyle, minHeight: 86, resize: "vertical" }} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 10 }}>
            <button type="button" onClick={() => setStepById("horario")} style={secondaryButtonStyle}>Volver</button>
            <button
              type="button"
              onClick={() => setStepById("confirmacion")}
              disabled={!normalizeText(form.nombre) || !normalizeText(form.telefono)}
              style={{ ...primaryButtonStyle, opacity: normalizeText(form.nombre) && normalizeText(form.telefono) ? 1 : 0.55 }}
            >
              Revisar reserva
            </button>
          </div>
        </>
      )}
    </div>
  );

  const selectedSummaryRows = () => {
    const rows = [];
    if (selectedRetiroService && form.retiroOrigen !== "ninguno") rows.push({ service: selectedRetiroService, kind: "retiro" });
    if (selectedService) rows.push({ service: selectedService, kind: "principal" });
    selectedExtraServices.forEach((service) => rows.push({ service, kind: "complementario" }));
    return rows;
  };

  const renderConfirmationStep = () => {
    if (bookingResult?.ok) {
      const services = bookingResult.servicios || [];
      const location = [bookingResult.local?.nombre, bookingResult.local?.direccion].filter(Boolean).join(" - ");
      const title = services.length > 1 ? `Niki Beauty Bar - ${bookingResult.servicio?.nombre} + ${services.length - 1} más` : `Niki Beauty Bar - ${bookingResult.servicio?.nombre || "Turno"}`;
      const description = services.map((service) => `${service.nombre}: ${service.inicio}-${service.fin} · ${service.profesional?.nombre || "Niki"}`).join("\n");
      const summaryText = [
        "Turno confirmado - Niki Beauty Bar",
        `Nro: #${bookingResult.turno_id}`,
        `Local: ${location}`,
        ...services.map((service) => `${service.nombre}: ${service.inicio}-${service.fin}`),
        `Total lista: ${formatMoney(bookingResult.precio_lista, "$0")}`,
        `Total efectivo: ${formatMoney(bookingResult.precio_efectivo, "$0")}`,
      ].join("\n");

      return (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "linear-gradient(135deg,#fff0f5,#fff)", border: `1px solid rgba(212,83,126,0.2)`, borderRadius: 20, padding: 22, textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: COLORS.pink, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 900, marginBottom: 10 }}>✓</div>
            <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>¡Listo! Tu turno quedó reservado</h2>
            <p style={{ margin: 0, color: "#765461", fontSize: 13 }}>Reserva #{bookingResult.turno_id}</p>
          </div>

          <SoftCard>
            <SummaryRow label="Local" value={bookingResult.local?.nombre || selectedLocal?.nombre} />
            <SummaryRow label="Fecha" value={formatDate(bookingResult.fecha)} />
            <SummaryRow label="Horario total" value={formatTimeRange(bookingResult.inicio, bookingResult.fin)} />
            <div style={{ padding: "12px 0" }}>
              <span style={{ display: "block", color: "#80616e", fontSize: 12, marginBottom: 8 }}>Servicios</span>
              <div style={{ display: "grid", gap: 8 }}>
                {services.map((service) => (
                  <div key={service.turno_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", background: service.clase === "principal" ? COLORS.pinkLight : "#fff8fb", borderRadius: 12, padding: 10 }}>
                    <div>
                      <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 13 }}>{service.nombre}</strong>
                      <span style={{ color: "#8e6c79", fontSize: 11 }}>{service.inicio}-{service.fin} · {service.profesional?.nombre}</span>
                    </div>
                    <span style={{ color: "#351821", fontSize: 12, fontWeight: 850 }}>{service.precio_lista ? formatMoney(service.precio_lista) : "Sin cargo"}</span>
                  </div>
                ))}
              </div>
            </div>
            <SummaryRow label="Total lista" value={formatMoney(bookingResult.precio_lista, "$0")} strong />
            <SummaryRow label="Total efectivo" value={formatMoney(bookingResult.precio_efectivo, "$0")} strong />
          </SoftCard>

          {bookingResult.retiro?.validacion_pendiente && (
            <div style={{ background: "#fff8e7", borderRadius: 14, padding: 13, color: "#795b1d", fontSize: 12, lineHeight: 1.5 }}>
              El retiro figura sin cargo sujeto a validación del historial en el local.
            </div>
          )}

          {actionError && <div style={{ background: "#fff0f3", color: COLORS.pinkDark, borderRadius: 12, padding: 12, fontSize: 12 }}>{actionError}</div>}
          {copyFeedback && <div style={{ background: "#f3fff5", color: "#2f6b3d", borderRadius: 12, padding: 12, fontSize: 12, fontWeight: 800 }}>{copyFeedback}</div>}

          <div style={{ display: "grid", gap: 9 }}>
            <button type="button" onClick={() => handleCopyText(summaryText, "Datos copiados")} style={primaryButtonStyle}>Copiar datos del turno</button>
            <button type="button" onClick={() => downloadIcsEvent({ uid: `niki-reserva-${bookingResult.reserva_grupo_id || bookingResult.turno_id}`, title, fecha: bookingResult.fecha, inicio: bookingResult.inicio, fin: bookingResult.fin, location, description })} style={secondaryButtonStyle}>Agregar al calendario</button>
            <button type="button" onClick={resetFlow} style={secondaryButtonStyle}>Reservar otro turno</button>
            <button type="button" onClick={() => switchView("mis_turnos")} style={secondaryButtonStyle}>Consultar mis turnos</button>
          </div>
        </div>
      );
    }

    const rows = selectedSummaryRows();
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 25 }}>Revisá tu reserva</h2>
          <p style={{ margin: 0, color: "#765461", fontSize: 14 }}>Un último vistazo y la confirmamos.</p>
        </div>

        <SoftCard>
          <SummaryRow label="Local" value={selectedLocal?.nombre || "-"} />
          <SummaryRow label="Fecha" value={formatDate(form.slot?.fecha)} />
          <SummaryRow label="Horario" value={formatTimeRange(form.slot?.inicio, form.slot?.fin)} />
          <div style={{ padding: "12px 0" }}>
            <span style={{ display: "block", color: "#80616e", fontSize: 12, marginBottom: 8 }}>Tu visita</span>
            <div style={{ display: "grid", gap: 8 }}>
              {rows.map((item) => {
                const p = getPriceForService(item.service.id);
                const retiroFree = item.kind === "retiro" && form.retiroOrigen === "niki";
                return (
                  <div key={`${item.kind}-${item.service.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, background: item.kind === "principal" ? COLORS.pinkLight : "#fff8fb", borderRadius: 12, padding: 10 }}>
                    <div>
                      <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 13 }}>{item.service.nombre}</strong>
                      <span style={{ color: "#8d6b78", fontSize: 11 }}>{item.service.duracionMinutos} min{item.kind === "complementario" ? " · servicio adicional" : ""}</span>
                    </div>
                    <span style={{ color: "#351821", fontSize: 12, fontWeight: 850 }}>{retiroFree ? "Sin cargo*" : formatMoney(p.precioLista)}</span>
                  </div>
                );
              })}
              {form.retiroOrigen !== "ninguno" && !selectedRetiroService && (
                <div style={{ background: "#fff8e7", borderRadius: 12, padding: 10, color: "#795b1d", fontSize: 11 }}>Retiro previo informado; el local validará tiempo y cargo.</div>
              )}
            </div>
          </div>
          <SummaryRow label="Total estimado lista" value={formatMoney(estimatedPrices.lista, "$0")} strong />
          <SummaryRow label="Total estimado efectivo" value={formatMoney(estimatedPrices.efectivo, "$0")} strong />
          <SummaryRow label="Clienta" value={form.nombre || "-"} />
          <SummaryRow label="Contacto" value={formatContact(form.telefono, form.email)} />
        </SoftCard>

        {form.retiroOrigen === "niki" && <p style={{ margin: 0, color: "#8b6976", fontSize: 11 }}>* El retiro hecho en Niki es sin cargo cuando el nuevo servicio es de igual o mayor valor. Se valida con el historial disponible.</p>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 10 }}>
          <button type="button" onClick={() => setStepById("datos")} style={secondaryButtonStyle}>Volver</button>
          <button type="button" onClick={confirmPublicBooking} disabled={bookingLoading} style={{ ...primaryButtonStyle, opacity: bookingLoading ? 0.65 : 1 }}>
            {bookingLoading ? "Confirmando..." : "Confirmar turno"}
          </button>
        </div>
      </div>
    );
  };

  const renderMyBookingsView = () => {
    const bookingGroups = groupBookingsByDate(lookupResult?.turnos || []);
    return (
      <section style={{ background: "rgba(255,255,255,0.92)", border: "1px solid rgba(114,36,62,0.09)", borderRadius: 20, padding: 18, boxShadow: "0 14px 34px rgba(64,30,42,0.07)" }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 6px", color: COLORS.pinkDark, fontSize: 24 }}>Mis turnos</h2>
          <p style={{ margin: 0, color: "#765461", fontSize: 13 }}>Tu identidad verificada protege esta información.</p>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <PublicClientIdentity supabaseUrl={SUPABASE_URL} supabaseKey={SUPABASE_KEY} onSessionChange={handleClientIdentity} />
          {lookupError && <div style={{ background: "#fff0f3", color: COLORS.pinkDark, borderRadius: 12, padding: 12, fontSize: 12 }}>{lookupError}</div>}
          {clientSession?.access_token && (
            <button type="button" onClick={consultMyBookings} disabled={lookupLoading} style={{ ...primaryButtonStyle, opacity: lookupLoading ? 0.65 : 1 }}>
              {lookupLoading ? "Consultando..." : "Ver mis próximos turnos"}
            </button>
          )}
        </div>

        {lookupResult && (
          <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
            <p style={{ margin: 0, color: "#765461", fontSize: 13 }}>{lookupResult.mensaje}</p>
            {bookingGroups.map((group) => (
              <section key={group.fecha} style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 16 }}>{formatDate(group.fecha)}</h3>
                {group.items.map((turno) => {
                  const services = turno.servicios?.length ? turno.servicios : [{ nombre: turno.servicio?.nombre || "Servicio", inicio: turno.inicio, fin: turno.fin, profesional: turno.manicura }];
                  const serviceNames = services.filter((s) => !s.es_retiro).map((s) => s.nombre).join(" + ");
                  const location = [turno.local?.nombre, getLocalAddress(turno.local)].filter(Boolean).join(" - ");
                  const summaryText = [
                    `Turno #${turno.turno_id}`,
                    `Fecha: ${formatDate(turno.fecha)}`,
                    `Horario: ${formatTimeRange(turno.inicio, turno.fin)}`,
                    `Local: ${location}`,
                    ...services.map((s) => `${s.nombre}: ${s.inicio}-${s.fin}`),
                  ].join("\n");
                  return (
                    <SoftCard key={`${turno.reserva_grupo_id || turno.turno_id}`}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <div>
                          <strong style={{ display: "block", color: COLORS.pinkDark, fontSize: 17 }}>{formatTimeRange(turno.inicio, turno.fin)}</strong>
                          <span style={{ display: "block", color: "#765461", fontSize: 12, marginTop: 3 }}>{serviceNames}</span>
                        </div>
                        <span style={{ background: COLORS.pinkLight, color: COLORS.pinkDark, borderRadius: 999, padding: "6px 9px", fontSize: 11, fontWeight: 900 }}>{turno.estado || "confirmado"}</span>
                      </div>
                      <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
                        {services.map((service) => (
                          <div key={`${service.turno_id || service.nombre}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, color: "#80616e" }}>
                            <span>{service.nombre}</span>
                            <span>{service.inicio}-{service.fin} · {service.profesional?.nombre || "Niki"}</span>
                          </div>
                        ))}
                      </div>
                      <SummaryRow label="Local" value={turno.local?.nombre || "-"} />
                      <SummaryRow label="Total" value={formatMoney(turno.precio, "$0")} strong />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                        <button type="button" onClick={() => handleCopyText(summaryText, "Turno copiado", turno.turno_id)} style={secondaryButtonStyle}>{copiedTurnId === String(turno.turno_id) ? "Copiado" : "Copiar"}</button>
                        <button type="button" onClick={() => downloadIcsEvent({ uid: `niki-turno-${turno.reserva_grupo_id || turno.turno_id}`, title: `Niki Beauty Bar - ${serviceNames}`, fecha: turno.fecha, inicio: turno.inicio, fin: turno.fin, location, description: summaryText })} style={secondaryButtonStyle}>Calendario</button>
                      </div>
                    </SoftCard>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderStep = () => {
    if (currentStep.id === "local") return renderLocalStep();
    if (currentStep.id === "servicio") return renderServiceStep();
    if (currentStep.id === "personaliza") return renderPersonalizeStep();
    if (currentStep.id === "horario") return renderHorarioStep();
    if (currentStep.id === "datos") return renderClientStep();
    return renderConfirmationStep();
  };

  return (
    <main style={{ minHeight: "100vh", background: "radial-gradient(circle at top left,#fff 0,#fff7fa 35%,#f8e7ee 100%)", color: "#351821", fontFamily: "'Montserrat', sans-serif", padding: "18px 14px 36px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 1040, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 13, padding: "8px 0 20px" }}>
          <LogoMark size={58} variant="light" />
          <div>
            <p style={{ margin: "0 0 3px", color: COLORS.pinkDark, fontSize: 13, fontWeight: 900 }}>Niki Beauty Bar</p>
            <h1 style={{ margin: 0, color: COLORS.pinkDark, fontSize: 30, lineHeight: 1.04, fontWeight: 900 }}>Reservá tu turno</h1>
            <p style={{ margin: "5px 0 0", color: "#8d6b78", fontSize: 12 }}>Simple, rápido y pensado para vos.</p>
          </div>
        </header>

        <nav style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <button type="button" onClick={() => switchView("reservar")} style={{ ...secondaryButtonStyle, background: publicView === "reservar" ? COLORS.pinkLight : "rgba(255,255,255,0.88)", borderColor: publicView === "reservar" ? "rgba(212,83,126,0.35)" : "rgba(114,36,62,0.12)" }}>Reservar turno</button>
          <button type="button" onClick={() => switchView("mis_turnos")} style={{ ...secondaryButtonStyle, background: publicView === "mis_turnos" ? COLORS.pinkLight : "rgba(255,255,255,0.88)", borderColor: publicView === "mis_turnos" ? "rgba(212,83,126,0.35)" : "rgba(114,36,62,0.12)" }}>Consultar mis turnos</button>
        </nav>

        {publicView === "mis_turnos" ? (
          renderMyBookingsView()
        ) : (
          <>
            {renderProgress()}
            {priceWarning && !loading && !error && <div style={{ background: "#fff8df", color: "#805817", borderRadius: 12, padding: "11px 13px", fontSize: 12, marginBottom: 14 }}>{priceWarning}</div>}
            {bookingError && !loading && !error && <div style={{ background: "#fff0f3", color: COLORS.pinkDark, border: "1px solid rgba(212,83,126,0.22)", borderRadius: 12, padding: "11px 13px", fontSize: 12, marginBottom: 14 }}>{bookingError}</div>}
            {renderMiniSummary()}

            {loading ? (
              renderLoading()
            ) : error ? (
              <section style={{ background: "#fff", borderRadius: 18, padding: 24 }}>
                <strong style={{ color: COLORS.pinkDark }}>No pudimos cargar el portal</strong>
                <p style={{ color: "#765461", fontSize: 13 }}>{error}</p>
                <button type="button" onClick={() => setReloadKey((v) => v + 1)} style={secondaryButtonStyle}>Reintentar</button>
              </section>
            ) : (
              <section style={{ background: "rgba(255,255,255,0.93)", border: "1px solid rgba(114,36,62,0.08)", borderRadius: 20, padding: 18, boxShadow: "0 18px 42px rgba(64,30,42,0.08)" }}>
                {renderStep()}
              </section>
            )}

            {!isFinal && step > 0 && !["personaliza", "horario", "datos"].includes(currentStep.id) && (
              <div style={{ marginTop: 12 }}>
                <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} style={secondaryButtonStyle}>Volver</button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
