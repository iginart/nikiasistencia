import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
const fromB64url = (value: string) => {
  const s = value.replace(/-/g,"+").replace(/_/g,"/");
  const padded = s + "=".repeat((4 - s.length % 4) % 4);
  return atob(padded);
};
async function verifySession(token: string, secret: string) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
    if (b64url(expected) !== sig) return null;
    const payload = JSON.parse(fromB64url(body));
    if (!payload?.uid || !payload?.exp || Number(payload.exp) < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:cors });
  if (req.method !== "POST") return json({ ok:false, error:"Método no permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!secret) return json({ ok:false, error:"Falta configurar NIKI_SESSION_SECRET." }, 500);
    const admin = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const form = await req.formData();
    const action = String(form.get("action") || "");
    const actorId = Number(form.get("actor_id") || 0);
    const sessionToken = String(form.get("session_token") || "");
    const targetUserId = Number(form.get("target_user_id") || 0);
    const localId = Number(form.get("local_id") || 0);
    const fecha = String(form.get("fecha") || "").slice(0,10);
    const path = String(form.get("path") || "");
    const expiresIn = Math.min(3600, Math.max(60, Number(form.get("expires_in") || 600)));
    if (!actorId || !sessionToken || !targetUserId || !localId || !fecha) return json({ ok:false, error:"Datos incompletos." }, 400);

    const session = await verifySession(sessionToken, secret);
    if (!session || Number(session.uid) !== actorId) return json({ ok:false, error:"Sesión inválida o vencida." }, 401);

    const { data:actor } = await admin.from("users").select("id,rol,activo").eq("id",actorId).maybeSingle();
    if (!actor?.activo) return json({ ok:false, error:"Usuario inválido o inactivo." }, 401);
    const { data:target } = await admin.from("users").select("id,rol,activo").eq("id",targetUserId).maybeSingle();
    if (!target?.activo) return json({ ok:false, error:"La persona indicada no es válida o está inactiva." }, 400);
    const { data:encRel } = await admin.from("encargado_locales").select("local_id").eq("user_id",targetUserId).eq("local_id",localId).maybeSingle();
    const targetEsEncargadaOperativa = !!encRel;
    const targetEsManicura = target.rol === "manicura";
    if (!targetEsManicura && !targetEsEncargadaOperativa) return json({ ok:false, error:"La persona no está asignada operativamente a esta sucursal." }, 400);

    let allowed = actor.rol === "admin" || actorId === targetUserId;
    if (!allowed && actor.rol === "casa_matriz") {
      const { data:loc } = await admin.from("locales").select("id,tipo_local").eq("id",localId).maybeSingle();
      if (loc?.tipo_local === "propio") allowed = true;
      else {
        const { data:row } = await admin.from("usuario_locales").select("local_id").eq("user_id",actorId).eq("local_id",localId).maybeSingle();
        allowed = !!row;
      }
    }
    if (!allowed && actor.rol === "franquiciado") {
      const { data:row } = await admin.from("usuario_locales").select("local_id").eq("user_id",actorId).eq("local_id",localId).maybeSingle();
      allowed = !!row;
    }
    if (!allowed && actor.rol === "encargada") {
      const { data:row } = await admin.from("encargado_locales").select("local_id").eq("user_id",actorId).eq("local_id",localId).maybeSingle();
      allowed = !!row;
    }
    if (!allowed) return json({ ok:false, error:"No tenés permiso para acceder a documentación de esta sucursal." }, 403);

    const bucket = "legajos-personal";
    const prefix = `${targetUserId}/asistencias/${fecha}/`;
    if (action !== "upload" && (!path || !path.startsWith(prefix))) return json({ ok:false, error:"Ruta de archivo inválida." }, 400);

    if (action === "upload") {
      const file = form.get("file");
      if (!(file instanceof File)) return json({ ok:false, error:"No se recibió el archivo." }, 400);
      const allowedTypes = ["image/jpeg","image/png","image/webp","application/pdf"];
      if (!allowedTypes.includes(file.type)) return json({ ok:false, error:"Formato no permitido. Usá PDF, JPG, PNG o WebP." }, 400);
      const max = file.type === "application/pdf" ? 2*1024*1024 : 1024*1024;
      if (file.size > max) return json({ ok:false, error:"El archivo supera el tamaño permitido." }, 400);
      const safe = String(file.name || "documento").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_");
      const storagePath = `${prefix}${Date.now()}_${safe}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error } = await admin.storage.from(bucket).upload(storagePath, bytes, { contentType:file.type, upsert:false });
      if (error) throw error;
      return json({ ok:true, path:storagePath, name:file.name, type:file.type, size:file.size });
    }
    if (action === "sign") {
      const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresIn);
      if (error) throw error;
      return json({ ok:true, url:data?.signedUrl || "" });
    }
    if (action === "delete") {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw error;
      return json({ ok:true });
    }
    return json({ ok:false, error:"Acción inválida." }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok:false, error:e instanceof Error ? e.message : String(e) }, 500);
  }
});
