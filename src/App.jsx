import { useState, useEffect, useMemo, useCallback } from "react";

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
  const { headers: extraHeaders, prefer, ...restOpts } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: extraHeaders?.Prefer || prefer || "return=representation",
      ...extraHeaders,
    },
    ...restOpts,
  });
  if (!res.ok) { const e = await res.text(); throw new Error(e); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const api = {
  // users
  getUsers: () => sb("users?select=*&order=id"),
  createUser: (d) => sb("users", { method: "POST", body: JSON.stringify(d) }),
  updateUser: (id, d) => sb(`users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),

  // locales
  getLocales: () => sb("locales?select=*&order=id"),
  createLocal: (d) => sb("locales", { method: "POST", body: JSON.stringify(d) }),
  updateLocal: (id, d) => sb(`locales?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteLocal: (id) => sb(`locales?id=eq.${id}`, { method: "DELETE", prefer: "" }),

  // horarios
  getHorarios: () => sb("horarios?select=*"),
  upsertHorario: (d) => sb("horarios", { method: "POST", body: JSON.stringify(d), headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),

  // asistencias
  getAsistencias: () => sb("asistencias?select=*"),
  upsertAsistencia: (d) => sb("asistencias", { method: "POST", body: JSON.stringify(d), headers: { Prefer: "resolution=merge-duplicates,return=representation" } }),
  deleteAsistencia: (userId, fecha) => sb(`asistencias?user_id=eq.${userId}&fecha=eq.${fecha}`, { method: "DELETE", prefer: "" }),

  // periodos
  getPeriodos: () => sb("periodos_bloqueados?select=*"),
  createPeriodo: (periodo) => sb("periodos_bloqueados", { method: "POST", body: JSON.stringify({ periodo }) }),
  deletePeriodo: (periodo) => sb(`periodos_bloqueados?periodo=eq.${periodo}`, { method: "DELETE", prefer: "" }),

  // reset tokens
  getTokens: () => sb("reset_tokens?select=*"),
  createToken: (d) => sb("reset_tokens", { method: "POST", body: JSON.stringify(d) }),
  deleteToken: (token) => sb(`reset_tokens?token=eq.${encodeURIComponent(token)}`, { method: "DELETE", prefer: "" }),
  deleteTokenByUser: (userId) => sb(`reset_tokens?user_id=eq.${userId}`, { method: "DELETE", prefer: "" }),
};

// Normaliza snake_case de Supabase a camelCase interno
function normalizeUser(u) {
  return { id: u.id, nombre: u.nombre, usuario: u.usuario, password: u.password, email: u.email || "", rol: u.rol, localId: u.local_id, activo: u.activo };
}
function normalizeHorario(h) {
  return { id: h.id, userId: h.user_id, fecha: h.fecha, entrada: h.entrada || "", salida: h.salida || "", trabaja: h.trabaja };
}
function normalizeAsistencia(a) {
  return { id: a.id, userId: a.user_id, fecha: a.fecha, estado: a.estado, entradaReal: a.entrada_real || "", salidaReal: a.salida_real || "", motivo: a.motivo || "", certificado: a.certificado, tipoDoc: a.tipo_doc || "" };
}

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

function getDiasDelMes(y, m) {
  const dias = [], d = new Date(y, m, 1);
  while (d.getMonth() === m) { if (d.getDay() !== 0) dias.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return dias;
}
function getSemanas(dias) {
  const s = []; let sem = [];
  dias.forEach((d, i) => { sem.push(d); if (d.getDay() === 6 || i === dias.length - 1) { s.push([...sem]); sem = []; } });
  if (sem.length) s.push(sem);
  return s;
}
function calcHoras(e, s) {
  if (!e || !s) return 0;
  const [eh, em] = e.split(":").map(Number), [sh, sm] = s.split(":").map(Number);
  const m = (sh * 60 + sm) - (eh * 60 + em); return m > 0 ? m / 60 : 0;
}
function fmtFecha(d) { return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`; }
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function genToken() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

// ── UI primitivos ──────────────────────────────────────────────────
function Avatar({ nombre, size = 36 }) {
  const i = nombre.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
  return <div style={{ width: size, height: size, borderRadius: "50%", background: COLORS.pinkLight, color: COLORS.pinkDark, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: size * 0.35, flexShrink: 0 }}>{i}</div>;
}
function Badge({ children, color = "pink" }) {
  const map = { pink: [COLORS.pinkLight, COLORS.pinkDark], success: [COLORS.successLight, COLORS.success], danger: [COLORS.dangerLight, COLORS.danger], amber: [COLORS.amberLight, COLORS.amber], info: [COLORS.infoLight, COLORS.info], gray: [COLORS.grayLight, "#444"] };
  const [bg, fg] = map[color] || map.pink;
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>{children}</span>;
}
function Card({ children, style }) { return <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "1rem 1.25rem", ...style }}>{children}</div>; }
function Btn({ children, onClick, variant = "primary", size = "md", disabled, style }) {
  const base = { border: "none", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.5 : 1, ...style };
  const v = {
    primary: { background: COLORS.pink, color: "#fff", padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 },
    secondary: { background: COLORS.pinkLight, color: COLORS.pinkDark, padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 },
    ghost: { background: "transparent", color: COLORS.pink, padding: size === "sm" ? "5px 8px" : "8px 12px", fontSize: size === "sm" ? 13 : 14 },
    danger: { background: COLORS.dangerLight, color: COLORS.danger, padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 },
    success: { background: COLORS.successLight, color: COLORS.success, padding: size === "sm" ? "5px 12px" : "8px 18px", fontSize: size === "sm" ? 13 : 14 },
  };
  return <button style={{ ...base, ...v[variant] }} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Input({ value, onChange, type = "text", placeholder, style }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 12px", fontSize: 14, width: "100%", background: "var(--color-background-primary)", color: "var(--color-text-primary)", boxSizing: "border-box", ...style }} />;
}
function Select({ value, onChange, children, style }) {
  return <select value={value} onChange={e => onChange(e.target.value)}
    style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "8px 12px", fontSize: 14, width: "100%", background: "var(--color-background-primary)", color: "var(--color-text-primary)", ...style }}>
    {children}
  </select>;
}
function Modal({ title, children, onClose, width = 480 }) {
  useEffect(() => { const p = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = p; }; }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "1.5rem", width: "100%", maxWidth: width, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#1a1a1a" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "#f5f5f5", border: "none", cursor: "pointer", fontSize: 18, color: "#666", width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ModalInput({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label style={{ fontSize: 13, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "9px 12px", fontSize: 14, background: "#fafafa", color: "#1a1a1a", outline: "none", boxSizing: "border-box" }}
        onFocus={e => e.target.style.borderColor = COLORS.pink} onBlur={e => e.target.style.borderColor = "#e0e0e0"} />
    </div>
  );
}
function ModalSelect({ label, value, onChange, children }) {
  return (
    <div>
      <label style={{ fontSize: 13, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "9px 12px", fontSize: 14, background: "#fafafa", color: "#1a1a1a", outline: "none", boxSizing: "border-box" }}>
        {children}
      </select>
    </div>
  );
}

// ── LOGIN ──────────────────────────────────────────────────────────
function Login({ onLogin, reloadData }) {
  const [u, setU] = useState(""), [p, setP] = useState(""), [err, setErr] = useState("");
  const [vista, setVista] = useState("login");
  const [email, setEmail] = useState(""), [token, setToken] = useState("");
  const [nueva, setNueva] = useState(""), [nueva2, setNueva2] = useState("");
  const [msg, setMsg] = useState(""), [tokenValido, setTokenValido] = useState(null);
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
      } else {
        setMsg("Si el mail existe, vas a recibir las instrucciones.");
      }
    } catch { setMsg("Error al procesar. Intentá de nuevo."); }
    setLoading(false);
  };

  const handleVerificarToken = async () => {
    setLoading(true); setMsg("");
    try {
      const tokens = await api.getTokens();
      const tk = tokens.find(t => t.token === token.trim() && t.expiry > Date.now());
      if (tk) { setTokenValido(tk); setVista("nueva"); }
      else setMsg("Token inválido o vencido.");
    } catch { setMsg("Error al verificar. Intentá de nuevo."); }
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
    } catch { setMsg("Error al guardar. Intentá de nuevo."); }
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
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>Ingresá tu mail y te enviamos un token para restablecer tu contraseña.</p>
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
  const [modal, setModal] = useState(null), [form, setForm] = useState({}), [formErr, setFormErr] = useState(""), [saving, setSaving] = useState(false);
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

  const toggle = async (u) => {
    await api.updateUser(u.id, { activo: !u.activo });
    await reloadData();
  };

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
  const [modal, setModal] = useState(null), [form, setForm] = useState({}), [saving, setSaving] = useState(false);
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
  const [err, setErr] = useState(""), [ok, setOk] = useState(false), [saving, setSaving] = useState(false);
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

// ── CARGA HORARIOS ─────────────────────────────────────────────────
function CargaHorarios({ data, reloadData, user }) {
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() === 11 ? 0 : hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getMonth() === 11 ? hoy.getFullYear() + 1 : hoy.getFullYear());
  const periodoKey = `${anio}-${String(mes + 1).padStart(2, "0")}`;
  const bloqueado = data.periodosBloqueados.includes(periodoKey);
  const dias = useMemo(() => getDiasDelMes(anio, mes), [anio, mes]);
  const semanas = useMemo(() => getSemanas(dias), [dias]);
  // Estado local para edición sin pisar mientras se escribe
  const [localH, setLocalH] = useState({});

  const getH = dk => {
    if (localH[dk]) return localH[dk];
    return data.horarios.find(h => h.userId === user.id && h.fecha === dk) || { entrada: "", salida: "", trabaja: true };
  };

  // Actualiza solo el estado local mientras escribe
  const onChangeH = (dk, campo, val) => {
    if (bloqueado) return;
    setLocalH(prev => ({ ...prev, [dk]: { ...getH(dk), [campo]: val } }));
  };

  // Guarda en Supabase al salir del campo
  const onBlurH = async (dk) => {
    if (bloqueado) return;
    const h = localH[dk] || getH(dk);
    await api.upsertHorario({ user_id: user.id, fecha: dk, entrada: h.entrada, salida: h.salida, trabaja: h.trabaja });
    await reloadData();
    setLocalH(prev => { const n = { ...prev }; delete n[dk]; return n; });
  };

  // Para el botón Libre/Agregar (acción inmediata)
  const toggleTrabaja = async (dk) => {
    if (bloqueado) return;
    const h = getH(dk);
    const nuevo = !h.trabaja;
    setLocalH(prev => ({ ...prev, [dk]: { ...h, trabaja: nuevo } }));
    await api.upsertHorario({ user_id: user.id, fecha: dk, entrada: h.entrada, salida: h.salida, trabaja: nuevo });
    await reloadData();
    setLocalH(prev => { const n = { ...prev }; delete n[dk]; return n; });
  };

  const horasSemana = s => s.reduce((a, d) => { const h = getH(dateKey(d)); return a + (h.trabaja ? calcHoras(h.entrada, h.salida) : 0); }, 0);
  const horasTotal = dias.reduce((a, d) => { const h = getH(dateKey(d)); return a + (h.trabaja ? calcHoras(h.entrada, h.salida) : 0); }, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Mis horarios</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Select value={mes} onChange={v => setMes(parseInt(v))} style={{ width: 130 }}>{MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}</Select>
          <Select value={anio} onChange={v => setAnio(parseInt(v))} style={{ width: 90 }}>{[hoy.getFullYear(), hoy.getFullYear() + 1].map(a => <option key={a} value={a}>{a}</option>)}</Select>
        </div>
      </div>
      {bloqueado && <div style={{ background: COLORS.amberLight, color: COLORS.amber, padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>⚠️ Este período está bloqueado.</div>}
      <Card style={{ marginBottom: 16, padding: "0.75rem 1rem" }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>Horas totales del mes</p>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{horasTotal.toFixed(1)}h</p>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {semanas.map((semana, si) => {
          const hs = horasSemana(semana);
          return (
            <Card key={si}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>Semana {si + 1} — {fmtFecha(semana[0])} al {fmtFecha(semana[semana.length - 1])}</p>
                <Badge color={hs > 0 ? "success" : "gray"}>{hs.toFixed(1)}h</Badge>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {semana.map(d => {
                  const dk = dateKey(d), h = getH(dk);
                  const dow = d.getDay(), nomDia = DIAS_SEMANA[dow === 0 ? 6 : dow - 1];
                  return (
                    <div key={dk} style={{ display: "grid", gridTemplateColumns: "50px 1fr auto", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 500 }}>{nomDia} {d.getDate()}</span>
                      {h.trabaja ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <input type="time" value={h.entrada || ""} disabled={bloqueado}
                            onChange={e => onChangeH(dk, "entrada", e.target.value)}
                            onBlur={() => onBlurH(dk)}
                            style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 8px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
                          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>a</span>
                          <input type="time" value={h.salida || ""} disabled={bloqueado}
                            onChange={e => onChangeH(dk, "salida", e.target.value)}
                            onBlur={() => onBlurH(dk)}
                            style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 8px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
                          {calcHoras(h.entrada, h.salida) > 0 && <span style={{ fontSize: 12, color: COLORS.success, fontWeight: 500 }}>{calcHoras(h.entrada, h.salida).toFixed(1)}h</span>}
                        </div>
                      ) : <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No trabajo</span>}
                      {!bloqueado && <button onClick={() => toggleTrabaja(dk)} style={{ background: h.trabaja ? COLORS.pinkLight : COLORS.grayLight, color: h.trabaja ? COLORS.pinkDark : "#666", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>{h.trabaja ? "Libre" : "+ Agregar"}</button>}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── GESTIÓN HORARIOS (ADMIN) ───────────────────────────────────────
function GestionHorarios({ data, reloadData }) {
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth()), [anio, setAnio] = useState(hoy.getFullYear());
  const [manicuraId, setManicuraId] = useState(data.users.filter(u => u.rol === "manicura")[0]?.id || null);
  const periodoKey = `${anio}-${String(mes + 1).padStart(2, "0")}`;
  const bloqueado = data.periodosBloqueados.includes(periodoKey);

  const toggleBloqueo = async () => {
    if (bloqueado) await api.deletePeriodo(periodoKey);
    else await api.createPeriodo(periodoKey);
    await reloadData();
  };

  const dias = useMemo(() => getDiasDelMes(anio, mes), [anio, mes]);
  const semanas = useMemo(() => getSemanas(dias), [dias]);

  const [localH, setLocalH] = useState({});

  const getH = dk => {
    if (localH[dk]) return localH[dk];
    return data.horarios.find(h => h.userId === parseInt(manicuraId) && h.fecha === dk) || { entrada: "", salida: "", trabaja: true };
  };

  const onChangeH = (dk, campo, val) => {
    setLocalH(prev => ({ ...prev, [dk]: { ...getH(dk), [campo]: val } }));
  };

  const onBlurH = async (dk) => {
    const uid = parseInt(manicuraId);
    const h = localH[dk] || getH(dk);
    await api.upsertHorario({ user_id: uid, fecha: dk, entrada: h.entrada, salida: h.salida, trabaja: h.trabaja });
    await reloadData();
    setLocalH(prev => { const n = { ...prev }; delete n[dk]; return n; });
  };

  const toggleTrabaja = async (dk) => {
    const uid = parseInt(manicuraId);
    const h = getH(dk);
    const nuevo = !h.trabaja;
    setLocalH(prev => ({ ...prev, [dk]: { ...h, trabaja: nuevo } }));
    await api.upsertHorario({ user_id: uid, fecha: dk, entrada: h.entrada, salida: h.salida, trabaja: nuevo });
    await reloadData();
    setLocalH(prev => { const n = { ...prev }; delete n[dk]; return n; });
  };

  const manicuras = data.users.filter(u => u.rol === "manicura" && u.activo);
  const manicuraActual = manicuras.find(m => m.id === parseInt(manicuraId));
  const horasTotal = dias.reduce((a, d) => { const h = getH(dateKey(d)); return a + (h.trabaja ? calcHoras(h.entrada, h.salida) : 0); }, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Gestión de horarios</h2>
        <Btn onClick={toggleBloqueo} variant={bloqueado ? "success" : "danger"} size="sm">{bloqueado ? "🔓 Habilitar" : "🔒 Bloquear"} período</Btn>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Select value={manicuraId || ""} onChange={v => setManicuraId(v)} style={{ flex: 1, minWidth: 160 }}>{manicuras.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</Select>
        <Select value={mes} onChange={v => setMes(parseInt(v))} style={{ width: 130 }}>{MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}</Select>
        <Select value={anio} onChange={v => setAnio(parseInt(v))} style={{ width: 90 }}>{[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map(a => <option key={a} value={a}>{a}</option>)}</Select>
      </div>
      {bloqueado && <div style={{ background: COLORS.amberLight, color: COLORS.amber, padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>🔒 Período bloqueado. Las manicuras no pueden editar.</div>}
      <Card style={{ marginBottom: 16, padding: "0.75rem 1rem" }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>Total horas — {manicuraActual?.nombre}</p>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>{horasTotal.toFixed(1)}h</p>
      </Card>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {semanas.map((semana, si) => {
          const hs = semana.reduce((a, d) => { const h = getH(dateKey(d)); return a + (h.trabaja ? calcHoras(h.entrada, h.salida) : 0); }, 0);
          return (
            <Card key={si}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>Semana {si + 1}</p>
                <Badge color={hs > 0 ? "success" : "gray"}>{hs.toFixed(1)}h</Badge>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {semana.map(d => {
                  const dk = dateKey(d), h = getH(dk);
                  const dow = d.getDay(), nomDia = DIAS_SEMANA[dow === 0 ? 6 : dow - 1];
                  return (
                    <div key={dk} style={{ display: "grid", gridTemplateColumns: "50px 1fr auto", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 500 }}>{nomDia} {d.getDate()}</span>
                      {h.trabaja ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <input type="time" value={h.entrada || ""}
                            onChange={e => onChangeH(dk, "entrada", e.target.value)}
                            onBlur={() => onBlurH(dk)}
                            style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 8px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
                          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>a</span>
                          <input type="time" value={h.salida || ""}
                            onChange={e => onChangeH(dk, "salida", e.target.value)}
                            onBlur={() => onBlurH(dk)}
                            style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 6, padding: "4px 8px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
                          {calcHoras(h.entrada, h.salida) > 0 && <span style={{ fontSize: 12, color: COLORS.success, fontWeight: 500 }}>{calcHoras(h.entrada, h.salida).toFixed(1)}h</span>}
                        </div>
                      ) : <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No trabaja</span>}
                      <button onClick={() => toggleTrabaja(dk)} style={{ background: h.trabaja ? COLORS.pinkLight : COLORS.grayLight, color: h.trabaja ? COLORS.pinkDark : "#666", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>{h.trabaja ? "Libre" : "+ Agregar"}</button>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── ASISTENCIA DIARIA ──────────────────────────────────────────────
function AsistenciaDiaria({ data, reloadData }) {
  const hoy = new Date();
  const [fecha, setFecha] = useState(dateKey(hoy));
  const [modal, setModal] = useState(null);
  const [formAus, setFormAus] = useState({}), [formTarde, setFormTarde] = useState({});

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
        </div>
      }
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
  const [mes, setMes] = useState(hoy.getMonth()), [anio, setAnio] = useState(hoy.getFullYear());
  const [filtroSemana, setFiltroSemana] = useState("todas");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [fechaDesde, setFechaDesde] = useState(dateKey(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [fechaHasta, setFechaHasta] = useState(dateKey(hoy));
  const [expandidos, setExpandidos] = useState({});

  const manicuras = data.users.filter(u => u.rol === "manicura" && u.activo);
  const semanasDelMes = useMemo(() => getSemanas(getDiasDelMes(anio, mes)), [anio, mes]);

  const filtrarM = () => {
    let base = esAdmin
      ? (filtroTipo === "manicura" ? manicuras.filter(m => m.id === parseInt(filtroId))
        : filtroTipo === "local" ? manicuras.filter(m => m.localId === parseInt(filtroId))
        : manicuras)
      : [data.users.find(u => u.id === user.id)].filter(Boolean);
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
        if (trabaja && a) {
          if (a.estado === "presente") horasReal = horasTeo;
          else if (a.estado === "tarde") horasReal = calcHoras(a.entradaReal || h.entrada, a.salidaReal || h.salida);
        }
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
      <div style={{ display: "flex", gap: 4, background: "var(--color-background-secondary)", padding: 4, borderRadius: 10, marginBottom: 20, width: "fit-content" }}>
        <TabBtn id="horas" label="Horas teóricas" /><TabBtn id="asistencia" label="Asistencia" />
      </div>
      {esAdmin && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <Select value={filtroTipo} onChange={v => { setFiltroTipo(v); setExpandidos({}); }} style={{ width: 130 }}>
            <option value="manicura">Manicura</option><option value="local">Local</option><option value="todas">Todas</option>
          </Select>
          {filtroTipo === "manicura" && <Select value={filtroId} onChange={v => { setFiltroId(v); setExpandidos({}); }} style={{ flex: 1, minWidth: 160 }}>{manicuras.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</Select>}
          {filtroTipo === "local" && <Select value={filtroId} onChange={v => { setFiltroId(v); setExpandidos({}); }} style={{ flex: 1, minWidth: 160 }}>{data.locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Select>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Select value={filtroSemana} onChange={v => { setFiltroSemana(v); setExpandidos({}); }} style={{ width: 150 }}>
          <option value="todas">Todas las semanas</option>
          {semanasDelMes.map((_, i) => <option key={i + 1} value={i + 1}>Semana {i + 1}</option>)}
        </Select>
        <Select value={filtroEstado} onChange={v => { setFiltroEstado(v); setExpandidos({}); }} style={{ width: 160 }}>
          <option value="todos">Todos los estados</option>
          <option value="ausente">Solo ausencias</option>
          <option value="tarde">Solo llegadas tarde</option>
        </Select>
        {(filtroSemana !== "todas" || filtroEstado !== "todos") && <button onClick={() => { setFiltroSemana("todas"); setFiltroEstado("todos"); setExpandidos({}); }} style={{ background: COLORS.amberLight, color: COLORS.amber, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>✕ Limpiar filtros</button>}
      </div>
      {filtroEstado !== "todos" && <div style={{ background: COLORS.infoLight, color: COLORS.info, padding: "8px 12px", borderRadius: 8, marginBottom: 12, fontSize: 13 }}>Mostrando solo <strong>{filtroEstado === "ausente" ? "ausencias" : "llegadas tarde"}</strong> en el período.</div>}

      {tab === "horas" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <Select value={mes} onChange={v => { setMes(parseInt(v)); setExpandidos({}); }} style={{ width: 130 }}>{MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}</Select>
            <Select value={anio} onChange={v => { setAnio(parseInt(v)); setExpandidos({}); }} style={{ width: 90 }}>{[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map(a => <option key={a} value={a}>{a}</option>)}</Select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mF.map(m => {
              const r = buildHorasReport(m), exp = expandidos[m.id];
              return (
                <Card key={m.id} style={{ padding: "0.875rem 1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <Avatar nombre={r.nombre} />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{r.nombre}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{data.locales.find(l => l.id === r.localId)?.nombre || "Sin local"} · {r.diasTrabajo} días</p>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginRight: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div style={{ textAlign: "right" }}><p style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{r.totalMesTeo.toFixed(1)}h</p><p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>teóricas</p></div>
                      <div style={{ textAlign: "right" }}><p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: r.totalMesReal < r.totalMesTeo ? COLORS.danger : COLORS.success }}>{r.totalMesReal.toFixed(1)}h</p><p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>reales</p></div>
                    </div>
                    <button onClick={() => toggleExp(m.id)} style={{ background: COLORS.pinkLight, color: COLORS.pinkDark, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{exp ? "▲ Ocultar" : "▼ Ver detalle"}</button>
                  </div>
                  {exp && (
                    <div style={{ marginTop: 14, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
                      {r.semanasData.map(sem => (
                        <div key={sem.semana} style={{ marginBottom: 14 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Semana {sem.semana}</span>
                            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Teo: <strong>{sem.totalTeo.toFixed(1)}h</strong></span>
                              <span style={{ fontSize: 12, color: sem.totalReal < sem.totalTeo ? COLORS.danger : COLORS.success }}>Real: <strong>{sem.totalReal.toFixed(1)}h</strong></span>
                              {sem.totalTeo > 0 && <Badge color={sem.totalReal < sem.totalTeo ? "danger" : "success"}>{sem.totalReal >= sem.totalTeo ? "✓" : "-" + (sem.totalTeo - sem.totalReal).toFixed(1) + "h"}</Badge>}
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {sem.dias.map(d => (
                              <div key={d.fecha} style={{ display: "grid", gridTemplateColumns: "60px 1fr 50px 50px 60px", gap: 8, alignItems: "center", padding: "5px 8px", borderRadius: 6, background: d.trabaja ? "var(--color-background-secondary)" : "transparent", opacity: d.trabaja ? 1 : 0.45 }}>
                                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>{d.label}</span>
                                <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{d.trabaja ? `${d.entrada} – ${d.salida}` : "—"}</span>
                                <span style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "right" }}>{d.trabaja ? `${d.horasTeo.toFixed(1)}h` : ""}</span>
                                <span style={{ fontSize: 12, textAlign: "right", color: d.trabaja ? (d.horasReal < d.horasTeo ? COLORS.danger : COLORS.success) : "var(--color-text-secondary)" }}>{d.trabaja ? (d.asistencia ? `${d.horasReal.toFixed(1)}h` : "—") : ""}</span>
                                {d.trabaja ? (d.asistencia ? <Badge color={estadoColor[d.asistencia.estado]}>{d.asistencia.estado === "presente" ? "✓" : d.asistencia.estado === "tarde" ? "Tarde" : "Ausente"}</Badge> : <Badge color="gray">Sin reg.</Badge>) : <Badge color="gray">Libre</Badge>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
            {mF.length === 0 && <Card><p style={{ margin: 0, textAlign: "center", color: "var(--color-text-secondary)" }}>Sin datos para los filtros seleccionados.</p></Card>}
          </div>
        </>
      )}

      {tab === "asistencia" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Desde</span>
            <input type="date" value={fechaDesde} onChange={e => { setFechaDesde(e.target.value); setExpandidos({}); }} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 12px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>hasta</span>
            <input type="date" value={fechaHasta} onChange={e => { setFechaHasta(e.target.value); setExpandidos({}); }} style={{ border: "0.5px solid var(--color-border-secondary)", borderRadius: 8, padding: "7px 12px", fontSize: 13, background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mF.map(m => {
              const r = buildAsistenciaReport(m), exp = expandidos[m.id];
              return (
                <Card key={m.id} style={{ padding: "0.875rem 1.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <Avatar nombre={r.nombre} />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{r.nombre}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{r.total} días registrados</p>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <Badge color="success">✓ {r.presentes}</Badge>
                      <Badge color="amber">⏰ {r.tardes}</Badge>
                      <Badge color="danger">✗ {r.ausentes}</Badge>
                      <span style={{ fontSize: 18, fontWeight: 500, color: r.pct >= 90 ? COLORS.success : r.pct >= 75 ? COLORS.amber : COLORS.danger, minWidth: 44, textAlign: "right" }}>{r.pct}%</span>
                    </div>
                    <button onClick={() => toggleExp(m.id)} style={{ background: COLORS.pinkLight, color: COLORS.pinkDark, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>{exp ? "▲ Ocultar" : "▼ Ver detalle"}</button>
                  </div>
                  {exp && (
                    <div style={{ marginTop: 14, borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
                      {r.asist.length === 0
                        ? <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center" }}>Sin registros en este período.</p>
                        : <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "80px 70px 1fr 1fr 80px", gap: 8, padding: "4px 8px" }}>
                            {["Fecha", "Estado", "H. teórico", "H. real", "Detalle"].map(h => <span key={h} style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</span>)}
                          </div>
                          {r.asist.map(a => {
                            const ht = data.horarios.find(h => h.userId === m.id && h.fecha === a.fecha);
                            const fmtD = (() => { const p = a.fecha.split("-"); return `${p[2]}/${p[1]}`; })();
                            return (
                              <div key={a.fecha} style={{ display: "grid", gridTemplateColumns: "80px 70px 1fr 1fr 80px", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, background: "var(--color-background-secondary)" }}>
                                <span style={{ fontSize: 13, fontWeight: 500 }}>{fmtD}</span>
                                <Badge color={estadoColor[a.estado]}>{estadoLabel[a.estado]}</Badge>
                                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{ht?.entrada && ht?.salida ? `${ht.entrada} – ${ht.salida}` : "—"}</span>
                                <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{a.estado === "tarde" ? `${a.entradaReal} – ${a.salidaReal}` : a.estado === "presente" ? "En horario" : "—"}</span>
                                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                                  {a.estado === "ausente" ? <span>{a.motivo}{a.certificado && <><br /><span style={{ fontSize: 11, color: COLORS.info }}>{a.tipoDoc || "Con cert."}</span></>}</span>
                                    : a.estado === "tarde" ? <span style={{ color: COLORS.amber }}>{(() => { const d = calcHoras(ht?.entrada || "", a.entradaReal || ""); return d > 0 ? `+${d.toFixed(1)}h` : ""; })()}</span> : ""}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      }
                    </div>
                  )}
                </Card>
              );
            })}
            {mF.length === 0 && <Card><p style={{ margin: 0, textAlign: "center", color: "var(--color-text-secondary)" }}>Sin datos para los filtros seleccionados.</p></Card>}
          </div>
        </>
      )}
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
    const [users, locales, horarios, asistencias, periodos] = await Promise.all([
      api.getUsers(), api.getLocales(), api.getHorarios(), api.getAsistencias(), api.getPeriodos()
    ]);
    setData({
      users: users.map(normalizeUser),
      locales,
      horarios: horarios.map(normalizeHorario),
      asistencias: asistencias.map(normalizeAsistencia),
      periodosBloqueados: periodos.map(p => p.periodo),
    });
  }, []);

  useEffect(() => {
    reloadData().then(() => setLoading(false)).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>Conectando con Supabase...</p></div>;

  if (!user) return <Login onLogin={u => { setUser(u); setSeccion(u.rol === "admin" ? "asistencia" : "horarios"); }} reloadData={reloadData} />;

  const navAdmin = [
    { id: "asistencia", label: "Asistencia", icon: "📋" },
    { id: "horarios_admin", label: "Horarios", icon: "🗓️" },
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
    if (seccion === "horarios_admin") return <GestionHorarios data={data} reloadData={reloadData} />;
    if (seccion === "reportes") return <Reportes data={data} user={user} />;
    if (seccion === "manicuras") return <ABMManicuras data={data} reloadData={reloadData} />;
    if (seccion === "locales") return <ABMLocales data={data} reloadData={reloadData} />;
    if (seccion === "horarios") return <CargaHorarios data={data} reloadData={reloadData} user={user} />;
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
