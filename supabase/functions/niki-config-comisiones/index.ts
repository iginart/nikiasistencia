import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
const b64url=(input:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(input))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
async function hmac(msg:string,secret:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg)));}
async function session(token:string,secret:string){const [body,sig]=String(token||'').split('.');if(!body||!sig||await hmac(body,secret)!==sig)return null;try{const raw=body.replace(/-/g,'+').replace(/_/g,'/');const obj=JSON.parse(atob(raw+'='.repeat((4-raw.length%4)%4)));return Number(obj.exp)>Date.now()/1000?obj:null;}catch{return null;}}
const weeklyGeneral=['porcentaje_base','porcentaje_reducido','horas_objetivo_default','horas_objetivo_fin_semana','max_llegadas_tarde','max_faltas_no_justificadas','minimo_semanal_estandar','minimo_semanal_premium_exclusiva','minimo_semanal_estandar_fin_semana','minimo_semanal_premium_exclusiva_fin_semana'];
const fortnightGeneral=['porcentaje_normal','porcentaje_reducido','horas_quincenales','horas_finde_dia','tardanzas_penalizacion','faltas_no_justificadas','minimo_estandar','minimo_premium','minimo_finde_estandar','minimo_finde_premium'];
const weeklyPersonal=['horas_objetivo_semanales','porcentaje_base','porcentaje_reducido','max_llegadas_tarde','max_faltas_no_justificadas'];
const fortnightPersonal=['horas_quincenales','horas_finde_dia','porcentaje_normal','porcentaje_reducido','tardanzas_penalizacion','faltas_no_justificadas'];
const asNumeric=(obj:Record<string,unknown>,names:string[])=>{const out:Record<string,number|null>={};for(const k of names){const v=obj[k];if(v===''||v==null){out[k]=null;continue;}const n=Number(v);if(!Number.isFinite(n)||n<0||((k.startsWith('porcentaje_'))&&n>100))throw new Error(`Valor inválido: ${k}`);out[k]=n;}return out;};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({ok:false,error:'Método no permitido'},405);
 try{
  const body=await req.json();
  const secret=Deno.env.get('NIKI_SESSION_SECRET')||Deno.env.get('NIKI_IMPORT_TOKEN')||'';
  if(!secret)throw new Error('Falta secreto de sesión');
  const auth=await session(String(body.session_token||''),secret),actorId=Number(body.actor_id);
  if(!auth||Number(auth.uid)!==actorId)return json({ok:false,error:'Sesión inválida'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:user,error:userError}=await admin.from('users').select('id,rol,activo,local_id').eq('id',actorId).maybeSingle();
  if(userError)throw userError;
  if(!user||user.activo===false||!['admin','casa_matriz','franquiciado','encargada'].includes(user.rol))return json({ok:false,error:'Sin permiso para consultar comisiones'},403);
  const mode=String(body.modalidad||'');if(!['semanal','quincenal'].includes(mode))throw new Error('Modalidad inválida');
  const action=String(body.action||'load');
  const canWrite=['admin','casa_matriz'].includes(user.rol);
  if(action!=='load'&&!canWrite)return json({ok:false,error:'Solo Administración y Casa Matriz pueden modificar configuraciones'},403);
  const generalTable=mode==='semanal'?'comisiones_configuracion':'comisiones_quincenales_config';
  const personalTable=mode==='semanal'?'comisiones_manicura_config':'comisiones_quincenales_manicura_config';
  if(action==='load'){
    const [g,p]=await Promise.all([
      mode==='semanal'?admin.from(generalTable).select('*').eq('activo',true).order('id',{ascending:true}).limit(1):admin.from(generalTable).select('*').eq('id',1).limit(1),
      admin.from(personalTable).select('*')
    ]);
    if(g.error||p.error)throw(g.error||p.error);
    if(canWrite)return json({ok:true,general:g.data?.[0]||null,excepciones:p.data||[]});
    const [mine,managed]=await Promise.all([
      admin.from('usuario_locales').select('local_id').eq('user_id',actorId),
      admin.from('encargado_locales').select('local_id').eq('user_id',actorId)
    ]);
    // Las configuraciones personales solo se comparten para sucursales permitidas.
    if(mine.error||managed.error)throw(mine.error||managed.error);
    const ids=new Set([Number(user.local_id),...(mine.data||[]).map((x:any)=>Number(x.local_id)),...(managed.data||[]).map((x:any)=>Number(x.local_id))]);
    return json({ok:true,general:g.data?.[0]||null,excepciones:(p.data||[]).filter((x:any)=>ids.has(Number(x.local_id)))});
  }
  if(action==='save_general'){
    const obj=asNumeric(body.valores||{},mode==='semanal'?weeklyGeneral:fortnightGeneral);
    const {data:actual,error:readErr}=await admin.from(generalTable).select('id').eq('id',Number(body.id||1)).maybeSingle();
    if(readErr)throw readErr;if(!actual)throw new Error('Configuración general no encontrada');
    const {error}=await admin.from(generalTable).update({...obj,actualizado_por_user_id:actorId,actualizado_en:new Date().toISOString()}).eq('id',actual.id);
    if(error)throw error;return json({ok:true});
  }
  if(action==='save_person'||action==='delete_person'){
    const uid=Number(body.user_id),lid=Number(body.local_id);
    if(!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(lid)||lid<=0)throw new Error('Manicura o local inválido');
    const [target,local]=await Promise.all([admin.from('users').select('id,activo,rol').eq('id',uid).maybeSingle(),admin.from('locales').select('id').eq('id',lid).maybeSingle()]);
    if(target.error||local.error)throw(target.error||local.error);
    if(!target.data||!local.data)throw new Error('Manicura o sucursal no encontrada');
    if(action==='delete_person'){
      const {error}=await admin.from(personalTable).delete().eq('user_id',uid).eq('local_id',lid);
      if(error)throw error;return json({ok:true});
    }
    const cols=mode==='semanal'?weeklyPersonal:fortnightPersonal;
    const valores=asNumeric(body.valores||{},cols);
    const payload={user_id:uid,local_id:lid,...valores,actualizado_por_user_id:actorId,actualizado_en:new Date().toISOString(),...(mode==='semanal'?{activo:true}:{})};
    if(mode==='semanal'){
      // La tabla semanal existente se actualiza por su clave de negocio;
      // no exigimos un índice ON CONFLICT que podría no estar presente.
      const {data:existing,error:lookupError}=await admin.from(personalTable).select('id').eq('user_id',uid).eq('local_id',lid).limit(2);
      if(lookupError)throw lookupError;
      if((existing||[]).length>1)throw new Error('Hay configuraciones semanales duplicadas. Corregí los registros antes de continuar.');
      const op=existing?.length?admin.from(personalTable).update(payload).eq('id',existing[0].id):admin.from(personalTable).insert(payload);
      const {error}=await op;if(error)throw error;
    }else{
      const {error}=await admin.from(personalTable).upsert(payload,{onConflict:'user_id,local_id'});
      if(error)throw error;
    }
    return json({ok:true});
  }
  return json({ok:false,error:'Acción no admitida'},400);
 }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},400);}
});
