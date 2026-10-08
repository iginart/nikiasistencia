import { useEffect, useState } from "react";

export const PUBLIC_CLIENT_TRUST_DAYS = 365;
const SESSION_KEY = "niki_public_client_session_v1";
const normalizeText = (value) => String(value || "").trim();

function sessionIsTrusted(session) {
  if (!session?.refresh_token || !session?.verified_at) return false;
  const verifiedAt = new Date(session.verified_at).getTime();
  if (!Number.isFinite(verifiedAt)) return false;
  const maxAge = PUBLIC_CLIENT_TRUST_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - verifiedAt <= maxAge;
}

export function clearPublicClientSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function readPublicClientSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!sessionIsTrusted(session)) {
      clearPublicClientSession();
      return null;
    }
    return session;
  } catch {
    clearPublicClientSession();
    return null;
  }
}

function savePublicClientSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function parseResponse(res, fallback) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error_description || data?.msg || data?.message || data?.error || fallback);
  }
  return data;
}

async function authPost(supabaseUrl, supabaseKey, path, body) {
  const res = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(res, "No pudimos validar el email.");
}

export async function sendPublicEmailOtp({ supabaseUrl, supabaseKey, email }) {
  return authPost(supabaseUrl, supabaseKey, "otp", {
    email: normalizeText(email).toLowerCase(),
    create_user: true,
  });
}

export async function verifyPublicEmailOtp({ supabaseUrl, supabaseKey, email, token }) {
  const verified = await authPost(supabaseUrl, supabaseKey, "verify", {
    email: normalizeText(email).toLowerCase(),
    token: normalizeText(token),
    type: "email",
  });

  if (!verified?.access_token || !verified?.refresh_token) {
    throw new Error("El código fue aceptado pero no se pudo iniciar la sesión.");
  }

  const session = {
    access_token: verified.access_token,
    refresh_token: verified.refresh_token,
    user: verified.user || { email: normalizeText(email).toLowerCase() },
    verified_at: new Date().toISOString(),
  };
  savePublicClientSession(session);
  return session;
}

export async function refreshPublicClientSession({ supabaseUrl, supabaseKey }) {
  const stored = readPublicClientSession();
  if (!stored?.refresh_token) return null;

  try {
    const refreshed = await authPost(supabaseUrl, supabaseKey, "token?grant_type=refresh_token", {
      refresh_token: stored.refresh_token,
    });
    if (!refreshed?.access_token) {
      clearPublicClientSession();
      return null;
    }
    const next = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || stored.refresh_token,
      user: refreshed.user || stored.user || null,
      verified_at: stored.verified_at,
    };
    savePublicClientSession(next);
    return next;
  } catch {
    clearPublicClientSession();
    return null;
  }
}

