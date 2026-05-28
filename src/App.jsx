import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// Fuente Montserrat en toda la app, incluyendo controles nativos
if (!document.getElementById("niki-font")) {
  const link = document.createElement("link");
  link.id = "niki-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
}
if (!document.getElementById("niki-font-global-style")) {
  const style = document.createElement("style");
  style.id = "niki-font-global-style";
  style.textContent = `
    html, body, #root, #root *,
    button, input, select, textarea, option {
      font-family: 'Montserrat', sans-serif !important;
    }
    button, input, select, textarea {
      letter-spacing: inherit;
    }
  `;
  document.head.appendChild(style);
}
document.body.style.fontFamily = "'Montserrat', sans-serif";

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
  createPeriodo: (periodo, userId) => sb("periodos_bloqueados", { method: "POST", body: JSON.stringify({ periodo, user_id: userId }) }),
  deletePeriodo: (periodo, userId) => sb(`periodos_bloqueados?periodo=eq.${encodeURIComponent(periodo)}&user_id=eq.${userId}`, { method: "DELETE", prefer: "" }),
  getTokens: () => sb("reset_tokens?select=*"),
  createToken: (d) => sb("reset_tokens", { method: "POST", body: JSON.stringify(d) }),
  deleteToken: (token) => sb(`reset_tokens?token=eq.${encodeURIComponent(token)}`, { method: "DELETE", prefer: "" }),
  deleteTokenByUser: (userId) => sb(`reset_tokens?user_id=eq.${userId}`, { method: "DELETE", prefer: "" }),
  getFeriados: () => sb("feriados?select=*"),
  createFeriado: (d) => sb("feriados", { method: "POST", body: JSON.stringify(d) }),
  deleteFeriado: (fecha) => sb(`feriados?fecha=eq.${fecha}`, { method: "DELETE", prefer: "" }),
  getReglasCobertura: () => sb("reglas_cobertura?select=*&order=local_id,dia_semana"),
  upsertReglaCobertura: (d) => patchOrPost("reglas_cobertura", `local_id=eq.${d.local_id}&dia_semana=eq.${d.dia_semana}`, d),
  getConfigCobertura: () => sb("config_cobertura?select=*&order=local_id"),
  upsertConfigCobertura: (d) => patchOrPost("config_cobertura", `local_id=eq.${d.local_id}`, d),
  getEncargadoLocales: () => sb("encargado_locales?select=*"),
  setEncargadoLocales: async (userId, localIds) => { await sb(`encargado_locales?user_id=eq.${userId}`, { method:"DELETE", prefer:"" }); if (!localIds?.length) return []; return sb("encargado_locales", { method:"POST", body:JSON.stringify(localIds.map(local_id=>({ user_id:userId, local_id:parseInt(local_id) }))) }); },
};

function normalizeUser(u) { return { id: u.id, nombre: u.nombre, usuario: u.usuario, password: u.password, email: u.email || "", rol: u.rol, localId: u.local_id, activo: u.activo }; }
function normalizeHorario(h) { return { id: h.id, userId: h.user_id, fecha: h.fecha, entrada: h.entrada || "", salida: h.salida || "", trabaja: h.trabaja }; }
function normalizeAsistencia(a) { return { id: a.id, userId: a.user_id, fecha: a.fecha, estado: a.estado, entradaReal: a.entrada_real || "", salidaReal: a.salida_real || "", motivo: a.motivo || "", certificado: a.certificado, tipoDoc: a.tipo_doc || "" }; }
function normalizePeriodo(p) { return { id: p.id, periodo: p.periodo, userId: p.user_id ?? p.userId ?? null }; }
function normalizeReglaCobertura(r) { return { id:r.id, localId:r.local_id, diaSemana:r.dia_semana, afluencia:r.afluencia, minimoDiario:r.minimo_diario, maximoDiario:r.maximo_diario, minimoApertura:r.minimo_apertura, minimoCierre:r.minimo_cierre, activo:r.activo }; }
function normalizeConfigCobertura(c) { return { id:c.id, localId:c.local_id, horaApertura:(c.hora_apertura||"10:00").slice(0,5), horaCierre:(c.hora_cierre||"20:00").slice(0,5), minutosApertura:c.minutos_apertura ?? 60, minutosCierre:c.minutos_cierre ?? 60 }; }
function normalizeEncargadoLocal(x) { return { userId:x.user_id, localId:x.local_id }; }

const COLORS = {
  pink: "#d4537e", pinkLight: "#fbeaf0", pinkDark: "#72243e",
  gray: "#888780", grayLight: "#f1efe8",
  success: "#639922", successLight: "#eaf3de",
  danger: "#e24b4a", dangerLight: "#fcebeb",
  amber: "#ba7517", amberLight: "#faeeda",
  info: "#185fa5", infoLight: "#e6f1fb",
};

// Logo: pegá acá la URL pública del logo o una imagen en base64/data URL.
// Si queda vacío, la app muestra una marca temporal con las iniciales.
const LOGO_SRC = "data:image/png;base64,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";

function LogoMark({ size = 32, variant = "light" }) {
  const bg = variant === "light" ? "#fff" : COLORS.pinkLight;
  const fg = variant === "light" ? COLORS.pinkDark : COLORS.pinkDark;
  if (LOGO_SRC) {
    return (
      <img
        src={LOGO_SRC}
        alt="Niki Beauty Bar"
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          borderRadius: 8,
          display: "block",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      aria-label="Niki Beauty Bar"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, size * 0.25),
        background: bg,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.max(10, size * 0.34),
        letterSpacing: "-0.04em",
        boxShadow: variant === "light" ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
        flexShrink: 0,
      }}
    >
      NB
    </div>
  );
}

const DIAS_SEMANA = ["Lun","Mar","Mié","Jue","Vie","Sáb"];
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MOTIVOS_AUSENCIA = ["Enfermedad","Personal","Trámite","Licencia","Otro"];

function getDiasDelMes(y, m) { const dias = [], d = new Date(y, m, 1); while (d.getMonth() === m) { if (d.getDay() !== 0) dias.push(new Date(d)); d.setDate(d.getDate() + 1); } return dias; }
function getSemanas(dias) { const s = []; let sem = []; dias.forEach((d, i) => { sem.push(d); if (d.getDay() === 6 || i === dias.length - 1) { s.push([...sem]); sem = []; } }); if (sem.length) s.push(sem); return s; }
function calcHoras(e, s) { if (!e || !s) return 0; const [eh, em] = e.split(":").map(Number), [sh, sm] = s.split(":").map(Number); const m = (sh * 60 + sm) - (eh * 60 + em); return m > 0 ? m / 60 : 0; }
function fmtFecha(d) { return `${String(d.getDate()).padStart(2,"00")}/${String(d.getMonth()+1).padStart(2,"00")}`; }
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function genToken() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
function getAssignedLocalIds(data, user) {
  if (!user) return [];
  if (user.rol === "admin") return (data.locales || []).map(l => l.id);
  if (user.rol === "encargada") return (data.encargadoLocales || []).filter(x => x.userId === user.id).map(x => x.localId);
  return user.localId ? [user.localId] : [];
}
function canSeeLocal(data, user, localId) {
  if (user?.rol === "admin") return true;
  return getAssignedLocalIds(data, user).includes(parseInt(localId));
}
function filterUsersByScope(data, user, users) {
  if (user?.rol === "admin") return users;
  const allowed = new Set(getAssignedLocalIds(data, user));
  if (user?.rol === "encargada") return users.filter(u => u.rol !== "admin" && allowed.has(u.localId));
  return users.filter(u => u.id === user?.id);
}
function getConfigForLocal(data, localId) {
  return (data.configCobertura || []).find(c => c.localId === parseInt(localId)) || { localId:parseInt(localId), horaApertura:"10:00", horaCierre:"20:00", minutosApertura:60, minutosCierre:60 };
}

function Avatar({ nombre, size = 36 }) { const i = nombre.split(" ").map(p => p[0]).slice(0,2).join("").toUpperCase(); return <div style={{ width:size,height:size,borderRadius:"50%",background:COLORS.pinkLight,color:COLORS.pinkDark,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:500,fontSize:size*0.35,flexShrink:0 }}>{i}</div>; }
function Badge({ children, color = "pink" }) { const map = { pink:[COLORS.pinkLight,COLORS.pinkDark],success:[COLORS.successLight,COLORS.success],danger:[COLORS.dangerLight,COLORS.danger],amber:[COLORS.amberLight,COLORS.amber],info:[COLORS.infoLight,COLORS.info],gray:[COLORS.grayLight,"#444"] }; const [bg,fg] = map[color]||map.pink; return <span style={{ background:bg,color:fg,fontSize:11,fontWeight:500,padding:"2px 8px",borderRadius:20,whiteSpace:"nowrap" }}>{children}</span>; }
function Card({ children, style }) { return <div style={{ background:"var(--color-background-primary)",border:"0.5px solid rgba(120,120,120,0.18)",borderRadius:12,padding:"1rem 1.25rem",...style }}>{children}</div>; }
function Btn({ children, onClick, variant="primary", size="md", disabled, style }) {
  const base = { border:"none",borderRadius:8,cursor:disabled?"not-allowed":"pointer",fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,opacity:disabled?0.5:1,...style };
  const v = { primary:{background:COLORS.pink,color:"#fff",padding:size==="sm"?"5px 12px":"8px 18px",fontSize:size==="sm"?13:14},secondary:{background:COLORS.pinkLight,color:COLORS.pinkDark,padding:size==="sm"?"5px 12px":"8px 18px",fontSize:size==="sm"?13:14},ghost:{background:"transparent",color:COLORS.pink,padding:size==="sm"?"5px 8px":"8px 12px",fontSize:size==="sm"?13:14},danger:{background:COLORS.dangerLight,color:COLORS.danger,padding:size==="sm"?"5px 12px":"8px 18px",fontSize:size==="sm"?13:14},success:{background:COLORS.successLight,color:COLORS.success,padding:size==="sm"?"5px 12px":"8px 18px",fontSize:size==="sm"?13:14} };
  return <button style={{...base,...v[variant]}} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Input({ value, onChange, type="text", placeholder, style }) { return <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:8,padding:"8px 12px",fontSize:14,width:"100%",background:"var(--color-background-primary)",color:"var(--color-text-primary)",boxSizing:"border-box",...style }}/>; }
function Select({ value, onChange, children, style }) { return <select value={value} onChange={e=>onChange(e.target.value)} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:8,padding:"8px 12px",fontSize:14,width:"100%",background:"var(--color-background-primary)",color:"var(--color-text-primary)",...style }}>{children}</select>; }
function Modal({ title, children, onClose, width=480 }) {
  useEffect(()=>{ const p=document.body.style.overflow; document.body.style.overflow="hidden"; return()=>{ document.body.style.overflow=p; }; },[]);
  return <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16 }} onClick={e=>{ if(e.target===e.currentTarget)onClose(); }}><div style={{ background:"#fff",borderRadius:14,padding:"1.5rem",width:"100%",maxWidth:width,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 8px 32px rgba(0,0,0,0.18)" }}><div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}><h3 style={{ margin:0,fontSize:16,fontWeight:500,color:"#1a1a1a" }}>{title}</h3><button onClick={onClose} style={{ background:"#f5f5f5",border:"none",cursor:"pointer",fontSize:18,color:"#666",width:30,height:30,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center" }}>×</button></div>{children}</div></div>;
}
function ConfirmDialog({ config, onCancel, onConfirm }) {
  if (!config) return null;
  const variant = config.variant || "primary";
  const confirmBg = variant === "danger" ? COLORS.danger : COLORS.pink;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10001,padding:16 }} onClick={e=>{ if(e.target===e.currentTarget) onCancel(); }}>
      <div style={{ background:"#fff",borderRadius:14,padding:"1.25rem",width:"100%",maxWidth:380,boxShadow:"0 10px 34px rgba(0,0,0,0.20)",border:"1px solid rgba(120,120,120,0.14)" }}>
        <div style={{ display:"flex",gap:12,alignItems:"flex-start",marginBottom:14 }}>
          <div style={{ width:34,height:34,borderRadius:"50%",background:variant === "danger" ? COLORS.dangerLight : COLORS.pinkLight,color:variant === "danger" ? COLORS.danger : COLORS.pinkDark,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0 }}>!</div>
          <div style={{ flex:1 }}>
            <h3 style={{ margin:"1px 0 4px",fontSize:16,fontWeight:600,color:"#1a1a1a" }}>{config.title || "Confirmar cambio"}</h3>
            <p style={{ margin:0,fontSize:13,lineHeight:1.45,color:"#555" }}>{config.message}</p>
          </div>
        </div>
        <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:18 }}>
          <button onClick={onCancel} style={{ background:"#f5f5f5",border:"none",borderRadius:8,padding:"8px 14px",fontSize:14,cursor:"pointer",color:"#555",fontWeight:500 }}>Cancelar</button>
          <button onClick={onConfirm} style={{ background:confirmBg,color:"#fff",border:"none",borderRadius:8,padding:"8px 14px",fontSize:14,cursor:"pointer",fontWeight:500 }}>{config.confirmText || "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

function ModalInput({ label, value, onChange, type="text" }) { return <div><label style={{ fontSize:13,fontWeight:500,color:"#555",display:"block",marginBottom:6 }}>{label}</label><input type={type} value={value} onChange={e=>onChange(e.target.value)} style={{ width:"100%",border:"1.5px solid #e0e0e0",borderRadius:8,padding:"9px 12px",fontSize:14,background:"#fafafa",color:"#1a1a1a",outline:"none",boxSizing:"border-box" }} onFocus={e=>e.target.style.borderColor=COLORS.pink} onBlur={e=>e.target.style.borderColor="#e0e0e0"}/></div>; }
function ModalSelect({ label, value, onChange, children }) { return <div><label style={{ fontSize:13,fontWeight:500,color:"#555",display:"block",marginBottom:6 }}>{label}</label><select value={value} onChange={e=>onChange(e.target.value)} style={{ width:"100%",border:"1.5px solid #e0e0e0",borderRadius:8,padding:"9px 12px",fontSize:14,background:"#fafafa",color:"#1a1a1a",outline:"none",boxSizing:"border-box" }}>{children}</select></div>; }

// ── CALENDARIO ────────────────────────────────────────────────────
const CAL_SLOT_H = 48;
const CAL_START = 10;
const CAL_END = 20;
const CAL_VIEW_START = 10;
const CAL_HOURS = Array.from({ length: CAL_END - CAL_START }, (_, i) => CAL_START + i);
const CAL_LABEL_HOURS = Array.from({ length: CAL_END - CAL_START + 1 }, (_, i) => CAL_START + i);
const CAL_TOTAL_SLOTS = (CAL_END - CAL_START) * 2;
const CAL_GRID_H = CAL_TOTAL_SLOTS * (CAL_SLOT_H / 2);

function calToSlot(h, m) { return (h - CAL_START) * 2 + (m >= 30 ? 1 : 0); }
function calFromSlot(s) { return { h: CAL_START + Math.floor(s / 2), m: s % 2 === 0 ? 0 : 30 }; }
function calFmt(h, m) { return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
function calSlotY(s) { return s * (CAL_SLOT_H / 2); }
function calYSlot(y) { return Math.max(0, Math.min(CAL_TOTAL_SLOTS - 1, Math.round(y / (CAL_SLOT_H / 2)))); }
function calHoras(b) { return b ? (b.endSlot - b.startSlot) / 2 : 0; }
function getMon(date) { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); d.setHours(0,0,0,0); return d; }

function fechaLarga(fecha) {
  const d = new Date(fecha + "T12:00:00");
  const dow = d.getDay();
  const dia = DIAS_SEMANA[dow === 0 ? 6 : dow - 1];
  return `${dia} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
function asistenciaInfo(a) {
  if (!a) return { icon:"", label:"Sin asistencia registrada", color:COLORS.gray, bg:COLORS.grayLight };
  if (a.estado === "presente") return { icon:"✓", label:"Asistió", color:COLORS.success, bg:COLORS.successLight };
  if (a.estado === "tarde") return { icon:"⏰", label:"Llegó tarde", color:COLORS.amber, bg:COLORS.amberLight };
  if (a.estado === "ausente") return { icon:"✕", label:"Faltó", color:COLORS.danger, bg:COLORS.dangerLight };
  return { icon:"?", label:a.estado || "Sin asistencia registrada", color:COLORS.gray, bg:COLORS.grayLight };
}
function TooltipHorario({ tooltip }) {
  if (!tooltip) return null;
  return (
    <div style={{ position:"fixed",left:tooltip.x,top:tooltip.y,transform:"translate(12px, 12px)",background:"#1f1f1f",color:"#fff",borderRadius:10,padding:"10px 12px",fontSize:12,lineHeight:1.45,boxShadow:"0 8px 24px rgba(0,0,0,0.22)",zIndex:10000,pointerEvents:"none",maxWidth:240 }}>
      <p style={{ margin:"0 0 4px",fontWeight:600 }}>{tooltip.manicura}</p>
      <p style={{ margin:0 }}>{tooltip.dia}</p>
      <p style={{ margin:"4px 0 0" }}>Desde: <strong>{tooltip.desde}</strong></p>
      <p style={{ margin:0 }}>Hasta: <strong>{tooltip.hasta}</strong></p>
      <p style={{ margin:"6px 0 0",color:tooltip.estadoColor }}>{tooltip.estadoIcon ? `${tooltip.estadoIcon} ` : ""}{tooltip.estado}</p>
    </div>
  );
}

function BloqueCalendario({ fecha, bloque, onChange, onCommit, onDelete, bloqueado, onOpen, asistencia, manicuraNombre, onTooltip, onHideTooltip, readOnly = false }) {
  const { startSlot: ss, endSlot: es } = bloque;
  const top = calSlotY(ss), height = Math.max(calSlotY(es) - top, 24);
  const s = calFromSlot(ss), e = calFromSlot(es);
  const dragState = useRef({ moved:false, last:null });
  const locked = bloqueado || !!asistencia;
  const ai = asistenciaInfo(asistencia);
  const tooltipTitle = `${manicuraNombre || "Manicura"}\n${fechaLarga(fecha)}\nDesde: ${calFmt(s.h,s.m)}\nHasta: ${calFmt(e.h,e.m)}\nAsistencia: ${ai.label}`;

  const showTip = useCallback((ev) => {
    if (onTooltip) onTooltip(ev, fecha, bloque);
  }, [onTooltip, fecha, bloque]);

  const drag = useCallback((ev, mode) => {
    if (locked || readOnly) return;
    ev.preventDefault();
    ev.stopPropagation();

    const sy = ev.clientY;
    const os = ss;
    const oe = es;
    dragState.current = { moved:false, last:null };

    try { ev.currentTarget.setPointerCapture?.(ev.pointerId); } catch {}

    const mv = e2 => {
      e2.preventDefault();
      const deltaY = e2.clientY - sy;
      if (Math.abs(deltaY) > 4) dragState.current.moved = true;
      const d = Math.round(deltaY / (CAL_SLOT_H / 2));
      let nb;

      if (mode === "move") {
        const dur = oe - os;
        const ns = Math.max(0, Math.min(CAL_TOTAL_SLOTS - dur, os + d));
        nb = { startSlot: ns, endSlot: ns + dur };
      } else if (mode === "top") {
        nb = { startSlot: Math.max(0, Math.min(oe - 2, os + d)), endSlot: oe };
      } else {
        nb = { startSlot: os, endSlot: Math.max(os + 2, Math.min(CAL_TOTAL_SLOTS, oe + d)) };
      }

      dragState.current.last = nb;
      onChange(fecha, nb);
    };

    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (dragState.current.moved && dragState.current.last && onCommit) {
        onCommit(fecha, dragState.current.last);
      }
    };

    window.addEventListener("pointermove", mv, { passive:false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [ss, es, fecha, onChange, onCommit, locked, readOnly]);

  return (
    <div
      title={tooltipTitle}
      onPointerEnter={showTip}
      onPointerMove={showTip}
      onPointerLeave={onHideTooltip}
      onPointerCancel={onHideTooltip}
      onClick={e => {
        e.stopPropagation();
        if (!dragState.current.moved && onOpen) onOpen(fecha);
      }}
      style={{ position:"absolute",left:2,right:2,top,height,background:locked?"#f7f4f5":COLORS.pinkLight,border:`1.5px solid ${locked?(asistencia?ai.color:COLORS.gray):COLORS.pink}`,borderRadius:6,cursor:locked?"not-allowed":(readOnly?"pointer":"grab"),userSelect:"none",touchAction:"none",overflow:"hidden",display:"flex",flexDirection:"column",zIndex:1,opacity:locked&&asistencia?0.95:1 }}
    >
      {!locked && !readOnly && <div onPointerDown={e=>drag(e,"top")} style={{ height:10,background:COLORS.pink,cursor:"ns-resize",flexShrink:0,borderRadius:"4px 4px 0 0",touchAction:"none" }}/>}      
      {asistencia && <span style={{ position:"absolute",top:locked?4:12,right:4,width:18,height:18,borderRadius:"50%",background:ai.bg,color:ai.color,border:`1px solid ${ai.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,zIndex:2 }}>{ai.icon}</span>}
      <div onPointerDown={readOnly?undefined:e=>drag(e,"move")} style={{ flex:1,padding:"2px 6px",paddingRight:asistencia?24:6,minHeight:0,overflow:"hidden",touchAction:"none" }}>
        <p style={{ margin:0,fontSize:11,fontWeight:500,color:locked?"#555":COLORS.pinkDark,lineHeight:1.25,whiteSpace:"normal",wordBreak:"keep-all" }}>{calFmt(s.h,s.m)} – {calFmt(e.h,e.m)}</p>
        {height > 36 && <p style={{ margin:0,fontSize:10,color:locked?COLORS.gray:COLORS.pink }}>{calHoras(bloque).toFixed(1)}h</p>}
        {asistencia && height > 54 && <p style={{ margin:"1px 0 0",fontSize:9,color:ai.color,fontWeight:600,whiteSpace:"nowrap" }}>{ai.label}</p>}
      </div>
      {!locked && !readOnly && <>
        <div onPointerDown={e=>drag(e,"bottom")} style={{ height:10,background:COLORS.pink,cursor:"ns-resize",flexShrink:0,borderRadius:"0 0 4px 4px",touchAction:"none" }}/>
        <button onClick={e=>{ e.stopPropagation(); onDelete(fecha); }} style={{ position:"absolute",top:10,right:3,background:"none",border:"none",cursor:"pointer",fontSize:10,color:COLORS.pink,padding:0,fontWeight:700 }}>✕</button>
      </>}
    </div>
  );
}

