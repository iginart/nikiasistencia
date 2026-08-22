import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const sessionSecret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!sessionSecret) return json({ ok:false, error:"Falta configurar NIKI_SESSION_SECRET." },500);
    const form = await req.formData();
    const action = String(form.get("action") || "");
    const actorId = Number(form.get("actor_id") || 0);
    const sessionToken = String(form.get("session_token") || "");
    const candidataId = Number(form.get("candidata_id") || 0);
    const instanciaId = Number(form.get("instancia_id") || 0) || null;
    const tipo = String(form.get("tipo") || "otro");
    const path = String(form.get("path") || "");
    const expiresIn = Math.min(3600, Math.max(60, Number(form.get("expires_in") || 600)));

    if (!actorId || !sessionToken || !candidataId) throw new Error("Sesión o candidata inválida.");

    const sessionPayload = await verifySession(sessionToken, sessionSecret);
    if (!sessionPayload || Number(sessionPayload.uid) !== actorId) return json({ ok:false,error:"Sesión inválida o vencida." },401);

    const { data: actor, error: actorError } = await admin.from("users").select("id,rol,activo").eq("id", actorId).maybeSingle();
    if (actorError || !actor || !actor.activo) return json({ ok:false,error:"Sesión inválida o vencida." },401);
    if (!["admin","casa_matriz"].includes(actor.rol)) return json({ ok:false,error:"No tenés permiso para acceder a archivos de reclutamiento." },403);

    const { data: candidata } = await admin.from("reclutamiento_candidatas").select("id").eq("id",candidataId).maybeSingle();
    if (!candidata) return json({ ok:false,error:"La candidata no existe." },404);

    const canEditInstance = async (id:number) => {
      if (actor.rol === "admin") return true;
      const {data:assigned,error}=await admin.from("reclutamiento_instancia_evaluadores").select("instancia_id").eq("instancia_id",id).eq("user_id",actor.id).maybeSingle();
      if(error) throw error;
      return !!assigned;
    };
    if (action === "upload" && instanciaId && !(await canEditInstance(instanciaId))) {
      return json({ok:false,error:"Solo el evaluador asignado o Admin puede subir archivos a esta entrevista o prueba."},403);
    }
    if (action === "delete" && path) {
      const {data:fileRow}=await admin.from("reclutamiento_archivos").select("instancia_id").eq("storage_path",path).maybeSingle();
      if(fileRow?.instancia_id && !(await canEditInstance(Number(fileRow.instancia_id)))) {
        return json({ok:false,error:"Solo el evaluador asignado o Admin puede eliminar este archivo."},403);
      }
    }

    const prefix = `${candidataId}/`;
    if (action !== "upload" && (!path || !path.startsWith(prefix))) return json({ ok:false,error:"Ruta de archivo inválida." },400);

    if (action === "upload") {
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("No se recibió el archivo.");
      const allowed = ["image/jpeg","image/png","image/webp","application/pdf"];
      if (!allowed.includes(file.type)) throw new Error("Formato de archivo no permitido.");
      const max = file.type === "application/pdf" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
      if (file.size > max) throw new Error("El archivo supera el tamaño permitido.");
      const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_");
      const folder = tipo === "cv" ? "cv" : instanciaId ? `instancias/${instanciaId}` : "general";
      const storagePath = `${candidataId}/${folder}/${Date.now()}_${safe}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error } = await admin.storage.from("reclutamiento").upload(storagePath,bytes,{ contentType:file.type,upsert:false });
      if (error) throw error;
      return json({ ok:true,path:storagePath,name:file.name,size:file.size,mimeType:file.type });
    }
    if (action === "sign") {
      const { data,error } = await admin.storage.from("reclutamiento").createSignedUrl(path,expiresIn);
      if (error) throw error;
      return json({ ok:true,url:data.signedUrl });
    }
    if (action === "delete") {
      const { error } = await admin.storage.from("reclutamiento").remove([path]);
      if (error) throw error;
      return json({ ok:true });
    }
    return json({ ok:false,error:"Acción no válida." },400);
  } catch (error) {
    return json({ ok:false,error:error instanceof Error ? error.message : String(error) },400);
  }
});

function json(body: unknown,status=200) {
  return new Response(JSON.stringify(body),{ status,headers:{ ...cors,"Content-Type":"application/json" } });
}
