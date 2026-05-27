import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// Fuente Inter
if (!document.getElementById("niki-font")) {
  const link = document.createElement("link");
  link.id = "niki-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap";
  document.head.appendChild(link);
  document.body.style.fontFamily = "'Inter', sans-serif";
}

const SUPABASE_URL = "https://fomdnmnrxntoqdsxndxx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvbWRubW5yeG50b3Fkc3huZHh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MDczMjksImV4cCI6MjA5NTM4MzMyOX0.pxqz72fqHYph-WZm9R3QT5tPpG9kOQBNaZKreEftFVA";

const sb = async (path, opts = {}) => {
  const prefer = opts.prefer ?? "return=representation";
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: opts.method || "GET", headers, body: opts.body });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const patchOrPost = async (table, matchQuery, data) => {
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchQuery}`, {
    method: "PATCH",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  const patchText = await patchRes.text();
  const patchResult = patchText ? JSON.parse(patchText) : [];
  if (!patchResult || patchResult.length === 0) return sb(table, { method: "POST", body: JSON.stringify(data) });
  return patchResult;
};

const api = {
  getUsers: () => sb("users?select=*&order=id"),
  createUser: (d) => sb("users", { method: "POST", body: JSON.stringify(d) }),
  updateUser: (id, d) => sb(`users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  getLocales: () => sb("locales?select=*&order=id"),
  createLocal: (d) => sb("locales", { method: "POST", body: JSON.stringify(d) }),
  updateLocal: (id, d) => sb(`locales?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteLocal: (id) => sb(`locales?id=eq.${id}`, { method: "DELETE", prefer: "" }),
  getHorarios: () => sb("horarios?select=*"),
  upsertHorario: (d) => patchOrPost("horarios", `user_id=eq.${d.user_id}&fecha=eq.${d.fecha}`, d),
  deleteHorario: (userId, fecha) => sb(`horarios?user_id=eq.${userId}&fecha=eq.${fecha}`, { method: "DELETE", prefer: "" }),
  getAsistencias: () => sb("asistencias?select=*"),
  upsertAsistencia: (d) => patchOrPost("asistencias", `user_id=eq.${d.user_id}&fecha=eq.${d.fecha}`, d),
  deleteAsistencia: (userId, fecha) => sb(`asistencias?user_id=eq.${userId}&fecha=eq.${fecha}`, { method: "DELETE", prefer: "" }),
  getPeriodos: () => sb("periodos_bloqueados?select=*"),
  createPeriodo: (periodo) => sb("periodos_bloqueados", { method: "POST", body: JSON.stringify({ periodo }) }),
  deletePeriodo: (periodo) => sb(`periodos_bloqueados?periodo=eq.${encodeURIComponent(periodo)}`, { method: "DELETE", prefer: "" }),
  getTokens: () => sb("reset_tokens?select=*"),
  createToken: (d) => sb("reset_tokens", { method: "POST", body: JSON.stringify(d) }),
  deleteToken: (token) => sb(`reset_tokens?token=eq.${encodeURIComponent(token)}`, { method: "DELETE", prefer: "" }),
  deleteTokenByUser: (userId) => sb(`reset_tokens?user_id=eq.${userId}`, { method: "DELETE", prefer: "" }),
  getFeriados: () => sb("feriados?select=*"),
  createFeriado: (d) => sb("feriados", { method: "POST", body: JSON.stringify(d) }),
  deleteFeriado: (fecha) => sb(`feriados?fecha=eq.${fecha}`, { method: "DELETE", prefer: "" }),
};

function normalizeUser(u) { return { id: u.id, nombre: u.nombre, usuario: u.usuario, password: u.password, email: u.email || "", rol: u.rol, localId: u.local_id, activo: u.activo }; }
function normalizeHorario(h) { return { id: h.id, userId: h.user_id, fecha: h.fecha, entrada: h.entrada || "", salida: h.salida || "", trabaja: h.trabaja }; }
function normalizeAsistencia(a) { return { id: a.id, userId: a.user_id, fecha: a.fecha, estado: a.estado, entradaReal: a.entrada_real || "", salidaReal: a.salida_real || "", motivo: a.motivo || "", certificado: a.certificado, tipoDoc: a.tipo_doc || "" }; }

const COLORS = {
  pink: "#d4537e", pinkLight: "#fbeaf0", pinkDark: "#72243e",
  gray: "#888780", grayLight: "#f1efe8",
  success: "#639922", successLight: "#eaf3de",
  danger: "#e24b4a", dangerLight: "#fcebeb",
  amber: "#ba7517", amberLight: "#faeeda",
  info: "#185fa5", infoLight: "#e6f1fb",
};

const DIAS_SEMANA = ["Lun","Mar","Mié","Jue","Vie","Sáb"];
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MOTIVOS_AUSENCIA = ["Enfermedad","Personal","Trámite","Licencia","Otro"];

function getDiasDelMes(y, m) { const dias = [], d = new Date(y, m, 1); while (d.getMonth() === m) { if (d.getDay() !== 0) dias.push(new Date(d)); d.setDate(d.getDate() + 1); } return dias; }
function getSemanas(dias) { const s = []; let sem = []; dias.forEach((d, i) => { sem.push(d); if (d.getDay() === 6 || i === dias.length - 1) { s.push([...sem]); sem = []; } }); if (sem.length) s.push(sem); return s; }
function calcHoras(e, s) { if (!e || !s) return 0; const [eh, em] = e.split(":").map(Number), [sh, sm] = s.split(":").map(Number); const m = (sh * 60 + sm) - (eh * 60 + em); return m > 0 ? m / 60 : 0; }
function fmtFecha(d) { return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`; }
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function genToken() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

