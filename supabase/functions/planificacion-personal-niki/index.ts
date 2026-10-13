import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function errorText(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const parts = [v.message, v.details, v.hint, v.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(" · ");
    try { return JSON.stringify(value); } catch {}
  }
  return String(value ?? "Error inesperado");
}
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function b64url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}
async function hmacSha256(message: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
async function verifySession(token: string, secret: string) {
  const [body,sig] = String(token || "").split(".");
  if (!body || !sig || await hmacSha256(body,secret) !== sig) return null;
  try {
    const payload = JSON.parse(fromB64url(body));
    if (!payload?.uid || !payload?.exp || Number(payload.exp) < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}
function isPeriodo(v:string){ return /^\d{4}-\d{2}$/.test(v); }
function isDate(v:string){ return /^\d{4}-\d{2}-\d{2}$/.test(v); }

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:cors });
  if (req.method !== "POST") return json({ ok:false,error:"Metodo no permitido" },405);
  try {
    const url=Deno.env.get("SUPABASE_URL")!;
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret=Deno.env.get("NIKI_SESSION_SECRET")||Deno.env.get("NIKI_IMPORT_TOKEN")||"";
    if(!secret) return json({ok:false,error:"Falta NIKI_SESSION_SECRET"},500);
    const admin=createClient(url,key,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const actorId=Number(body.actor_id||0), action=String(body.action||""), token=String(body.session_token||"");
    const session=await verifySession(token,secret);
    if(!actorId||!session||Number(session.uid)!==actorId) return json({ok:false,error:"Sesion invalida o vencida"},401);
    const {data:actor,error:ae}=await admin.from("users").select("id,nombre,rol,activo").eq("id",actorId).maybeSingle();
    if(ae) throw ae;
    if(!actor||actor.activo===false) return json({ok:false,error:"Usuario no autorizado"},403);

    const allLocalAccess = ["admin","casa_matriz"].includes(actor.rol);
    const quotaEditors = ["admin","casa_matriz","franquiciado"].includes(actor.rol);
    const scheduleEditors = ["admin","casa_matriz","franquiciado","encargada"].includes(actor.rol);
    const commissionEditors = ["admin","casa_matriz","franquiciado","encargada"].includes(actor.rol);

    const allowedLocals = async()=>{
      if(allLocalAccess){
        const {data,error}=await admin.from("locales").select("id"); if(error)throw error;
        return new Set((data||[]).map((x:any)=>Number(x.id)));
      }
      if(actor.rol==="franquiciado"){
        const {data,error}=await admin.from("usuario_locales").select("local_id").eq("user_id",actorId); if(error)throw error;
        return new Set((data||[]).map((x:any)=>Number(x.local_id)));
      }
      if(actor.rol==="encargada"){
        const {data,error}=await admin.from("encargado_locales").select("local_id").eq("user_id",actorId); if(error)throw error;
        return new Set((data||[]).map((x:any)=>Number(x.local_id)));
      }
      return new Set<number>();
    };
    const assertLocal=async(localId:number)=>{
      const set=await allowedLocals();
      if(!set.has(Number(localId))) throw new Error("No tenes permiso para ese local.");
    };

    if(action==="staffing_get"){
      if(!scheduleEditors) return json({ok:false,error:"Sin permiso"},403);
      const localId=Number(body.local_id||0); if(!localId) return json({ok:false,error:"Falta local"},400);
      await assertLocal(localId);
      const [{data:cfg,error:ce},{data:quotas,error:qe}] = await Promise.all([
        admin.from("dotacion_cupos_config").select("*").eq("local_id",localId).maybeSingle(),
        admin.from("dotacion_cupos").select("*").eq("local_id",localId).eq("perfil","manicura").eq("activo",true).order("tipo_semana").order("dia_semana").order("hora")
      ]);
      if(ce||qe) throw new Error(`No se pudieron leer los cupos: ${errorText(ce||qe)}`);
      return json({ok:true,config:cfg||null,quotas:quotas||[],can_edit_quotas:quotaEditors,can_edit_schedule:scheduleEditors});
    }

    if(action==="staffing_save"){
      if(!quotaEditors) return json({ok:false,error:"Solo Administracion, Casa Matriz o Franquiciado pueden definir cupos."},403);
      const localId=Number(body.local_id||0); if(!localId) return json({ok:false,error:"Falta local"},400);
      await assertLocal(localId);
      const ref=String(body.fecha_referencia_a||""); if(!isDate(ref)) return json({ok:false,error:"Fecha de Semana A invalida"},400);
      const rows=Array.isArray(body.quotas)?body.quotas:[];
      const clean=rows.map((r:any)=>({
        local_id:localId, perfil:"manicura", tipo_semana:String(r.tipo_semana||"").toLowerCase(),
        dia_semana:Number(r.dia_semana), hora:Number(r.hora), cupo:Number(r.cupo||0), activo:true,
        actualizado_por_user_id:actorId, actualizado_en:new Date().toISOString()
      })).filter((r:any)=>["a","b"].includes(r.tipo_semana)&&r.dia_semana>=1&&r.dia_semana<=6&&r.hora>=9&&r.hora<=19&&r.cupo>=0&&r.cupo<=30);
      if(clean.length!==rows.length) return json({ok:false,error:"Hay cupos invalidos."},400);
      const rpcRows=clean.map((r:any)=>({tipo_semana:r.tipo_semana,dia_semana:r.dia_semana,hora:r.hora,cupo:r.cupo}));
      const {data:savedCount,error:saveErr}=await admin.rpc("guardar_dotacion_cupos",{
        p_local_id:localId,
        p_fecha_referencia_a:ref,
        p_user_id:actorId,
        p_cupos:rpcRows
      });
      if(saveErr) throw new Error(`No se pudieron guardar los cupos: ${errorText(saveErr)}`);
      return json({ok:true,registros:Number(savedCount??clean.length)});
    }

    if(action==="cuts_list"){
      if(!commissionEditors) return json({ok:false,error:"Sin permiso"},403);
      const periodo=String(body.periodo||""); if(!isPeriodo(periodo)) return json({ok:false,error:"Periodo invalido"},400);
      const allowed=await allowedLocals();
      let q=admin.from("comisiones_cortes_quincenales").select("*").eq("periodo",periodo).order("quincena").order("local_id");
      if(!allLocalAccess) q=q.in("local_id",Array.from(allowed));
      const {data,error}=await q; if(error)throw error;
      return json({ok:true,rows:data||[]});
    }

    if(action==="cut_close"){
      if(!commissionEditors) return json({ok:false,error:"Sin permiso"},403);
      const periodo=String(body.periodo||""),quincena=Number(body.quincena||0);
      if(!isPeriodo(periodo)||![1,2].includes(quincena)) return json({ok:false,error:"Periodo o quincena invalida"},400);
      const fechaDesde=String(body.fecha_desde||""),fechaHasta=String(body.fecha_hasta||"");
      if(!isDate(fechaDesde)||!isDate(fechaHasta)||fechaHasta<fechaDesde) return json({ok:false,error:"Rango invalido"},400);
      const snapshots=Array.isArray(body.snapshots)?body.snapshots:[];
      if(!snapshots.length) return json({ok:false,error:"No hay locales para cerrar"},400);
      const allowed=await allowedLocals();
      for(const s of snapshots){if(!allowed.has(Number(s.local_id))) return json({ok:false,error:"Uno de los locales no esta permitido"},403);}
      const now=new Date().toISOString();
      const rows=snapshots.map((s:any)=>({
        periodo,quincena,local_id:Number(s.local_id),fecha_desde:fechaDesde,fecha_hasta:fechaHasta,estado:"cerrado",
        total_neto:Number(s.total_neto||0),total_bruto:Number(s.total_bruto||0),total_garantias:Number(s.total_garantias||0),total_adelantos:Number(s.total_adelantos||0),
        detalle:Array.isArray(s.detalle)?s.detalle:[],cerrado_por_user_id:actorId,cerrado_en:now,pagado_por_user_id:null,pagado_en:null,fecha_pago:null,actualizado_en:now
      }));
      const {data,error}=await admin.from("comisiones_cortes_quincenales").upsert(rows,{onConflict:"periodo,quincena,local_id"}).select(); if(error)throw error;
      return json({ok:true,rows:data||[]});
    }

    if(action==="cut_paid"){
      if(!commissionEditors) return json({ok:false,error:"Sin permiso"},403);
      const ids=(Array.isArray(body.ids)?body.ids:[]).map(Number).filter(Boolean); if(!ids.length)return json({ok:false,error:"No hay cortes seleccionados"},400);
      const fecha=String(body.fecha_pago||""); if(!isDate(fecha))return json({ok:false,error:"Fecha de pago invalida"},400);
      const {data:current,error:ce}=await admin.from("comisiones_cortes_quincenales").select("id,local_id").in("id",ids);if(ce)throw ce;
      const allowed=await allowedLocals();
      if((current||[]).some((r:any)=>!allowed.has(Number(r.local_id))))return json({ok:false,error:"Sin permiso para uno de los cortes"},403);
      const now=new Date().toISOString();
      const {data,error}=await admin.from("comisiones_cortes_quincenales").update({estado:"pagado",fecha_pago:fecha,pagado_por_user_id:actorId,pagado_en:now,actualizado_en:now}).in("id",ids).select();if(error)throw error;
      return json({ok:true,rows:data||[]});
    }

    if(action==="cut_reopen"){
      if(!commissionEditors)return json({ok:false,error:"Sin permiso"},403);
      const ids=(Array.isArray(body.ids)?body.ids:[]).map(Number).filter(Boolean);if(!ids.length)return json({ok:false,error:"No hay cortes seleccionados"},400);
      const {data:current,error:ce}=await admin.from("comisiones_cortes_quincenales").select("id,local_id").in("id",ids);if(ce)throw ce;
      const allowed=await allowedLocals();
      if((current||[]).some((r:any)=>!allowed.has(Number(r.local_id))))return json({ok:false,error:"Sin permiso para uno de los cortes"},403);
      const now=new Date().toISOString();
      const {data,error}=await admin.from("comisiones_cortes_quincenales").update({estado:"cerrado",fecha_pago:null,pagado_por_user_id:null,pagado_en:null,actualizado_en:now}).in("id",ids).select();if(error)throw error;
      return json({ok:true,rows:data||[]});
    }

    return json({ok:false,error:"Accion invalida"},400);
  } catch(e) {
    console.error(e);
    return json({ok:false,error:errorText(e)},500);
  }
});