export async function fetchPublicClientProfile({ supabaseUrl, supabaseKey, accessToken }) {
  const res = await fetch(`${supabaseUrl}/functions/v1/cliente-publico`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  return parseResponse(res, "No pudimos recuperar tus datos.");
}

export async function createPublicBooking({ supabaseUrl, supabaseKey, accessToken, payload }) {
  const res = await fetch(`${supabaseUrl}/functions/v1/crear-turno-publico`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return parseResponse(res, "No se pudo confirmar el turno.");
}

export async function fetchClientBookings({ supabaseUrl, supabaseKey, accessToken }) {
  const res = await fetch(`${supabaseUrl}/functions/v1/consultar-turnos-cliente`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  return parseResponse(res, "No pudimos consultar tus turnos.");
}

export default function PublicClientIdentity({ supabaseUrl, supabaseKey, onSessionChange }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const notify = (nextSession, nextProfile) => onSessionChange?.(nextSession || null, nextProfile || null);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      setLoading(true);
      setError("");
      try {
        const restored = await refreshPublicClientSession({ supabaseUrl, supabaseKey });
        if (cancelled) return;
        if (!restored) {
          setSession(null);
          setProfile(null);
          notify(null, null);
          return;
        }
        setSession(restored);
        setEmail(restored.user?.email || "");
        const nextProfile = await fetchPublicClientProfile({
          supabaseUrl,
          supabaseKey,
          accessToken: restored.access_token,
        });
        if (cancelled) return;
        setProfile(nextProfile);
        notify(restored, nextProfile);
      } catch (err) {
        clearPublicClientSession();
        if (!cancelled) {
          setSession(null);
          setProfile(null);
          notify(null, null);
          setError(err?.message || "No pudimos recuperar tu sesión.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => { cancelled = true; };
  }, [supabaseUrl, supabaseKey]);

  const sendCode = async () => {
    const normalizedEmail = normalizeText(email).toLowerCase();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Ingresá un email válido.");
      return;
    }
    setBusy(true);
    try {
      await sendPublicEmailOtp({ supabaseUrl, supabaseKey, email: normalizedEmail });
      setCode("");
      setCodeSent(true);
    } catch (err) {
      setError(err?.message || "No pudimos enviar el código.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError("");
    if (!normalizeText(code)) {
      setError("Ingresá el código que recibiste por email.");
      return;
    }
    setBusy(true);
    try {
      const nextSession = await verifyPublicEmailOtp({
        supabaseUrl,
        supabaseKey,
        email,
        token: code,
      });
      setSession(nextSession);
      setEmail(nextSession.user?.email || normalizeText(email).toLowerCase());
      setCode("");
      setCodeSent(false);
      const nextProfile = await fetchPublicClientProfile({
        supabaseUrl,
        supabaseKey,
        accessToken: nextSession.access_token,
      });
      setProfile(nextProfile);
      notify(nextSession, nextProfile);
    } catch (err) {
      setError(err?.message || "El código no es válido o venció.");
    } finally {
      setBusy(false);
    }
  };

  const useAnotherEmail = () => {
    clearPublicClientSession();
    setSession(null);
    setProfile(null);
    setEmail("");
    setCode("");
    setCodeSent(false);
    setError("");
    notify(null, null);
  };

  const inputStyle = {
    width: "100%",
    border: "1px solid rgba(114,36,62,0.18)",
    borderRadius: 8,
    padding: "13px 14px",
    fontSize: 15,
    boxSizing: "border-box",
  };
  const buttonStyle = {
    width: "100%",
    border: "none",
    borderRadius: 8,
    padding: "13px 16px",
    fontSize: 14,
    fontWeight: 800,
    cursor: busy ? "not-allowed" : "pointer",
  };

  if (loading) {
    return <div style={{ padding: 13, borderRadius: 8, background: "#fff7fa", color: "#735260", fontSize: 13 }}>Reconociendo este dispositivo...</div>;
  }

  if (session?.access_token) {
    return (
      <div style={{ padding: 13, borderRadius: 8, background: "#f8fff7", border: "1px solid rgba(72,150,88,0.24)" }}>
        <strong style={{ display: "block", color: "#2f6b3d", fontSize: 13 }}>Email verificado</strong>
        <span style={{ display: "block", marginTop: 4, color: "#55705c", fontSize: 13 }}>
          {profile?.email || session.user?.email || email}
        </span>
        <button type="button" onClick={useAnotherEmail} style={{ ...buttonStyle, marginTop: 10, background: "#fff", color: "#72243e", border: "1px solid rgba(114,36,62,0.16)" }}>
          Usar otro email
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10, padding: 13, borderRadius: 8, background: "#fff7fa", border: "1px solid rgba(114,36,62,0.10)" }}>
      <label style={{ display: "grid", gap: 7, color: "#5f3a49", fontSize: 13, fontWeight: 700 }}>
        Email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@email.com" style={inputStyle} />
      </label>

      {!codeSent ? (
        <button type="button" onClick={sendCode} disabled={busy} style={{ ...buttonStyle, background: "#d4537e", color: "#fff", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Enviando..." : "Enviar código"}
        </button>
      ) : (
        <>
          <label style={{ display: "grid", gap: 7, color: "#5f3a49", fontSize: 13, fontWeight: 700 }}>
            Código recibido por email
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" style={inputStyle} />
          </label>
          <button type="button" onClick={verifyCode} disabled={busy} style={{ ...buttonStyle, background: "#d4537e", color: "#fff", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Verificando..." : "Verificar email"}
          </button>
          <button type="button" onClick={sendCode} disabled={busy} style={{ ...buttonStyle, background: "#fff", color: "#72243e", border: "1px solid rgba(114,36,62,0.16)" }}>
            Reenviar código
          </button>
        </>
      )}

      {error && <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fff0f3", border: "1px solid rgba(212,83,126,0.28)", color: "#72243e", fontSize: 13 }}>{error}</div>}

      <p style={{ margin: 0, color: "#8a6875", fontSize: 12, lineHeight: 1.45 }}>
        Te pediremos el código la primera vez en este dispositivo y, como máximo, después de {PUBLIC_CLIENT_TRUST_DAYS} días o si la sesión deja de ser válida.
      </p>
    </div>
  );
}
