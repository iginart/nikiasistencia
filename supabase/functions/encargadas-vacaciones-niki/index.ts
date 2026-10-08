import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c] || c));
}
function dateUtc(key:string){ const [y,m,d]=key.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
function dateKey(d:Date){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`; }
function daysInclusive(a:string,b:string){ return Math.floor((dateUtc(b).getTime()-dateUtc(a).getTime())/86400000)+1; }
function eachDay(a:string,b:string){ const out:string[]=[]; for(let d=dateUtc(a);d<=dateUtc(b);d=new Date(d.getTime()+86400000))out.push(dateKey(d)); return out; }
function isDate(v:string){ return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isPeriodo(v:string){ return /^\d{4}-\d{2}$/.test(v); }
function minOf(t:string|null|undefined){ if(!t)return null; const [h,m]=String(t).slice(0,5).split(":").map(Number); return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null; }
function overlap(a1:string,a2:string,b1:string,b2:string){ const x1=minOf(a1),x2=minOf(a2),y1=minOf(b1),y2=minOf(b2); return x1!=null&&x2!=null&&y1!=null&&y2!=null&&Math.max(x1,y1)<Math.min(x2,y2); }

async function sendMail(to:string,name:string,subject:string,htmlContent:string){
  const apiKey=Deno.env.get("BREVO_API_KEY");
  const senderEmail=Deno.env.get("BREVO_SENDER_EMAIL");
  const senderName=Deno.env.get("BREVO_SENDER_NAME")||"Niki Beauty Bar";
  if(!apiKey||!senderEmail) return { sent:false, reason:"Brevo no configurado" };
  const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","api-key":apiKey,"content-type":"application/json"},body:JSON.stringify({sender:{email:senderEmail,name:senderName},to:[{email:to,name}],subject,htmlContent})});
  const txt=await r.text(); if(!r.ok) throw new Error(`Brevo: ${txt||r.status}`); return {sent:true};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"Metodo no permitido"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret=Deno.env.get("NIKI_SESSION_SECRET")||Deno.env.get("NIKI_IMPORT_TOKEN")||"";
    if(!secret)return json({ok:false,error:"Falta NIKI_SESSION_SECRET"},500);
    const admin=createClient(url,key,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const actorId=Number(body.actor_id||0), action=String(body.action||""), token=String(body.session_token||"");
    const session=await verifySession(token,secret);
    if(!actorId||!session||Number(session.uid)!==actorId)return json({ok:false,error:"Sesion invalida o vencida"},401);
    const {data:actor,error:ae}=await admin.from("users").select("id,nombre,email,rol,activo").eq("id",actorId).maybeSingle();
    if(ae)throw ae; if(!actor||actor.activo===false)return json({ok:false,error:"Usuario no autorizado"},403);
    const approver=["admin","casa_matriz"].includes(actor.rol);

    const operationalManager=async(userId:number)=>{
      const {data,error}=await admin.from("encargado_locales").select("local_id").eq("user_id",userId).limit(1);
      if(error)throw error; return !!data?.length;
    };
    const readRequest=async(id:number)=>{
      const {data,error}=await admin.from("encargada_vacaciones_solicitudes").select("*").eq("id",id).maybeSingle();
      if(error)throw error; return data;
    };
    const canRead=(r:any)=>approver||Number(r?.user_id)===actorId;

    if(action==="list"){
      let q=admin.from("encargada_vacaciones_solicitudes").select("*").order("fecha_inicio",{ascending:false});
      if(!approver)q=q.eq("user_id",actorId);
      const {data:rows,error}=await q; if(error)throw error;
      const ids=[...new Set((rows||[]).map((r:any)=>Number(r.user_id)))];
      const {data:users,error:ue}=ids.length?await admin.from("users").select("id,nombre,email,activo").in("id",ids):{data:[],error:null}; if(ue)throw ue;
      return json({ok:true,rows:rows||[],users:users||[]});
    }

    if(action==="create"){
      const targetUserId=approver&&body.target_user_id?Number(body.target_user_id):actorId;
      if(!(await operationalManager(targetUserId)))return json({ok:false,error:"La persona no tiene perfil operativo de encargada."},400);
      const desde=String(body.fecha_inicio||""),hasta=String(body.fecha_fin||"");
      if(!isDate(desde)||!isDate(hasta)||hasta<desde)return json({ok:false,error:"Indica un rango de fechas valido."},400);
      const {data:existing,error:ee}=await admin.from("encargada_vacaciones_solicitudes").select("id,fecha_inicio,fecha_fin,estado").eq("user_id",targetUserId).in("estado",["solicitada","aprobada"]).lte("fecha_inicio",hasta).gte("fecha_fin",desde);
      if(ee)throw ee; if(existing?.length)return json({ok:false,error:"Ya existe una solicitud pendiente o aprobada que se superpone con esas fechas."},409);
      const payload={user_id:targetUserId,fecha_inicio:desde,fecha_fin:hasta,anio_vacaciones:Number(body.anio_vacaciones||desde.slice(0,4)),estado:"solicitada",observacion_solicitante:String(body.observacion||"").trim()||null,actualizado_en:new Date().toISOString()};
      const {data,error}=await admin.from("encargada_vacaciones_solicitudes").insert(payload).select().single(); if(error)throw error;
      return json({ok:true,row:data});
    }

    if(action==="detail"){
      const id=Number(body.id||0),r=await readRequest(id); if(!r)return json({ok:false,error:"Solicitud inexistente"},404); if(!canRead(r))return json({ok:false,error:"Sin permiso"},403);
      const days=eachDay(r.fecha_inicio,r.fecha_fin);
      const [{data:user,error:ue},{data:plan,error:pe},{data:marks,error:me},{data:rels,error:re},{data:segments,error:se}]=await Promise.all([
        admin.from("users").select("id,nombre,email,activo").eq("id",r.user_id).single(),
        admin.from("encargada_planificacion").select("*").eq("user_id",r.user_id).gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin).order("fecha"),
        admin.from("encargada_planificacion_confirmaciones").select("local_id,fecha").gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin),
        admin.from("encargado_locales").select("user_id,local_id"),
        admin.from("encargada_coberturas_segmentos").select("*").eq("solicitud_vacaciones_id",id).order("fecha")
      ]);
      const err=ue||pe||me||re||se;if(err)throw err;
      const relatedLocalIds=[...new Set((rels||[]).filter((x:any)=>Number(x.user_id)===Number(r.user_id)).map((x:any)=>Number(x.local_id)))];
      const markSet=new Set((marks||[]).map((x:any)=>`${x.local_id}|${x.fecha}`));
      const missing=(plan||[]).filter((p:any)=>!markSet.has(`${p.local_id}|${p.fecha}`));
      const candidateIds=[...new Set((rels||[]).filter((x:any)=>!relatedLocalIds.length||relatedLocalIds.includes(Number(x.local_id))).map((x:any)=>Number(x.user_id)).filter((x:number)=>x!==Number(r.user_id)))];
      const {data:candidates,error:ce}=candidateIds.length?await admin.from("users").select("id,nombre,email,activo").in("id",candidateIds).eq("activo",true):{data:[],error:null}; if(ce)throw ce;
      return json({ok:true,row:r,user,plan:plan||[],segments:segments||[],candidates:candidates||[],missing_confirmations:missing,days});
    }

    if(action==="cancel"){
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);
      if(!canRead(r))return json({ok:false,error:"Sin permiso"},403);
      if(r.estado==="rechazada"||r.estado==="cancelada")return json({ok:false,error:"La solicitud ya esta cerrada."},409);
      if(r.estado==="aprobada"&&!approver)return json({ok:false,error:"Una vacacion aprobada solo puede cancelarla Casa Matriz o Administracion."},403);
      const now=new Date().toISOString();
      const {error}=await admin.from("encargada_vacaciones_solicitudes").update({estado:"cancelada",cancelado_por_user_id:actor.id,cancelado_en:now,actualizado_en:now}).eq("id",id);if(error)throw error;
      await Promise.all([
        admin.from("encargada_coberturas_segmentos").update({estado:"cancelada",actualizado_por_user_id:actor.id,actualizado_en:now}).eq("solicitud_vacaciones_id",id),
        admin.from("encargada_jornada_real").delete().eq("solicitud_vacaciones_id",id).eq("origen","vacaciones")
      ]);
      return json({ok:true});
    }

    if(action==="reject"){
      if(!approver)return json({ok:false,error:"Solo Casa Matriz o Administracion puede rechazar vacaciones."},403);
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);
      if(r.estado!=="solicitada")return json({ok:false,error:"La solicitud ya fue resuelta."},409);
      const now=new Date().toISOString(),obs=String(body.observacion||"").trim()||null;
      const {error}=await admin.from("encargada_vacaciones_solicitudes").update({estado:"rechazada",observacion_resolucion:obs,resuelto_por_user_id:actor.id,resuelto_en:now,actualizado_en:now}).eq("id",id);if(error)throw error;
      const {data:u}=await admin.from("users").select("nombre,email").eq("id",r.user_id).single();
      if(u?.email)await sendMail(u.email,u.nombre||"Encargada","Solicitud de vacaciones rechazada",`<div style="font-family:Montserrat,Arial,sans-serif"><h2>Solicitud de vacaciones</h2><p>Hola ${esc(u.nombre)},</p><p>Tu solicitud del <strong>${esc(r.fecha_inicio)}</strong> al <strong>${esc(r.fecha_fin)}</strong> fue rechazada.</p>${obs?`<p>Observacion: ${esc(obs)}</p>`:""}</div>`).catch(()=>null);
      return json({ok:true});
    }

    if(action==="approve"){
      if(!approver)return json({ok:false,error:"Solo Casa Matriz o Administracion puede aprobar vacaciones."},403);
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);
      if(r.estado!=="solicitada")return json({ok:false,error:"La solicitud ya fue resuelta."},409);
      const segments=Array.isArray(body.segments)?body.segments:[];
      const periodo=String(body.periodo_liquidacion||r.fecha_inicio.slice(0,7));
      if(!isPeriodo(periodo))return json({ok:false,error:"Periodo de liquidacion invalido."},400);
      const {data:plan,error:pe}=await admin.from("encargada_planificacion").select("*").eq("user_id",r.user_id).gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin).order("fecha");if(pe)throw pe;
      const planRows=plan||[];
      const {data:marks,error:me}=await admin.from("encargada_planificacion_confirmaciones").select("local_id,fecha").gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin);if(me)throw me;
      const markSet=new Set((marks||[]).map((x:any)=>`${x.local_id}|${x.fecha}`));
      const missingConfirm=planRows.find((p:any)=>!markSet.has(`${p.local_id}|${p.fecha}`));
      if(missingConfirm)return json({ok:false,error:`No se puede aprobar: la planificacion del ${missingConfirm.fecha} no esta confirmada.`},409);
      if(planRows.length!==segments.length)return json({ok:false,error:"Debe definirse un reemplazo para cada turno confirmado comprendido por las vacaciones."},400);
      for(const p of planRows){
        const s=segments.find((x:any)=>Number(x.local_id)===Number(p.local_id)&&String(x.fecha)===String(p.fecha)&&String(x.hora_desde).slice(0,5)===String(p.hora_desde).slice(0,5)&&String(x.hora_hasta).slice(0,5)===String(p.hora_hasta).slice(0,5));
        if(!s||!Number(s.reemplazo_user_id)||Number(s.reemplazo_user_id)===Number(r.user_id))return json({ok:false,error:`Falta reemplazo valido para ${p.fecha} ${String(p.hora_desde).slice(0,5)}-${String(p.hora_hasta).slice(0,5)}.`},400);
      }
      // Conflictos: se rechazan solapamientos con otra sucursal. En el mismo local
      // se permite solapar porque una encargada ya presente puede cubrir a otra.
      for(const s of segments){
        const uid=Number(s.reemplazo_user_id),lid=Number(s.local_id),fecha=String(s.fecha);
        const [{data:rp,error:rpe},{data:cs,error:cse}]=await Promise.all([
          admin.from("encargada_planificacion").select("local_id,hora_desde,hora_hasta").eq("user_id",uid).eq("fecha",fecha),
          admin.from("encargada_coberturas_segmentos").select("local_id,hora_desde,hora_hasta,estado").eq("reemplazo_user_id",uid).eq("fecha",fecha).neq("estado","cancelada")
        ]);if(rpe||cse)throw(rpe||cse);
        const conflict=[...(rp||[]),...(cs||[])].find((x:any)=>Number(x.local_id)!==lid&&overlap(String(s.hora_desde),String(s.hora_hasta),String(x.hora_desde),String(x.hora_hasta)));
        if(conflict)return json({ok:false,error:`El reemplazo seleccionado tiene un horario superpuesto en otra sucursal el ${fecha}.`},409);
      }
      const now=new Date().toISOString();
      const base=body.remuneracion_base_vacaciones==null?null:Number(body.remuneracion_base_vacaciones);
      const {error:ue}=await admin.from("encargada_vacaciones_solicitudes").update({estado:"aprobada",periodo_liquidacion:periodo,remuneracion_base_vacaciones:Number.isFinite(base)?base:null,observacion_resolucion:String(body.observacion||"").trim()||null,resuelto_por_user_id:actor.id,resuelto_en:now,actualizado_en:now}).eq("id",id);if(ue)throw ue;
      await admin.from("encargada_coberturas_segmentos").delete().eq("solicitud_vacaciones_id",id);
      if(segments.length){
        const cov=segments.map((s:any)=>({origen:"vacaciones",solicitud_vacaciones_id:id,local_id:Number(s.local_id),fecha:String(s.fecha),reemplazado_user_id:Number(r.user_id),reemplazo_user_id:Number(s.reemplazo_user_id),hora_desde:String(s.hora_desde).slice(0,5),hora_hasta:String(s.hora_hasta).slice(0,5),estado:"planificada",motivo:"Vacaciones",creado_por_user_id:actor.id,actualizado_por_user_id:actor.id,actualizado_en:now}));
        const {error:ce}=await admin.from("encargada_coberturas_segmentos").insert(cov);if(ce)throw ce;
      }
      if(planRows.length){
        const vacRows=planRows.map((p:any)=>({fecha:p.fecha,local_id:Number(p.local_id),user_id:Number(r.user_id),hora_plan_desde:p.hora_desde,hora_plan_hasta:p.hora_hasta,hora_real_desde:null,hora_real_hasta:null,estado:"vacaciones",reemplaza_user_id:null,comentario:"Vacaciones aprobadas",motivo_ausencia:"Vacaciones",origen:"vacaciones",solicitud_vacaciones_id:id,creado_por_user_id:actor.id,actualizado_por_user_id:actor.id,actualizado_en:now}));
        const {error:ve}=await admin.from("encargada_jornada_real").upsert(vacRows,{onConflict:"local_id,user_id,fecha"});if(ve)throw ve;
      }
      const {data:u}=await admin.from("users").select("nombre,email").eq("id",r.user_id).single();
      if(u?.email)await sendMail(u.email,u.nombre||"Encargada","Vacaciones aprobadas",`<div style="font-family:Montserrat,Arial,sans-serif"><h2 style="color:#72243e">Vacaciones aprobadas</h2><p>Hola ${esc(u.nombre)},</p><p>Tu solicitud del <strong>${esc(r.fecha_inicio)}</strong> al <strong>${esc(r.fecha_fin)}</strong> fue aprobada.</p><p>La cobertura de tus horarios ya quedo planificada en NIKI OS.</p></div>`).catch(()=>null);
      return json({ok:true,dias:daysInclusive(r.fecha_inicio,r.fecha_fin)});
    }

    return json({ok:false,error:"Accion invalida"},400);
  }catch(e){console.error(e);return json({ok:false,error:e instanceof Error?e.message:String(e)},500);}
});
