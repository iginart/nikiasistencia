import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function b64urlToString(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function b64url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
  const payload = JSON.parse(b64urlToString(body));
  if (!payload?.uid || !payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
  return payload as { uid: number; rol: string; exp: number };
}

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes.buffer);
}

function roleLabel(rol: string) {
  return ({
    admin: "Administrador/a",
    casa_matriz: "Casa Matriz",
    franquiciado: "Franquiciado/a",
    encargada: "Encargada",
    manicura: "Manicura",
  } as Record<string, string>)[rol] || "Usuario/a";
}

function roleInfoHtml(rol: string) {
  if (rol === "manicura") {
    return `
      <div style="margin:18px 0 0;border:1px solid #f0d9e2;background:#fff8fb;border-radius:14px;padding:15px 16px">
        <p style="margin:0 0 9px;font-size:14px;font-weight:700;color:#72243e">¿Qué vas a poder hacer en NIKI OS?</p>
        <ul style="margin:0;padding-left:19px;font-size:13px;line-height:1.65;color:#4a4a4a">
          <li>Cargar y consultar tus horarios de trabajo.</li>
          <li>Consultar la información y las funciones habilitadas para tu perfil.</li>
          <li>Acceder a las herramientas de NIKI OS correspondientes a tus locales y tareas.</li>
        </ul>
        <div style="height:1px;background:#efd9e2;margin:13px 0"></div>
        <p style="margin:0 0 7px;font-size:13px;font-weight:700;color:#72243e">Importante sobre tus horarios</p>
        <ul style="margin:0;padding-left:19px;font-size:13px;line-height:1.65;color:#4a4a4a">
          <li>Del <strong>1 al 7 de cada mes</strong> tenés que cargar los horarios del mes siguiente.</li>
          <li>Si no podés cargarlos dentro de ese período, contactá a tu encargada para solicitar el desbloqueo.</li>
          <li>Después del día 7, cualquier alta o modificación de horarios requiere que tu encargada desbloquee el período.</li>
        </ul>
      </div>`;
  }

  if (rol === "encargada") {
    return `
      <div style="margin:18px 0 0;border:1px solid #f0d9e2;background:#fff8fb;border-radius:14px;padding:15px 16px">
        <p style="margin:0 0 9px;font-size:14px;font-weight:700;color:#72243e">¿Qué vas a poder hacer en NIKI OS?</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#4a4a4a">Vas a poder trabajar con la información operativa de los locales que tengas asignados, gestionar al equipo según tus permisos y asistir a las manicuras cuando necesiten desbloqueos o correcciones de horarios.</p>
      </div>`;
  }

  if (rol === "casa_matriz") {
    return `
      <div style="margin:18px 0 0;border:1px solid #f0d9e2;background:#fff8fb;border-radius:14px;padding:15px 16px">
        <p style="margin:0 0 9px;font-size:14px;font-weight:700;color:#72243e">¿Qué vas a poder hacer en NIKI OS?</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#4a4a4a">Vas a poder consultar y gestionar información operativa, reportes y configuraciones de los locales habilitados para tu perfil, con las restricciones propias de Casa Matriz.</p>
      </div>`;
  }

  if (rol === "franquiciado") {
    return `
      <div style="margin:18px 0 0;border:1px solid #f0d9e2;background:#fff8fb;border-radius:14px;padding:15px 16px">
        <p style="margin:0 0 9px;font-size:14px;font-weight:700;color:#72243e">¿Qué vas a poder hacer en NIKI OS?</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#4a4a4a">Vas a poder acceder a la información y herramientas de las sucursales que tengas asignadas, de acuerdo con los permisos de tu perfil.</p>
      </div>`;
  }

  if (rol === "admin") {
    return `
      <div style="margin:18px 0 0;border:1px solid #f0d9e2;background:#fff8fb;border-radius:14px;padding:15px 16px">
        <p style="margin:0 0 9px;font-size:14px;font-weight:700;color:#72243e">Tu perfil</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#4a4a4a">Tu usuario tiene acceso administrativo a NIKI OS.</p>
      </div>`;
  }

  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  try {
    const body = await req.json();
    const actorId = Number(body.actor_id || 0);
    const targetUserId = Number(body.target_user_id || 0);
    const sessionToken = String(body.session_token || "");

    if (!actorId || !targetUserId || !sessionToken) {
      return json({ ok: false, error: "Faltan datos obligatorios" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sessionSecret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") || "Niki Beauty Bar";
    const appUrl = Deno.env.get("NIKI_APP_URL") || "https://iginart.github.io/nikiasistencia/";

    if (!sessionSecret) return json({ ok: false, error: "Falta configurar NIKI_SESSION_SECRET" }, 500);
    if (!brevoApiKey || !senderEmail) return json({ ok: false, error: "Faltan secretos BREVO_API_KEY o BREVO_SENDER_EMAIL" }, 500);

    const session = await verifySession(sessionToken, sessionSecret);
    if (!session || Number(session.uid) !== actorId) return json({ ok: false, error: "Sesión inválida o vencida" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const [{ data: actorRows, error: actorError }, { data: targetRows, error: targetError }] = await Promise.all([
      supabase.from("users").select("id,rol,activo").eq("id", actorId).limit(1),
      supabase.from("users").select("id,nombre,usuario,email,rol,activo").eq("id", targetUserId).limit(1),
    ]);
    if (actorError) throw actorError;
    if (targetError) throw targetError;

    const actor = actorRows?.[0];
    const target = targetRows?.[0];
    if (!actor || actor.activo === false) return json({ ok: false, error: "Usuario no autorizado" }, 403);
    if (!target || target.activo === false) return json({ ok: false, error: "Usuario destino no encontrado o inactivo" }, 404);

    let allowed = false;
    if (actor.rol === "admin") allowed = true;
    if (actor.rol === "casa_matriz") allowed = target.rol !== "admin";
    if (actor.rol === "encargada") allowed = target.rol === "manicura";

    if (!allowed) return json({ ok: false, error: "No tenés permiso para invitar este usuario" }, 403);

    const destino = String(target.email || "").trim().toLowerCase();
    const usuarioAcceso = String(target.usuario || "").trim();
    if (!destino) return json({ ok: false, error: "El usuario no tiene email cargado" }, 400);
    if (!usuarioAcceso) return json({ ok: false, error: "El usuario no tiene nombre de usuario configurado" }, 400);

    const token = newToken();
    const expiry = Date.now() + 1000 * 60 * 60 * 24 * 3; // 72 hs

    await supabase.from("reset_tokens").delete().eq("user_id", target.id);
    const { error: tokenError } = await supabase.from("reset_tokens").insert({
      token,
      user_id: target.id,
      expiry,
    });
    if (tokenError) throw tokenError;

    const base = appUrl.endsWith("/") ? appUrl : `${appUrl}/`;
    const link = `${base}#/reset-password?token=${encodeURIComponent(token)}`;
    const perfil = roleLabel(String(target.rol || ""));

    const asunto = "Tu acceso a NIKI OS está listo";
    const htmlContent = `
      <div style="font-family:Montserrat,Arial,sans-serif;background:#fff7fb;padding:24px;color:#333">
        <div style="max-width:590px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #f3d7e3">
          <div style="background:#e1c6cc;color:#72243e;padding:20px 24px">
            <h1 style="margin:0;font-size:22px;font-weight:700">Bienvenida/o a NIKI OS</h1>
            <p style="margin:4px 0 0;font-size:14px">Niki Beauty Bar</p>
          </div>
          <div style="padding:24px">
            <p style="font-size:15px;margin:0 0 12px">Hola ${esc(target.nombre || target.usuario)},</p>
            <p style="font-size:15px;line-height:1.55;margin:0 0 16px">Ya creamos tu acceso a NIKI OS. <strong>No tenés una contraseña asignada</strong>: la vas a crear vos desde este email.</p>

            <div style="background:#fff0f6;border-radius:14px;padding:15px 17px;margin:0 0 18px;border:1px solid #f4dbe5">
              <p style="margin:0 0 5px;font-size:12px;color:#7b6670;text-transform:uppercase;letter-spacing:.04em">Tu usuario de acceso</p>
              <p style="margin:0;font-size:21px;font-weight:800;color:#72243e;word-break:break-word">${esc(usuarioAcceso)}</p>
              <p style="margin:7px 0 0;font-size:12px;color:#777">Perfil: ${esc(perfil)}</p>
            </div>

            <p style="font-size:14px;line-height:1.55;margin:0 0 8px">Guardá ese usuario. Es el dato que vas a usar para ingresar a NIKI OS.</p>
            <p style="margin:20px 0 22px">
              <a href="${esc(link)}" style="display:inline-block;background:#72243e;color:#fff;text-decoration:none;border-radius:12px;padding:13px 20px;font-weight:700">
                Crear mi contraseña
              </a>
            </p>

            ${roleInfoHtml(String(target.rol || ""))}

            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee">
              <p style="font-size:12px;color:#777;line-height:1.55;margin:0">El enlace para crear tu contraseña vence en 72 horas. Si vence, pedí que te reenvíen la invitación. Si no esperabas este mensaje, podés ignorarlo.</p>
            </div>
          </div>
        </div>
      </div>`;

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: destino, name: target.nombre || target.usuario }],
        subject: asunto,
        htmlContent,
      }),
    });

    const brevoText = await brevoRes.text();
    let brevoJson: any = null;
    try { brevoJson = brevoText ? JSON.parse(brevoText) : null; } catch (_) {}

    if (!brevoRes.ok) {
      const msg = brevoJson?.message || brevoText || `Brevo error ${brevoRes.status}`;
      return json({ ok: false, error: msg, brevo: brevoJson || brevoText }, 502);
    }

    return json({ ok: true, email: destino, target_user_id: target.id, usuario: usuarioAcceso, messageId: brevoJson?.messageId || null });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error) }, 500);
  }
});