function CalendarioHorarios({ data, reloadData, user, agendaRequest, onBackToReport }) {
  const hoy = new Date();
  const esAdmin = user.rol === "admin";
  const esEncargada = user.rol === "encargada";
  const puedeGestionar = esAdmin || esEncargada;
  const allowedLocalIds = getAssignedLocalIds(data, user);
  const isMobile = window.innerWidth < 640;
  const [vista, setVista] = useState("semana");
  const [weekStart, setWeekStart] = useState(getMon(hoy));
  const [diaVista, setDiaVista] = useState(dateKey(hoy));
  const [localDiaId, setLocalDiaId] = useState("");
  const [mes, setMes] = useState(hoy.getMonth() === 11 ? 0 : hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getMonth() === 11 ? hoy.getFullYear() + 1 : hoy.getFullYear());
  const [manicuraId, setManicuraId] = useState(puedeGestionar ? (data.users.filter(u=>u.rol==="manicura"&&u.activo&&(esAdmin||allowedLocalIds.includes(u.localId)))[0]?.id||null) : user.id);
  const [navVisible, setNavVisible] = useState(true);
  const [modalDk, setModalDk] = useState(null);
  const [localH, setLocalH] = useState({});
  const [localHAll, setLocalHAll] = useState({});
  const [confirmDialog, setConfirmDialog] = useState(null);
  const confirmResolver = useRef(null);
  const silentEditOnce = useRef(new Set());
  const scrollRef = useRef(null);
  const didScroll = useRef(false);
  const tooltipTimer = useRef(null);
  const saveTimers = useRef({});
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    if (!agendaRequest?.fecha) return;
    const d = new Date(agendaRequest.fecha + "T12:00:00");
    setVista("dia");
    setDiaVista(agendaRequest.fecha);
    setMes(d.getMonth());
    setAnio(d.getFullYear());
    setLocalDiaId(agendaRequest.localId ? String(agendaRequest.localId) : "");
  }, [agendaRequest]);

  const mesKey = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const periodoDesdeFecha = useCallback((f) => f.slice(0, 7), []);
  const periodoDesdeDate = useCallback((d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`, []);
  const periodoActivoKey = vista === "semana"
    ? periodoDesdeDate(weekStart)
    : vista === "dia"
      ? periodoDesdeFecha(diaVista)
      : mesKey;
  const periodoActivoDate = vista === "semana"
    ? weekStart
    : vista === "dia"
      ? new Date(diaVista + "T12:00:00")
      : new Date(anio, mes, 1);
  const periodoActivoLabel = `${MESES[periodoActivoDate.getMonth()]} ${periodoActivoDate.getFullYear()}`;
  const periodoBloqueadoParaManicura = useCallback((periodo, uid) =>
    (data.periodosBloqueados || []).some(p => {
      if (typeof p === "string") return p === periodo;
      return p.periodo === periodo && parseInt(p.userId) === parseInt(uid);
    }), [data.periodosBloqueados]
  );
  const puedeEditarManicura = useCallback((uid) => {
    const uidNum = parseInt(uid);
    if (esAdmin) return true;
    if (user.rol === "manicura") return uidNum === parseInt(user.id);
    const m = data.users.find(u => u.id === uidNum);
    return esEncargada && m?.rol === "manicura" && allowedLocalIds.includes(m.localId);
  }, [esAdmin, esEncargada, user.rol, user.id, data.users, allowedLocalIds]);
  const bloqueadoPorFecha = useCallback((f, uid = manicuraId) =>
    (periodoBloqueadoParaManicura(periodoDesdeFecha(f), uid) && !esAdmin) || !puedeEditarManicura(uid),
    [periodoBloqueadoParaManicura, periodoDesdeFecha, manicuraId, esAdmin, puedeEditarManicura]
  );
  const bloqueado = (periodoBloqueadoParaManicura(periodoActivoKey, manicuraId) && !esAdmin) || !puedeEditarManicura(manicuraId);
  const feriados = new Set((data.feriados||[]).map(f=>f.fecha));
  const manicuras = data.users.filter(u=>u.rol==="manicura"&&u.activo&&(esAdmin || allowedLocalIds.includes(u.localId)));
  const selectedManicura = data.users.find(u=>u.id===parseInt(manicuraId));
  const getAsistencia = useCallback((f) => (data.asistencias||[]).find(a=>a.userId===parseInt(manicuraId)&&a.fecha===f), [data.asistencias, manicuraId]);
  const getAsistenciaFor = useCallback((uid, f) => (data.asistencias||[]).find(a=>a.userId===parseInt(uid)&&a.fecha===f), [data.asistencias]);
  const getBloqueFor = useCallback((uid, f) => {
    const h = (data.horarios||[]).find(h=>h.userId===parseInt(uid)&&h.fecha===f&&h.trabaja&&h.entrada&&h.salida);
    if (!h) return null;
    const [eh,em] = h.entrada.split(":").map(Number);
    const [sh,sm] = h.salida.split(":").map(Number);
    return { startSlot:calToSlot(eh,em), endSlot:calToSlot(sh,sm) };
  }, [data.horarios]);
  const hasAsistencia = useCallback((f) => !!getAsistencia(f), [getAsistencia]);
  const horarioKey = useCallback((uid, f) => `${parseInt(uid)}|${f}`, []);
  const hasHorarioPersistidoFor = useCallback((uid, f) => (data.horarios||[]).some(h=>h.userId===parseInt(uid)&&h.fecha===f&&h.trabaja&&h.entrada&&h.salida), [data.horarios]);
  const pedirConfirmacion = useCallback((config) => new Promise(resolve => {
    confirmResolver.current = resolve;
    setConfirmDialog(config);
  }), []);
  const confirmarCambioHorario = useCallback(async (uid, f, accion) => {
    const key = horarioKey(uid, f);
    if (!hasHorarioPersistidoFor(uid, f)) return true;
    if (silentEditOnce.current.has(key)) {
      silentEditOnce.current.delete(key);
      return true;
    }
    const ok = await pedirConfirmacion({
      title: accion === "eliminarlo" ? "Eliminar horario" : "Modificar horario",
      message: `Este horario ya está guardado para ${fechaLarga(f)}. ¿Confirmás que querés ${accion}?`,
      confirmText: accion === "eliminarlo" ? "Eliminar" : "Modificar",
      variant: accion === "eliminarlo" ? "danger" : "primary",
    });
    return ok;
  }, [hasHorarioPersistidoFor, horarioKey, pedirConfirmacion]);

  const bloques = useMemo(() => {
    const uid = parseInt(manicuraId); const res = {};
    (data.horarios||[]).filter(h=>h.userId===uid).forEach(h => {
      if (h.trabaja && h.entrada && h.salida) {
        const [eh,em] = h.entrada.split(":").map(Number);
        const [sh,sm] = h.salida.split(":").map(Number);
        res[h.fecha] = { startSlot:calToSlot(eh,em), endSlot:calToSlot(sh,sm) };
      }
    });
    return res;
  }, [data.horarios, manicuraId]);

  const getB = f => localH[f] ?? bloques[f];
  const getBFor = (uid, f) => localHAll[horarioKey(uid, f)] ?? getBloqueFor(uid, f);

  const showTooltip = useCallback((ev, f, b, manicuraNombre, asistenciaOverride) => {
    if (!b) return;
    const a = asistenciaOverride ?? getAsistencia(f);
    const ai = asistenciaInfo(a);
    const st = calFromSlot(b.startSlot), en = calFromSlot(b.endSlot);
    clearTimeout(tooltipTimer.current);
    setTooltip({
      x: Math.min(ev.clientX || 0, window.innerWidth - 260),
      y: Math.min(ev.clientY || 0, window.innerHeight - 180),
      manicura: manicuraNombre || selectedManicura?.nombre || "Manicura",
      dia: fechaLarga(f),
      desde: calFmt(st.h, st.m),
      hasta: calFmt(en.h, en.m),
      estado: ai.label,
      estadoIcon: ai.icon,
      estadoColor: ai.color,
    });
    if (ev.pointerType === "touch") {
      tooltipTimer.current = setTimeout(() => setTooltip(null), 2200);
    }
  }, [getAsistencia, selectedManicura]);
  const hideTooltip = useCallback(() => {
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, []);

  const setScrollRef = useCallback(el => {
    scrollRef.current = el;
    if (el && !didScroll.current) { el.scrollTop=0; didScroll.current=true; }
  }, []);

  useEffect(() => () => {
    clearTimeout(tooltipTimer.current);
    Object.values(saveTimers.current).forEach(clearTimeout);
  }, []);

  const saveBloqueFor = useCallback(async (uid, f, b, opts = {}) => {
    if (getAsistenciaFor(uid, f)) return false;
    if (bloqueadoPorFecha(f, uid)) return false;
    const key = horarioKey(uid, f);
    const bl = b || (parseInt(uid) === parseInt(manicuraId) ? localH[f] || bloques[f] : localHAll[key] || getBloqueFor(uid, f));
    if (!bl) return false;
    const ok = await confirmarCambioHorario(uid, f, "modificarlo");
    if (!ok) {
      if (opts.clearSelected !== false && parseInt(uid) === parseInt(manicuraId)) setLocalH(p => { const n={...p}; delete n[f]; return n; });
      setLocalHAll(p => { const n={...p}; delete n[key]; return n; });
      return false;
    }
    const s = calFromSlot(bl.startSlot), e = calFromSlot(bl.endSlot);
    await api.upsertHorario({ user_id:parseInt(uid), fecha:f, entrada:calFmt(s.h,s.m), salida:calFmt(e.h,e.m), trabaja:true });
    await reloadData();
    if (parseInt(uid) === parseInt(manicuraId)) setLocalH(p => { const n={...p}; delete n[f]; return n; });
    setLocalHAll(p => { const n={...p}; delete n[key]; return n; });
    return true;
  }, [manicuraId, localH, localHAll, bloques, getBloqueFor, getAsistenciaFor, reloadData, confirmarCambioHorario, horarioKey, bloqueadoPorFecha]);

  const saveBloque = useCallback(async (f, b) => saveBloqueFor(parseInt(manicuraId), f, b), [manicuraId, saveBloqueFor]);

  const onAddBFor = useCallback(async (uid, f, b) => {
    if (getAsistenciaFor(uid, f)) return false;
    if (bloqueadoPorFecha(f, uid)) return false;
    const key = horarioKey(uid, f);
    const alreadyPersisted = hasHorarioPersistidoFor(uid, f);
    if (alreadyPersisted && !(await confirmarCambioHorario(uid, f, "modificarlo"))) return false;
    if (parseInt(uid) === parseInt(manicuraId)) setLocalH(p => ({...p,[f]:b}));
    setLocalHAll(p => ({...p,[key]:b}));
    const s = calFromSlot(b.startSlot), e = calFromSlot(b.endSlot);
    await api.upsertHorario({ user_id:parseInt(uid), fecha:f, entrada:calFmt(s.h,s.m), salida:calFmt(e.h,e.m), trabaja:true });
    if (!alreadyPersisted) silentEditOnce.current.add(key);
    await reloadData();
    if (parseInt(uid) === parseInt(manicuraId)) setLocalH(p => { const n={...p}; delete n[f]; return n; });
    setLocalHAll(p => { const n={...p}; delete n[key]; return n; });
    return true;
  }, [manicuraId, reloadData, getAsistenciaFor, confirmarCambioHorario, hasHorarioPersistidoFor, horarioKey, bloqueadoPorFecha]);

  const onAddB = useCallback(async (f, b) => onAddBFor(parseInt(manicuraId), f, b), [manicuraId, onAddBFor]);

  const onDeleteBFor = useCallback(async (uid, f) => {
    if (getAsistenciaFor(uid, f)) return false;
    if (bloqueadoPorFecha(f, uid)) return false;
    if (!(await confirmarCambioHorario(uid, f, "eliminarlo"))) return false;
    await api.deleteHorario(parseInt(uid), f);
    await reloadData();
    return true;
  }, [reloadData, getAsistenciaFor, confirmarCambioHorario, bloqueadoPorFecha]);

  const onDeleteB = useCallback(async (f) => onDeleteBFor(parseInt(manicuraId), f), [manicuraId, onDeleteBFor]);

  const toggleFeriado = useCallback(async (f) => {
    if (!esAdmin) return;
    if (feriados.has(f)) await api.deleteFeriado(f);
    else await api.createFeriado({ fecha:f, descripcion:"" });
    await reloadData();
  }, [esAdmin, feriados, reloadData]);

  const toggleBloqueo = useCallback(async () => {
    const uid = parseInt(manicuraId);
    if (!uid) return;
    if (periodoBloqueadoParaManicura(periodoActivoKey, uid)) await api.deletePeriodo(periodoActivoKey, uid);
    else await api.createPeriodo(periodoActivoKey, uid);
    await reloadData();
  }, [periodoActivoKey, manicuraId, periodoBloqueadoParaManicura, reloadData]);

  const todasBloqueadas = useMemo(() => manicuras.length > 0 && manicuras.every(m => periodoBloqueadoParaManicura(periodoActivoKey, m.id)), [manicuras, periodoActivoKey, periodoBloqueadoParaManicura]);
  const toggleBloqueoTodas = useCallback(async () => {
    if (!puedeGestionar || manicuras.length === 0) return;
    const accion = todasBloqueadas ? "habilitar" : "bloquear";
    const ok = await pedirConfirmacion({ title: accion === "bloquear" ? "Bloquear todas" : "Habilitar todas", message: `¿Confirmás que querés ${accion} ${periodoActivoLabel} para todas las manicuras activas?`, confirmText: accion === "bloquear" ? "Bloquear" : "Habilitar", variant: accion === "bloquear" ? "danger" : "primary" });
    if (!ok) return;
    for (const m of manicuras) {
      const yaBloqueada = periodoBloqueadoParaManicura(periodoActivoKey, m.id);
      if (todasBloqueadas && yaBloqueada) await api.deletePeriodo(periodoActivoKey, m.id);
      if (!todasBloqueadas && !yaBloqueada) await api.createPeriodo(periodoActivoKey, m.id);
    }
    await reloadData();
  }, [puedeGestionar, manicuras, todasBloqueadas, periodoActivoKey, periodoActivoLabel, periodoBloqueadoParaManicura, reloadData, pedirConfirmacion]);

  const { totalHoras, diasCargados } = useMemo(() => {
    let fechas = [];
    if (vista==="semana") fechas=Array.from({length:6},(_,i)=>{ const d=new Date(weekStart); d.setDate(d.getDate()+i); return dateKey(d); });
    else if (vista==="dia") fechas=[diaVista];
    else fechas=getDiasDelMes(anio,mes).map(d=>dateKey(d));
    const cargados = fechas.filter(f=>getB(f));
    return { totalHoras:cargados.reduce((a,f)=>a+calHoras(getB(f)),0), diasCargados:cargados.length };
  }, [vista, weekStart, diaVista, mes, anio, bloques, localH]);

  const weekDays = useMemo(()=>Array.from({length:6},(_,i)=>{ const d=new Date(weekStart); d.setDate(d.getDate()+i); return d; }),[weekStart]);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+5);
  const diaVistaDate = new Date(diaVista + "T12:00:00");
  const navLabel = vista==="semana"
    ? `${weekStart.getDate()} – ${weekEnd.getDate()} ${MESES[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : vista==="dia"
      ? `${fechaLarga(diaVista)} ${diaVistaDate.getFullYear()}`
      : `${MESES[mes]} ${anio}`;
  const prevNav = () => {
    if(vista==="semana"){const d=new Date(weekStart);d.setDate(d.getDate()-7);setWeekStart(d);}
    else if(vista==="dia"){const d=new Date(diaVista+"T12:00:00");d.setDate(d.getDate()-1);setDiaVista(dateKey(d));setMes(d.getMonth());setAnio(d.getFullYear());}
    else{if(mes===0){setMes(11);setAnio(a=>a-1);}else setMes(m=>m-1);}
  };
  const nextNav = () => {
    if(vista==="semana"){const d=new Date(weekStart);d.setDate(d.getDate()+7);setWeekStart(d);}
    else if(vista==="dia"){const d=new Date(diaVista+"T12:00:00");d.setDate(d.getDate()+1);setDiaVista(dateKey(d));setMes(d.getMonth());setAnio(d.getFullYear());}
    else{if(mes===11){setMes(0);setAnio(a=>a+1);}else setMes(m=>m+1);}
  };
  const todayDk = dateKey(hoy);

  // ── SEMANAL ──────────────────────────────────────────────────────
  const renderSemanal = () => (
    <div style={{ display:"flex",flex:1,overflow:"hidden",flexDirection:"column" }}>
      {/* Header días — divisiones verticales claras */}
      <div style={{ display:"flex",flexShrink:0,borderBottom:"0.5px solid rgba(120,120,120,0.24)" }}>
        <div style={{ width:44,flexShrink:0 }}/>
        <div style={{ flex:1,display:"grid",gridTemplateColumns:"repeat(6,1fr)" }}>
          {weekDays.map((d,i)=>{
            const f=dateKey(d),isToday=f===todayDk,fer=feriados.has(f);
            return <div key={i} onClick={()=>esAdmin&&toggleFeriado(f)} title={esAdmin?(fer?"Quitar feriado":"Marcar feriado"):""} style={{ textAlign:"center",padding:"6px 4px",borderLeft:"0.5px solid rgba(120,120,120,0.24)",background:fer?COLORS.amberLight:"transparent",cursor:esAdmin?"pointer":"default" }}>
              <p style={{ margin:0,fontSize:10,color:fer?COLORS.amber:"var(--color-text-secondary)",fontWeight:fer?500:400 }}>{DIAS_SEMANA[i]}{fer?" 🗓️":""}</p>
              <div style={{ width:26,height:26,borderRadius:"50%",background:isToday?COLORS.pink:"transparent",margin:"2px auto 0",display:"flex",alignItems:"center",justifyContent:"center" }}>
                <span style={{ fontSize:13,fontWeight:500,color:isToday?"#fff":fer?COLORS.amber:"var(--color-text-primary)" }}>{d.getDate()}</span>
              </div>
              {fer && <p style={{ margin:0,fontSize:9,color:COLORS.amber,fontWeight:500 }}>Feriado</p>}
            </div>;
          })}
        </div>
        <div style={{ width:80,flexShrink:0,borderLeft:"0.5px solid rgba(120,120,120,0.24)",display:"flex",alignItems:"center",justifyContent:"center" }}>
          <span style={{ fontSize:11,color:"var(--color-text-secondary)",fontWeight:500 }}>Sem.</span>
        </div>
      </div>
      {/* Cuerpo scrolleable: eje + grid juntos */}
      <div ref={setScrollRef} style={{ flex:1,overflowY:"hidden",display:"flex" }}>
        <div style={{ width:44,flexShrink:0,borderRight:"0.5px solid rgba(120,120,120,0.24)",position:"relative",height:CAL_GRID_H+18 }}>
          {CAL_LABEL_HOURS.map(h=>{
            const top=(h-CAL_START)*CAL_SLOT_H;
            return <span key={h} style={{ position:"absolute",right:6,top,transform:h===CAL_START?"translateY(1px)":h===CAL_END?"translateY(-100%)":"translateY(-50%)",fontSize:10,color:"var(--color-text-secondary)",lineHeight:1 }}>{String(h).padStart(2,"0")}:00</span>;
          })}
        </div>
        <div style={{ flex:1,display:"grid",gridTemplateColumns:"repeat(6,1fr)" }}>
          {weekDays.map((d,i)=>{
            const f=dateKey(d),fer=feriados.has(f),b=getB(f),lockedDay=bloqueadoPorFecha(f);
            return <div key={i}
              onClick={e=>{
                if (lockedDay || b || hasAsistencia(f)) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const slot = calYSlot(e.clientY - rect.top);
                onAddB(f,{startSlot:slot,endSlot:Math.min(CAL_TOTAL_SLOTS,slot+8)});
              }}
              style={{ position:"relative",height:CAL_GRID_H+18,borderLeft:"0.5px solid rgba(120,120,120,0.24)",cursor:lockedDay?"default":(b?"default":"cell"),background:fer?"rgba(186,117,23,0.05)":"transparent" }}>
              {CAL_HOURS.map((_,hi)=><div key={hi} style={{ position:"absolute",top:hi*CAL_SLOT_H,left:0,right:0,height:CAL_SLOT_H,borderTop:"0.5px solid rgba(120,120,120,0.24)",pointerEvents:"none" }}><div style={{ position:"absolute",top:"50%",left:0,right:0,borderTop:"1px dashed rgba(120,120,120,0.16)",opacity:0.5 }}/></div>)}
              <div style={{ position:"absolute",top:CAL_GRID_H,left:0,right:0,borderTop:"0.5px solid rgba(120,120,120,0.24)",pointerEvents:"none" }}/>

              {b && <BloqueCalendario fecha={f} bloque={b} onChange={(f2,nb)=>{if(hasAsistencia(f2))return;setLocalH(p=>({...p,[f2]:nb}));}} onCommit={(f2,nb)=>saveBloque(f2,nb)} onDelete={onDeleteB} bloqueado={lockedDay||hasAsistencia(f)} onOpen={setModalDk} asistencia={getAsistencia(f)} manicuraNombre={selectedManicura?.nombre} onTooltip={showTooltip} onHideTooltip={hideTooltip}/>}
            </div>;
          })}
        </div>
        <div style={{ width:80,flexShrink:0,borderLeft:"0.5px solid rgba(120,120,120,0.24)",display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:16 }}>
          <span style={{ fontSize:16,fontWeight:500,color:totalHoras>0?COLORS.success:"var(--color-text-secondary)" }}>{totalHoras.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  );

  // ── DÍA / TODAS LAS MANICURAS ───────────────────────────────────
  const renderDiarioTodos = () => {
    const baseCols = puedeGestionar ? manicuras : manicuras.filter(m => m.id === user.id);
    const cols = localDiaId ? baseCols.filter(m => m.localId === parseInt(localDiaId)) : baseCols;
    const totalDia = cols.reduce((a,m)=>a+calHoras(getBloqueFor(m.id, diaVista)),0);
    const minColW = isMobile ? 118 : 0;
    const innerMinWidth = isMobile ? Math.max(cols.length * minColW, 1) : "100%";
    const gridCols = isMobile
      ? `repeat(${Math.max(cols.length,1)}, ${minColW}px)`
      : `repeat(${Math.max(cols.length,1)}, minmax(0, 1fr))`;

    return <div style={{ display:"flex",flex:1,overflow:"hidden",flexDirection:"column" }}>
      {puedeGestionar && <div style={{ display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderBottom:"0.5px solid rgba(120,120,120,0.18)",background:"var(--color-background-primary)" }}>
        <span style={{ fontSize:12,color:"var(--color-text-secondary)",fontWeight:500 }}>Local</span>
        <select value={localDiaId} onChange={e=>setLocalDiaId(e.target.value)} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:6,padding:"5px 8px",fontSize:12,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}>
          <option value="">Todos los locales visibles</option>
          {data.locales.filter(l=>esAdmin || allowedLocalIds.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
      </div>}
      <div style={{ display:"flex",flex:1,overflow:"hidden" }}>
        <div style={{ width:44,flexShrink:0,borderRight:"0.5px solid rgba(120,120,120,0.24)",display:"flex",flexDirection:"column" }}>
          <div style={{ height:48,flexShrink:0,borderBottom:"0.5px solid rgba(120,120,120,0.24)" }}/>
          <div style={{ position:"relative",height:CAL_GRID_H+18,flexShrink:0 }}>
            {CAL_LABEL_HOURS.map(h=>{
              const top=(h-CAL_START)*CAL_SLOT_H;
              return <span key={h} style={{ position:"absolute",right:6,top,transform:h===CAL_START?"translateY(1px)":h===CAL_END?"translateY(-100%)":"translateY(-50%)",fontSize:10,color:"var(--color-text-secondary)",lineHeight:1 }}>{String(h).padStart(2,"0")}:00</span>;
            })}
          </div>
        </div>

        <div style={{ flex:1,overflowX:isMobile?"auto":"hidden",overflowY:"hidden" }}>
          <div style={{ minWidth:innerMinWidth }}>
            <div style={{ display:"grid",gridTemplateColumns:gridCols,height:48,borderBottom:"0.5px solid rgba(120,120,120,0.24)" }}>
              {cols.map(m=><div key={m.id} style={{ textAlign:"center",padding:"7px 6px",borderLeft:"0.5px solid rgba(120,120,120,0.24)",background:"var(--color-background-primary)",minWidth:0 }}>
                <p style={{ margin:0,fontSize:11,fontWeight:600,color:"var(--color-text-primary)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{m.nombre}</p>
                <p style={{ margin:"2px 0 0",fontSize:10,color:"var(--color-text-secondary)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>{data.locales.find(l=>l.id===m.localId)?.nombre||"Sin local"}</p>
              </div>)}
            </div>

            <div style={{ display:"grid",gridTemplateColumns:gridCols,height:CAL_GRID_H+18 }}>
              {cols.map(m=>{
                const b=getBFor(m.id,diaVista), asis=getAsistenciaFor(m.id,diaVista), fer=feriados.has(diaVista);
                const lockedByPeriod = bloqueadoPorFecha(diaVista, m.id);
                const lockedForEdit = lockedByPeriod || !!asis;
                return <div key={m.id}
                  onClick={async e=>{
                    if (!puedeEditarManicura(m.id)) return;
                    setManicuraId(m.id);
                    if (b || lockedForEdit) { setModalDk(diaVista); return; }
                    const rect=e.currentTarget.getBoundingClientRect();
                    const slot=calYSlot(e.clientY-rect.top);
                    const nb={startSlot:slot,endSlot:Math.min(CAL_TOTAL_SLOTS,slot+8)};
                    const st=calFromSlot(nb.startSlot), en=calFromSlot(nb.endSlot);
                    await onAddBFor(m.id, diaVista, nb);
                  }}
                  style={{ position:"relative",height:CAL_GRID_H+18,borderLeft:"0.5px solid rgba(120,120,120,0.24)",cursor:puedeEditarManicura(m.id)&&!b&&!lockedForEdit?"cell":"default",background:fer?"rgba(186,117,23,0.05)":"transparent",minWidth:0 }}>
                  {CAL_HOURS.map((_,hi)=><div key={hi} style={{ position:"absolute",top:hi*CAL_SLOT_H,left:0,right:0,height:CAL_SLOT_H,borderTop:"0.5px solid rgba(120,120,120,0.24)",pointerEvents:"none" }}><div style={{ position:"absolute",top:"50%",left:0,right:0,borderTop:"1px dashed rgba(120,120,120,0.16)",opacity:0.5 }}/></div>)}
                  <div style={{ position:"absolute",top:CAL_GRID_H,left:0,right:0,borderTop:"0.5px solid rgba(120,120,120,0.24)",pointerEvents:"none" }}/>
                  {b && <BloqueCalendario fecha={diaVista} bloque={b} onChange={(f2,nb)=>{ if(asis) return; setLocalHAll(p=>({...p,[horarioKey(m.id,f2)]:nb})); }} onCommit={(f2,nb)=>saveBloqueFor(m.id,f2,nb)} onDelete={(f2)=>onDeleteBFor(m.id,f2)} bloqueado={lockedByPeriod || !!asis} onOpen={()=>{ setManicuraId(m.id); setModalDk(diaVista); }} asistencia={asis} manicuraNombre={m.nombre} onTooltip={(ev,f,bl)=>showTooltip(ev,f,bl,m.nombre,asis)} onHideTooltip={hideTooltip}/>} 
                  {!b && lockedByPeriod && <div style={{ position:"absolute",left:4,right:4,top:8,background:COLORS.amberLight,color:COLORS.amber,borderRadius:6,padding:"4px 6px",fontSize:10,fontWeight:600,textAlign:"center" }}>Bloqueado</div>}
                </div>;
              })}
            </div>
          </div>
        </div>

        <div style={{ width:70,flexShrink:0,borderLeft:"0.5px solid rgba(120,120,120,0.24)",display:"flex",flexDirection:"column" }}>
          <div style={{ height:48,flexShrink:0,borderBottom:"0.5px solid rgba(120,120,120,0.24)",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ fontSize:11,color:"var(--color-text-secondary)",fontWeight:500 }}>{totalDia.toFixed(1)}h</span>
          </div>
          <div style={{ height:CAL_GRID_H+18,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:16 }}>
            <span style={{ fontSize:16,fontWeight:500,color:totalDia>0?COLORS.success:"var(--color-text-secondary)" }}>{totalDia.toFixed(1)}h</span>
          </div>
        </div>
      </div>
    </div>;
  };

  // ── MENSUAL ──────────────────────────────────────────────────────
  const renderMensual = () => {
    const dias=getDiasDelMes(anio,mes), sems=getSemanas(dias);
    const rowH = Math.max(isMobile ? 58 : 74, Math.floor((520 - 34) / Math.max(sems.length, 1)));
    return <div style={{ flex:1,overflow:"hidden" }}>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr) 70px",borderBottom:"0.5px solid rgba(120,120,120,0.24)",position:"sticky",top:0,background:"var(--color-background-primary)",zIndex:2 }}>
        {DIAS_SEMANA.map(d=><div key={d} style={{ textAlign:"center",padding:"8px 4px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",borderLeft:"0.5px solid rgba(120,120,120,0.24)" }}>{d}</div>)}
        <div style={{ textAlign:"center",padding:"8px 4px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",borderLeft:"0.5px solid rgba(120,120,120,0.24)" }}>Sem.</div>
      </div>
      {sems.map((semana,si)=>{
        const totalSem=semana.reduce((a,d)=>a+calHoras(getB(dateKey(d))),0);
        return <div key={si} style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr) 70px",borderBottom:"0.5px solid rgba(120,120,120,0.24)",height:rowH }}>
          {Array.from({length:6},(_,i)=>{
            const d=semana[i]; if(!d) return <div key={i} style={{ borderLeft:"0.5px solid rgba(120,120,120,0.24)" }}/>;
            const f=dateKey(d),b=getB(f),isToday=f===todayDk,fer=feriados.has(f),asis=getAsistencia(f),ai=asistenciaInfo(asis),lockedDia=bloqueadoPorFecha(f)||!!asis;
            const st=b?calFromSlot(b.startSlot):null, en=b?calFromSlot(b.endSlot):null;
            const tooltipTitle = b ? `${selectedManicura?.nombre || "Manicura"}\n${fechaLarga(f)}\nDesde: ${calFmt(st.h,st.m)}\nHasta: ${calFmt(en.h,en.m)}\nAsistencia: ${ai.label}` : "";
            return <div
              key={i}
              title={tooltipTitle}
              onClick={()=>setModalDk(f)}
              onPointerEnter={e=>b&&showTooltip(e,f,b)}
              onPointerMove={e=>b&&showTooltip(e,f,b)}
              onPointerLeave={hideTooltip}
              onPointerCancel={hideTooltip}
              style={{ borderLeft:"0.5px solid rgba(120,120,120,0.24)",padding:isMobile?4:5,cursor:"pointer",background:fer?COLORS.amberLight:(b?COLORS.pinkLight:"transparent"),touchAction:"manipulation" }}>
              <div style={{ display:"flex",alignItems:"center",gap:4,marginBottom:5,minWidth:0 }}>
                <div style={{ width:22,height:22,borderRadius:"50%",background:isToday?COLORS.pink:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                  <span style={{ fontSize:11,fontWeight:500,color:isToday?"#fff":fer?COLORS.amber:"var(--color-text-primary)" }}>{d.getDate()}</span>
                </div>
                {fer && <span style={{ fontSize:9,color:COLORS.amber,fontWeight:500 }}>Feriado</span>}
                {asis && <span style={{ marginLeft:"auto",width:18,height:18,borderRadius:"50%",background:ai.bg,color:ai.color,border:`1px solid ${ai.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,flexShrink:0 }}>{ai.icon}</span>}
              </div>
              {b ? <div style={{ background:"#fff",border:`1px solid ${asis?ai.color:COLORS.pink}`,borderRadius:5,padding:"5px 6px",minWidth:0,overflow:"hidden",opacity:lockedDia&&asis?0.95:1 }}>
                <p style={{ margin:0,fontSize:isMobile?9:10,color:asis?"#555":COLORS.pinkDark,fontWeight:600,lineHeight:1.25,whiteSpace:"normal" }}>Desde {calFmt(st.h,st.m)}</p>
                <p style={{ margin:0,fontSize:isMobile?9:10,color:asis?"#555":COLORS.pinkDark,fontWeight:600,lineHeight:1.25,whiteSpace:"normal" }}>Hasta {calFmt(en.h,en.m)}</p>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:4,marginTop:2 }}>
                  <p style={{ margin:0,fontSize:isMobile?9:10,color:asis?ai.color:COLORS.pink,fontWeight:asis?600:400 }}>{asis?ai.label:calHoras(b).toFixed(1)+"h"}</p>
                  {!lockedDia && <span style={{ fontSize:9,color:COLORS.gray,whiteSpace:"nowrap" }}>Editar</span>}
                  {lockedDia && asis && <span style={{ fontSize:9,color:COLORS.gray,whiteSpace:"nowrap" }}>Bloq.</span>}
                </div>
              </div>
              : !lockedDia && <p style={{ margin:0,fontSize:10,color:"var(--color-text-secondary)",opacity:0.5 }}>+ agregar</p>}
            </div>;
          })}
          <div style={{ borderLeft:"0.5px solid rgba(120,120,120,0.24)",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ fontSize:15,fontWeight:500,color:totalSem>0?COLORS.success:"var(--color-text-secondary)" }}>{totalSem.toFixed(1)}h</span>
          </div>
        </div>;
      })}
    </div>;
  };

  // ── MODAL DÍA ────────────────────────────────────────────────────
  const ModalDia = ({ f }) => {
    const b = getB(f);
    const def = b ? { s:calFmt(calFromSlot(b.startSlot).h,calFromSlot(b.startSlot).m), e:calFmt(calFromSlot(b.endSlot).h,calFromSlot(b.endSlot).m) } : { s:"10:00", e:"20:00" };
    const [start,setStart] = useState(def.s);
    const [end,setEnd] = useState(def.e);
    const fer = feriados.has(f);
    const asistencia = getAsistencia(f);
    const ai = asistenciaInfo(asistencia);
    const lockedDia = bloqueadoPorFecha(f) || !!asistencia;
    const d = new Date(f+"T12:00:00"), dow=d.getDay();
    const label = `${DIAS_SEMANA[dow===0?6:dow-1]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
    const opciones = Array.from({length:CAL_TOTAL_SLOTS + 1},(_,i)=>{ const {h,m}=calFromSlot(i); return calFmt(h,m); });
    const guardar = async () => {
      const [sh,sm]=start.split(":").map(Number),[eh,em]=end.split(":").map(Number);
      const ss=calToSlot(sh,sm),es=calToSlot(eh,em);
      if (!lockedDia && es>ss) await onAddB(f,{startSlot:ss,endSlot:es});
      setModalDk(null);
    };
    return <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999 }} onClick={e=>{ if(e.target===e.currentTarget)setModalDk(null); }}>
      <div style={{ background:"#fff",borderRadius:12,padding:"1.25rem",width:290,boxShadow:"0 8px 24px rgba(0,0,0,0.15)" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14 }}>
          <h3 style={{ margin:0,fontSize:15,fontWeight:500,color:"#1a1a1a" }}>{label}</h3>
          <button onClick={()=>setModalDk(null)} style={{ background:"none",border:"none",cursor:"pointer",fontSize:18,color:"#888" }}>×</button>
        </div>
        {asistencia && <div style={{ background:ai.bg,color:ai.color,borderRadius:8,padding:"8px 10px",fontSize:13,fontWeight:500,marginBottom:12 }}>
          {ai.icon} {ai.label}. Este horario ya tiene datos reales y no puede modificarse ni eliminarse.
        </div>}
        {!asistencia && bloqueadoPorFecha(f) && <div style={{ background:COLORS.amberLight,color:COLORS.amber,borderRadius:8,padding:"8px 10px",fontSize:13,fontWeight:500,marginBottom:12 }}>
          🔒 Este período está bloqueado.
        </div>}
        {!lockedDia && <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          {[["Entrada",start,setStart],["Salida",end,setEnd]].map(([lbl,val,setVal])=><div key={lbl}><label style={{ fontSize:12,color:"#888",display:"block",marginBottom:4 }}>{lbl}</label><select value={val} onChange={e=>setVal(e.target.value)} style={{ width:"100%",border:"1.5px solid #e0e0e0",borderRadius:8,padding:"8px 10px",fontSize:14,background:"#fafafa" }}>{opciones.map(t=><option key={t} value={t}>{t}</option>)}</select></div>)}
          <div style={{ display:"flex",gap:8,marginTop:4 }}>
            <button onClick={guardar} style={{ flex:1,background:COLORS.pink,color:"#fff",border:"none",borderRadius:8,padding:"8px",fontSize:14,fontWeight:500,cursor:"pointer" }}>Guardar</button>
            {b && <button onClick={async()=>{ await onDeleteB(f); setModalDk(null); }} style={{ background:COLORS.dangerLight,color:COLORS.danger,border:"none",borderRadius:8,padding:"8px 12px",fontSize:14,cursor:"pointer",fontWeight:500 }}>Eliminar</button>}
            <button onClick={()=>setModalDk(null)} style={{ background:"#f5f5f5",border:"none",borderRadius:8,padding:"8px 12px",fontSize:14,cursor:"pointer" }}>Cancelar</button>
          </div>
        </div>}
        {esAdmin && <div style={{ marginTop:!lockedDia?12:0,borderTop:!lockedDia?"0.5px solid #eee":"none",paddingTop:!lockedDia?12:0 }}>
          <button onClick={async()=>{ await toggleFeriado(f); setModalDk(null); }} style={{ width:"100%",background:fer?COLORS.amberLight:"#f5f5f5",color:fer?COLORS.amber:"#555",border:"none",borderRadius:8,padding:"8px",fontSize:13,cursor:"pointer",fontWeight:500 }}>{fer?"🗓️ Quitar feriado":"🗓️ Marcar como feriado"}</button>
        </div>}
      </div>
    </div>;
  };

  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
          <h2 style={{ margin:0,fontSize:18,fontWeight:500 }}>{puedeGestionar?"Gestión de horarios":"Mis horarios"}</h2>
          {agendaRequest?.fromReport && onBackToReport && <Btn onClick={onBackToReport} variant="secondary" size="sm">← Volver al reporte</Btn>}
        </div>
        {puedeGestionar && <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
          <Btn onClick={toggleBloqueo} variant={periodoBloqueadoParaManicura(periodoActivoKey, manicuraId)?"success":"danger"} size="sm">{periodoBloqueadoParaManicura(periodoActivoKey, manicuraId)?"🔓 Habilitar manicura":"🔒 Bloquear manicura"}</Btn>
          <Btn onClick={toggleBloqueoTodas} variant={todasBloqueadas?"success":"danger"} size="sm">{todasBloqueadas?"🔓 Habilitar todas":"🔒 Bloquear todas"}</Btn>
        </div>}
      </div>
      <div style={{ display:"flex",height:vista==="mes"?560:640,border:"0.5px solid rgba(120,120,120,0.18)",borderRadius:12,overflow:"hidden",background:"var(--color-background-primary)" }}>
        {/* Panel lateral */}
        {navVisible && <div style={{ width:190,flexShrink:0,borderRight:"0.5px solid rgba(120,120,120,0.18)",display:"flex",flexDirection:"column",background:"var(--color-background-secondary)" }}>
          {puedeGestionar && <div style={{ padding:"10px 10px 6px" }}>
            <p style={{ margin:"0 0 6px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em" }}>Manicura</p>
            <select value={manicuraId||""} onChange={e=>setManicuraId(e.target.value)} style={{ width:"100%",border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:6,padding:"6px 8px",fontSize:12,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}>
              {manicuras.map(m=><option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>}
          <div style={{ padding:"10px 10px 6px",borderTop:puedeGestionar?"0.5px solid rgba(120,120,120,0.18)":"none" }}>
            <p style={{ margin:"0 0 6px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em" }}>Vista</p>
            <div style={{ display:"flex",flexDirection:"column",gap:3 }}>
              {["semana",...(puedeGestionar?["dia"]:[]),"mes"].map(v=><button key={v} onClick={()=>{ if(v==="dia") setDiaVista(todayDk); setVista(v); }} style={{ textAlign:"left",padding:"6px 8px",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:500,background:vista===v?COLORS.pinkLight:"transparent",color:vista===v?COLORS.pinkDark:"var(--color-text-primary)" }}>{v==="semana"?"📅 Semana":v==="dia"?"👥 Día / todas":"🗓️ Mes"}</button>)}
            </div>
          </div>
          <div style={{ padding:"8px 10px",borderTop:"0.5px solid rgba(120,120,120,0.18)" }}>
            <p style={{ margin:"0 0 6px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em" }}>Período</p>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6 }}>
              <button onClick={prevNav} style={{ background:"none",border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:14 }}>‹</button>
              <span style={{ fontSize:10,fontWeight:500,textAlign:"center",flex:1,padding:"0 4px",color:"var(--color-text-primary)" }}>{navLabel}</span>
              <button onClick={nextNav} style={{ background:"none",border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:14 }}>›</button>
            </div>
            <button onClick={()=>{ setWeekStart(getMon(hoy)); setDiaVista(dateKey(hoy)); setMes(hoy.getMonth()); setAnio(hoy.getFullYear()); }} style={{ width:"100%",background:"none",border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:6,padding:"4px",cursor:"pointer",fontSize:11,color:"var(--color-text-secondary)" }}>Hoy</button>
          </div>
          <div style={{ padding:"8px 10px",borderTop:"0.5px solid rgba(120,120,120,0.18)" }}>
            <p style={{ margin:"0 0 6px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.05em" }}>Resumen</p>
            <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
              {[["Días cargados",diasCargados,null],["Horas totales",`${totalHoras.toFixed(1)}h`,totalHoras>0?COLORS.success:null]].map(([lbl,val,color])=><div key={lbl} style={{ background:"var(--color-background-primary)",borderRadius:8,padding:"7px 10px",border:"0.5px solid rgba(120,120,120,0.18)" }}><p style={{ margin:0,fontSize:10,color:"var(--color-text-secondary)" }}>{lbl}</p><p style={{ margin:0,fontSize:18,fontWeight:500,color:color||"var(--color-text-primary)" }}>{val}</p></div>)}
            </div>
          </div>
          {puedeGestionar && <div style={{ padding:"8px 10px",borderTop:"0.5px solid rgba(120,120,120,0.18)",marginTop:"auto" }}>
            <div style={{ background:COLORS.amberLight,borderRadius:6,padding:"6px 8px" }}>
              <p style={{ margin:0,fontSize:10,color:COLORS.amber,fontWeight:500 }}>Clic en día (sem.) o modal (mes) para feriado</p>
            </div>
          </div>}
        </div>}
        {/* Contenido principal */}
        <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
          <div style={{ padding:"6px 10px",borderBottom:"0.5px solid rgba(120,120,120,0.18)",display:"flex",alignItems:"center",gap:8 }}>
            {/* Botón ocultar panel — claramente separado del período */}
            <button onClick={()=>setNavVisible(v=>!v)} title={navVisible?"Ocultar panel":"Mostrar panel"} style={{ background:"none",border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:12,color:"var(--color-text-secondary)",whiteSpace:"nowrap",flexShrink:0 }}>
              {navVisible?"‹ Ocultar":"Panel ›"}
            </button>
            <div style={{ width:1,height:18,background:"var(--color-border-secondary)",margin:"0 2px",flexShrink:0 }}/>
            <span style={{ fontSize:12,fontWeight:500,color:"var(--color-text-secondary)" }}>{navLabel}</span>
            {bloqueado && <span style={{ marginLeft:"auto",fontSize:11,color:COLORS.amber,background:COLORS.amberLight,padding:"3px 8px",borderRadius:6 }}>🔒 Período bloqueado para esta manicura</span>}
            {vista==="semana"&&!bloqueado&&!isMobile&&<span style={{ marginLeft:"auto",fontSize:11,color:"var(--color-text-secondary)",opacity:0.7 }}>Clic en celda vacía para agregar · Arrastrá para mover</span>}
            {vista==="semana"&&!bloqueado&&isMobile&&<span style={{ marginLeft:"auto",fontSize:11,color:"var(--color-text-secondary)",opacity:0.7 }}>Arrastrá el bloque para mover · bordes para ajustar</span>}
            {vista==="dia"&&<span style={{ marginLeft:"auto",fontSize:11,color:"var(--color-text-secondary)",opacity:0.7 }}>Todas las manicuras del día seleccionado</span>}
          </div>
          {vista==="semana" ? renderSemanal() : vista==="dia" ? renderDiarioTodos() : renderMensual()}
        </div>
      </div>
      <TooltipHorario tooltip={tooltip}/>
      <ConfirmDialog
        config={confirmDialog}
        onCancel={() => { setConfirmDialog(null); confirmResolver.current?.(false); confirmResolver.current = null; }}
        onConfirm={() => { setConfirmDialog(null); confirmResolver.current?.(true); confirmResolver.current = null; }}
      />
      {modalDk && <ModalDia f={modalDk}/>}
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
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"var(--color-background-tertiary)" }}>
      <Card style={{ width:"100%",maxWidth:360 }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <div style={{ display:"flex",justifyContent:"center",marginBottom:14 }}><LogoMark size={104} variant="soft"/></div>
          <h2 style={{ margin:0,fontSize:20,fontWeight:500 }}>Niki Beauty Bar</h2>
          <p style={{ margin:"4px 0 0",fontSize:13,color:"var(--color-text-secondary)" }}>Control de asistencia</p>
        </div>
        {vista==="login" && <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          <Input value={u} onChange={setU} placeholder="Usuario"/>
          <Input value={p} onChange={setP} type="password" placeholder="Contraseña"/>
          {err && <p style={{ margin:0,fontSize:13,color:COLORS.danger }}>{err}</p>}
          <Btn onClick={handleLogin} disabled={loading} style={{ width:"100%",justifyContent:"center" }}>{loading?"Ingresando...":"Ingresar"}</Btn>
          <button onClick={()=>{ setVista("recuperar"); setMsg(""); setEmail(""); }} style={{ background:"none",border:"none",color:COLORS.pink,fontSize:13,cursor:"pointer",textAlign:"center",marginTop:4 }}>¿Olvidaste tu contraseña?</button>
        </div>}
        {vista==="recuperar" && <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          <p style={{ margin:0,fontSize:13,color:"var(--color-text-secondary)" }}>Ingresá tu mail y te enviamos un token.</p>
          <Input value={email} onChange={setEmail} placeholder="tu@mail.com" type="email"/>
          {msg && <p style={{ margin:0,fontSize:13,color:msg.startsWith("Demo")?COLORS.info:COLORS.success,wordBreak:"break-all" }}>{msg}</p>}
          <Btn onClick={handleRecuperar} disabled={loading} style={{ width:"100%",justifyContent:"center" }}>{loading?"Enviando...":"Enviar token"}</Btn>
          {msg && <Btn onClick={()=>{ setVista("token"); setMsg(""); }} variant="secondary" style={{ width:"100%",justifyContent:"center" }}>Tengo mi token →</Btn>}
          <button onClick={()=>setVista("login")} style={{ background:"none",border:"none",color:"var(--color-text-secondary)",fontSize:13,cursor:"pointer",textAlign:"center" }}>← Volver</button>
        </div>}
        {vista==="token" && <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          <p style={{ margin:0,fontSize:13,color:"var(--color-text-secondary)" }}>Ingresá el token que recibiste.</p>
          <Input value={token} onChange={setToken} placeholder="Token"/>
          {msg && <p style={{ margin:0,fontSize:13,color:COLORS.danger }}>{msg}</p>}
          <Btn onClick={handleVerificarToken} disabled={loading} style={{ width:"100%",justifyContent:"center" }}>{loading?"Verificando...":"Verificar"}</Btn>
          <button onClick={()=>setVista("recuperar")} style={{ background:"none",border:"none",color:"var(--color-text-secondary)",fontSize:13,cursor:"pointer",textAlign:"center" }}>← Volver</button>
        </div>}
        {vista==="nueva" && <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
          <p style={{ margin:0,fontSize:13,color:"var(--color-text-secondary)" }}>Elegí tu nueva contraseña.</p>
          <Input value={nueva} onChange={setNueva} type="password" placeholder="Nueva contraseña"/>
          <Input value={nueva2} onChange={setNueva2} type="password" placeholder="Repetir contraseña"/>
          {msg && <p style={{ margin:0,fontSize:13,color:COLORS.danger }}>{msg}</p>}
          <Btn onClick={handleNuevaPassword} disabled={loading} style={{ width:"100%",justifyContent:"center" }}>{loading?"Guardando...":"Guardar contraseña"}</Btn>
        </div>}
      </Card>
    </div>
  );
}

// ── ABM MANICURAS ──────────────────────────────────────────────────
function ABMManicuras({ data, reloadData, user }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const esAdmin = user.rol === "admin";
  const allowedLocalIds = getAssignedLocalIds(data, user);
  const localesPermitidos = esAdmin ? data.locales : data.locales.filter(l => allowedLocalIds.includes(l.id));
  const manicuras = data.users.filter(u => u.rol === "manicura" && (esAdmin || allowedLocalIds.includes(u.localId)));
  const openNew = () => { setForm({ nombre:"",usuario:"",email:"",password:"",password2:"",localId:localesPermitidos[0]?.id||"",activo:true }); setFormErr(""); setModal("new"); };
  const openEdit = u => { setForm({...u,password:"",password2:""}); setFormErr(""); setModal("edit"); };
  const save = async () => {
    setFormErr("");
    if (!form.nombre.trim()||!form.usuario.trim()) { setFormErr("Nombre y usuario son obligatorios."); return; }
    if (!localesPermitidos.some(l => l.id === parseInt(form.localId))) { setFormErr("No podés asignar manicuras a ese local."); return; }
    if (modal==="new") {
      if (!form.password) { setFormErr("Ingresá una contraseña."); return; }
      if (form.password!==form.password2) { setFormErr("Las contraseñas no coinciden."); return; }
    } else {
      if (form.password&&form.password!==form.password2) { setFormErr("Las contraseñas no coinciden."); return; }
    }
    setSaving(true);
    try {
      if (modal==="new") {
        await api.createUser({ nombre:form.nombre.trim(),usuario:form.usuario.trim(),email:form.email.trim(),password:form.password,rol:"manicura",local_id:parseInt(form.localId)||null,activo:true });
      } else {
        const upd = { nombre:form.nombre.trim(),usuario:form.usuario.trim(),email:form.email?.trim()||"",local_id:parseInt(form.localId)||null };
        if (form.password) upd.password = form.password;
        await api.updateUser(form.id, upd);
      }
      await reloadData(); setModal(null);
    } catch(e) { setFormErr("Error al guardar: "+e.message); }
    setSaving(false);
  };
  const toggle = async (u) => { await api.updateUser(u.id,{activo:!u.activo}); await reloadData(); };
  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:18,fontWeight:500 }}>Manicuras</h2>
        <Btn onClick={openNew} size="sm">+ Nueva</Btn>
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
        {manicuras.map(m => {
          const local = data.locales.find(l=>l.id===m.localId);
          return <Card key={m.id} style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
            <Avatar nombre={m.nombre}/>
            <div style={{ flex:1,minWidth:0 }}>
              <p style={{ margin:0,fontWeight:500,fontSize:14 }}>{m.nombre}</p>
              <p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>{m.usuario} · {m.email||"Sin mail"} · {local?.nombre||"Sin local"}</p>
            </div>
            <Badge color={m.activo?"success":"gray"}>{m.activo?"Activa":"Inactiva"}</Badge>
            <Btn onClick={()=>openEdit(m)} variant="ghost" size="sm">Editar</Btn>
            <Btn onClick={()=>toggle(m)} variant="ghost" size="sm" style={{ color:m.activo?COLORS.danger:COLORS.success }}>{m.activo?"Desactivar":"Activar"}</Btn>
          </Card>;
        })}
      </div>
      {modal && <Modal title={modal==="new"?"Nueva manicura":"Editar manicura"} onClose={()=>setModal(null)}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <ModalInput label="Nombre completo" value={form.nombre||""} onChange={v=>setForm(f=>({...f,nombre:v}))}/>
          <ModalInput label="Usuario" value={form.usuario||""} onChange={v=>setForm(f=>({...f,usuario:v}))}/>
          <ModalInput label="Email" type="email" value={form.email||""} onChange={v=>setForm(f=>({...f,email:v}))}/>
          <div style={{ borderTop:"1px dashed #eee",paddingTop:14 }}>
            <p style={{ margin:"0 0 10px",fontSize:13,color:"#888" }}>{modal==="edit"?"Dejá en blanco para no cambiar la contraseña":"Contraseña"}</p>
            <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
              <ModalInput label={modal==="edit"?"Nueva contraseña":"Contraseña"} type="password" value={form.password||""} onChange={v=>setForm(f=>({...f,password:v}))}/>
              <ModalInput label="Repetir contraseña" type="password" value={form.password2||""} onChange={v=>setForm(f=>({...f,password2:v}))}/>
            </div>
          </div>
          <ModalSelect label="Local" value={form.localId||""} onChange={v=>setForm(f=>({...f,localId:v}))}>
            <option value="">Sin local</option>
            {localesPermitidos.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}
          </ModalSelect>
          {formErr && <p style={{ margin:0,fontSize:13,color:COLORS.danger,background:COLORS.dangerLight,padding:"8px 12px",borderRadius:8 }}>{formErr}</p>}
          <div style={{ display:"flex",gap:8,marginTop:4 }}>
            <Btn onClick={save} disabled={saving} style={{ flex:1,justifyContent:"center" }}>{saving?"Guardando...":"Guardar"}</Btn>
            <Btn onClick={()=>setModal(null)} variant="secondary" style={{ flex:1,justifyContent:"center" }}>Cancelar</Btn>
          </div>
        </div>
      </Modal>}
    </div>
  );
}

// ── ABM LOCALES ────────────────────────────────────────────────────
function ABMLocales({ data, reloadData }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const openNew = () => { setForm({nombre:"",direccion:""}); setModal("new"); };
  const openEdit = l => { setForm({...l}); setModal("edit"); };
  const save = async () => {
    if (!form.nombre) return; setSaving(true);
    try {
      if (modal==="new") await api.createLocal({nombre:form.nombre,direccion:form.direccion});
      else await api.updateLocal(form.id,{nombre:form.nombre,direccion:form.direccion});
      await reloadData(); setModal(null);
    } catch(e) { alert("Error: "+e.message); }
    setSaving(false);
  };
  const del = async (id) => {
    if (data.users.some(u=>u.localId===id)) return alert("Hay manicuras asignadas a este local.");
    await api.deleteLocal(id); await reloadData();
  };
  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
        <h2 style={{ margin:0,fontSize:18,fontWeight:500 }}>Locales</h2>
        <Btn onClick={openNew} size="sm">+ Nuevo</Btn>
      </div>
      <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
        {data.locales.map(l=>{
          const qty=data.users.filter(u=>u.localId===l.id&&u.rol==="manicura").length;
          return <Card key={l.id} style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:0,fontWeight:500,fontSize:14 }}>{l.nombre}</p>
              <p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>{l.direccion}</p>
            </div>
            <Badge color="info">{qty} manicura{qty!==1?"s":""}</Badge>
            <Btn onClick={()=>openEdit(l)} variant="ghost" size="sm">Editar</Btn>
            <Btn onClick={()=>del(l.id)} variant="ghost" size="sm" style={{ color:COLORS.danger }}>Eliminar</Btn>
          </Card>;
        })}
      </div>
      {modal && <Modal title={modal==="new"?"Nuevo local":"Editar local"} onClose={()=>setModal(null)}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <ModalInput label="Nombre" value={form.nombre||""} onChange={v=>setForm(f=>({...f,nombre:v}))}/>
          <ModalInput label="Dirección" value={form.direccion||""} onChange={v=>setForm(f=>({...f,direccion:v}))}/>
          <div style={{ display:"flex",gap:8,marginTop:4 }}>
            <Btn onClick={save} disabled={saving} style={{ flex:1,justifyContent:"center" }}>{saving?"Guardando...":"Guardar"}</Btn>
            <Btn onClick={()=>setModal(null)} variant="secondary" style={{ flex:1,justifyContent:"center" }}>Cancelar</Btn>
          </div>
        </div>
      </Modal>}
    </div>
  );
}

// ── MI PERFIL ──────────────────────────────────────────────────────
function MiPerfil({ data, reloadData, user, setUser }) {
  const [form, setForm] = useState({nombre:user.nombre,usuario:user.usuario||"",email:user.email||"",password:"",password2:""});
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setErr(""); setOk(false);
    if (!form.nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    if (!form.usuario.trim()) { setErr("El usuario es obligatorio."); return; }
    if (form.password&&form.password!==form.password2) { setErr("Las contraseñas no coinciden."); return; }
    setSaving(true);
    try {
      const upd = {nombre:form.nombre.trim(),usuario:form.usuario.trim(),email:form.email.trim()};
      if (form.password) upd.password = form.password;
      await api.updateUser(user.id,upd);
      await reloadData(); setUser({...user,...upd}); setOk(true);
    } catch(e) { setErr("Error al guardar: "+e.message); }
    setSaving(false);
  };
  return (
    <div>
      <h2 style={{ margin:"0 0 20px",fontSize:18,fontWeight:500 }}>Mi perfil</h2>
      <Card style={{ maxWidth:440 }}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <div><label style={{ fontSize:13,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Nombre</label><Input value={form.nombre} onChange={v=>setForm(f=>({...f,nombre:v}))}/></div>
          <div><label style={{ fontSize:13,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Usuario</label><Input value={form.usuario} onChange={v=>setForm(f=>({...f,usuario:v}))}/></div>
          <div><label style={{ fontSize:13,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Email</label><Input type="email" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} placeholder="tu@mail.com"/></div>
          <div style={{ borderTop:"0.5px solid rgba(120,120,120,0.18)",paddingTop:14 }}>
            <p style={{ margin:"0 0 10px",fontSize:13,color:"var(--color-text-secondary)" }}>Cambiar contraseña (opcional)</p>
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              <Input type="password" value={form.password} onChange={v=>setForm(f=>({...f,password:v}))} placeholder="Nueva contraseña"/>
              <Input type="password" value={form.password2} onChange={v=>setForm(f=>({...f,password2:v}))} placeholder="Repetir contraseña"/>
            </div>
          </div>
          {err && <p style={{ margin:0,fontSize:13,color:COLORS.danger,background:COLORS.dangerLight,padding:"8px 12px",borderRadius:8 }}>{err}</p>}
          {ok && <p style={{ margin:0,fontSize:13,color:COLORS.success,background:COLORS.successLight,padding:"8px 12px",borderRadius:8 }}>Perfil actualizado correctamente.</p>}
          <Btn onClick={save} disabled={saving} style={{ alignSelf:"flex-start" }}>{saving?"Guardando...":"Guardar cambios"}</Btn>
        </div>
      </Card>
    </div>
  );
}

// ── ASISTENCIA DIARIA ──────────────────────────────────────────────
function AsistenciaDiaria({ data, reloadData, user }) {
  const hoy = new Date();
  const [fecha, setFecha] = useState(dateKey(hoy));
  const [modal, setModal] = useState(null);
  const [formAus, setFormAus] = useState({});
  const [formTarde, setFormTarde] = useState({});
  const allowedLocalIds = getAssignedLocalIds(data, user);
  const localesVisibles = (user.rol === "admin"
    ? data.locales
    : data.locales.filter(l => allowedLocalIds.includes(l.id))
  ).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||""));
  const [filtroLocal, setFiltroLocal] = useState("todos");

  useEffect(() => {
    if (filtroLocal !== "todos" && !localesVisibles.some(l => l.id === parseInt(filtroLocal))) {
      setFiltroLocal("todos");
    }
  }, [filtroLocal, localesVisibles]);

  const getA = uid => data.asistencias.find(a=>a.userId===uid&&a.fecha===fecha);
  const estadoColor = {presente:"success",tarde:"amber",ausente:"danger"};
  const estadoLabel = {presente:"✓ Presente",tarde:"⏰ Tarde",ausente:"✗ Ausente"};

  const manicurasConHorario = useMemo(() => data.users.filter(u => {
    if (u.rol!=="manicura"||!u.activo) return false;
    if (user.rol === "encargada" && !allowedLocalIds.includes(u.localId)) return false;
    if (filtroLocal !== "todos" && u.localId !== parseInt(filtroLocal)) return false;
    const h = data.horarios.find(h=>h.userId===u.id&&h.fecha===fecha);
    return h&&h.trabaja&&h.entrada&&h.salida;
  }).sort((a,b)=>{
    const la=data.locales.find(l=>l.id===a.localId)?.nombre||"";
    const lb=data.locales.find(l=>l.id===b.localId)?.nombre||"";
    return la.localeCompare(lb) || a.nombre.localeCompare(b.nombre);
  }), [data.users, data.horarios, data.locales, fecha, user.rol, allowedLocalIds, filtroLocal]);

  const gruposPorLocal = useMemo(() => {
    const grupos = new Map();
    manicurasConHorario.forEach(m => {
      const local = data.locales.find(l=>l.id===m.localId) || { id: "sin", nombre: "Sin local", direccion: "" };
      if (!grupos.has(local.id)) grupos.set(local.id, { local, manicuras: [] });
      grupos.get(local.id).manicuras.push(m);
    });
    return Array.from(grupos.values()).sort((a,b)=>(a.local.nombre||"").localeCompare(b.local.nombre||""));
  }, [manicurasConHorario, data.locales]);

  const resumenLocal = (manicuras) => manicuras.reduce((acc,m)=>{
    const a=getA(m.id);
    if (!a) acc.pendientes += 1;
    else if (a.estado === "presente") acc.presentes += 1;
    else if (a.estado === "tarde") acc.tardes += 1;
    else if (a.estado === "ausente") acc.ausentes += 1;
    return acc;
  }, { presentes:0, tardes:0, ausentes:0, pendientes:0 });

  const setA = async (uid, datos) => {
    await api.upsertAsistencia({user_id:uid,fecha,estado:datos.estado,entrada_real:datos.entradaReal||null,salida_real:datos.salidaReal||null,motivo:datos.motivo||null,certificado:datos.certificado||false,tipo_doc:datos.tipoDoc||null});
    await reloadData();
  };
  const limpiar = async (uid) => { await api.deleteAsistencia(uid,fecha); await reloadData(); };

  const renderManicura = (m) => {
    const h=data.horarios.find(hh=>hh.userId===m.id&&hh.fecha===fecha);
    const a=getA(m.id);
    return <Card key={m.id} style={{ padding:"0.85rem 1rem",borderColor:a?.estado?"rgba(120,120,120,0.18)":"rgba(120,120,120,0.14)" }}>
      <div style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
        <Avatar nombre={m.nombre}/>
        <div style={{ flex:1,minWidth:120 }}>
          <p style={{ margin:0,fontWeight:500,fontSize:14 }}>{m.nombre}</p>
          <p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>Horario: {h?.entrada} – {h?.salida}{a?.estado==="tarde"?` | Real: ${a.entradaReal} – ${a.salidaReal}`:""}</p>
          {a?.estado==="ausente"&&<p style={{ margin:0,fontSize:12,color:COLORS.danger }}>{a.motivo}{a.certificado?` · ${a.tipoDoc||"con certificado"}`:""}</p>}
        </div>
        {a?.estado ? <Badge color={estadoColor[a.estado]}>{estadoLabel[a.estado]}</Badge> : <Badge color="gray">Pendiente</Badge>}
        <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
          <Btn onClick={()=>setA(m.id,{estado:"presente"})} variant="success" size="sm">✓</Btn>
          <Btn onClick={()=>{ const h2=data.horarios.find(h=>h.userId===m.id&&h.fecha===fecha); const a2=getA(m.id); setFormTarde({uid:m.id,entrada:a2?.entradaReal||h2?.entrada||"",salida:a2?.salidaReal||h2?.salida||""}); setModal("tarde"); }} variant="secondary" size="sm">⏰ Tarde</Btn>
          <Btn onClick={()=>{ const a2=getA(m.id); setFormAus({uid:m.id,motivo:a2?.motivo||MOTIVOS_AUSENCIA[0],certificado:a2?.certificado||false,tipoDoc:a2?.tipoDoc||""}); setModal("ausencia"); }} variant="danger" size="sm">✗ Ausente</Btn>
          {a&&<Btn onClick={()=>limpiar(m.id)} variant="ghost" size="sm">Limpiar</Btn>}
        </div>
      </div>
    </Card>;
  };

  return (
    <div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8 }}>
        <div>
          <h2 style={{ margin:0,fontSize:18,fontWeight:500 }}>Asistencia diaria</h2>
          <p style={{ margin:"3px 0 0",fontSize:12,color:"var(--color-text-secondary)" }}>Agrupada por local para controlar cada sucursal por separado.</p>
        </div>
        <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
          <select value={filtroLocal} onChange={e=>setFiltroLocal(e.target.value)} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:8,padding:"7px 12px",fontSize:14,background:"var(--color-background-primary)",color:"var(--color-text-primary)",minWidth:180 }}>
            <option value="todos">Todos los locales</option>
            {localesVisibles.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
          <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:8,padding:"7px 12px",fontSize:14,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}/>
        </div>
      </div>

      {manicurasConHorario.length===0
        ? <Card><p style={{ margin:0,color:"var(--color-text-secondary)",fontSize:14,textAlign:"center" }}>No hay manicuras con horario para esta fecha{filtroLocal!=="todos"?" en el local seleccionado":""}.</p></Card>
        : <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          {gruposPorLocal.map(({ local, manicuras }) => {
            const r = resumenLocal(manicuras);
            return <div key={local.id} style={{ border:"1px solid rgba(120,120,120,0.18)",borderRadius:14,overflow:"hidden",background:"var(--color-background-primary)" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",padding:"10px 12px",background:"var(--color-background-secondary)",borderBottom:"1px solid rgba(120,120,120,0.14)" }}>
                <div>
                  <p style={{ margin:0,fontSize:15,fontWeight:600,color:"var(--color-text-primary)" }}>🏠 {local.nombre}</p>
                  {local.direccion&&<p style={{ margin:"2px 0 0",fontSize:11,color:"var(--color-text-secondary)" }}>{local.direccion}</p>}
                </div>
                <div style={{ display:"flex",gap:6,flexWrap:"wrap",alignItems:"center" }}>
                  <Badge color="info">{manicuras.length} con horario</Badge>
                  <Badge color="success">✓ {r.presentes}</Badge>
                  <Badge color="amber">⏰ {r.tardes}</Badge>
                  <Badge color="danger">✗ {r.ausentes}</Badge>
                  <Badge color="gray">Pend. {r.pendientes}</Badge>
                </div>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:8,padding:10 }}>
                {manicuras.map(renderManicura)}
              </div>
            </div>;
          })}
        </div>}
      {modal==="tarde" && <Modal title="Registrar llegada tarde" onClose={()=>setModal(null)}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <ModalInput label="Horario real de entrada" value={formTarde.entrada} onChange={v=>setFormTarde(f=>({...f,entrada:v}))} type="time"/>
          <ModalInput label="Horario real de salida" value={formTarde.salida} onChange={v=>setFormTarde(f=>({...f,salida:v}))} type="time"/>
          <div style={{ display:"flex",gap:8 }}>
            <Btn onClick={async()=>{ await setA(formTarde.uid,{estado:"tarde",entradaReal:formTarde.entrada,salidaReal:formTarde.salida}); setModal(null); }} style={{ flex:1,justifyContent:"center" }}>Guardar</Btn>
            <Btn onClick={()=>setModal(null)} variant="secondary" style={{ flex:1,justifyContent:"center" }}>Cancelar</Btn>
          </div>
        </div>
      </Modal>}
      {modal==="ausencia" && <Modal title="Registrar ausencia" onClose={()=>setModal(null)}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <ModalSelect label="Motivo" value={formAus.motivo} onChange={v=>setFormAus(f=>({...f,motivo:v}))}>{MOTIVOS_AUSENCIA.map(m=><option key={m} value={m}>{m}</option>)}</ModalSelect>
          <label style={{ display:"flex",alignItems:"center",gap:8,fontSize:14,cursor:"pointer" }}>
            <input type="checkbox" checked={formAus.certificado} onChange={e=>setFormAus(f=>({...f,certificado:e.target.checked}))}/>Presenta documentación
          </label>
          {formAus.certificado && <ModalSelect label="Tipo" value={formAus.tipoDoc} onChange={v=>setFormAus(f=>({...f,tipoDoc:v}))}>
            <option value="">Seleccionar...</option>
            <option value="Certificado médico">Certificado médico</option>
            <option value="Certificado por examen">Certificado por examen</option>
            <option value="Otro">Otro</option>
          </ModalSelect>}
          <div style={{ display:"flex",gap:8 }}>
            <Btn onClick={async()=>{ await setA(formAus.uid,{estado:"ausente",motivo:formAus.motivo,certificado:formAus.certificado,tipoDoc:formAus.tipoDoc}); setModal(null); }} style={{ flex:1,justifyContent:"center" }}>Guardar</Btn>
            <Btn onClick={()=>setModal(null)} variant="secondary" style={{ flex:1,justifyContent:"center" }}>Cancelar</Btn>
          </div>
        </div>
      </Modal>}
    </div>
  );
}

// ── REPORTES ───────────────────────────────────────────────────────

function Reportes({ data, user, onOpenAgenda, reportRestore }) {
  const hoy = new Date();
  const esAdmin = user.rol === "admin";
  const esEncargada = user.rol === "encargada";
  const puedeGestionar = esAdmin || esEncargada;
  const allowedLocalIds = getAssignedLocalIds(data, user);
  const localesVisibles = esAdmin ? data.locales : data.locales.filter(l => allowedLocalIds.includes(l.id));
  const [tab, setTab] = useState(reportRestore?.tab || "horas");
  const [filtroTipo, setFiltroTipo] = useState(puedeGestionar ? "manicura" : "manicura");
  const [filtroId, setFiltroId] = useState(puedeGestionar ? (data.users.filter(u=>u.rol==="manicura"&&(esAdmin||allowedLocalIds.includes(u.localId)))[0]?.id || "") : user.id);
  const restoreDate = reportRestore?.fecha ? new Date(reportRestore.fecha + "T12:00:00") : null;
  const [mes, setMes] = useState(restoreDate ? restoreDate.getMonth() : hoy.getMonth());
  const [anio, setAnio] = useState(restoreDate ? restoreDate.getFullYear() : hoy.getFullYear());
  const [filtroSemana, setFiltroSemana] = useState("todas");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [fechaDesde, setFechaDesde] = useState(dateKey(new Date(hoy.getFullYear(),hoy.getMonth(),1)));
  const [fechaHasta, setFechaHasta] = useState(dateKey(hoy));
  const [expandidos, setExpandidos] = useState({});
  const [localCobertura, setLocalCobertura] = useState(reportRestore?.localId || localesVisibles[0]?.id || "");
  const manicuras = data.users.filter(u=>u.rol==="manicura"&&u.activo&&(esAdmin || allowedLocalIds.includes(u.localId)));
  const semanasDelMes = useMemo(()=>getSemanas(getDiasDelMes(anio,mes)),[anio,mes]);

  const TabBtn = ({id,label}) => <button onClick={()=>setTab(id)} style={{ padding:"8px 16px",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500,background:tab===id?COLORS.pink:"transparent",color:tab===id?"#fff":"var(--color-text-secondary)" }}>{label}</button>;
  const estadoColor={presente:"success",tarde:"amber",ausente:"danger"};
  const estadoLabel={presente:"Presente",tarde:"Tarde",ausente:"Ausente"};
  const toggleExp = id => setExpandidos(e=>({...e,[id]:!e[id]}));

  const filtrarM = () => {
    let base = puedeGestionar?(filtroTipo==="manicura"?manicuras.filter(m=>m.id===parseInt(filtroId)):filtroTipo==="local"?manicuras.filter(m=>m.localId===parseInt(filtroId)):manicuras):[data.users.find(u=>u.id===user.id)].filter(Boolean);
    if (filtroEstado!=="todos") base=base.filter(m=>data.asistencias.some(a=>a.userId===m.id&&a.fecha>=fechaDesde&&a.fecha<=fechaHasta&&a.estado===filtroEstado));
    return base;
  };
  const mF = filtrarM();

  const buildHorasReport = m => {
    const dias=getDiasDelMes(anio,mes), semanas=getSemanas(dias);
    const semanasData=semanas.map((sem,si)=>{
      const diasData=sem.map(d=>{
        const dk=dateKey(d);
        const h=data.horarios.find(hh=>hh.userId===m.id&&hh.fecha===dk);
        const a=data.asistencias.find(aa=>aa.userId===m.id&&aa.fecha===dk);
        const trabaja=h?.trabaja&&h?.entrada&&h?.salida;
        const horasTeo=trabaja?calcHoras(h.entrada,h.salida):0;
        let horasReal=0;
        if(trabaja&&a){if(a.estado==="presente")horasReal=horasTeo;else if(a.estado==="tarde")horasReal=calcHoras(a.entradaReal||h.entrada,a.salidaReal||h.salida);}
        const dow=d.getDay();
        return {fecha:dk,label:`${DIAS_SEMANA[dow===0?6:dow-1]} ${d.getDate()}`,entrada:h?.entrada||"",salida:h?.salida||"",horasTeo,horasReal,trabaja:!!trabaja,asistencia:a||null};
      });
      return {semana:si+1,dias:diasData,totalTeo:diasData.reduce((a,d)=>a+d.horasTeo,0),totalReal:diasData.reduce((a,d)=>a+d.horasReal,0)};
    });
    const semFilt=filtroSemana==="todas"?semanasData:semanasData.filter(s=>s.semana===parseInt(filtroSemana));
    return {...m,semanasData:semFilt,totalMesTeo:semFilt.reduce((a,s)=>a+s.totalTeo,0),totalMesReal:semFilt.reduce((a,s)=>a+s.totalReal,0),diasTrabajo:semFilt.flatMap(s=>s.dias).filter(d=>d.trabaja).length};
  };
  const buildAsistenciaReport = m => {
    let asist=data.asistencias.filter(a=>a.userId===m.id&&a.fecha>=fechaDesde&&a.fecha<=fechaHasta).sort((a,b)=>a.fecha.localeCompare(b.fecha));
    if(filtroSemana!=="todas"){const semDias=(semanasDelMes[parseInt(filtroSemana)-1]||[]).map(d=>dateKey(d));asist=asist.filter(a=>semDias.includes(a.fecha));}
    const asistFilt=filtroEstado==="todos"?asist:asist.filter(a=>a.estado===filtroEstado);
    const presentes=asist.filter(a=>a.estado==="presente").length, tardes=asist.filter(a=>a.estado==="tarde").length, ausentes=asist.filter(a=>a.estado==="ausente").length, total=presentes+tardes+ausentes;
    return {...m,asist:asistFilt,presentes,tardes,ausentes,total,pct:total>0?Math.round(((presentes+tardes)/total)*100):0};
  };

  const defaultRules = [
    {diaSemana:1,afluencia:"baja",minimoDiario:2,maximoDiario:4,minimoApertura:1,minimoCierre:1},
    {diaSemana:2,afluencia:"baja",minimoDiario:2,maximoDiario:4,minimoApertura:1,minimoCierre:1},
    {diaSemana:3,afluencia:"media",minimoDiario:3,maximoDiario:5,minimoApertura:1,minimoCierre:1},
    {diaSemana:4,afluencia:"media",minimoDiario:3,maximoDiario:5,minimoApertura:1,minimoCierre:1},
    {diaSemana:5,afluencia:"alta",minimoDiario:4,maximoDiario:6,minimoApertura:2,minimoCierre:2},
    {diaSemana:6,afluencia:"alta",minimoDiario:4,maximoDiario:6,minimoApertura:2,minimoCierre:2},
  ];
  const reglasForLocal = useCallback((localId) => {
    const map = new Map(defaultRules.map(r=>[r.diaSemana,{...r, localId:parseInt(localId)}]));
    (data.reglasCobertura||[]).filter(r=>r.localId===parseInt(localId)).forEach(r=>map.set(r.diaSemana,r));
    return map;
  }, [data.reglasCobertura]);
  const configCob = getConfigForLocal(data, localCobertura || localesVisibles[0]?.id);
  const minOf = t => { const [h,m]=(t||"00:00").split(":").map(Number); return h*60+(m||0); };
  const overlap = (a1,a2,b1,b2) => Math.max(a1,b1) < Math.min(a2,b2);
  const statusInfo = st => ({critico:["🔴","Crítico",COLORS.danger,COLORS.dangerLight],bajo:["🟡","Bajo",COLORS.amber,COLORS.amberLight],ok:["✅","Correcto",COLORS.success,COLORS.successLight],alto:["🟣","Sobrecubierto",COLORS.pinkDark,COLORS.pinkLight],sin:["⚪","Sin horarios",COLORS.gray,COLORS.grayLight]}[st]);
  const abrirAgendaDia = (fecha) => onOpenAgenda?.({ fecha, localId: parseInt(localCobertura || localesVisibles[0]?.id) });

  const cobertura = useMemo(()=>{
    const open=minOf(configCob.horaApertura), close=minOf(configCob.horaCierre);
    const openEnd=open+(configCob.minutosApertura||60), closeStart=close-(configCob.minutosCierre||60);
    const horas=[]; for(let m=open; m<close; m+=60) horas.push(m);
    const dias=getDiasDelMes(anio,mes);
    const selectedLocalId = parseInt(localCobertura || localesVisibles[0]?.id);
    const reglas = reglasForLocal(selectedLocalId);
    const empleadosBase = manicuras.filter(m=>m.localId===selectedLocalId);
    const items=dias.map(d=>{
      const f=dateKey(d), dow=d.getDay(), regla=reglas.get(dow)||defaultRules.find(r=>r.diaSemana===dow)||defaultRules[0];
      const hs=data.horarios.filter(h=>h.fecha===f&&h.trabaja&&h.entrada&&h.salida&&empleadosBase.some(m=>m.id===h.userId));
      const userIds=[...new Set(hs.map(h=>h.userId))];
      const total=userIds.length;
      const apertura=hs.filter(h=>overlap(minOf(h.entrada),minOf(h.salida),open,openEnd)).length;
      const cierre=hs.filter(h=>overlap(minOf(h.entrada),minOf(h.salida),closeStart,close)).length;
      const hourly=horas.map(hm=>hs.filter(h=>overlap(minOf(h.entrada),minOf(h.salida),hm,hm+60)).length);
      let estado="ok";
      const motivos=[];
      if(total===0){ estado="sin"; motivos.push("sin horarios cargados"); }
      if(apertura<regla.minimoApertura){ estado="critico"; motivos.push(`apertura ${apertura}/${regla.minimoApertura}`); }
      if(cierre<regla.minimoCierre){ estado="critico"; motivos.push(`cierre ${cierre}/${regla.minimoCierre}`); }
      if(estado!=="critico"&&total<regla.minimoDiario){ estado="bajo"; motivos.push(`día ${total}/${regla.minimoDiario}`); }
      if(estado==="ok"&&total>regla.maximoDiario){ estado="alto"; motivos.push(`${total}/${regla.maximoDiario} manicuras`); }
      return {fecha:f,dia:d,dow,regla,total,apertura,cierre,hourly,estado,motivos};
    });
    const resumen={critico:items.filter(i=>i.estado==="critico").length,bajo:items.filter(i=>i.estado==="bajo").length,alto:items.filter(i=>i.estado==="alto").length,ok:items.filter(i=>i.estado==="ok").length,sin:items.filter(i=>i.estado==="sin").length};
    const alertas=items.filter(i=>i.estado!=="ok").sort((a,b)=>(({critico:0,sin:1,bajo:2,alto:3}[a.estado]||0)-({critico:0,sin:1,bajo:2,alto:3}[b.estado]||0)||a.fecha.localeCompare(b.fecha)));
    return {items,resumen,alertas,horas};
  }, [anio, mes, data.horarios, manicuras, localCobertura, localesVisibles, reglasForLocal, configCob]);

  const renderCobertura = () => {
    const cellBg = st => statusInfo(st)[3];
    const cellFg = st => statusInfo(st)[2];
    const semanas=getSemanas(cobertura.items.map(i=>i.dia));
    const byFecha = new Map(cobertura.items.map(i=>[i.fecha,i]));
    return <>
      <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center" }}>
        <Select value={mes} onChange={v=>setMes(parseInt(v))} style={{ width:130 }}>{MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}</Select>
        <Select value={anio} onChange={v=>setAnio(parseInt(v))} style={{ width:90 }}>{[hoy.getFullYear()-1,hoy.getFullYear(),hoy.getFullYear()+1].map(a=><option key={a} value={a}>{a}</option>)}</Select>
        {puedeGestionar&&<Select value={localCobertura} onChange={setLocalCobertura} style={{ width:180 }}>{localesVisibles.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</Select>}
        <span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>Apertura {configCob.horaApertura} · Cierre {configCob.horaCierre}</span>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14 }}>
        {[['critico','Días críticos'],['bajo','Baja cobertura'],['ok','Correctos'],['alto','Sobrecubiertos'],['sin','Sin horarios']].map(([k,lbl])=>{const [ico,,fg,bg]=statusInfo(k); return <div key={k} style={{ background:bg,border:`1px solid ${fg}22`,borderRadius:10,padding:"10px 12px" }}><p style={{ margin:0,fontSize:12,color:fg,fontWeight:500 }}>{ico} {lbl}</p><p style={{ margin:0,fontSize:24,fontWeight:600,color:fg }}>{cobertura.resumen[k]}</p></div>;})}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1.05fr 0.95fr",gap:14,alignItems:"start" }}>
        <Card style={{ padding:0,overflow:"hidden" }}>
          <div style={{ padding:"10px 12px",borderBottom:"1px solid rgba(120,120,120,0.18)",display:"flex",justifyContent:"space-between",alignItems:"center" }}><strong style={{ fontSize:14 }}>Calendario semaforizado</strong><span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>{MESES[mes]} {anio}</span></div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",borderBottom:"1px solid rgba(120,120,120,0.18)" }}>{DIAS_SEMANA.map(d=><div key={d} style={{ padding:"7px 6px",textAlign:"center",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",borderLeft:"1px solid rgba(120,120,120,0.14)" }}>{d}</div>)}</div>
          {semanas.map((sem,si)=><div key={si} style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",minHeight:86,borderBottom:"1px solid rgba(120,120,120,0.14)" }}>{Array.from({length:6},(_,i)=>{const d=sem[i]; if(!d)return <div key={i} style={{ borderLeft:"1px solid rgba(120,120,120,0.12)" }}/>; const it=byFecha.get(dateKey(d)); const [ico,label,fg]=statusInfo(it.estado); return <div key={i} title={`${label} · ${it.motivos.join(', ') || 'Dentro del rango esperado'}`} style={{ padding:7,borderLeft:"1px solid rgba(120,120,120,0.12)",background:cellBg(it.estado) }}><div style={{ display:"flex",justifyContent:"space-between",gap:4 }}><span style={{ fontSize:12,fontWeight:600,color:fg }}>{d.getDate()}</span><span>{ico}</span></div><p style={{ margin:"4px 0 0",fontSize:11,color:fg,fontWeight:500 }}>👥 {it.total}</p><p style={{ margin:"2px 0 0",fontSize:10,color:"var(--color-text-secondary)" }}>Ap. {it.apertura} · Cie. {it.cierre}</p><p style={{ margin:"2px 0 0",fontSize:9,color:"var(--color-text-secondary)",textTransform:"capitalize" }}>{it.regla.afluencia}</p><button onClick={e=>{ e.stopPropagation(); abrirAgendaDia(it.fecha); }} style={{ marginTop:5,background:"rgba(255,255,255,0.75)",border:`1px solid ${fg}33`,borderRadius:6,padding:"3px 6px",fontSize:10,fontWeight:600,color:fg,cursor:"pointer",width:"100%" }}>Ver agenda</button></div>;})}</div>)}
        </Card>
        <Card>
          <h3 style={{ margin:"0 0 10px",fontSize:14,fontWeight:500 }}>Alertas principales</h3>
          {cobertura.alertas.length===0?<p style={{ margin:0,fontSize:13,color:COLORS.success }}>No hay alertas para este período.</p>:<div style={{ display:"flex",flexDirection:"column",gap:7,maxHeight:390,overflow:"auto" }}>{cobertura.alertas.slice(0,18).map(it=>{const [ico,label,fg,bg]=statusInfo(it.estado); return <div key={it.fecha} style={{ background:bg,borderRadius:8,padding:"8px 10px",border:`1px solid ${fg}22` }}><div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",gap:8 }}><p style={{ margin:0,fontSize:13,fontWeight:600,color:fg }}>{ico} {fmtFecha(it.dia)} · {label}</p><button onClick={()=>abrirAgendaDia(it.fecha)} style={{ background:"#fff",border:`1px solid ${fg}33`,borderRadius:6,padding:"4px 7px",fontSize:11,fontWeight:600,color:fg,cursor:"pointer",whiteSpace:"nowrap" }}>Ver agenda</button></div><p style={{ margin:"2px 0 0",fontSize:12,color:"var(--color-text-secondary)" }}>👥 {it.total} · Apertura {it.apertura}/{it.regla.minimoApertura} · Cierre {it.cierre}/{it.regla.minimoCierre}</p><p style={{ margin:"2px 0 0",fontSize:11,color:"var(--color-text-secondary)" }}>{it.motivos.join(" · ")}</p></div>;})}</div>}
        </Card>
      </div>
      <Card style={{ marginTop:14,padding:0,overflow:"hidden" }}>
        <div style={{ padding:"10px 12px",borderBottom:"1px solid rgba(120,120,120,0.18)" }}><strong style={{ fontSize:14 }}>Mapa de calor por hora</strong><p style={{ margin:"2px 0 0",fontSize:12,color:"var(--color-text-secondary)" }}>Cantidad de manicuras activas por franja. Los colores comparan contra la demanda esperada del día.</p></div>
        <div style={{ overflowX:"auto" }}><div style={{ minWidth:720 }}>
          <div style={{ display:"grid",gridTemplateColumns:`88px repeat(${cobertura.horas.length},1fr)`,borderBottom:"1px solid rgba(120,120,120,0.16)" }}><div style={{ padding:7,fontSize:11,color:"var(--color-text-secondary)" }}>Día</div>{cobertura.horas.map(h=><div key={h} style={{ padding:7,textAlign:"center",fontSize:11,color:"var(--color-text-secondary)",borderLeft:"1px solid rgba(120,120,120,0.12)" }}>{String(Math.floor(h/60)).padStart(2,"0")}:00</div>)}</div>
          {cobertura.items.map(it=><div key={it.fecha} style={{ display:"grid",gridTemplateColumns:`88px repeat(${cobertura.horas.length},1fr)`,borderBottom:"1px solid rgba(120,120,120,0.10)" }}><div style={{ padding:"7px 8px",fontSize:12,fontWeight:500 }}>{fmtFecha(it.dia)}</div>{it.hourly.map((qty,idx)=>{const minBase=Math.max(1,Math.round(it.regla.minimoDiario/2)); const shade=(palette,i)=>palette[Math.max(0,Math.min(palette.length-1,i))]; const palettes={danger:["#fff1f1","#ffdada","#f8b8b8","#e24b4a"],amber:["#fff6e8","#fae6c7","#f2c884","#ba7517"],success:["#f1f8e8","#dceec9","#b6d98c","#639922"],pink:["#fbeaf0","#f4c4d4","#e590ad","#72243e"]}; let bg,fg; let shadeIdx=0; if(qty===0){bg=palettes.danger[2];fg=COLORS.danger;} else if(qty<minBase){shadeIdx=qty;bg=shade(palettes.amber,shadeIdx);fg=shadeIdx>=3?"#fff":COLORS.amber;} else if(qty>it.regla.maximoDiario){shadeIdx=Math.min(3,qty-it.regla.maximoDiario);bg=shade(palettes.pink,shadeIdx);fg=shadeIdx>=3?"#fff":COLORS.pinkDark;} else {shadeIdx=Math.max(0,qty-minBase);bg=shade(palettes.success,shadeIdx);fg=shadeIdx>=3?"#fff":COLORS.success;} return <div key={idx} style={{ padding:7,textAlign:"center",fontSize:12,fontWeight:700,color:fg,background:bg,borderLeft:"1px solid rgba(120,120,120,0.10)",textShadow:fg==="#fff"?"0 1px 1px rgba(0,0,0,0.25)":"none" }}>{qty}</div>;})}</div>)}
        </div></div>
      </Card>
    </>;
  };

  return (
    <div>
      <h2 style={{ margin:"0 0 16px",fontSize:18,fontWeight:500 }}>Reportes</h2>
      <div style={{ display:"flex",gap:4,background:"var(--color-background-secondary)",padding:4,borderRadius:10,marginBottom:20,width:"fit-content",flexWrap:"wrap" }}><TabBtn id="horas" label="Horas teóricas"/><TabBtn id="asistencia" label="Asistencia"/><TabBtn id="cobertura" label="Cobertura"/></div>
      {tab!=="cobertura"&&puedeGestionar && <div style={{ display:"flex",gap:8,marginBottom:8,flexWrap:"wrap" }}>
        <Select value={filtroTipo} onChange={v=>{setFiltroTipo(v);setExpandidos({});}} style={{ width:130 }}><option value="manicura">Manicura</option><option value="local">Local</option><option value="todas">Todas</option></Select>
        {filtroTipo==="manicura"&&<Select value={filtroId} onChange={v=>{setFiltroId(v);setExpandidos({});}} style={{ flex:1,minWidth:160 }}>{manicuras.map(m=><option key={m.id} value={m.id}>{m.nombre}</option>)}</Select>}
        {filtroTipo==="local"&&<Select value={filtroId} onChange={v=>{setFiltroId(v);setExpandidos({});}} style={{ flex:1,minWidth:160 }}>{localesVisibles.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</Select>}
      </div>}
      {tab!=="cobertura"&&<div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}>
        <Select value={filtroSemana} onChange={v=>{setFiltroSemana(v);setExpandidos({});}} style={{ width:150 }}><option value="todas">Todas las semanas</option>{semanasDelMes.map((_,i)=><option key={i+1} value={i+1}>Semana {i+1}</option>)}</Select>
        <Select value={filtroEstado} onChange={v=>{setFiltroEstado(v);setExpandidos({});}} style={{ width:160 }}><option value="todos">Todos los estados</option><option value="ausente">Solo ausencias</option><option value="tarde">Solo llegadas tarde</option></Select>
      </div>}
      {tab==="cobertura"&&renderCobertura()}
      {tab==="horas"&&<>
        <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap" }}><Select value={mes} onChange={v=>{setMes(parseInt(v));setExpandidos({});}} style={{ width:130 }}>{MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}</Select><Select value={anio} onChange={v=>{setAnio(parseInt(v));setExpandidos({});}} style={{ width:90 }}>{[hoy.getFullYear()-1,hoy.getFullYear(),hoy.getFullYear()+1].map(a=><option key={a} value={a}>{a}</option>)}</Select></div>
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>{mF.map(m=>{ const r=buildHorasReport(m),exp=expandidos[m.id]; return <Card key={m.id} style={{ padding:"0.875rem 1.25rem" }}><div style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}><Avatar nombre={r.nombre}/><div style={{ flex:1 }}><p style={{ margin:0,fontWeight:500,fontSize:14 }}>{r.nombre}</p><p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>{data.locales.find(l=>l.id===r.localId)?.nombre||"Sin local"} · {r.diasTrabajo} días</p></div><div style={{ display:"flex",gap:16,marginRight:8,flexWrap:"wrap",justifyContent:"flex-end" }}><div style={{ textAlign:"right" }}><p style={{ margin:0,fontSize:18,fontWeight:500 }}>{r.totalMesTeo.toFixed(1)}h</p><p style={{ margin:0,fontSize:11,color:"var(--color-text-secondary)" }}>teóricas</p></div><div style={{ textAlign:"right" }}><p style={{ margin:0,fontSize:18,fontWeight:500,color:r.totalMesReal<r.totalMesTeo?COLORS.danger:COLORS.success }}>{r.totalMesReal.toFixed(1)}h</p><p style={{ margin:0,fontSize:11,color:"var(--color-text-secondary)" }}>reales</p></div></div><button onClick={()=>toggleExp(m.id)} style={{ background:COLORS.pinkLight,color:COLORS.pinkDark,border:"none",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap" }}>{exp?"▲ Ocultar":"▼ Ver detalle"}</button></div>{exp&&<div style={{ marginTop:14,borderTop:"0.5px solid rgba(120,120,120,0.18)",paddingTop:14 }}>{r.semanasData.map(sem=><div key={sem.semana} style={{ marginBottom:14 }}><div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}><span style={{ fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",textTransform:"uppercase",letterSpacing:"0.04em" }}>Semana {sem.semana}</span><span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>Teo: <strong>{sem.totalTeo.toFixed(1)}h</strong> · Real: <strong>{sem.totalReal.toFixed(1)}h</strong></span></div><div style={{ display:"flex",flexDirection:"column",gap:4 }}>{sem.dias.map(d=><div key={d.fecha} style={{ display:"grid",gridTemplateColumns:"60px 1fr 50px 50px 70px",gap:8,alignItems:"center",padding:"5px 8px",borderRadius:6,background:d.trabaja?"var(--color-background-secondary)":"transparent",opacity:d.trabaja?1:0.45 }}><span style={{ fontSize:13,fontWeight:500,color:"var(--color-text-secondary)" }}>{d.label}</span><span style={{ fontSize:12,color:"var(--color-text-primary)" }}>{d.trabaja?`${d.entrada} – ${d.salida}`:"—"}</span><span style={{ fontSize:12,color:"var(--color-text-secondary)",textAlign:"right" }}>{d.trabaja?`${d.horasTeo.toFixed(1)}h`:""}</span><span style={{ fontSize:12,textAlign:"right",color:d.trabaja?(d.horasReal<d.horasTeo?COLORS.danger:COLORS.success):"var(--color-text-secondary)" }}>{d.trabaja?(d.asistencia?`${d.horasReal.toFixed(1)}h`:"—"):""}</span>{d.trabaja?(d.asistencia?<Badge color={estadoColor[d.asistencia.estado]}>{d.asistencia.estado==="presente"?"✓":d.asistencia.estado==="tarde"?"Tarde":"Ausente"}</Badge>:<Badge color="gray">Sin reg.</Badge>):<Badge color="gray">Libre</Badge>}</div>)}</div></div>)}</div>}</Card>;})}{mF.length===0&&<Card><p style={{ margin:0,textAlign:"center",color:"var(--color-text-secondary)" }}>Sin datos para los filtros seleccionados.</p></Card>}</div>
      </>}
      {tab==="asistencia"&&<>
        <div style={{ display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center" }}><span style={{ fontSize:13,color:"var(--color-text-secondary)" }}>Desde</span><input type="date" value={fechaDesde} onChange={e=>{setFechaDesde(e.target.value);setExpandidos({});}} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:8,padding:"7px 12px",fontSize:13,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}/><span style={{ fontSize:13,color:"var(--color-text-secondary)" }}>hasta</span><input type="date" value={fechaHasta} onChange={e=>{setFechaHasta(e.target.value);setExpandidos({});}} style={{ border:"0.5px solid rgba(120,120,120,0.24)",borderRadius:8,padding:"7px 12px",fontSize:13,background:"var(--color-background-primary)",color:"var(--color-text-primary)" }}/></div>
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>{mF.map(m=>{ const r=buildAsistenciaReport(m),exp=expandidos[m.id]; return <Card key={m.id} style={{ padding:"0.875rem 1.25rem" }}><div style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}><Avatar nombre={r.nombre}/><div style={{ flex:1 }}><p style={{ margin:0,fontWeight:500,fontSize:14 }}>{r.nombre}</p><p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>{r.total} días registrados</p></div><div style={{ display:"flex",gap:6,flexWrap:"wrap",alignItems:"center" }}><Badge color="success">✓ {r.presentes}</Badge><Badge color="amber">⏰ {r.tardes}</Badge><Badge color="danger">✗ {r.ausentes}</Badge><span style={{ fontSize:18,fontWeight:500,color:r.pct>=90?COLORS.success:r.pct>=75?COLORS.amber:COLORS.danger,minWidth:44,textAlign:"right" }}>{r.pct}%</span></div><button onClick={()=>toggleExp(m.id)} style={{ background:COLORS.pinkLight,color:COLORS.pinkDark,border:"none",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap" }}>{exp?"▲ Ocultar":"▼ Ver detalle"}</button></div>{exp&&<div style={{ marginTop:14,borderTop:"0.5px solid rgba(120,120,120,0.18)",paddingTop:14 }}>{r.asist.length===0?<p style={{ margin:0,fontSize:13,color:"var(--color-text-secondary)",textAlign:"center" }}>Sin registros en este período.</p>:<div style={{ display:"flex",flexDirection:"column",gap:4 }}>{r.asist.map(a=>{const ht=data.horarios.find(h=>h.userId===m.id&&h.fecha===a.fecha);const fmtD=(()=>{const p=a.fecha.split("-");return `${p[2]}/${p[1]}`;})();return <div key={a.fecha} style={{ display:"grid",gridTemplateColumns:"80px 90px 1fr 1fr 100px",gap:8,alignItems:"center",padding:"6px 8px",borderRadius:6,background:"var(--color-background-secondary)" }}><span style={{ fontSize:13,fontWeight:500 }}>{fmtD}</span><Badge color={estadoColor[a.estado]}>{estadoLabel[a.estado]}</Badge><span style={{ fontSize:13,color:"var(--color-text-secondary)" }}>{ht?.entrada&&ht?.salida?`${ht.entrada} – ${ht.salida}`:"—"}</span><span style={{ fontSize:13,color:"var(--color-text-secondary)" }}>{a.estado==="tarde"?`${a.entradaReal} – ${a.salidaReal}`:a.estado==="presente"?"En horario":"—"}</span><span style={{ fontSize:12,color:"var(--color-text-secondary)" }}>{a.estado==="ausente"?a.motivo:a.estado==="tarde"?"Llegada tarde":""}</span></div>;})}</div>}</div>}</Card>;})}{mF.length===0&&<Card><p style={{ margin:0,textAlign:"center",color:"var(--color-text-secondary)" }}>Sin datos para los filtros seleccionados.</p></Card>}</div>
      </>}
    </div>
  );
}

function ConfiguracionCobertura({ data, reloadData, user }) {
  const esAdmin = user.rol === "admin";
  const allowedLocalIds = getAssignedLocalIds(data, user);
  const localesVisibles = esAdmin ? data.locales : data.locales.filter(l => allowedLocalIds.includes(l.id));
  const [localId,setLocalId] = useState(localesVisibles[0]?.id || "");
  const defaultRules = [
    {diaSemana:1,afluencia:"baja",minimoDiario:2,maximoDiario:4,minimoApertura:1,minimoCierre:1},
    {diaSemana:2,afluencia:"baja",minimoDiario:2,maximoDiario:4,minimoApertura:1,minimoCierre:1},
    {diaSemana:3,afluencia:"media",minimoDiario:3,maximoDiario:5,minimoApertura:1,minimoCierre:1},
    {diaSemana:4,afluencia:"media",minimoDiario:3,maximoDiario:5,minimoApertura:1,minimoCierre:1},
    {diaSemana:5,afluencia:"alta",minimoDiario:4,maximoDiario:6,minimoApertura:2,minimoCierre:2},
    {diaSemana:6,afluencia:"alta",minimoDiario:4,maximoDiario:6,minimoApertura:2,minimoCierre:2},
  ];
  const buildReglas = (lid) => defaultRules.map(r => ({ ...r, localId:parseInt(lid), ...(data.reglasCobertura||[]).find(x=>x.localId===parseInt(lid)&&x.diaSemana===r.diaSemana) }));
  const [reglas,setReglas] = useState(buildReglas(localId));
  const [config,setConfig] = useState(getConfigForLocal(data, localId));
  const [saving,setSaving] = useState(false);
  const [ok,setOk] = useState(false);
  useEffect(()=>{ setReglas(buildReglas(localId)); setConfig(getConfigForLocal(data, localId)); setOk(false); }, [localId, data.reglasCobertura, data.configCobertura]);
  const setRegla = (dia, campo, valor) => setReglas(rs => rs.map(r => r.diaSemana===dia ? { ...r, [campo]: valor } : r));
  const save = async () => {
    setSaving(true); setOk(false);
    const lid=parseInt(localId);
    await api.upsertConfigCobertura({ local_id:lid, hora_apertura:config.horaApertura, hora_cierre:config.horaCierre, minutos_apertura:parseInt(config.minutosApertura)||60, minutos_cierre:parseInt(config.minutosCierre)||60 });
    for (const r of reglas) await api.upsertReglaCobertura({ local_id:lid, dia_semana:r.diaSemana, afluencia:r.afluencia, minimo_diario:parseInt(r.minimoDiario)||0, maximo_diario:parseInt(r.maximoDiario)||0, minimo_apertura:parseInt(r.minimoApertura)||0, minimo_cierre:parseInt(r.minimoCierre)||0, activo:true });
    await reloadData(); setSaving(false); setOk(true);
  };
  return <div>
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8 }}><h2 style={{ margin:0,fontSize:18,fontWeight:500 }}>Configuración de cobertura por local</h2><Btn onClick={save} disabled={saving||!localId}>{saving?"Guardando...":"Guardar configuración"}</Btn></div>
    {ok&&<div style={{ background:COLORS.successLight,color:COLORS.success,borderRadius:8,padding:"8px 12px",fontSize:13,marginBottom:12 }}>Configuración guardada correctamente.</div>}
    <Card style={{ marginBottom:14 }}><h3 style={{ margin:"0 0 12px",fontSize:15,fontWeight:500 }}>Local</h3><Select value={localId} onChange={setLocalId} style={{ maxWidth:320 }}>{localesVisibles.map(l=><option key={l.id} value={l.id}>{l.nombre}</option>)}</Select></Card>
    <Card style={{ marginBottom:14 }}><h3 style={{ margin:"0 0 12px",fontSize:15,fontWeight:500 }}>Parámetros generales</h3><div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12 }}><div><label style={{ fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Hora de apertura</label><Input type="time" value={config.horaApertura} onChange={v=>setConfig(c=>({...c,horaApertura:v}))}/></div><div><label style={{ fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Hora de cierre</label><Input type="time" value={config.horaCierre} onChange={v=>setConfig(c=>({...c,horaCierre:v}))}/></div><div><label style={{ fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Minutos de apertura</label><Input type="number" value={config.minutosApertura} onChange={v=>setConfig(c=>({...c,minutosApertura:v}))}/></div><div><label style={{ fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4 }}>Minutos de cierre</label><Input type="number" value={config.minutosCierre} onChange={v=>setConfig(c=>({...c,minutosCierre:v}))}/></div></div></Card>
    <Card style={{ padding:0,overflow:"hidden" }}><div style={{ padding:"12px 14px",borderBottom:"1px solid rgba(120,120,120,0.18)" }}><h3 style={{ margin:0,fontSize:15,fontWeight:500 }}>Reglas por día</h3><p style={{ margin:"3px 0 0",fontSize:12,color:"var(--color-text-secondary)" }}>Estos valores alimentan el reporte de cobertura del local seleccionado.</p></div><div style={{ overflowX:"auto" }}><div style={{ minWidth:760 }}><div style={{ display:"grid",gridTemplateColumns:"110px 130px repeat(4,1fr)",gap:8,padding:"8px 12px",fontSize:11,fontWeight:500,color:"var(--color-text-secondary)",borderBottom:"1px solid rgba(120,120,120,0.14)" }}>{["Día","Afluencia","Mín. día","Máx. día","Mín. apertura","Mín. cierre"].map(h=><span key={h}>{h}</span>)}</div>{reglas.map(r=><div key={r.diaSemana} style={{ display:"grid",gridTemplateColumns:"110px 130px repeat(4,1fr)",gap:8,padding:"8px 12px",alignItems:"center",borderBottom:"1px solid rgba(120,120,120,0.10)" }}><strong style={{ fontSize:13 }}>{DIAS_SEMANA[r.diaSemana-1]}</strong><Select value={r.afluencia} onChange={v=>setRegla(r.diaSemana,"afluencia",v)}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option></Select>{[["minimoDiario"],["maximoDiario"],["minimoApertura"],["minimoCierre"]].map(([campo])=><Input key={campo} type="number" value={r[campo]} onChange={v=>setRegla(r.diaSemana,campo,v)}/>)}</div>)}</div></div></Card>
  </div>;
}

// ── ABM ENCARGADAS ────────────────────────────────────────────────
function ABMEncargadas({ data, reloadData }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const encargadas = data.users.filter(u => u.rol === "encargada");
  const localesDe = (uid) => (data.encargadoLocales||[]).filter(x=>x.userId===uid).map(x=>x.localId);
  const openNew = () => { setForm({ nombre:"",usuario:"",email:"",password:"",password2:"",localIds:[] }); setFormErr(""); setModal("new"); };
  const openEdit = u => { setForm({...u,password:"",password2:"",localIds:localesDe(u.id)}); setFormErr(""); setModal("edit"); };
  const toggleLocal = (id) => setForm(f => ({ ...f, localIds:(f.localIds||[]).includes(id) ? (f.localIds||[]).filter(x=>x!==id) : [...(f.localIds||[]), id] }));
  const save = async () => {
    setFormErr("");
    if (!form.nombre?.trim() || !form.usuario?.trim()) { setFormErr("Nombre y usuario son obligatorios."); return; }
    if (!(form.localIds||[]).length) { setFormErr("Asigná al menos un local."); return; }
    if (modal === "new") {
      if (!form.password) { setFormErr("Ingresá una contraseña."); return; }
      if (form.password !== form.password2) { setFormErr("Las contraseñas no coinciden."); return; }
    } else if (form.password && form.password !== form.password2) { setFormErr("Las contraseñas no coinciden."); return; }
    setSaving(true);
    try {
      let userId = form.id;
      if (modal === "new") {
        const created = await api.createUser({ nombre:form.nombre.trim(), usuario:form.usuario.trim(), email:form.email?.trim()||"", password:form.password, rol:"encargada", local_id:null, activo:true });
        userId = created?.[0]?.id;
      } else {
        const upd = { nombre:form.nombre.trim(), usuario:form.usuario.trim(), email:form.email?.trim()||"" };
        if (form.password) upd.password = form.password;
        await api.updateUser(form.id, upd);
      }
      await api.setEncargadoLocales(userId, form.localIds);
      await reloadData(); setModal(null);
    } catch(e) { setFormErr("Error al guardar: "+e.message); }
    setSaving(false);
  };
  const toggle = async (u) => { await api.updateUser(u.id,{activo:!u.activo}); await reloadData(); };
  return <div>
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}><h2 style={{ margin:0,fontSize:18,fontWeight:500 }}>Encargadas</h2><Btn onClick={openNew} size="sm">+ Nueva</Btn></div>
    <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
      {encargadas.map(e=>{ const locs=localesDe(e.id).map(id=>data.locales.find(l=>l.id===id)?.nombre).filter(Boolean).join(", "); return <Card key={e.id} style={{ display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}><Avatar nombre={e.nombre}/><div style={{ flex:1,minWidth:0 }}><p style={{ margin:0,fontWeight:500,fontSize:14 }}>{e.nombre}</p><p style={{ margin:0,fontSize:12,color:"var(--color-text-secondary)" }}>{e.usuario} · {e.email||"Sin mail"} · {locs||"Sin locales"}</p></div><Badge color={e.activo?"success":"gray"}>{e.activo?"Activa":"Inactiva"}</Badge><Btn onClick={()=>openEdit(e)} variant="ghost" size="sm">Editar</Btn><Btn onClick={()=>toggle(e)} variant="ghost" size="sm" style={{ color:e.activo?COLORS.danger:COLORS.success }}>{e.activo?"Desactivar":"Activar"}</Btn></Card>; })}
    </div>
    {modal && <Modal title={modal==="new"?"Nueva encargada":"Editar encargada"} onClose={()=>setModal(null)}>
      <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
        <ModalInput label="Nombre completo" value={form.nombre||""} onChange={v=>setForm(f=>({...f,nombre:v}))}/>
        <ModalInput label="Usuario" value={form.usuario||""} onChange={v=>setForm(f=>({...f,usuario:v}))}/>
        <ModalInput label="Email" type="email" value={form.email||""} onChange={v=>setForm(f=>({...f,email:v}))}/>
        <div style={{ borderTop:"1px dashed #eee",paddingTop:14 }}><p style={{ margin:"0 0 10px",fontSize:13,color:"#888" }}>{modal==="edit"?"Dejá en blanco para no cambiar la contraseña":"Contraseña"}</p><div style={{ display:"flex",flexDirection:"column",gap:14 }}><ModalInput label={modal==="edit"?"Nueva contraseña":"Contraseña"} type="password" value={form.password||""} onChange={v=>setForm(f=>({...f,password:v}))}/><ModalInput label="Repetir contraseña" type="password" value={form.password2||""} onChange={v=>setForm(f=>({...f,password2:v}))}/></div></div>
        <div><label style={{ fontSize:13,fontWeight:500,color:"#555",display:"block",marginBottom:6 }}>Locales asignados</label><div style={{ display:"flex",flexDirection:"column",gap:6,maxHeight:150,overflowY:"auto",border:"1px solid #eee",borderRadius:8,padding:8 }}>{data.locales.map(l=><label key={l.id} style={{ display:"flex",gap:8,alignItems:"center",fontSize:14 }}><input type="checkbox" checked={(form.localIds||[]).includes(l.id)} onChange={()=>toggleLocal(l.id)}/>{l.nombre}</label>)}</div></div>
        {formErr && <p style={{ margin:0,fontSize:13,color:COLORS.danger,background:COLORS.dangerLight,padding:"8px 12px",borderRadius:8 }}>{formErr}</p>}
        <div style={{ display:"flex",gap:8,marginTop:4 }}><Btn onClick={save} disabled={saving} style={{ flex:1,justifyContent:"center" }}>{saving?"Guardando...":"Guardar"}</Btn><Btn onClick={()=>setModal(null)} variant="secondary" style={{ flex:1,justifyContent:"center" }}>Cancelar</Btn></div>
      </div>
    </Modal>}
  </div>;
}

// ── APP PRINCIPAL ──────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState(null);
  const [user, setUser] = useState(null);
  const [seccion, setSeccion] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDesktopMenu, setIsDesktopMenu] = useState(() => window.innerWidth >= 768);
  const [loading, setLoading] = useState(true);
  const [agendaRequest, setAgendaRequest] = useState(null);
  const [reportRestore, setReportRestore] = useState(null);

  const reloadData = useCallback(async () => {
    const [users, locales, horarios, asistencias, periodos, feriados, reglasCobertura, configCobertura, encargadoLocales] = await Promise.all([
      api.getUsers(), api.getLocales(), api.getHorarios(), api.getAsistencias(), api.getPeriodos(), api.getFeriados(), api.getReglasCobertura(), api.getConfigCobertura(), api.getEncargadoLocales()
    ]);
    setData({
      users: users.map(normalizeUser),
      locales,
      horarios: horarios.map(normalizeHorario),
      asistencias: asistencias.map(normalizeAsistencia),
      periodosBloqueados: periodos.map(normalizePeriodo),
      feriados,
      reglasCobertura: reglasCobertura.map(normalizeReglaCobertura),
      configCobertura: (configCobertura||[]).map(normalizeConfigCobertura),
      encargadoLocales: (encargadoLocales||[]).map(normalizeEncargadoLocal),
    });
  }, []);

  useEffect(()=>{ reloadData().then(()=>setLoading(false)).catch(()=>setLoading(false)); },[]);

  useEffect(() => {
    const onResize = () => setIsDesktopMenu(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (loading) return <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center" }}><p style={{ color:"var(--color-text-secondary)",fontSize:14 }}>Conectando con Supabase...</p></div>;
  if (!user) return <Login onLogin={u=>{ setUser(u); setSeccion(u.rol==="manicura"?"horarios":"asistencia"); }} reloadData={reloadData}/>;

  const navAdmin = [
    {id:"asistencia",label:"Asistencia",icon:"📋"},
    {id:"horarios",label:"Horarios",icon:"🗓️"},
    {id:"reportes",label:"Reportes",icon:"📊"},
    {id:"manicuras",label:"Manicuras",icon:"logo"},
    {id:"encargadas",label:"Encargadas",icon:"👩‍💼"},
    {id:"locales",label:"Locales",icon:"🏠"},
    {id:"cobertura_config",label:"Cobertura",icon:"⚙️"},
    {id:"perfil",label:"Mi perfil",icon:"👤"},
  ];
  const navEncargada = [
    {id:"asistencia",label:"Asistencia",icon:"📋"},
    {id:"horarios",label:"Horarios",icon:"🗓️"},
    {id:"reportes",label:"Reportes",icon:"📊"},
    {id:"manicuras",label:"Manicuras",icon:"logo"},
    {id:"cobertura_config",label:"Cobertura",icon:"⚙️"},
    {id:"perfil",label:"Mi perfil",icon:"👤"},
  ];
  const navManicura = [
    {id:"horarios",label:"Mis horarios",icon:"🗓️"},
    {id:"reportes",label:"Mis reportes",icon:"📊"},
    {id:"perfil",label:"Mi perfil",icon:"👤"},
  ];
  const nav = user.rol==="admin" ? navAdmin : user.rol==="encargada" ? navEncargada : navManicura;

  const renderSeccion = () => {
    if (seccion==="asistencia") return <AsistenciaDiaria data={data} reloadData={reloadData} user={user}/>;
    if (seccion==="horarios") return <CalendarioHorarios data={data} reloadData={reloadData} user={user} agendaRequest={agendaRequest} onBackToReport={()=>{ setSeccion("reportes"); setMenuOpen(false); }}/>;
    if (seccion==="reportes") return <Reportes data={data} user={user} reportRestore={reportRestore} onOpenAgenda={(req)=>{ const restore={ tab:"cobertura", fecha:req.fecha, localId:req.localId || "" }; setReportRestore(restore); setAgendaRequest({...req, fromReport:true}); setSeccion("horarios"); setMenuOpen(false); }}/>;
    if (seccion==="manicuras") return <ABMManicuras data={data} reloadData={reloadData} user={user}/>;
    if (seccion==="locales") return user.rol==="admin" ? <ABMLocales data={data} reloadData={reloadData}/> : null;
    if (seccion==="encargadas") return user.rol==="admin" ? <ABMEncargadas data={data} reloadData={reloadData}/> : null;
    if (seccion==="cobertura_config") return <ConfiguracionCobertura data={data} reloadData={reloadData} user={user}/>;
    if (seccion==="perfil") return <MiPerfil data={data} reloadData={reloadData} user={user} setUser={setUser}/>;
    return null;
  };

  return (
    <div style={{ minHeight:"100vh",background:"var(--color-background-tertiary)",display:"flex",flexDirection:"column" }}>
      <header style={{ background:COLORS.pink,color:"#fff",padding:"0 16px",height:66,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <LogoMark size={48} variant="light"/>
          <span style={{ fontWeight:600,fontSize:15,letterSpacing:"-0.02em" }}>Niki Beauty Bar</span>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:13,opacity:0.9 }}>{user.nombre}</span>
          <button onClick={()=>{ setUser(null); setMenuOpen(false); }} style={{ background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer" }}>Salir</button>
          {!isDesktopMenu && <button onClick={()=>setMenuOpen(m=>!m)} style={{ background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",borderRadius:6,padding:"6px 10px",fontSize:16,cursor:"pointer" }}>☰</button>}
        </div>
      </header>
      <div style={{ display:"flex",flex:1 }}>
        <nav style={{ width:isDesktopMenu?220:(menuOpen?"100%":0),maxWidth:isDesktopMenu?220:"100%",background:"var(--color-background-primary)",borderRight:isDesktopMenu||menuOpen?"0.5px solid rgba(120,120,120,0.18)":"none",overflowX:"hidden",transition:"width 0.2s",flexShrink:0,position:isDesktopMenu?"sticky":"fixed",top:66,left:0,bottom:isDesktopMenu?"auto":0,zIndex:isDesktopMenu?1:90,alignSelf:"flex-start",maxHeight:"calc(100vh - 66px)",overflowY:"auto",boxShadow:!isDesktopMenu&&menuOpen?"8px 0 24px rgba(0,0,0,0.12)":"none" }}>
          <div style={{ padding:"12px 8px",display:"flex",flexDirection:"column",gap:2,minWidth:200 }}>
            {nav.map(item=><button key={item.id} onClick={()=>{ setSeccion(item.id); if(!isDesktopMenu) setMenuOpen(false); if(item.id!=="horarios") setAgendaRequest(null); }} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,textAlign:"left",background:seccion===item.id?COLORS.pinkLight:"transparent",color:seccion===item.id?COLORS.pinkDark:"var(--color-text-primary)",fontWeight:seccion===item.id?500:400 }}><span>{item.icon === "logo" ? <LogoMark size={24} variant="soft"/> : item.icon}</span>{item.label}</button>)}
          </div>
        </nav>
        <main style={{ flex:1,padding:"20px 16px",maxWidth:1280,width:"100%",margin:"0 auto" }}>
          {renderSeccion()}
        </main>
      </div>
    </div>
  );
}
