import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{...cors,"Content-Type":"application/json"}});
function base64url(data: ArrayBuffer) { let s="";for(const b of new Uint8Array(data))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
async function verifySession(token: string, secret: string) {
  const [body,sig] = String(token||"").split(".");
  if (!body || !sig || !secret) return null;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const expected = base64url(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body)));
  if (expected.length !== sig.length) return null;
  let mismatch = 0;for(let i=0;i<expected.length;i++) mismatch |= expected.charCodeAt(i)^sig.charCodeAt(i);
  if(mismatch) return null;
  try {
    const value=body.replace(/-/g,"+").replace(/_/g,"/");
    const payload=JSON.parse(atob(value+"=".repeat((4-value.length%4)%4)));
    if(!payload?.uid || !payload?.exp || Number(payload.exp) <= Math.floor(Date.now()/1000))return null;
    return payload;
  }catch{return null;}
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"Método no permitido"},405);
  try {
    const url=Deno.env.get("SUPABASE_URL") || "";
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const secret=Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if(!url||!serviceKey||!secret)return json({ok:false,error:"Falta configuración segura del servidor"},500);
    const body=await req.json().catch(()=>({}));
    const actorId=Number(body.actor_id||0), localId=Number(body.local_id||0);
    const listaId=body.lista_id==null || body.lista_id==="" ? null : Number(body.lista_id);
    const fechaDesde=String(body.fecha_desde||"");
    const motivo=String(body.motivo||"").trim().slice(0,1000);
    if(!Number.isSafeInteger(actorId)||actorId<=0)return json({ok:false,error:"Usuario inválido"},400);
    const session=await verifySession(String(body.session_token||""),secret);
    if(!session||Number(session.uid)!==actorId)return json({ok:false,error:"Sesión inválida o vencida"},401);
    const db=createClient(url,serviceKey,{auth:{persistSession:false}});
    const {data:actor,error:userError}=await db.from("users").select("id,rol,activo").eq("id",actorId).maybeSingle();
    if(userError||!actor||actor.activo===false)return json({ok:false,error:"Usuario no disponible"},401);
    if(!["admin","casa_matriz"].includes(actor.rol))return json({ok:false,error:"Solo Administración y Casa Matriz pueden cambiar la lista de una sucursal"},403);
    if(!Number.isSafeInteger(localId)||localId<=0 || (listaId!==null&&(!Number.isSafeInteger(listaId)||listaId<=0)) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde) || Number.isNaN(Date.parse(fechaDesde+"T12:00:00Z")))return json({ok:false,error:"Datos de lista, local o fecha inválidos"},400);
    const {data:local,error:localError}=await db.from("locales").select("id").eq("id",localId).maybeSingle();
    if(localError||!local)return json({ok:false,error:"Sucursal inexistente"},404);
    const {error}=await db.rpc("niki_asignar_lista_local_vigente",{p_local_id:localId,p_lista_id:listaId,p_fecha_desde:fechaDesde,p_motivo:motivo||null,p_actor_id:actorId});
    if(error)throw error;
    return json({ok:true});
  }catch(err){console.error("Error guardando vigencia:",err);return json({ok:false,error:err instanceof Error?err.message:"No se pudo registrar la vigencia"},500);}
});
