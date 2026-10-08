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
function isDate(v: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")); }
function dateUtc(key: string) { const [y,m,d]=key.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
function dateKey(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`; }
function addDays(key: string, days: number) { const d=dateUtc(key); d.setUTCDate(d.getUTCDate()+days); return dateKey(d); }
function addMonthsClamped(key: string, months: number) {
  const d=dateUtc(key); const day=d.getUTCDate(); const y=d.getUTCFullYear(); const m=d.getUTCMonth()+months;
  const first=new Date(Date.UTC(y,m,1)); const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return dateKey(new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(day,last))));
}
function firstOfMonth(key: string) { return `${String(key).slice(0,7)}-01`; }
function asNumber(v: unknown) { const n=Number(v); return Number.isFinite(n)?n:null; }
function cleanText(v: unknown) { const s=String(v ?? "").trim(); return s || null; }
function normalizeAlerts(value: unknown) {
  const arr=Array.isArray(value)?value:[];
  return [...new Set(arr.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=60))].sort((a,b)=>b-a).slice(0,8);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:cors });
  if (req.method !== "POST") return json({ ok:false, error:"Metodo no permitido" }, 405);
  try {
    const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret=Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!secret) return json({ok:false,error:"Falta NIKI_SESSION_SECRET"},500);
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const actorId=Number(body.actor_id||0), token=String(body.session_token||""), action=String(body.action||"");
    const session=await verifySession(token,secret);
    if (!actorId || !session || Number(session.uid)!==actorId) return json({ok:false,error:"Sesion invalida o vencida"},401);

    const {data:actor,error:ae}=await admin.from("users").select("id,nombre,rol,activo").eq("id",actorId).maybeSingle();
    if (ae) throw ae;
    if (!actor || actor.activo===false || !["admin","casa_matriz","franquiciado"].includes(actor.rol)) return json({ok:false,error:"Usuario sin permiso para administrar gastos"},403);

    const [{data:locales,error:le},{data:asignaciones,error:ue}]=await Promise.all([
      admin.from("locales").select("id,nombre,tipo_local,activo").order("nombre"),
      admin.from("usuario_locales").select("user_id,local_id").eq("user_id",actorId)
    ]);
    if (le||ue) throw (le||ue);
    const assigned=(asignaciones||[]).map((x:any)=>Number(x.local_id));
    let allowedIds:number[]=[];
    if (actor.rol==="admin") allowedIds=(locales||[]).map((x:any)=>Number(x.id));
    else if (actor.rol==="casa_matriz") {
      const propios=(locales||[]).filter((x:any)=>String(x.tipo_local||"propio")==="propio").map((x:any)=>Number(x.id));
      allowedIds=[...new Set([...propios,...assigned])];
    } else allowedIds=[...new Set(assigned)];
    const allowedSet=new Set(allowedIds);
    const canLocal=(id:unknown)=>allowedSet.has(Number(id));

    async function readConfig(id:number) {
      const {data,error}=await admin.from("gastos_configuracion").select("*").eq("id",id).maybeSingle();
      if (error) throw error;
      if (!data || !canLocal(data.local_id)) return null;
      return data;
    }
    async function readDue(id:number) {
      const {data,error}=await admin.from("gastos_vencimientos").select("*").eq("id",id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const cfg=await readConfig(Number(data.gasto_id));
      return cfg ? {row:data,cfg} : null;
    }
    async function generateForConfig(cfg:any, resetFuture=false) {
      if (!cfg?.activo) return 0;
      const today=dateKey(new Date());
      if (resetFuture) {
        const {error}=await admin.from("gastos_vencimientos").delete().eq("gasto_id",cfg.id).eq("estado","pendiente").gte("fecha_vencimiento",today);
        if (error) throw error;
      }
      const first=String(cfg.fecha_primer_vencimiento);
      const step=Number(cfg.frecuencia_meses||1);
      const startWindow=addDays(today,-62);
      const horizon=addMonthsClamped(today,18);
      const rows:any[]=[];
      for (let i=0;i<240;i++) {
        const due=addMonthsClamped(first,i*step);
        if (due<startWindow) continue;
        if (due>horizon) break;
        if (!cfg.fecha_fin || due<=String(cfg.fecha_fin)) {
          rows.push({gasto_id:Number(cfg.id),periodo:firstOfMonth(due),fecha_vencimiento:due,importe_previsto:cfg.importe_estimado ?? null,estado:"pendiente",actualizado_en:new Date().toISOString()});
        }
      }
      if (!rows.length) return 0;
      const {data,error}=await admin.from("gastos_vencimientos").upsert(rows,{onConflict:"gasto_id,periodo",ignoreDuplicates:true}).select("id");
      if (error) throw error;
      return data?.length||0;
    }

    if (action==="bootstrap") {
      const {data:configs,error:ce}=allowedIds.length
        ? await admin.from("gastos_configuracion").select("*").in("local_id",allowedIds).order("activo",{ascending:false}).order("descripcion")
        : {data:[],error:null};
      if (ce) throw ce;
      const configIds=(configs||[]).map((x:any)=>Number(x.id));
      const {data:dues,error:de}=configIds.length
        ? await admin.from("gastos_vencimientos").select("*").in("gasto_id",configIds).order("fecha_vencimiento",{ascending:true})
        : {data:[],error:null};
      if (de) throw de;
      const {data:users,error:usersErr}=await admin.from("users").select("id,nombre,rol,activo").eq("activo",true).in("rol",["admin","casa_matriz","franquiciado","encargada"]).order("nombre");
      if (usersErr) throw usersErr;
      return json({ok:true,configuraciones:configs||[],vencimientos:dues||[],responsables:users||[],locales:(locales||[]).filter((x:any)=>allowedSet.has(Number(x.id)))});
    }

    if (action==="alerts") {
      const today=dateKey(new Date()), until=addDays(today,60);
      const {data:configs,error:ce}=allowedIds.length?await admin.from("gastos_configuracion").select("id,local_id,descripcion,categoria,proveedor,alertas_dias").in("local_id",allowedIds).eq("activo",true):{data:[],error:null};
      if (ce) throw ce;
      const ids=(configs||[]).map((x:any)=>Number(x.id));
      const {data:rows,error:re}=ids.length?await admin.from("gastos_vencimientos").select("id,gasto_id,fecha_vencimiento,importe_previsto,estado").in("gasto_id",ids).eq("estado","pendiente").lte("fecha_vencimiento",until).order("fecha_vencimiento"):{data:[],error:null};
      if (re) throw re;
      const cfgMap=new Map((configs||[]).map((x:any)=>[Number(x.id),x]));
      const dayMs=86400000, todayMs=dateUtc(today).getTime();
      const items=(rows||[]).filter((r:any)=>{
        const cfg:any=cfgMap.get(Number(r.gasto_id));
        const diff=Math.floor((dateUtc(String(r.fecha_vencimiento)).getTime()-todayMs)/dayMs);
        if (diff<0) return true;
        const alertDays=normalizeAlerts(cfg?.alertas_dias);
        const maxAlert=alertDays.length?Math.max(...alertDays):7;
        return diff<=maxAlert;
      }).map((r:any)=>({...r,config:cfgMap.get(Number(r.gasto_id))}));
      return json({ok:true,today,until,items});
    }

    if (action==="create_config") {
      const localId=Number(body.local_id||0);
      if (!canLocal(localId)) return json({ok:false,error:"Local fuera de tu alcance"},403);
      if (!cleanText(body.descripcion) || !cleanText(body.categoria) || !isDate(body.fecha_primer_vencimiento)) return json({ok:false,error:"Completá local, categoría, descripción y primer vencimiento"},400);
      const freq=Number(body.frecuencia_meses||1); if (![1,2,3,6,12].includes(freq)) return json({ok:false,error:"Frecuencia inválida"},400);
      const now=new Date().toISOString();
      const payload:any={
        local_id:localId,categoria:String(body.categoria).trim(),descripcion:String(body.descripcion).trim(),proveedor:cleanText(body.proveedor),numero_cliente:cleanText(body.numero_cliente),numero_cuenta:cleanText(body.numero_cuenta),codigo_pago:cleanText(body.codigo_pago),forma_pago:cleanText(body.forma_pago),datos_pago:cleanText(body.datos_pago),portal_pago:cleanText(body.portal_pago),frecuencia_meses:freq,fecha_primer_vencimiento:String(body.fecha_primer_vencimiento),tipo_importe:body.tipo_importe==="fijo"?"fijo":"variable",importe_estimado:asNumber(body.importe_estimado),responsable_user_id:asNumber(body.responsable_user_id),alertas_dias:normalizeAlerts(body.alertas_dias),fecha_fin:isDate(body.fecha_fin)?String(body.fecha_fin):null,observaciones:cleanText(body.observaciones),activo:body.activo!==false,creado_por_user_id:actorId,actualizado_por_user_id:actorId,actualizado_en:now
      };
      const {data,error}=await admin.from("gastos_configuracion").insert(payload).select().single(); if (error) throw error;
      await generateForConfig(data,false);
      return json({ok:true,row:data});
    }

    if (action==="update_config") {
      const id=Number(body.id||0), current=await readConfig(id); if (!current) return json({ok:false,error:"Gasto inexistente o sin permiso"},404);
      const localId=Number(body.local_id||current.local_id); if (!canLocal(localId)) return json({ok:false,error:"Local fuera de tu alcance"},403);
      if (!cleanText(body.descripcion) || !cleanText(body.categoria) || !isDate(body.fecha_primer_vencimiento)) return json({ok:false,error:"Completá categoría, descripción y primer vencimiento"},400);
      const freq=Number(body.frecuencia_meses||1); if (![1,2,3,6,12].includes(freq)) return json({ok:false,error:"Frecuencia inválida"},400);
      const payload:any={local_id:localId,categoria:String(body.categoria).trim(),descripcion:String(body.descripcion).trim(),proveedor:cleanText(body.proveedor),numero_cliente:cleanText(body.numero_cliente),numero_cuenta:cleanText(body.numero_cuenta),codigo_pago:cleanText(body.codigo_pago),forma_pago:cleanText(body.forma_pago),datos_pago:cleanText(body.datos_pago),portal_pago:cleanText(body.portal_pago),frecuencia_meses:freq,fecha_primer_vencimiento:String(body.fecha_primer_vencimiento),tipo_importe:body.tipo_importe==="fijo"?"fijo":"variable",importe_estimado:asNumber(body.importe_estimado),responsable_user_id:asNumber(body.responsable_user_id),alertas_dias:normalizeAlerts(body.alertas_dias),fecha_fin:isDate(body.fecha_fin)?String(body.fecha_fin):null,observaciones:cleanText(body.observaciones),activo:body.activo!==false,actualizado_por_user_id:actorId,actualizado_en:new Date().toISOString()};
      const {data,error}=await admin.from("gastos_configuracion").update(payload).eq("id",id).select().single(); if (error) throw error;
      if (data.activo) await generateForConfig(data,true); else {
        const today=dateKey(new Date()); const {error:delErr}=await admin.from("gastos_vencimientos").delete().eq("gasto_id",id).eq("estado","pendiente").gte("fecha_vencimiento",today); if (delErr) throw delErr;
      }
      return json({ok:true,row:data});
    }

    if (action==="generate_config") {
      const id=Number(body.id||0), cfg=await readConfig(id); if (!cfg) return json({ok:false,error:"Gasto inexistente o sin permiso"},404);
      const count=await generateForConfig(cfg,false); return json({ok:true,generados:count});
    }

    if (action==="update_due") {
      const id=Number(body.id||0), found=await readDue(id); if (!found) return json({ok:false,error:"Vencimiento inexistente o sin permiso"},404);
      if (found.row.estado==="pagado") return json({ok:false,error:"Un pago ya registrado debe reabrirse antes de editarlo"},409);
      if (!isDate(body.fecha_vencimiento)) return json({ok:false,error:"Fecha de vencimiento inválida"},400);
      const payload:any={fecha_vencimiento:String(body.fecha_vencimiento),periodo:firstOfMonth(String(body.fecha_vencimiento)),importe_previsto:asNumber(body.importe_previsto),documento_referencia:cleanText(body.documento_referencia),observaciones:cleanText(body.observaciones),actualizado_en:new Date().toISOString()};
      const {data,error}=await admin.from("gastos_vencimientos").update(payload).eq("id",id).select().single(); if (error) throw error;
      return json({ok:true,row:data});
    }

    if (action==="pay_due") {
      const id=Number(body.id||0), found=await readDue(id); if (!found) return json({ok:false,error:"Vencimiento inexistente o sin permiso"},404);
      const fecha=isDate(body.fecha_pago)?String(body.fecha_pago):dateKey(new Date());
      const importe=asNumber(body.importe_pagado); if (importe===null || importe<0) return json({ok:false,error:"Ingresá el importe pagado"},400);
      const payload:any={estado:"pagado",fecha_pago:fecha,importe_pagado:importe,forma_pago_real:cleanText(body.forma_pago_real)||found.cfg.forma_pago||null,referencia_pago:cleanText(body.referencia_pago),observaciones:cleanText(body.observaciones)??found.row.observaciones??null,pagado_por_user_id:actorId,actualizado_en:new Date().toISOString()};
      const {data,error}=await admin.from("gastos_vencimientos").update(payload).eq("id",id).select().single(); if (error) throw error;
      return json({ok:true,row:data});
    }

    if (action==="reopen_due") {
      const id=Number(body.id||0), found=await readDue(id); if (!found) return json({ok:false,error:"Vencimiento inexistente o sin permiso"},404);
      const payload={estado:"pendiente",fecha_pago:null,importe_pagado:null,forma_pago_real:null,referencia_pago:null,pagado_por_user_id:null,actualizado_en:new Date().toISOString()};
      const {data,error}=await admin.from("gastos_vencimientos").update(payload).eq("id",id).select().single(); if (error) throw error;
      return json({ok:true,row:data});
    }

    return json({ok:false,error:"Accion invalida"},400);
  } catch (e) {
    console.error(e);
    return json({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
