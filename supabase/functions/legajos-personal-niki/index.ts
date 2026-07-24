import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function b64url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

async function hmacSha256(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(sig);
}

async function verifySession(token: string, secret: string) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;

  const expected = await hmacSha256(body, secret);
  if (expected !== sig) return null;

  try {
    const payload = JSON.parse(fromB64url(body));
    if (!payload?.uid || !payload?.exp) return null;
    if (Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok:false, error:"Método no permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sessionSecret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!sessionSecret) return json({ ok:false, error:"Falta configurar NIKI_SESSION_SECRET." }, 500);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const form = await req.formData();
    const action = String(form.get("action") || "");
    const actorId = Number(form.get("actor_id") || 0);
    const sessionToken = String(form.get("session_token") || "");
    const targetUserId = Number(form.get("target_user_id") || 0);
    const path = String(form.get("path") || "");
    const expiresIn = Math.min(3600, Math.max(60, Number(form.get("expires_in") || 600)));

    if (!actorId || !sessionToken || !targetUserId) {
      return json({ ok:false, error:"Sesión o persona inválida." }, 401);
    }

    const session = await verifySession(sessionToken, sessionSecret);
    if (!session || Number(session.uid) !== actorId) {
      return json({ ok:false, error:"Sesión inválida o vencida." }, 401);
    }

    const { data: actor, error: actorError } = await admin
      .from("users")
      .select("id,rol,activo")
      .eq("id", actorId)
      .maybeSingle();

    if (actorError || !actor || !actor.activo) {
      return json({ ok:false, error:"Usuario inválido o inactivo." }, 401);
    }

    const profileRead = action === "sign" && path.startsWith(`${targetUserId}/perfil/`);
    const canManage = actor.rol === "admin" || actor.rol === "casa_matriz" || actorId === targetUserId || profileRead;
    if (!canManage) return json({ ok:false, error:"No tenés permiso para acceder a este legajo." }, 403);

    const prefix = `${targetUserId}/`;
    if (action !== "upload" && (!path || !path.startsWith(prefix))) {
      return json({ ok:false, error:"Ruta de archivo inválida." }, 400);
    }

    if (action === "upload") {
      const file = form.get("file");
      const folder = path === "perfil" ? "perfil" : "documentos";
      if (!(file instanceof File)) throw new Error("No se recibió el archivo.");

      const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!allowed.includes(file.type)) throw new Error("Formato de archivo no permitido.");
      if (folder === "perfil" && file.type === "application/pdf") throw new Error("La foto de perfil debe ser una imagen.");

      const max = folder === "perfil"
        ? 500 * 1024
        : file.type === "application/pdf"
          ? 2 * 1024 * 1024
          : 1024 * 1024;
      if (file.size > max) throw new Error("El archivo supera el tamaño permitido.");

      const safe = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${targetUserId}/${folder}/${Date.now()}_${safe}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error } = await admin.storage
        .from("legajos-personal")
        .upload(storagePath, bytes, { contentType:file.type, upsert:false });
      if (error) throw error;
      return json({ ok:true, path:storagePath });
    }

    if (action === "sign") {
      const { data, error } = await admin.storage.from("legajos-personal").createSignedUrl(path, expiresIn);
      if (error) throw error;
      return json({ ok:true, url:data.signedUrl });
    }

    if (action === "delete") {
      const { error } = await admin.storage.from("legajos-personal").remove([path]);
      if (error) throw error;
      return json({ ok:true });
    }

    return json({ ok:false, error:"Acción no válida." }, 400);
  } catch (error) {
    return json({ ok:false, error:error instanceof Error ? error.message : String(error) }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{ ...cors, "Content-Type":"application/json" },
  });
}
