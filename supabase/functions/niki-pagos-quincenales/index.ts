import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const safe=(x:unknown)=>x instanceof Error?x.message:String(x);
const b64url=(input:string|ArrayBuffer)=>{const b=typeof input==='string'?new TextEncoder().encode(input):new Uint8Array(input);let s='';b.forEach(x=>s+=String.fromCharCode(x));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');};
const hmac=async(body:string,secret:string)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));};
async function validSession(token:string,secret:string){const [b,s]=String(token||'').split('.');if(!b||!s||await hmac(b,secret)!==s)return null;try{const n=b.replace(/-/g,'+').replace(/_/g,'/');const p=JSON.parse(atob(n+'='.repeat((4-n.length%4)%4)));return p.uid&&Number(p.exp)>Date.now()/1000?p:null;}catch{return null;}}
const money=(x:unknown)=>{const v=Number(x);if(!Number.isFinite(v)||Math.abs(v)>100000000)return NaN;return Math.round(v*100)/100;};
const integer=(x:unknown)=>Number.isSafeInteger(Number(x))?Number(x):0;
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({ok:false,error:'Método no permitido'},405);
 try{
  const body=await req.json();const action=String(body.action||'');
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const secret=Deno.env.get('NIKI_SESSION_SECRET')||Deno.env.get('NIKI_IMPORT_TOKEN')||'';
  if(!secret)throw new Error('Falta el secreto de sesión Niki.');
  const session=await validSession(String(body.session_token||''),secret);
  const actorId=integer(body.actor_id);
  if(!session||actorId!==integer(session.uid))return json({ok:false,error:'Sesión inválida'},401);
  const {data:actor,error:actorError}=await admin.from('users').select('id,rol,activo').eq('id',actorId).maybeSingle();
  if(actorError)throw actorError;
  if(!actor||actor.activo===false||!['admin','casa_matriz'].includes(actor.rol))return json({ok:false,error:'Solo Administración y Casa Matriz pueden gestionar estos pagos'},403);
  const periodo=String(body.periodo||'');const quincena=integer(body.quincena);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)||![1,2].includes(quincena))return json({ok:false,error:'Período incorrecto'},400);
  const localId=integer(body.local_id);const userId=integer(body.user_id);
  const scoped=async()=>{
    if(!localId||!userId)throw new Error('Falta local o manicura');
    const [l,u]=await Promise.all([admin.from('locales').select('id').eq('id',localId).maybeSingle(),admin.from('users').select('id,rol').eq('id',userId).maybeSingle()]);
    if(l.error||u.error||!l.data||!u.data)throw new Error('Local o manicura inexistente');
  };
  const base=()=>admin.from('niki_liquidaciones_quincenales').select('*').eq('periodo',periodo).eq('quincena',quincena);
  if(action==='list'){
    const localIds=Array.isArray(body.local_ids)?body.local_ids.map(integer).filter(Boolean).slice(0,150):[];
    if(!localIds.length)return json({ok:true,liquidaciones:[],pagos:[]});
    const {data:liquidaciones,error}=await base().in('local_id',localIds).order('version',{ascending:false});if(error)throw error;
    const ids=(liquidaciones||[]).map((x:any)=>x.id);
    let pagos:any[]=[];
    if(ids.length){const out=await admin.from('niki_pagos_comisiones').select('*').in('liquidacion_id',ids);if(out.error)throw out.error;pagos=out.data||[];}
    return json({ok:true,liquidaciones:liquidaciones||[],pagos});
  }
  await scoped();
  const {data:revisiones,error:readError}=await base().eq('local_id',localId).eq('user_id',userId).order('version',{ascending:false});if(readError)throw readError;
  const actual=(revisiones||[]).find((x:any)=>x.estado==='revisada');
  if(action==='review'){
    if(actual)return json({ok:false,error:'Esta liquidación ya está revisada. Reabrila antes de crear otra versión.'},409);
    const row=body.snapshot;
    if(!row||typeof row!=='object'||Array.isArray(row)||integer(row.uid)!==userId||integer(row.principal)!==localId)throw new Error('Detalle de liquidación inválido');
    const monto=money(row.total),comision=money(row.comision),complemento=money(row.complemento),ajuste=money(row.ajustesGarantia),adelantos=money(row.adelantos);
    if([monto,comision,complemento,ajuste,adelantos].some(x=>!Number.isFinite(x))||monto<0||![35,40].includes(integer(row.pct)))throw new Error('Importes o porcentaje inválidos');
    if(Math.abs(monto-(comision+complemento+ajuste-adelantos))>0.03)throw new Error('El total no coincide con el detalle de la liquidación');
    if(!Array.isArray(row.ventas)||!Array.isArray(row.todosLosDias))throw new Error('Falta detalle de servicios o jornadas');
    const desde=`${periodo}-${quincena===1?'01':'16'}`;const hasta=quincena===1?`${periodo}-15`:`${periodo}-${new Date(Number(periodo.slice(0,4)),Number(periodo.slice(5)),0).getDate()}`;
    const validSales=(row.ventas||[]).filter((v:any)=>String(v.fechaPago||'').slice(0,10)>=desde&&String(v.fechaPago||'').slice(0,10)<=hasta);
    if(validSales.length!==row.ventas.length)throw new Error('Hay prestaciones fuera de la quincena');
    const comisionOrigen=validSales.reduce((s:number,v:any)=>s+money(v.comision),0);
    if(Math.abs(money(comisionOrigen*integer(row.pct)/40)-comision)>0.10)throw new Error('La comisión no coincide con las prestaciones y el porcentaje');
    const {data:shadow,error:shadowError}=await admin.from('comisiones_agendapro_shadow').select('hash_registro,comision,fecha_pago,user_id,local_id').eq('user_id',userId).gte('fecha_pago',desde).lte('fecha_pago',hasta);
    if(shadowError)throw shadowError;
    const indexed=new Map((shadow||[]).map((v:any)=>[String(v.hash_registro),v]));
    for(const v of validSales){const src=indexed.get(String(v.hashRegistro||''));if(!src||Math.abs(money(src.comision)-money(v.comision))>0.02)throw new Error('Las ventas cambiaron desde que se calculó la liquidación. Actualizá el piloto.');}
    const version=Math.max(0,...(revisiones||[]).map((r:any)=>integer(r.version)))+1;
    const {data:created,error}=await admin.from('niki_liquidaciones_quincenales').insert({periodo,quincena,local_id:localId,user_id:userId,version,estado:'revisada',total:monto,comision,complemento_minimo:complemento,ajustes_garantia:ajuste,adelantos,porcentaje:integer(row.pct),snapshot:row,revisada_por_user_id:actorId}).select('*').single();if(error)throw error;
    return json({ok:true,liquidacion:created});
  }
  if(!actual)throw new Error('Primero revisá y congelá esta liquidación');
  const liquidacionId=integer(body.liquidacion_id);
  if(liquidacionId!==integer(actual.id))throw new Error('La versión de la liquidación cambió. Recargá la pantalla.');
  const {data:pagos,error:pe}=await admin.from('niki_pagos_comisiones').select('*').eq('liquidacion_id',actual.id).is('anulado_en',null);if(pe)throw pe;
  const pagado=(pagos||[]).reduce((s:number,x:any)=>s+money(x.importe),0);
  if(action==='reopen'){
    if(pagado>0)throw new Error('No se puede reabrir una liquidación con pagos registrados. Primero hay que regularizar esos pagos.');
    const motivo=String(body.motivo||'').trim();if(motivo.length<8)throw new Error('Indicá un motivo de reapertura');
    const {error}=await admin.from('niki_liquidaciones_quincenales').update({estado:'reabierta',reabierta_por_user_id:actorId,reabierta_en:new Date().toISOString(),motivo_reapertura:motivo}).eq('id',actual.id).eq('estado','revisada');if(error)throw error;
    return json({ok:true});
  }
  if(action==='prepare'){
    const medio=String(body.medio||'');if(!['efectivo','transferencia'].includes(medio))throw new Error('Medio incorrecto');
    const {error}=await admin.from('niki_liquidaciones_quincenales').update({medio_preparado:medio}).eq('id',actual.id);if(error)throw error;
    return json({ok:true});
  }
  if(action==='bank'){
    const dato=String(body.dato_bancario||'').trim();
    if(dato&&!(/^\d{22}$/.test(dato)||/^[A-Za-z0-9._-]{6,20}$/.test(dato)))throw new Error('CBU o alias inválido');
    const {error}=await admin.from('users').update({dato_bancario:dato}).eq('id',userId);if(error)throw error;
    return json({ok:true});
  }
  if(action==='pay'){
    const importe=money(body.importe),medio=String(body.medio||'');
    if(!Number.isFinite(importe)||importe<=0||!['efectivo','transferencia'].includes(medio))throw new Error('Importe o medio de pago incorrecto');
    if(importe>money(actual.total-pagado)+0.01)throw new Error('El pago supera el saldo de la liquidación');
    const fecha=String(body.fecha_pago||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha))throw new Error('Fecha inválida');
    const {data:created,error}=await admin.from('niki_pagos_comisiones').insert({liquidacion_id:actual.id,importe,medio,fecha_pago:fecha,referencia:String(body.referencia||'').slice(0,300)||null,dato_bancario_snapshot:medio==='transferencia'?String(body.dato_bancario||''):null,registrado_por_user_id:actorId}).select('*').single();if(error)throw error;
    return json({ok:true,pago:created});
  }
  return json({ok:false,error:'Acción desconocida'},400);
 }catch(e){return json({ok:false,error:safe(e)},400);}
});
