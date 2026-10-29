import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Content-Type": "application/json",
};
const RESULTADOS_API_VERSION = 5;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(
  body && typeof body==="object" && !Array.isArray(body)
    ? {...body as Record<string, unknown>, resultados_api_version:RESULTADOS_API_VERSION} : body
), {status, headers});

async function readSession(token: string, secret: string) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    {name:"HMAC",hash:"SHA-256"}, false, ["verify"]);
  try {
    const decode = (value: string) => {
      const base = value.replace(/-/g,"+").replace(/_/g,"/");
      return Uint8Array.from(atob(base + "=".repeat((4-base.length%4)%4)), c => c.charCodeAt(0));
    };
    if (!await crypto.subtle.verify("HMAC", key, decode(signature), new TextEncoder().encode(body))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(body)));
    return Number(data.uid)>0 && Number(data.exp)>Date.now()/1000 ? data : null;
  } catch { return null; }
}

function validDay(value: unknown) {
  const day = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day))
    && new Date(day).toISOString().slice(0,10)===day;
}

Deno.serve(async req => {
  if (req.method==="OPTIONS") return new Response("ok", {headers});
  if (req.method!=="POST") return json({ok:false,error:"Método no permitido"},405);
  try {
    const b = await req.json();
    const secret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN");
    if (!secret) throw new Error("Falta configuración de sesión Niki");
    const session = await readSession(String(b.session_token || ""),secret);
    const actorId = Number(b.actor_id);
    if (!session || Number(session.uid)!==actorId) return json({ok:false,error:"Sesión inválida o vencida"},401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {auth:{persistSession:false}});
    const {data:actor,error:ae} = await admin.from("users").select("id,rol,activo,local_id").eq("id",actorId).maybeSingle();
    if (ae) throw ae;
    if (!actor || actor.activo===false) return json({ok:false,error:"Usuario inactivo"},403);
    const [localRes,userRes,encRes] = await Promise.all([
      admin.from("locales").select("id,nombre,tipo_local"),
      admin.from("usuario_locales").select("local_id").eq("user_id",actorId),
      admin.from("encargado_locales").select("local_id").eq("user_id",actorId),
    ]);
    if (localRes.error || userRes.error || encRes.error) throw(localRes.error || userRes.error || encRes.error);
    const locales = localRes.data || [];
    const explicit = new Set((userRes.data || []).map(x => Number(x.local_id)));
    const assignedEnc = (encRes.data || []).map(x=>Number(x.local_id));
    const role = actor.rol==="manicura" && assignedEnc.length ? "encargada" : actor.rol;
    if (!["admin","casa_matriz","franquiciado","encargada"].includes(role)) {
      return json({ok:false,error:"Este tablero es para perfiles de gestión"},403);
    }
    let allowed: number[] = [];
    if (role==="admin") allowed=locales.map(l=>Number(l.id));
    else if (role==="casa_matriz") allowed=locales.filter(l=>(l.tipo_local||"propio")==="propio"||explicit.has(Number(l.id))).map(l=>Number(l.id));
    else if (role==="franquiciado") allowed=explicit.size ? [...explicit] : [Number(actor.local_id)].filter(Boolean);
    else allowed=assignedEnc.length ? assignedEnc : [Number(actor.local_id)].filter(Boolean);
    const action=String(b.action || "resultados");
    if (action==="config" || action==="config_save") {
      if (role!=="admin") return json({ok:false,error:"Sólo Admin puede configurar vínculos de origen"},403);
      if (action==="config_save") {
        if (!Array.isArray(b.items) || b.items.length>200) throw new Error("Vínculos inválidos");
        const {data,error}=await admin.rpc("niki_gastos_guardar_vinculos",{p_rows:b.items});
        if(error)throw error;
        return json(data);
      }
      const {data,error}=await admin.rpc("niki_gastos_fuentes");
      if(error)throw error;
      return json({ok:true,fuentes:data||[]});
    }
    if (!["resultados","detalle","evolucion","reglas","reglas_save","gasto_formulario","gasto_guardar","gasto_eliminar"].includes(action)) return json({ok:false,error:"Acción desconocida"},400);
    if (b.local_ids!==undefined && !Array.isArray(b.local_ids)) throw new Error("Sucursales inválidas");
    const requested = b.local_ids===undefined ? allowed : [...new Set<number>(b.local_ids.map(Number))];
    if (requested.some(id=>!Number.isSafeInteger(id)||id<=0||!allowed.includes(id))) {
      return json({ok:false,error:"No tenés permiso para alguna de las sucursales"},403);
    }
    if(action==="gasto_formulario"){
      const {data,error}=await admin.rpc("niki_gastos_formulario",{p_local_ids:requested});
      if(error)throw error;return json(data);
    }
    if(action==="gasto_guardar"||action==="gasto_eliminar"){
      const expenseId=b.expense_id==null?null:Number(b.expense_id),revision=b.revision==null?null:Number(b.revision);
      if(expenseId!==null&&(!Number.isSafeInteger(expenseId)||expenseId===0||revision===null||!Number.isSafeInteger(revision)||revision<0))throw new Error("Identificador o versión de gasto inválidos");
      if(action==="gasto_eliminar"){
        if(expenseId===null)throw new Error("Seleccioná un gasto manual");
        const {data,error}=await admin.rpc("niki_gastos_eliminar",{p_expense_id:expenseId,p_revision:revision,p_actor_id:actorId,p_allowed_local_ids:allowed});
        if(error)throw error;return json(data);
      }
      const row=b.gasto;
      if(!row||typeof row!=="object"||Array.isArray(row))throw new Error("Completá todos los campos del gasto");
      const localId=Number(row.local_id);
      if(!Number.isSafeInteger(localId)||!requested.includes(localId))return json({ok:false,error:"Sucursal no permitida"},403);
      const code=String(row.codigo??"").trim(),notes=String(row.detalle??"").trim(),method=String(row.medio_pago??"").trim(),amount=String(row.importe??"");
      if(!validDay(row.fecha)||!code||code.length>32||["0","1","15"].includes(code)||!notes||notes.length>5000||!method||method.length>150||!/^-?\d+(\.\d{1,2})?$/.test(amount)||!Number.isFinite(Number(amount)))throw new Error("Completá fecha, sucursal, concepto, detalle, medio de pago e importe (hasta dos decimales)");
      const requestId=expenseId===null?String(b.request_id||""):null;
      if(expenseId===null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId!))throw new Error("Falta el identificador de alta");
      const {data,error}=await admin.rpc("niki_gastos_guardar",{p_row:{local_id:localId,fecha:row.fecha,codigo:code,detalle:notes,medio_pago:method,importe:amount},p_actor_id:actorId,p_allowed_local_ids:allowed,p_expense_id:expenseId,p_revision:revision,p_request_id:requestId});
      if(error)throw error;return json(data);
    }
    if(action==="reglas"||action==="reglas_save"){
      if(action==="reglas_save"){
        if(!["admin","casa_matriz","franquiciado"].includes(role))return json({ok:false,error:"Este perfil sólo puede consultar los controles de gastos"},403);
        const localId=Number(b.local_id);
        if(!Number.isSafeInteger(localId)||!requested.includes(localId))return json({ok:false,error:"Sucursal no permitida"},403);
        if(!Array.isArray(b.reglas)||b.reglas.length>150)throw new Error("Reglas inválidas");
        const {data,error}=await admin.rpc("niki_resultados_reglas_guardar",{p_local_id:localId,p_rows:b.reglas,p_actor_id:actorId});
        if(error)throw error;return json(data);
      }
      const {data,error}=await admin.rpc("niki_resultados_reglas",{p_local_ids:requested});
      if(error)throw error;return json(data);
    }
    if (!validDay(b.desde)||!validDay(b.hasta)||b.hasta<b.desde
      || (Date.parse(b.hasta)-Date.parse(b.desde))/86400000>366) throw new Error("Rango inválido; máximo 366 días");
    if(action==="detalle"){
      const code=String(b.codigo??""),limit=Number(b.limit??100),offset=Number(b.offset??0);
      if(!code||code.length>32||["0","1","15"].includes(code)||!Number.isSafeInteger(limit)||limit<1||limit>500||!Number.isSafeInteger(offset)||offset<0)throw new Error("Detalle inválido");
      const {data,error}=await admin.rpc("niki_resultados_costo_detalle",{p_desde:b.desde,p_hasta:b.hasta,p_local_ids:requested,p_codigo:code,p_limit:limit,p_offset:offset});
      if(error)throw error;return json(data);
    }
    if(action==="evolucion"){
      const {data,error}=await admin.rpc("niki_resultados_evolucion",{p_desde:b.desde,p_hasta:b.hasta,p_local_ids:requested,p_context_ids:allowed});
      if(error)throw error;return json(data);
    }
    const {data,error}=await admin.rpc("niki_resultados_gestion",{p_desde:b.desde,p_hasta:b.hasta,p_local_ids:requested});
    if(error)throw error;
    return json(data);
  } catch(error) {
    // No registrar cuerpos, tokens ni filas de gastos en logs.
    const message=error instanceof Error?error.message:(error&&typeof error==="object"&&"message" in error)?String(error.message):String(error);
    return json({ok:false,error:message},400);
  }
});
