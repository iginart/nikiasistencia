import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = (value: string) => {
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - s.length % 4) % 4);
  return atob(padded);
};
const encodePayload = (value: unknown) => {
  const bytes = enc.encode(JSON.stringify(value));
  return b64url(bytes);
};
async function hmac(body: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body))));
}
async function verifyExpiredAllowed(token: string, secret: string) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    if ((await hmac(body, secret)) !== sig) return null;
    const payload = JSON.parse(fromB64url(body));
    if (!payload?.uid || !payload?.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!secret) return json({ ok: false, error: "Falta configurar NIKI_SESSION_SECRET." }, 500);

    const body = await req.json().catch(() => ({}));
    const actorId = Number(body.actor_id || 0);
    const sessionToken = String(body.session_token || "");
    if (!actorId || !sessionToken) return json({ ok: false, error: "Datos de sesión incompletos." }, 400);

    const payload = await verifyExpiredAllowed(sessionToken, secret);
    if (!payload || Number(payload.uid) !== actorId) return json({ ok: false, error: "Sesión inválida." }, 401);

    const now = Math.floor(Date.now() / 1000);
    const graceSeconds = 30 * 24 * 60 * 60;
    if (Number(payload.exp) < now - graceSeconds) {
      return json({ ok: false, error: "La sesión venció. Iniciá sesión nuevamente." }, 401);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: actor } = await admin
      .from("users")
      .select("id,activo,password_actualizado_en")
      .eq("id", actorId)
      .maybeSingle();
    if (!actor?.activo) return json({ ok: false, error: "Usuario inválido o inactivo." }, 401);

    if (actor.password_actualizado_en && payload.iat) {
      const passwordChangedAt = Math.floor(new Date(actor.password_actualizado_en).getTime() / 1000);
      if (Number.isFinite(passwordChangedAt) && passwordChangedAt > Number(payload.iat)) {
        return json({ ok: false, error: "La sesión fue invalidada por un cambio de contraseña." }, 401);
      }
    }

    const ttlSeconds = 8 * 60 * 60;
    const nextPayload = { ...payload, uid: actorId, iat: now, exp: now + ttlSeconds };
    const encoded = encodePayload(nextPayload);
    const token = `${encoded}.${await hmac(encoded, secret)}`;
    return json({ ok: true, session_token: token, expires_at: nextPayload.exp });
  } catch (e) {
    console.error("renovar-sesion-niki", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "No se pudo renovar la sesión." }, 500);
  }
});
