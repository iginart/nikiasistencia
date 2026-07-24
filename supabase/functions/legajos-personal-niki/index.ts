import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const form = await req.formData();
    const action = String(form.get("action") || "");
    const actorId = Number(form.get("actor_id") || 0);
    const sessionToken = String(form.get("session_token") || "");
    const targetUserId = Number(form.get("target_user_id") || 0);
    const path = String(form.get("path") || "");
    const expiresIn = Math.min(3600, Math.max(60, Number(form.get("expires_in") || 600)));

    if (!actorId || !sessionToken || !targetUserId) throw new Error("Sesión o persona inválida.");

    const { data: actor, error: actorError } = await admin
      .from("users")
      .select("id,rol,activo,session_token")
      .eq("id", actorId)
      .maybeSingle();
    if (actorError || !actor || !actor.activo || actor.session_token !== sessionToken) {
      return json({ ok:false, error:"Sesión inválida o vencida." }, 401);
    }

    const profileRead = action === "sign" && path.includes("/perfil/");
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
      const allowed = ["image/jpeg","image/png","image/webp","application/pdf"];
      if (!allowed.includes(file.type)) throw new Error("Formato de archivo no permitido.");
      const max = folder === "perfil" ? 500 * 1024 : file.type === "application/pdf" ? 2 * 1024 * 1024 : 1024 * 1024;
      if (file.size > max) throw new Error("El archivo supera el tamaño permitido.");
      const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${targetUserId}/${folder}/${Date.now()}_${safe}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error } = await admin.storage.from("legajos-personal").upload(storagePath, bytes, { contentType:file.type, upsert:false });
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
  return new Response(JSON.stringify(body), { status, headers:{ ...cors, "Content-Type":"application/json" } });
}