function Avatar({ nombre, size = 36 }) { const i = nombre.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase(); return <div style={{ width: size, height: size, borderRadius: "50%", background: COLORS.pinkLight, color: COLORS.pinkDark, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: size * 0.35, flexShrink: 0 }}>{i}</div>; }
function Badge({ children, color = "pink" }) { const map = { pink: [COLORS.pinkLight, COLORS.pinkDark], success: [COLORS.successLight, COLORS.success], danger: [COLORS.dangerLight, COLORS.danger], amber: [COLORS.amberLight, COLORS.amber], info: [COLORS.infoLight, COLORS.info], gray: [COLORS.grayLight, "#444"] }; const [bg, fg] = map[color] || map.pink; return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>{children}</span>; }
function Card({ children, style }) { return <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "1rem 1.25rem", ...style }}>{children}</div>; }
function Btn({ children, onClick, variant = "primary", size = "md", disabled, style }) {
  const base = { border: "none", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.5 : 1, ...style };
  const v = { primary: { background: COLORS.pink, color: "#fff", padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 }, secondary: { background: COLORS.pinkLight, color: COLORS.pinkDark, padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 }, ghost: { background: "transparent", color: COLORS.pink, padding: size === "sm" ? "5px 8px" : "8px 12px", fontSize: size === "sm" ? 13 : 14 }, danger: { background: COLORS.dangerLight, color: COLORS.danger, padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 }, success: { background: COLORS.successLight, color: COLORS.success, padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 } };
  return <button style={{ ...base, ...v[variant] }} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Input({ value, onChange, type = "text", placeholder, style }) { return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 12px", fontSize: 14, width: "100%", background: "var(--color-background-primary)", color: "var(--color-text-primary)", boxSizing: "border-box", ...style }} />; }
function Select({ value, onChange, children, style }) { return <select value={value} onChange={e => onChange(e.target.value)} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 12px", fontSize: 14, width: "100%", background: "var(--color-background-primary)", color: "var(--color-text-primary)", ...style }}>{children}</select>; }
function Modal({ title, children, onClose, width = 480 }) {
  useEffect(() => { const p = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = p; }; }, []);
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div style={{ background: "#fff", borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: width, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}><h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#1a1a1a" }}>{title}</h3><button onClick={onClose} style={{ background: "#f5f5f5", border: "none", cursor: "pointer", fontSize: 18, color: "#666", width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button></div>{children}</div></div>;
}
function ModalInput({ label, value, onChange, type = "text" }) { return <div><label style={{ fontSize: 13, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "9px 12px", fontSize: 14, background: "#fafafa", color: "#1a1a1a", outline: "none", boxSizing: "border-box" }} onFocus={e => e.target.style.borderColor = COLORS.pink} onBlur={e => e.target.style.borderColor = "#e0e0e0"} /></div>; }
function ModalSelect({ label, value, onChange, children }) { return <div><label style={{ fontSize: 13, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>{label}</label><select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "9px 12px", fontSize: 14, background: "#fafafa", color: "#1a1a1a", outline: "none", boxSizing: "border-box" }}>{children}</select></div>; }

// ── CALENDARIO ────────────────────────────────────────────────────
const CAL_SLOT_H = 40;
const CAL_START = 7;
const CAL_END = 23;
const CAL_VIEW_START = 10;
const CAL_HOURS = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);
const CAL_TOTAL_SLOTS = (CAL_END - CAL_START) * 2;
const CAL_GRID_H = CAL_TOTAL_SLOTS * (CAL_SLOT_H / 2);

function calToSlot(h, m) { return (h - CAL_START) * 2 + (m >= 30 ? 1 : 0); }
function calFromSlot(s) { return { h: CAL_START + Math.floor(s / 2), m: s % 2 === 0 ? 0 : 30 }; }
function calFmt(h, m) { return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
function calSlotY(s) { return s * (CAL_SLOT_H / 2); }
function calYSlot(y) { return Math.max(0, Math.min(CAL_TOTAL_SLOTS - 1, Math.round(y / (CAL_SLOT_H / 2)))); }
function calHoras(b) { return b ? (b.endSlot - b.startSlot) / 2 : 0; }
function getMon(date) { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); d.setHours(0,0,0,0); return d; }

function BloqueCalendario({ fecha, bloque, onChange, onDelete, bloqueado }) {
  const { startSlot: ss, endSlot: es } = bloque;
  const top = calSlotY(ss), height = Math.max(calSlotY(es) - top, 20);
  const s = calFromSlot(ss), e = calFromSlot(es);
  const drag = useCallback((ev, mode) => {
    if (bloqueado) return; ev.preventDefault(); ev.stopPropagation();
    const sy = ev.clientY, os = ss, oe = es;
    const mv = e2 => {
      const d = Math.round((e2.clientY - sy) / (CAL_SLOT_H / 2));
      if (mode === "move") { const dur = oe - os; const ns = Math.max(0, Math.min(CAL_TOTAL_SLOTS - dur, os + d)); onChange(fecha, { startSlot: ns, endSlot: ns + dur }); }
      else if (mode === "top") onChange(fecha, { startSlot: Math.max(0, Math.min(oe - 2, os + d)), endSlot: oe });
      else onChange(fecha, { startSlot: os, endSlot: Math.max(os + 2, Math.min(CAL_TOTAL_SLOTS, oe + d)) });
    };
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  }, [ss, es, fecha, onChange, bloqueado]);
  return (
    <div style={{ position: "absolute", left: 2, right: 2, top, height, background: COLORS.pinkLight, border: `1.5px solid ${COLORS.pink}`, borderRadius: 6, cursor: bloqueado ? "default" : "grab", userSelect: "none", overflow: "hidden", display: "flex", flexDirection: "column", zIndex: 1 }}>
      {!bloqueado && <div onMouseDown={e => drag(e, "top")} style={{ height: 5, background: COLORS.pink, cursor: "ns-resize", flexShrink: 0, borderRadius: "4px 4px 0 0" }} />}
      <div onMouseDown={e => drag(e, "move")} style={{ flex: 1, padding: "2px 6px", minHeight: 0, overflow: "hidden" }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 500, color: COLORS.pinkDark, lineHeight: 1.3, whiteSpace: "nowrap" }}>{calFmt(s.h, s.m)} – {calFmt(e.h, e.m)}</p>
        {height > 32 && <p style={{ margin: 0, fontSize: 10, color: COLORS.pink }}>{calHoras(bloque).toFixed(1)}h</p>}
      </div>
      {!bloqueado && <>
        <div onMouseDown={e => drag(e, "bottom")} style={{ height: 5, background: COLORS.pink, cursor: "ns-resize", flexShrink: 0, borderRadius: "0 0 4px 4px" }} />
        <button onClick={e => { e.stopPropagation(); onDelete(fecha); }} style={{ position: "absolute", top: 7, right: 3, background: "none", border: "none", cursor: "pointer", fontSize: 10, color: COLORS.pink, padding: 0, fontWeight: 700 }}>✕</button>
      </>}
    </div>
  );
}

function CalendarioHorarios({ data, reloadData, user }) {
  const hoy = new Date();
  const esAdmin = user.rol === "admin";
  const [vista, setVista] = useState("semana");
  const [weekStart, setWeekStart] = useState(getMon(hoy));
  const [mes, setMes] = useState(hoy.getMonth() === 11 ? 0 : hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getMonth() === 11 ? hoy.getFullYear() + 1 : hoy.getFullYear());
  const [manicuraId, setManicuraId] = useState(esAdmin ? (data.users.filter(u => u.rol === "manicura" && u.activo)[0]?.id || null) : user.id);
  const [navVisible, setNavVisible] = useState(true);
  const [modalDk, setModalDk] = useState(null);
  const [localH, setLocalH] = useState({});
  const scrollRef = useRef(null);
  const didScroll = useRef(false);

  const periodoKey = `${anio}-${String(mes + 1).padStart(2,"0")}`;
  const bloqueado = (data.periodosBloqueados || []).includes(periodoKey) && !esAdmin;
  const feriados = new Set((data.feriados || []).map(f => f.fecha));
  const manicuras = data.users.filter(u => u.rol === "manicura" && u.activo);

  const bloques = useMemo(() => {
    const uid = parseInt(manicuraId); const res = {};
    (data.horarios || []).filter(h => h.userId === uid).forEach(h => {
      if (h.trabaja && h.entrada && h.salida) {
        const [eh, em] = h.entrada.split(":").map(Number);
        const [sh, sm] = h.salida.split(":").map(Number);
        res[h.fecha] = { startSlot: calToSlot(eh, em), endSlot: calToSlot(sh, sm) };
      }
    });
    return res;
  }, [data.horarios, manicuraId]);

  const getB = f => localH[f] ?? bloques[f];

  const setScrollRef = useCallback(el => {
    scrollRef.current = el;
    if (el && !didScroll.current) { el.scrollTop = (CAL_VIEW_START - CAL_START) * CAL_SLOT_H - 8; didScroll.current = true; }
  }, []);

  const saveBloque = useCallback(async (f, b) => {
    const uid = parseInt(manicuraId);
    const bl = b || localH[f] || bloques[f];
    if (!bl) return;
    const s = calFromSlot(bl.startSlot), e = calFromSlot(bl.endSlot);
    await api.upsertHorario({ user_id: uid, fecha: f, entrada: calFmt(s.h, s.m), salida: calFmt(e.h, e.m), trabaja: true });
    await reloadData();
    setLocalH(p => { const n = { ...p }; delete n[f]; return n; });
  }, [manicuraId, localH, bloques, reloadData]);

  const onAddB = useCallback(async (f, b) => {
    const uid = parseInt(manicuraId);
    setLocalH(p => ({ ...p, [f]: b }));
    const s = calFromSlot(b.startSlot), e = calFromSlot(b.endSlot);
    await api.upsertHorario({ user_id: uid, fecha: f, entrada: calFmt(s.h, s.m), salida: calFmt(e.h, e.m), trabaja: true });
    await reloadData();
    setLocalH(p => { const n = { ...p }; delete n[f]; return n; });
  }, [manicuraId, reloadData]);

  const onDeleteB = useCallback(async (f) => {
    await api.deleteHorario(parseInt(manicuraId), f); await reloadData();
  }, [manicuraId, reloadData]);

  const toggleFeriado = useCallback(async (f) => {
    if (!esAdmin) return;
    if (feriados.has(f)) await api.deleteFeriado(f);
    else await api.createFeriado({ fecha: f, descripcion: "" });
    await reloadData();
  }, [esAdmin, feriados, reloadData]);

  const toggleBloqueo = useCallback(async () => {
    if ((data.periodosBloqueados || []).includes(periodoKey)) await api.deletePeriodo(periodoKey);
    else await api.createPeriodo(periodoKey);
    await reloadData();
  }, [periodoKey, data.periodosBloqueados, reloadData]);

  const { totalHoras, diasCargados } = useMemo(() => {
    let fechas = [];
    if (vista === "semana") fechas = Array.from({ length: 6 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return dateKey(d); });
    else fechas = getDiasDelMes(anio, mes).map(d => dateKey(d));
    const cargados = fechas.filter(f => getB(f));
    return { totalHoras: cargados.reduce((a, f) => a + calHoras(getB(f)), 0), diasCargados: cargados.length };
  }, [vista, weekStart, mes, anio, bloques, localH]);

  const weekDays = useMemo(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }), [weekStart]);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 5);
  const navLabel = vista === "semana" ? `${weekStart.getDate()} – ${weekEnd.getDate()} ${MESES[weekStart.getMonth()]} ${weekStart.getFullYear()}` : `${MESES[mes]} ${anio}`;
  const prevNav = () => { if (vista === "semana") { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); } else { if (mes === 0) { setMes(11); setAnio(a => a - 1); } else setMes(m => m - 1); } };
  const nextNav = () => { if (vista === "semana") { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); } else { if (mes === 11) { setMes(0); setAnio(a => a + 1); } else setMes(m => m + 1); } };
  const todayDk = dateKey(hoy);

  const renderSemanal = () => (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", flexDirection: "column" }}>
      <div style={{ display: "flex", flexShrink: 0, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ width: 44, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(6,1fr)" }}>
          {weekDays.map((d, i) => {
            const f = dateKey(d), isToday = f === todayDk, fer = feriados.has(f);
            return <div key={i} onClick={() => esAdmin && toggleFeriado(f)} title={esAdmin ? (fer ? "Quitar feriado" : "Marcar feriado") : ""} style={{ textAlign: "center", padding: "6px 4px", borderLeft: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none", background: fer ? COLORS.amberLight : "transparent", cursor: esAdmin ? "pointer" : "default" }}>
              <p style={{ margin: 0, fontSize: 10, color: fer ? COLORS.amber : "var(--color-text-secondary)", fontWeight: fer ? 500 : 400 }}>{DIAS_SEMANA[i]}{fer ? " 🗓️" : ""}</p>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: isToday ? COLORS.pink : "transparent", margin: "2px auto 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: isToday ? "#fff" : fer ? COLORS.amber : "var(--color-text-primary)" }}>{d.getDate()}</span>
              </div>
              {fer && <p style={{ margin: 0, fontSize: 9, color: COLORS.amber, fontWeight: 500 }}>Feriado</p>}
            </div>;
          })}
        </div>
        <div style={{ width: 80, flexShrink: 0, borderLeft: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500 }}>Sem.</span>
        </div>
      </div>
      <div ref={setScrollRef} style={{ flex: 1, overflowY: "auto", display: "flex" }}>
        <div style={{ width: 44, flexShrink: 0, borderRight: "0.5px solid var(--color-border-tertiary)" }}>
          {CAL_HOURS.map(h => <div key={h} style={{ height: CAL_SLOT_H, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 6 }}><span style={{ fontSize: 10, color: "var(--color-text-secondary)", marginTop: -5 }}>{String(h).padStart(2,"0")}:00</span></div>)}
        </div>
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(6,1fr)" }}>
          {weekDays.map((d, i) => {
            const f = dateKey(d), fer = feriados.has(f), b = getB(f);
            return <div key={i} onClick={e => { if (!bloqueado && !b) { const rect = e.currentTarget.getBoundingClientRect(); const slot = calYSlot(e.clientY - rect.top); onAddB(f, { startSlot: Math.max(0, slot - 2), endSlot: Math.min(CAL_TOTAL_SLOTS, slot + 6) }); } }} style={{ position: "relative", height: CAL_GRID_H, borderLeft: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none", cursor: bloqueado ? "default" : (b ? "default" : "cell"), background: fer ? "rgba(186,117,23,0.05)" : "transparent" }}>
              {CAL_HOURS.map((_, hi) => <div key={hi} style={{ position: "absolute", top: hi * CAL_SLOT_H, left: 0, right: 0, height: CAL_SLOT_H, borderTop: "0.5px solid var(--color-border-tertiary)", pointerEvents: "none" }}><div style={{ position: "absolute", top: "50%", left: 0, right: 0, borderTop: "0.5px dashed var(--color-border-tertiary)", opacity: 0.4 }} /></div>)}
              {b && <BloqueCalendario fecha={f} bloque={b} onChange={(f2, nb) => { setLocalH(p => ({ ...p, [f2]: nb })); setTimeout(() => saveBloque(f2, nb), 600); }} onDelete={onDeleteB} bloqueado={bloqueado} />}
            </div>;
          })}
        </div>
        <div style={{ width: 80, flexShrink: 0, borderLeft: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: totalHoras > 0 ? COLORS.success : "var(--color-text-secondary)" }}>{totalHoras.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  );

  const renderMensual = () => {
    const dias = getDiasDelMes(anio, mes), sems = getSemanas(dias);
    return <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr) 80px", borderBottom: "0.5px solid var(--color-border-tertiary)", position: "sticky", top: 0, background: "var(--color-background-primary)", zIndex: 2 }}>
        {DIAS_SEMANA.map(d => <div key={d} style={{ textAlign: "center", padding: "8px 4px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)" }}>{d}</div>)}
        <div style={{ textAlign: "center", padding: "8px 4px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", borderLeft: "0.5px solid var(--color-border-tertiary)" }}>Sem.</div>
      </div>
      {sems.map((semana, si) => {
        const totalSem = semana.reduce((a, d) => a + calHoras(getB(dateKey(d))), 0);
        return <div key={si} style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr) 80px", borderBottom: "0.5px solid var(--color-border-tertiary)", minHeight: 90 }}>
          {Array.from({ length: 6 }, (_, i) => {
            const d = semana[i]; if (!d) return <div key={i} style={{ borderLeft: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none" }} />;
            const f = dateKey(d), b = getB(f), isToday = f === todayDk, fer = feriados.has(f);
            const s = b ? calFromSlot(b.startSlot) : null, e = b ? calFromSlot(b.endSlot) : null;
            return <div key={i} onClick={() => setModalDk(f)} style={{ borderLeft: i > 0 ? "0.5px solid var(--color-border-tertiary)" : "none", padding: 6, cursor: "pointer", background: fer ? COLORS.amberLight : (b ? COLORS.pinkLight : "transparent") }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: isToday ? COLORS.pink : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: isToday ? "#fff" : fer ? COLORS.amber : "var(--color-text-primary)" }}>{d.getDate()}</span>
                </div>
                {fer && <span style={{ fontSize: 9, color: COLORS.amber, fontWeight: 500 }}>Feriado</span>}
              </div>
              {b ? <div style={{ background: "#fff", border: `1px solid ${COLORS.pink}`, borderRadius: 4, padding: "2px 5px" }}><p style={{ margin: 0, fontSize: 10, color: COLORS.pinkDark, fontWeight: 500 }}>{calFmt(s.h, s.m)}–{calFmt(e.h, e.m)}</p><p style={{ margin: 0, fontSize: 10, color: COLORS.pink }}>{calHoras(b).toFixed(1)}h</p></div>
              : !bloqueado && <p style={{ margin: 0, fontSize: 10, color: "var(--color-text-secondary)", opacity: 0.5 }}>+ agregar</p>}
            </div>;
          })}
          <div style={{ borderLeft: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: totalSem > 0 ? COLORS.success : "var(--color-text-secondary)" }}>{totalSem.toFixed(1)}h</span>
          </div>
        </div>;
      })}
    </div>;
  };

  const ModalDia = ({ f }) => {
    const b = getB(f);
    const def = b ? { s: calFmt(calFromSlot(b.startSlot).h, calFromSlot(b.startSlot).m), e: calFmt(calFromSlot(b.endSlot).h, calFromSlot(b.endSlot).m) } : { s: "10:00", e: "20:00" };
    const [start, setStart] = useState(def.s);
    const [end, setEnd] = useState(def.e);
    const fer = feriados.has(f);
    const d = new Date(f + "T12:00:00"), dow = d.getDay();
    const label = `${DIAS_SEMANA[dow === 0 ? 6 : dow - 1]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
    const opciones = Array.from({ length: CAL_TOTAL_SLOTS }, (_, i) => { const { h, m } = calFromSlot(i); return calFmt(h, m); });
    const guardar = async () => {
      const [sh, sm] = start.split(":").map(Number), [eh, em] = end.split(":").map(Number);
      const ss = calToSlot(sh, sm), es = calToSlot(eh, em);
      if (es > ss) await onAddB(f, { startSlot: ss, endSlot: es });
      setModalDk(null);
    };
    return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={e => { if (e.target === e.currentTarget) setModalDk(null); }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "1.25rem", width: 290, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}><h3 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#1a1a1a" }}>{label}</h3><button onClick={() => setModalDk(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#888" }}>×</button></div>
        {!bloqueado && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[["Entrada", start, setStart], ["Salida", end, setEnd]].map(([lbl, val, setVal]) => <div key={lbl}><label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 4 }}>{lbl}</label><select value={val} onChange={e => setVal(e.target.value)} style={{ width: "100%", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "8px 10px", fontSize: 14, background: "#fafafa" }}>{opciones.map(t => <option key={t} value={t}>{t}</option>)}</select></div>)}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={guardar} style={{ flex: 1, background: COLORS.pink, color: "#fff", border: "none", borderRadius: 8, padding: "8px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Guardar</button>
            {b && <button onClick={async () => { await onDeleteB(f); setModalDk(null); }} style={{ background: "#fee", color: "#e24b4a", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 14, cursor: "pointer" }}>Eliminar</button>}
            <button onClick={() => setModalDk(null)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
          </div>
        </div>}
        {esAdmin && <div style={{ marginTop: !bloqueado ? 12 : 0, borderTop: !bloqueado ? "0.5px solid #eee" : "none", paddingTop: !bloqueado ? 12 : 0 }}>
          <button onClick={async () => { await toggleFeriado(f); setModalDk(null); }} style={{ width: "100%", background: fer ? COLORS.amberLight : "#f5f5f5", color: fer ? COLORS.amber : "#555", border: "none", borderRadius: 8, padding: "8px", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>{fer ? "🗓️ Quitar feriado" : "🗓️ Marcar como feriado"}</button>
        </div>}
      </div>
    </div>;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{esAdmin ? "Gestión de horarios" : "Mis horarios"}</h2>
        {esAdmin && <Btn onClick={toggleBloqueo} variant={(data.periodosBloqueados || []).includes(periodoKey) ? "success" : "danger"} size="sm">{(data.periodosBloqueados || []).includes(periodoKey) ? "🔓 Habilitar período" : "🔒 Bloquear período"}</Btn>}
      </div>
      <div style={{ display: "flex", height: 560, border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, overflow: "hidden", background: "var(--color-background-primary)" }}>
        {navVisible && <div style={{ width: 190, flexShrink: 0, borderRight: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column", background: "var(--color-background-secondary)" }}>
          {esAdmin && <div style={{ padding: "10px 10px 6px" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Manicura</p>
            <select value={manicuraId || ""} onChange={e => setManicuraId(e.target.value)} style={{ width: "100%", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
              {manicuras.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>}
          <div style={{ padding: "10px 10px 6px", borderTop: esAdmin ? "0.5px solid var(--color-border-tertiary)" : "none" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Vista</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {["semana", "mes"].map(v => <button key={v} onClick={() => setVista(v)} style={{ textAlign: "left", padding: "6px 8px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 500, background: vista === v ? COLORS.pinkLight : "transparent", color: vista === v ? COLORS.pinkDark : "var(--color-text-primary)" }}>{v === "semana" ? "📅 Semana" : "🗓️ Mes"}</button>)}
            </div>
          </div>
          <div style={{ padding: "8px 10px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Período</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <button onClick={prevNav} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: 14 }}>‹</button>
              <span style={{ fontSize: 10, fontWeight: 500, textAlign: "center", flex: 1, padding: "0 4px", color: "var(--color-text-primary)" }}>{navLabel}</span>
              <button onClick={nextNav} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: 14 }}>›</button>
            </div>
            <button onClick={() => { setWeekStart(getMon(hoy)); setMes(hoy.getMonth()); setAnio(hoy.getFullYear()); }} style={{ width: "100%", background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px", cursor: "pointer", fontSize: 11, color: "var(--color-text-secondary)" }}>Hoy</button>
          </div>
          <div style={{ padding: "8px 10px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Resumen</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[["Días cargados", diasCargados, null], ["Horas totales", `${totalHoras.toFixed(1)}h`, totalHoras > 0 ? COLORS.success : null]].map(([lbl, val, color]) => <div key={lbl} style={{ background: "var(--color-background-primary)", borderRadius: 8, padding: "7px 10px", border: "0.5px solid var(--color-border-tertiary)" }}><p style={{ margin: 0, fontSize: 10, color: "var(--color-text-secondary)" }}>{lbl}</p><p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: color || "var(--color-text-primary)" }}>{val}</p></div>)}
            </div>
          </div>
          {esAdmin && <div style={{ padding: "8px 10px", borderTop: "0.5px solid var(--color-border-tertiary)", marginTop: "auto" }}>
            <div style={{ background: COLORS.amberLight, borderRadius: 6, padding: "6px 8px" }}>
              <p style={{ margin: 0, fontSize: 10, color: COLORS.amber, fontWeight: 500 }}>Clic en día (sem.) o modal (mes) para feriado</p>
            </div>
          </div>}
        </div>}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setNavVisible(v => !v)} style={{ background: "none", border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 13, color: "var(--color-text-secondary)" }}>{navVisible ? "◀" : "▶"}</button>
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{navLabel}</span>
            {bloqueado && <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.amber, background: COLORS.amberLight, padding: "3px 8px", borderRadius: 6 }}>🔒 Período bloqueado</span>}
            {vista === "semana" && !bloqueado && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary)", opacity: 0.7 }}>Clic en celda vacía para agregar · Arrastrá para mover</span>}
          </div>
          {vista === "semana" ? renderSemanal() : renderMensual()}
        </div>
      </div>
      {modalDk && <ModalDia f={modalDk} />}
    </div>
  );
}

// ── LOGIN ──────────────────────────────────────────────────────────
function Login({ onLogin, reloadData }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [vista, setVista] = useState("login");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [nueva, setNueva] = useState("");
  const [nueva2, setNueva2] = useState("");
  const [msg, setMsg] = useState("");
  const [tokenValido, setTokenValido] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true); setErr("");
    try {
      const users = await api.getUsers();
      const found = users.map(normalizeUser).find(x => x.usuario === u.trim() && x.password === p && x.activo);
      if (found) { await reloadData(); onLogin(found); }
      else setErr("Usuario o contraseña incorrectos.");
    } catch { setErr("Error de conexión. Intentá de nuevo."); }
    setLoading(false);
  };

  const handleRecuperar = async () => {
    setLoading(true); setMsg("");
    try {
      const users = await api.getUsers();
      const user = users.map(normalizeUser).find(x => x.email && x.email.toLowerCase() === email.trim().toLowerCase() && x.activo);
      if (user) {
        await api.deleteTokenByUser(user.id);
        const tk = genToken();
        await api.createToken({ token: tk, user_id: user.id, expiry: Date.now() + 30 * 60 * 1000 });
        setMsg(`Demo — tu token es: ${tk}`);
      } else setMsg("Si el mail existe, vas a recibir las instrucciones.");
    } catch { setMsg("Error al procesar."); }
    setLoading(false);
  };

  const handleVerificarToken = async () => {
    setLoading(true); setMsg("");
    try {
      const tokens = await api.getTokens();
      const tk = tokens.find(t => t.token === token.trim() && t.expiry > Date.now());
      if (tk) { setTokenValido(tk); setVista("nueva"); }
      else setMsg("Token inválido o vencido.");
    } catch { setMsg("Error al verificar."); }
    setLoading(false);
  };

  const handleNuevaPassword = async () => {
    if (!nueva || nueva !== nueva2) { setMsg("Las contraseñas no coinciden."); return; }
    setLoading(true);
    try {
      await api.updateUser(tokenValido.user_id, { password: nueva });
      await api.deleteToken(tokenValido.token);
      setVista("login"); setMsg(""); setNueva(""); setNueva2(""); setToken(""); setErr("");
      alert("Contraseña actualizada. Ya podés ingresar.");
    } catch { setMsg("Error al guardar."); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--color-background-tertiary)" }}>
      <Card style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 4 }}>💅</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>Niki Beauty Bar</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>Control de asistencia</p>
        </div>
        {vista === "login" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Input value={u} onChange={setU} placeholder="Usuario" />
            <Input value={p} onChange={setP} type="password" placeholder="Contraseña" />
            {err && <p style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>{err}</p>}
            <Btn onClick={handleLogin} disabled={loading} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Ingresando..." : "Ingresar"}</Btn>
            <button onClick={() => { setVista("recuperar"); setMsg(""); setEmail(""); }} style={{ background: "none", border: "none", color: COLORS.pink, fontSize: 13, cursor: "pointer", textAlign: "center", marginTop: 4 }}>¿Olvidaste tu contraseña?</button>
          </div>
        )}
        {vista === "recuperar" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>Ingresá tu mail y te enviamos un token.</p>
            <Input value={email} onChange={setEmail} placeholder="tu@mail.com" type="email" />
            {msg && <p style={{ margin: 0, fontSize: 13, color: msg.startsWith("Demo") ? COLORS.info : COLORS.success, wordBreak: "break-all" }}>{msg}</p>}
            <Btn onClick={handleRecuperar} disabled={loading} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Enviando..." : "Enviar token"}</Btn>
            {msg && <Btn onClick={() => { setVista("token"); setMsg(""); }} variant="secondary" style={{ width: "100%", justifyContent: "center" }}>Tengo mi token →</Btn>}
            <button onClick={() => setVista("login")} style={{ background: "none", border: "none", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", textAlign: "center" }}>← Volver</button>
          </div>
        )}
        {vista === "token" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>Ingresá el token que recibiste.</p>
            <Input value={token} onChange={setToken} placeholder="Token" />
            {msg && <p style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>{msg}</p>}
            <Btn onClick={handleVerificarToken} disabled={loading} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Verificando..." : "Verificar"}</Btn>
            <button onClick={() => setVista("recuperar")} style={{ background: "none", border: "none", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", textAlign: "center" }}>← Volver</button>
          </div>
        )}
        {vista === "nueva" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>Elegí tu nueva contraseña.</p>
            <Input value={nueva} onChange={setNueva} type="password" placeholder="Nueva contraseña" />
            <Input value={nueva2} onChange={setNueva2} type="password" placeholder="Repetir contraseña" />
            {msg && <p style={{ margin: 0, fontSize: 13, color: COLORS.danger }}>{msg}</p>}
            <Btn onClick={handleNuevaPassword} disabled={loading} style={{ width: "100%", justifyContent: "center" }}>{loading ? "Guardando..." : "Guardar contraseña"}</Btn>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── ABM MANICURAS ──────────────────────────────────────────────────
function ABMManicuras({ data, reloadData }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const manicuras = data.users.filter(u => u.rol === "manicura");
  const openNew = () => { setForm({ nombre: "", usuario: "", email: "", password: "", password2: "", localId: data.locales[0]?.id || "", activo: true }); setFormErr(""); setModal("new"); };
  const openEdit = u => { setForm({ ...u, password: "", password2: "" }); setFormErr(""); setModal("edit"); };
  const save = async () => {
    setFormErr("");
    if (!form.nombre.trim() || !form.usuario.trim()) { setFormErr("Nombre y usuario son obligatorios."); return; }
    if (modal === "new") {
      if (!form.password) { setFormErr("Ingresá una contraseña."); return; }
      if (form.password !== form.password2) { setFormErr("Las contraseñas no coinciden."); return; }
    } else {
      if (form.password && form.password !== form.password2) { setFormErr("Las contraseñas no coinciden."); return; }
    }
    setSaving(true);
    try {
      if (modal === "new") {
        await api.createUser({ nombre: form.nombre.trim(), usuario: form.usuario.trim(), email: form.email.trim(), password: form.password, rol: "manicura", local_id: parseInt(form.localId) || null, activo: true });
      } else {
        const upd = { nombre: form.nombre.trim(), usuario: form.usuario.trim(), email: form.email?.trim() || "", local_id: parseInt(form.localId) || null };
        if (form.password) upd.password = form.password;
        await api.updateUser(form.id, upd);
      }
      await reloadData(); setModal(null);
    } catch (e) { setFormErr("Error al guardar: " + e.message); }
    setSaving(false);
  };
  const toggle = async (u) => { await api.updateUser(u.id, { activo: !u.activo }); await reloadData(); };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Manicuras</h2>
        <Btn onClick={openNew} size="sm">+ Nueva</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {manicuras.map(m => {
          const local = data.locales.find(l => l.id === m.localId);
          return (
            <Card key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Avatar nombre={m.nombre} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{m.nombre}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{m.usuario} · {m.email || "Sin mail"} · {local?.nombre || "Sin local"}</p>
              </div>
              <Badge color={m.activo ? "success" : "gray"}>{m.activo ? "Activa" : "Inactiva"}</Badge>
              <Btn onClick={() => openEdit(m)} variant="ghost" size="sm">Editar</Btn>
              <Btn onClick={() => toggle(m)} variant="ghost" size="sm" style={{ color: m.activo ? COLORS.danger : COLORS.success }}>{m.activo ? "Desactivar" : "Activar"}</Btn>
            </Card>
          );
        })}
      </div>
      {modal && (
        <Modal title={modal === "new" ? "Nueva manicura" : "Editar manicura"} onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ModalInput label="Nombre completo" value={form.nombre || ""} onChange={v => setForm(f => ({ ...f, nombre: v }))} />
            <ModalInput label="Usuario" value={form.usuario || ""} onChange={v => setForm(f => ({ ...f, usuario: v }))} />
            <ModalInput label="Email" type="email" value={form.email || ""} onChange={v => setForm(f => ({ ...f, email: v }))} />
            <div style={{ borderTop: "1px dashed #eee", paddingTop: 14 }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "#888" }}>{modal === "edit" ? "Dejá en blanco para no cambiar la contraseña" : "Contraseña"}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <ModalInput label={modal === "edit" ? "Nueva contraseña" : "Contraseña"} type="password" value={form.password || ""} onChange={v => setForm(f => ({ ...f, password: v }))} />
                <ModalInput label="Repetir contraseña" type="password" value={form.password2 || ""} onChange={v => setForm(f => ({ ...f, password2: v }))} />
              </div>
            </div>
            <ModalSelect label="Local" value={form.localId || ""} onChange={v => setForm(f => ({ ...f, localId: v }))}>
              <option value="">Sin local</option>
              {data.locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </ModalSelect>
            {formErr && <p style={{ margin: 0, fontSize: 13, color: COLORS.danger, background: COLORS.dangerLight, padding: "8px 12px", borderRadius: 8 }}>{formErr}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Btn onClick={save} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Guardando..." : "Guardar"}</Btn>
              <Btn onClick={() => setModal(null)} variant="secondary" style={{ flex: 1, justifyContent: "center" }}>Cancelar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ABM LOCALES ────────────────────────────────────────────────────
function ABMLocales({ data, reloadData }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const openNew = () => { setForm({ nombre: "", direccion: "" }); setModal("new"); };
  const openEdit = l => { setForm({ ...l }); setModal("edit"); };
  const save = async () => {
    if (!form.nombre) return;
    setSaving(true);
    try {
      if (modal === "new") await api.createLocal({ nombre: form.nombre, direccion: form.direccion });
      else await api.updateLocal(form.id, { nombre: form.nombre, direccion: form.direccion });
      await reloadData(); setModal(null);
    } catch (e) { alert("Error: " + e.message); }
    setSaving(false);
  };
  const del = async (id) => {
    if (data.users.some(u => u.localId === id)) return alert("Hay manicuras asignadas a este local.");
    await api.deleteLocal(id); await reloadData();
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Locales</h2>
        <Btn onClick={openNew} size="sm">+ Nuevo</Btn>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.locales.map(l => {
          const qty = data.users.filter(u => u.localId === l.id && u.rol === "manicura").length;
          return (
            <Card key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{l.nombre}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{l.direccion}</p>
              </div>
              <Badge color="info">{qty} manicura{qty !== 1 ? "s" : ""}</Badge>
              <Btn onClick={() => openEdit(l)} variant="ghost" size="sm">Editar</Btn>
              <Btn onClick={() => del(l.id)} variant="ghost" size="sm" style={{ color: COLORS.danger }}>Eliminar</Btn>
            </Card>
          );
        })}
      </div>
      {modal && (
        <Modal title={modal === "new" ? "Nuevo local" : "Editar local"} onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ModalInput label="Nombre" value={form.nombre || ""} onChange={v => setForm(f => ({ ...f, nombre: v }))} />
            <ModalInput label="Dirección" value={form.direccion || ""} onChange={v => setForm(f => ({ ...f, direccion: v }))} />
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Btn onClick={save} disabled={saving} style={{ flex: 1, justifyContent: "center" }}>{saving ? "Guardando..." : "Guardar"}</Btn>
              <Btn onClick={() => setModal(null)} variant="secondary" style={{ flex: 1, justifyContent: "center" }}>Cancelar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── MI PERFIL ──────────────────────────────────────────────────────
function MiPerfil({ data, reloadData, user, setUser }) {
  const [form, setForm] = useState({ nombre: user.nombre, email: user.email || "", password: "", password2: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setErr(""); setOk(false);
    if (!form.nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    if (form.password && form.password !== form.password2) { setErr("Las contraseñas no coinciden."); return; }
    setSaving(true);
    try {
      const upd = { nombre: form.nombre.trim(), email: form.email.trim() };
      if (form.password) upd.password = form.password;
      await api.updateUser(user.id, upd);
      await reloadData();
      setUser({ ...user, ...upd });
      setOk(true);
    } catch (e) { setErr("Error al guardar: " + e.message); }
    setSaving(false);
  };
  return (
    <div>
      <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 500 }}>Mi perfil</h2>
      <Card style={{ maxWidth: 440 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Nombre</label><Input value={form.nombre} onChange={v => setForm(f => ({ ...f, nombre: v }))} /></div>
          <div><label style={{ fontSize: 13, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Email</label><Input type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="tu@mail.com" /></div>
          <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--color-text-secondary)" }}>Cambiar contraseña (opcional)</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Input type="password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder="Nueva contraseña" />
              <Input type="password" value={form.password2} onChange={v => setForm(f => ({ ...f, password2: v }))} placeholder="Repetir contraseña" />
            </div>
          </div>
          {err && <p style={{ margin: 0, fontSize: 13, color: COLORS.danger, background: COLORS.dangerLight, padding: "8px 12px", borderRadius: 8 }}>{err}</p>}
          {ok && <p style={{ margin: 0, fontSize: 13, color: COLORS.success, background: COLORS.successLight, padding: "8px 12px", borderRadius: 8 }}>Perfil actualizado correctamente.</p>}
          <Btn onClick={save} disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Guardando..." : "Guardar cambios"}</Btn>
        </div>
      </Card>
    </div>
  );
}

// ── ASISTENCIA DIARIA ──────────────────────────────────────────────
function AsistenciaDiaria({ data, reloadData }) {
  const hoy = new Date();
  const [fecha, setFecha] = useState(dateKey(hoy));
  const [modal, setModal] = useState(null);
  const [formAus, setFormAus] = useState({});
  const [formTarde, setFormTarde] = useState({});
  const manicurasConHorario = data.users.filter(u => {
    if (u.rol !== "manicura" || !u.activo) return false;
    const h = data.horarios.find(h => h.userId === u.id && h.fecha === fecha);
    return h && h.trabaja && h.entrada && h.salida;
  });
  const getA = uid => data.asistencias.find(a => a.userId === uid && a.fecha === fecha);
  const setA = async (uid, datos) => {
    await api.upsertAsistencia({ user_id: uid, fecha, estado: datos.estado, entrada_real: datos.entradaReal || null, salida_real: datos.salidaReal || null, motivo: datos.motivo || null, certificado: datos.certificado || false, tipo_doc: datos.tipoDoc || null });
    await reloadData();
  };
  const limpiar = async (uid) => { await api.deleteAsistencia(uid, fecha); await reloadData(); };
  const estadoColor = { presente: "success", tarde: "amber", ausente: "danger" };
  const estadoLabel = { presente: "✓ Presente", tarde: "⏰ Tarde", ausente: "✗ Ausente" };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Asistencia diaria</h2>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 12px", fontSize: 14, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
      </div>
      {manicurasConHorario.length === 0
        ? <Card><p style={{ margin: 0, color: "var(--color-text-secondary)", fontSize: 14, textAlign: "center" }}>No hay manicuras con horario para esta fecha.</p></Card>
        : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {manicurasConHorario.map(m => {
            const h = data.horarios.find(hh => hh.userId === m.id && hh.fecha === fecha);
            const a = getA(m.id);
            return (
              <Card key={m.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <Avatar nombre={m.nombre} />
                  <div style={{ flex: 1, minWidth: 100 }}>
                    <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{m.nombre}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>Horario: {h?.entrada} – {h?.salida}{a?.estado === "tarde" ? ` | Real: ${a.entradaReal} – ${a.salidaReal}` : ""}</p>
                    {a?.estado === "ausente" && <p style={{ margin: 0, fontSize: 12, color: COLORS.danger }}>{a.motivo}{a.certificado ? ` · ${a.tipoDoc || "con certificado"}` : ""}</p>}
                  </div>
                  {a?.estado && <Badge color={estadoColor[a.estado]}>{estadoLabel[a.estado]}</Badge>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Btn onClick={() => setA(m.id, { estado: "presente" })} variant="success" size="sm">✓</Btn>
                    <Btn onClick={() => { const h2 = data.horarios.find(h => h.userId === m.id && h.fecha === fecha); const a2 = getA(m.id); setFormTarde({ uid: m.id, entrada: a2?.entradaReal || h2?.entrada || "", salida: a2?.salidaReal || h2?.salida || "" }); setModal("tarde"); }} variant="secondary" size="sm">⏰ Tarde</Btn>
                    <Btn onClick={() => { const a2 = getA(m.id); setFormAus({ uid: m.id, motivo: a2?.motivo || MOTIVOS_AUSENCIA[0], certificado: a2?.certificado || false, tipoDoc: a2?.tipoDoc || "" }); setModal("ausencia"); }} variant="danger" size="sm">✗ Ausente</Btn>
                    {a && <Btn onClick={() => limpiar(m.id)} variant="ghost" size="sm">Limpiar</Btn>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>}
      {modal === "tarde" && (
        <Modal title="Registrar llegada tarde" onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ModalInput label="Horario real de entrada" value={formTarde.entrada} onChange={v => setFormTarde(f => ({ ...f, entrada: v }))} type="time" />
            <ModalInput label="Horario real de salida" value={formTarde.salida} onChange={v => setFormTarde(f => ({ ...f, salida: v }))} type="time" />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={async () => { await setA(formTarde.uid, { estado: "tarde", entradaReal: formTarde.entrada, salidaReal: formTarde.salida }); setModal(null); }} style={{ flex: 1, justifyContent: "center" }}>Guardar</Btn>
              <Btn onClick={() => setModal(null)} variant="secondary" style={{ flex: 1, justifyContent: "center" }}>Cancelar</Btn>
            </div>
          </div>
        </Modal>
      )}
      {modal === "ausencia" && (
        <Modal title="Registrar ausencia" onClose={() => setModal(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ModalSelect label="Motivo" value={formAus.motivo} onChange={v => setFormAus(f => ({ ...f, motivo: v }))}>{MOTIVOS_AUSENCIA.map(m => <option key={m} value={m}>{m}</option>)}</ModalSelect>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={formAus.certificado} onChange={e => setFormAus(f => ({ ...f, certificado: e.target.checked }))} />Presenta documentación
            </label>
            {formAus.certificado && (
              <ModalSelect label="Tipo" value={formAus.tipoDoc} onChange={v => setFormAus(f => ({ ...f, tipoDoc: v }))}>
                <option value="">Seleccionar...</option>
                <option value="Certificado médico">Certificado médico</option>
                <option value="Certificado por examen">Certificado por examen</option>
                <option value="Otro">Otro</option>
              </ModalSelect>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={async () => { await setA(formAus.uid, { estado: "ausente", motivo: formAus.motivo, certificado: formAus.certificado, tipoDoc: formAus.tipoDoc }); setModal(null); }} style={{ flex: 1, justifyContent: "center" }}>Guardar</Btn>
              <Btn onClick={() => setModal(null)} variant="secondary" style={{ flex: 1, justifyContent: "center" }}>Cancelar</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── REPORTES ───────────────────────────────────────────────────────
function Reportes({ data, user }) {
  const hoy = new Date();
  const esAdmin = user.rol === "admin";
  const [tab, setTab] = useState("horas");
  const [filtroTipo, setFiltroTipo] = useState("manicura");
  const [filtroId, setFiltroId] = useState(esAdmin ? (data.users.filter(u => u.rol === "manicura")[0]?.id || "") : user.id);
  const [mes, setMes] = useState(hoy.getMonth());
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [filtroSemana, setFiltroSemana] = useState("todas");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [fechaDesde, setFechaDesde] = useState(dateKey(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [fechaHasta, setFechaHasta] = useState(dateKey(hoy));
  const [expandidos, setExpandidos] = useState({});
  const manicuras = data.users.filter(u => u.rol === "manicura" && u.activo);
  const semanasDelMes = useMemo(() => getSemanas(getDiasDelMes(anio, mes)), [anio, mes]);
  const filtrarM = () => {
    let base = esAdmin ? (filtroTipo === "manicura" ? manicuras.filter(m => m.id === parseInt(filtroId)) : filtroTipo === "local" ? manicuras.filter(m => m.localId === parseInt(filtroId)) : manicuras) : [data.users.find(u => u.id === user.id)].filter(Boolean);
    if (filtroEstado !== "todos") base = base.filter(m => data.asistencias.some(a => a.userId === m.id && a.fecha >= fechaDesde && a.fecha <= fechaHasta && a.estado === filtroEstado));
    return base;
  };
  const mF = filtrarM();
  const toggleExp = id => setExpandidos(e => ({ ...e, [id]: !e[id] }));
  const buildHorasReport = m => {
    const dias = getDiasDelMes(anio, mes);
    const semanas = getSemanas(dias);
    const semanasData = semanas.map((sem, si) => {
      const diasData = sem.map(d => {
        const dk = dateKey(d);
        const h = data.horarios.find(hh => hh.userId === m.id && hh.fecha === dk);
        const a = data.asistencias.find(aa => aa.userId === m.id && aa.fecha === dk);
        const trabaja = h?.trabaja && h?.entrada && h?.salida;
        const horasTeo = trabaja ? calcHoras(h.entrada, h.salida) : 0;
        let horasReal = 0;
        if (trabaja && a) { if (a.estado === "presente") horasReal = horasTeo; else if (a.estado === "tarde") horasReal = calcHoras(a.entradaReal || h.entrada, a.salidaReal || h.salida); }
        const dow = d.getDay();
        return { fecha: dk, label: `${DIAS_SEMANA[dow === 0 ? 6 : dow - 1]} ${d.getDate()}`, entrada: h?.entrada || "", salida: h?.salida || "", horasTeo, horasReal, trabaja: !!trabaja, asistencia: a || null };
      });
      return { semana: si + 1, dias: diasData, totalTeo: diasData.reduce((a, d) => a + d.horasTeo, 0), totalReal: diasData.reduce((a, d) => a + d.horasReal, 0) };
    });
    const semFilt = filtroSemana === "todas" ? semanasData : semanasData.filter(s => s.semana === parseInt(filtroSemana));
    return { ...m, semanasData: semFilt, totalMesTeo: semFilt.reduce((a, s) => a + s.totalTeo, 0), totalMesReal: semFilt.reduce((a, s) => a + s.totalReal, 0), diasTrabajo: semFilt.flatMap(s => s.dias).filter(d => d.trabaja).length };
  };
  const buildAsistenciaReport = m => {
    let asist = data.asistencias.filter(a => a.userId === m.id && a.fecha >= fechaDesde && a.fecha <= fechaHasta).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (filtroSemana !== "todas") { const semDias = (semanasDelMes[parseInt(filtroSemana) - 1] || []).map(d => dateKey(d)); asist = asist.filter(a => semDias.includes(a.fecha)); }
    const asistFilt = filtroEstado === "todos" ? asist : asist.filter(a => a.estado === filtroEstado);
    const presentes = asist.filter(a => a.estado === "presente").length;
    const tardes = asist.filter(a => a.estado === "tarde").length;
    const ausentes = asist.filter(a => a.estado === "ausente").length;
    const total = presentes + tardes + ausentes;
    return { ...m, asist: asistFilt, presentes, tardes, ausentes, total, pct: total > 0 ? Math.round(((presentes + tardes) / total) * 100) : 0 };
  };
  const TabBtn = ({ id, label }) => <button onClick={() => setTab(id)} style={{ padding: "8px 16px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500, background: tab === id ? COLORS.pink : "transparent", color: tab === id ? "#fff" : "var(--color-text-secondary)" }}>{label}</button>;
  const estadoColor = { presente: "success", tarde: "amber", ausente: "danger" };
  const estadoLabel = { presente: "Presente", tarde: "Tarde", ausente: "Ausente" };
  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 500 }}>Reportes</h2>
      <div style={{ display: "flex", gap: 4, background: "var(--color-background-secondary)", padding: 4, borderRadius: 10, marginBottom: 20, width: "fit-content" }}><TabBtn id="horas" label="Horas teóricas" /><TabBtn id="asistencia" label="Asistencia" /></div>
      {esAdmin && <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <Select value={filtroTipo} onChange={v => { setFiltroTipo(v); setExpandidos({}); }} style={{ width: 130 }}><option value="manicura">Manicura</option><option value="local">Local</option><option value="todas">Todas</option></Select>
        {filtroTipo === "manicura" && <Select value={filtroId} onChange={v => { setFiltroId(v); setExpandidos({}); }} style={{ flex: 1, minWidth: 160 }}>{manicuras.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</Select>}
        {filtroTipo === "local" && <Select value={filtroId} onChange={v => { setFiltroId(v); setExpandidos({}); }} style={{ flex: 1, minWidth: 160 }}>{data.locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Select>}
      </div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Select value={filtroSemana} onChange={v => { setFiltroSemana(v); setExpandidos({}); }} style={{ width: 150 }}><option value="todas">Todas las semanas</option>{semanasDelMes.map((_, i) => <option key={i + 1} value={i + 1}>Semana {i + 1}</option>)}</Select>
        <Select value={filtroEstado} onChange={v => { setFiltroEstado(v); setExpandidos({}); }} style={{ width: 160 }}><option value="todos">Todos los estados</option><option value="ausente">Solo ausencias</option><option value="tarde">Solo llegadas tarde</option></Select>
        {(filtroSemana !== "todas" || filtroEstado !== "todos") && <button onClick={() => { setFiltroSemana("todas"); setFiltroEstado("todos"); setExpandidos({}); }} style={{ background: COLORS.amberLight, color: COLORS.amber, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>✕ Limpiar filtros</button>}
      </div>
      {filtroEstado !== "todos" && <div style={{ background: COLORS.infoLight, color: COLORS.info, padding: "8px 12px", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>Mostrando solo <strong>{filtroEstado === "ausente" ? "ausencias" : "llegadas tarde"}</strong> en el período.</div>}
      {tab === "horas" && <>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <Select value={mes} onChange={v => { setMes(parseInt(v)); setExpandidos({}); }} style={{ width: 130 }}>{MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}</Select>
          <Select value={anio} onChange={v => { setAnio(parseInt(v)); setExpandidos({}); }} style={{ width: 90 }}>{[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map(a => <option key={a} value={a}>{a}</option>)}</Select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mF.map(m => { const r = buildHorasReport(m), exp = expandidos[m.id]; return (
            <Card key={m.id} style={{ padding: "0.875rem 1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Avatar nombre={r.nombre} />
                <div style={{ flex: 1 }}><p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{r.nombre}</p><p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{data.locales.find(l => l.id === r.localId)?.nombre || "Sin local"} · {r.diasTrabajo} días</p></div>
                <div style={{ display: "flex", gap: 16, marginRight: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <div style={{ textAlign: "right" }}><p style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{r.totalMesTeo.toFixed(1)}h</p><p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>teóricas</p></div>
                  <div style={{ textAlign: "right" }}><p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: r.totalMesReal < r.totalMesTeo ? COLORS.danger : COLORS.success }}>{r.totalMesReal.toFixed(1)}h</p><p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>reales</p></div>
                </div>
                <button onClick={() => toggleExp(m.id)} style={{ background: COLORS.pinkLight, color: COLORS.pinkDark, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{exp ? "▲ Ocultar" : "▼ Ver detalle"}</button>
              </div>
              {exp && <div style={{ marginTop: 14, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
                {r.semanasData.map(sem => <div key={sem.semana} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Semana {sem.semana}</span>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Teo: <strong>{sem.totalTeo.toFixed(1)}h</strong></span>
                      <span style={{ fontSize: 12, color: sem.totalReal < sem.totalTeo ? COLORS.danger : COLORS.success }}>Real: <strong>{sem.totalReal.toFixed(1)}h</strong></span>
                      {sem.totalTeo > 0 && <Badge color={sem.totalReal < sem.totalTeo ? "danger" : "success"}>{sem.totalReal >= sem.totalTeo ? "✓" : "-" + (sem.totalTeo - sem.totalReal).toFixed(1) + "h"}</Badge>}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {sem.dias.map(d => <div key={d.fecha} style={{ display: "grid", gridTemplateColumns: "60px 1fr 50px 50px 60px", gap: 8, alignItems: "center", padding: "5px 8px", borderRadius: 6, background: d.trabaja ? "var(--color-background-secondary)" : "transparent", opacity: d.trabaja ? 1 : 0.45 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>{d.label}</span>
                      <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{d.trabaja ? `${d.entrada} – ${d.salida}` : "—"}</span>
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "right" }}>{d.trabaja ? `${d.horasTeo.toFixed(1)}h` : ""}</span>
                      <span style={{ fontSize: 12, textAlign: "right", color: d.trabaja ? (d.horasReal < d.horasTeo ? COLORS.danger : COLORS.success) : "var(--color-text-secondary)" }}>{d.trabaja ? (d.asistencia ? `${d.horasReal.toFixed(1)}h` : "—") : ""}</span>
                      {d.trabaja ? (d.asistencia ? <Badge color={estadoColor[d.asistencia.estado]}>{d.asistencia.estado === "presente" ? "✓" : d.asistencia.estado === "tarde" ? "Tarde" : "Ausente"}</Badge> : <Badge color="gray">Sin reg.</Badge>) : <Badge color="gray">Libre</Badge>}
                    </div>)}
                  </div>
                </div>)}
              </div>}
            </Card>
          ); })}
          {mF.length === 0 && <Card><p style={{ margin: 0, textAlign: "center", color: "var(--color-text-secondary)" }}>Sin datos para los filtros seleccionados.</p></Card>}
        </div>
      </>}
      {tab === "asistencia" && <>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Desde</span>
          <input type="date" value={fechaDesde} onChange={e => { setFechaDesde(e.target.value); setExpandidos({}); }} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 12px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>hasta</span>
          <input type="date" value={fechaHasta} onChange={e => { setFechaHasta(e.target.value); setExpandidos({}); }} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 12px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mF.map(m => { const r = buildAsistenciaReport(m), exp = expandidos[m.id]; return (
            <Card key={m.id} style={{ padding: "0.875rem 1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Avatar nombre={r.nombre} />
                <div style={{ flex: 1 }}><p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{r.nombre}</p><p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{r.total} días registrados</p></div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge color="success">✓ {r.presentes}</Badge>
                  <Badge color="amber">⏰ {r.tardes}</Badge>
                  <Badge color="danger">✗ {r.ausentes}</Badge>
                  <span style={{ fontSize: 18, fontWeight: 500, color: r.pct >= 90 ? COLORS.success : r.pct >= 75 ? COLORS.amber : COLORS.danger, minWidth: 44, textAlign: "right" }}>{r.pct}%</span>
                </div>
                <button onClick={() => toggleExp(m.id)} style={{ background: COLORS.pinkLight, color: COLORS.pinkDark, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{exp ? "▲ Ocultar" : "▼ Ver detalle"}</button>
              </div>
              {exp && <div style={{ marginTop: 14, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
                {r.asist.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center" }}>Sin registros en este período.</p>
                : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "80px 70px 1fr 1fr 80px", gap: 8, padding: "4px 8px" }}>
                    {["Fecha", "Estado", "H. teórico", "H. real", "Detalle"].map(h => <span key={h} style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</span>)}
                  </div>
                  {r.asist.map(a => {
                    const ht = data.horarios.find(h => h.userId === m.id && h.fecha === a.fecha);
                    const fmtD = (() => { const p = a.fecha.split("-"); return `${p[2]}/${p[1]}`; })();
                    return <div key={a.fecha} style={{ display: "grid", gridTemplateColumns: "80px 70px 1fr 1fr 80px", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, background: "var(--color-background-secondary)" }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{fmtD}</span>
                      <Badge color={estadoColor[a.estado]}>{estadoLabel[a.estado]}</Badge>
                      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{ht?.entrada && ht?.salida ? `${ht.entrada} – ${ht.salida}` : "—"}</span>
                      <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{a.estado === "tarde" ? `${a.entradaReal} – ${a.salidaReal}` : a.estado === "presente" ? "En horario" : "—"}</span>
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                        {a.estado === "ausente" ? <span>{a.motivo}{a.certificado && <><br /><span style={{ fontSize: 11, color: COLORS.info }}>{a.tipoDoc || "Con cert."}</span></>}</span>
                          : a.estado === "tarde" ? <span style={{ color: COLORS.amber }}>{(() => { const d = calcHoras(ht?.entrada || "", a.entradaReal || ""); return d > 0 ? `+${d.toFixed(1)}h` : ""; })()}</span> : ""}
                      </span>
                    </div>;
                  })}
                </div>}
              </div>}
            </Card>
          ); })}
          {mF.length === 0 && <Card><p style={{ margin: 0, textAlign: "center", color: "var(--color-text-secondary)" }}>Sin datos para los filtros seleccionados.</p></Card>}
        </div>
      </>}
    </div>
  );
}

// ── APP PRINCIPAL ──────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [seccion, setSeccion] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reloadData = useCallback(async () => {
    const [users, locales, horarios, asistencias, periodos, feriados] = await Promise.all([
      api.getUsers(), api.getLocales(), api.getHorarios(), api.getAsistencias(), api.getPeriodos(), api.getFeriados()
    ]);
    setData({
      users: users.map(normalizeUser),
      locales,
      horarios: horarios.map(normalizeHorario),
      asistencias: asistencias.map(normalizeAsistencia),
      periodosBloqueados: periodos.map(p => p.periodo),
      feriados,
    });
  }, []);

  useEffect(() => { reloadData().then(() => setLoading(false)).catch(() => setLoading(false)); }, []);

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>Conectando con Supabase...</p></div>;
  if (!user) return <Login onLogin={u => { setUser(u); setSeccion(u.rol === "admin" ? "asistencia" : "horarios"); }} reloadData={reloadData} />;

  const navAdmin = [
    { id: "asistencia", label: "Asistencia", icon: "📋" },
    { id: "horarios", label: "Horarios", icon: "🗓️" },
    { id: "reportes", label: "Reportes", icon: "📊" },
    { id: "manicuras", label: "Manicuras", icon: "💅" },
    { id: "locales", label: "Locales", icon: "🏠" },
    { id: "perfil", label: "Mi perfil", icon: "👤" },
  ];
  const navManicura = [
    { id: "horarios", label: "Mis horarios", icon: "🗓️" },
    { id: "reportes", label: "Mis reportes", icon: "📊" },
    { id: "perfil", label: "Mi perfil", icon: "👤" },
  ];
  const nav = user.rol === "admin" ? navAdmin : navManicura;

  const renderSeccion = () => {
    if (seccion === "asistencia") return <AsistenciaDiaria data={data} reloadData={reloadData} />;
    if (seccion === "horarios") return <CalendarioHorarios data={data} reloadData={reloadData} user={user} />;
    if (seccion === "reportes") return <Reportes data={data} user={user} />;
    if (seccion === "manicuras") return <ABMManicuras data={data} reloadData={reloadData} />;
    if (seccion === "locales") return <ABMLocales data={data} reloadData={reloadData} />;
    if (seccion === "perfil") return <MiPerfil data={data} reloadData={reloadData} user={user} setUser={setUser} />;
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-background-tertiary)", display: "flex", flexDirection: "column" }}>
      <header style={{ background: COLORS.pink, color: "#fff", padding: "0 16px", height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>💅</span>
          <span style={{ fontWeight: 500, fontSize: 15 }}>Niki Beauty Bar</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{user.nombre}</span>
          <button onClick={() => { setUser(null); setMenuOpen(false); }} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>Salir</button>
          <button onClick={() => setMenuOpen(m => !m)} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 16, cursor: "pointer" }}>☰</button>
        </div>
      </header>
      <div style={{ display: "flex", flex: 1 }}>
        <nav style={{ width: menuOpen ? "100%" : 0, maxWidth: 220, background: "var(--color-background-primary)", borderRight: "0.5px solid var(--color-border-tertiary)", overflowX: "hidden", transition: "width 0.2s", flexShrink: 0, position: "sticky", top: 54, alignSelf: "flex-start", maxHeight: "calc(100vh - 54px)", overflowY: "auto" }}>
          <div style={{ padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, minWidth: 200 }}>
            {nav.map(item => (
              <button key={item.id} onClick={() => { setSeccion(item.id); setMenuOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, textAlign: "left", background: seccion === item.id ? COLORS.pinkLight : "transparent", color: seccion === item.id ? COLORS.pinkDark : "var(--color-text-primary)", fontWeight: seccion === item.id ? 500 : 400 }}>
                <span>{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
        </nav>
        <main style={{ flex: 1, padding: "20px 16px", maxWidth: 760, width: "100%" }}>
          {renderSeccion()}
        </main>
      </div>
    </div>
  );
}
