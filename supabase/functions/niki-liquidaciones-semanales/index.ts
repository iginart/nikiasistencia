import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
const b64url=(input:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(input))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
async function hmac(msg:string,secret:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg)));}
async function session(token:string,secret:string){const [body,sig]=String(token||'').split('.');if(!body||!sig||await hmac(body,secret)!==sig)return null;try{const raw=body.replace(/-/g,'+').replace(/_/g,'/');const obj=JSON.parse(atob(raw+'='.repeat((4-raw.length%4)%4)));return Number(obj.exp)>Date.now()/1000?obj:null;}catch{return null;}}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({ok:false,error:'Método inválido'},405);
 try{
  const b=await req.json();const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const secret=Deno.env.get('NIKI_SESSION_SECRET')||Deno.env.get('NIKI_IMPORT_TOKEN')||'';
  if(!secret)throw new Error('Falta secreto Niki');
  const auth=await session(String(b.session_token||''),secret);const actorId=Number(b.actor_id);
  if(!auth||Number(auth.uid)!==actorId)return json({ok:false,error:'Sesión inválida'},401);
  const {data:actor,error:ae}=await admin.from('users').select('id,rol,activo').eq('id',actorId).maybeSingle();
  if(ae)throw ae;if(!actor||actor.activo===false||!['admin','casa_matriz'].includes(actor.rol))return json({ok:false,error:'Solo Administración y Casa Matriz'},403);
  // Aplicar el mismo alcance que getAssignedLocalIds: Casa Matriz ve todos
  // los propios y solo las franquicias explícitamente asignadas.
  const {data:allLocales,error:le}=await admin.from('locales').select('id,tipo_local');
  if(le)throw le;
  let allowedLocalIds=(allLocales||[]).map((x:any)=>Number(x.id));
  if(actor.rol==='casa_matriz'){
    const {data:assigned,error:ue}=await admin.from('usuario_locales').select('local_id').eq('user_id',actorId);
    if(ue)throw ue;
    const explicit=new Set((assigned||[]).map((x:any)=>Number(x.local_id)));
    allowedLocalIds=(allLocales||[]).filter((x:any)=>String(x.tipo_local||'propio')==='propio'||explicit.has(Number(x.id))).map((x:any)=>Number(x.id));
  }
  const allowed=new Set(allowedLocalIds);
  const desde=String(b.desde||'');const hasta=String(b.hasta||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(desde)||!/^\d{4}-\d{2}-\d{2}$/.test(hasta))throw new Error('Fechas inválidas');
  const localId=Number(b.local_id),userId=Number(b.user_id);const action=String(b.action||'');
  if(action==='list'){
   if(!allowedLocalIds.length)return json({ok:true,liquidaciones:[],porcentajes:[],recuperaciones:[],pagos:[]});
   const [a,p,r]=await Promise.all([
     admin.from('niki_liquidaciones_semanales').select('*').eq('desde',desde).eq('hasta',hasta).in('local_id',allowedLocalIds).order('version',{ascending:false}),
     admin.from('niki_porcentajes_semanales').select('*').eq('desde',desde).eq('hasta',hasta).in('local_id',allowedLocalIds),
     admin.from('niki_recuperaciones_semanales').select('*').eq('desde',desde).eq('hasta',hasta).in('local_id',allowedLocalIds)]);
   if(a.error||p.error||r.error)throw(a.error||p.error||r.error);
   const ids=(a.data||[]).map((x:any)=>x.id);
   let pagos:any[]=[];
   if(ids.length){const out=await admin.from('niki_pagos_semanales').select('*').in('liquidacion_id',ids);if(out.error)throw out.error;pagos=out.data||[];}
   return json({ok:true,liquidaciones:a.data||[],porcentajes:p.data||[],recuperaciones:r.data||[],pagos});
  }
  if(!['review','reopen','percentage','recovery','prepare','pay','bank'].includes(action))throw new Error('Acción desconocida');
  if(!Number.isSafeInteger(localId)||localId<=0||!Number.isSafeInteger(userId)||userId<=0)throw new Error('Sucursal o manicura inválida');
  if(!allowed.has(localId))return json({ok:false,error:'No tenés permisos para esta sucursal'},403);
  const [loc,usr]=await Promise.all([admin.from('locales').select('id').eq('id',localId).maybeSingle(),admin.from('users').select('id').eq('id',userId).maybeSingle()]);
  if(loc.error||usr.error||!loc.data||!usr.data)throw new Error('Sucursal o manicura inexistente');
  // Defensa del servidor: nunca escribir semanal en locales configurados como quincenales.
  const {data:modalidad,error:me}=await admin.from('comisiones_quincenales_locales')
    .select('modalidad,fecha_desde').eq('local_id',localId).maybeSingle();
  if(me)throw me;
  if(modalidad?.modalidad==='quincenal' && (!modalidad.fecha_desde || modalidad.fecha_desde<=hasta))
    return json({ok:false,error:'Este local tiene liquidación quincenal. No se permite registrar una liquidación semanal.'},409);
  // Nunca aceptar un ID de liquidación de otra sucursal, manicura o semana,
  // aunque un cliente manipule los parámetros de la petición.
  if(['bank','prepare','pay'].includes(action)){
    const liquidationId=Number(b.liquidacion_id);
    if(!Number.isSafeInteger(liquidationId)||liquidationId<=0)throw new Error('Liquidación obligatoria');
    const {data:matched,error:qe}=await admin.from('niki_liquidaciones_semanales')
      .select('id,local_id,user_id,desde,hasta,estado')
      .eq('id',liquidationId).eq('local_id',localId).eq('user_id',userId)
      .eq('desde',desde).eq('hasta',hasta).maybeSingle();
    if(qe)throw qe;
    if(!matched||matched.estado!=='revisada')throw new Error('Liquidación no validada o no corresponde al corte seleccionado');
  }
  if(action==='bank'){
   const dato=String(b.dato_bancario||'').trim();
   if(dato&&!(/^\d{22}$/.test(dato)||/^[A-Za-z0-9._-]{6,20}$/.test(dato)))throw new Error('CBU o alias inválido');
   const {error}=await admin.from('users').update({dato_bancario:dato}).eq('id',userId);
   if(error)throw error;return json({ok:true});
  }
  if(action==='prepare'||action==='pay'){
   const {data,error}=await admin.rpc('niki_semanal_pago',{
    p_action:action,p_liquidacion_id:Number(b.liquidacion_id||0),p_actor_id:actorId,
    p_medio:b.medio||null,p_importe:action==='pay'?Number(b.importe):null,
    p_fecha_pago:b.fecha_pago||null,p_referencia:b.referencia||null,
    p_dato_bancario:b.dato_bancario||null,p_idempotency_key:b.idempotency_key||null
   });
   if(error)throw error;return json(data);
  }
  if(action==='recovery'){
   const {data,error}=await admin.rpc('niki_semanal_recuperacion',{
    p_desde:desde,p_hasta:hasta,p_local_id:localId,p_user_id:userId,p_actor_id:actorId,
    p_fecha_ausencia:b.fecha_ausencia??null,p_recuperada:b.recuperada??false,
    p_horas_recuperadas:b.horas_recuperadas??0,p_detalle:b.detalle??''
   });
   if(error)throw error;return json(data);
  }
  const {data,error}=await admin.rpc('niki_semanal_transaccion',{ 
   p_action:action,p_desde:desde,p_hasta:hasta,p_local_id:localId,p_user_id:userId,p_actor_id:actorId,
   p_snapshot:b.snapshot??null,p_motivo:b.motivo??null,p_porcentaje:b.porcentaje??null,p_liquidacion_id:b.liquidacion_id??null
  });
  if(error)throw error;return json(data);
 }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},400);}
});
