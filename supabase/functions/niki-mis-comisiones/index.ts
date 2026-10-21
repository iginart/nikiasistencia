import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'};
const json=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
const b64url=(input:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(input))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
async function hmac(msg:string,secret:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg)));}
async function session(token:string,secret:string){const [body,sig]=String(token||'').split('.');if(!body||!sig||await hmac(body,secret)!==sig)return null;try{const raw=body.replace(/-/g,'+').replace(/_/g,'/');const obj=JSON.parse(atob(raw+'='.repeat((4-raw.length%4)%4)));return Number(obj.exp)>Date.now()/1000?obj:null;}catch{return null;}}
const safeMoney=(n:unknown)=>Number(n||0);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({ok:false,error:'Método no permitido'},405);
 try {
  const body=await req.json();
  const secret=Deno.env.get('NIKI_SESSION_SECRET')||Deno.env.get('NIKI_IMPORT_TOKEN')||'';
  if(!secret)throw new Error('No está configurado el secreto de sesión de Niki');
  const auth=await session(String(body.session_token||''),secret);const actorId=Number(body.actor_id);
  if(!auth||Number(auth.uid)!==actorId)return json({ok:false,error:'Sesión inválida'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:user,error:userError}=await admin.from('users').select('id,rol,activo,dato_bancario').eq('id',actorId).maybeSingle();
  if(userError)throw userError;
  if(!user||user.activo===false||user.rol!=='manicura')return json({ok:false,error:'Solo disponible para manicuras'},403);
  const action=String(body.action||'load');
  if(action==='bank'){
    const dato=String(body.dato_bancario||'').trim();
    if(dato&&!(/^\d{22}$/.test(dato)||/^[A-Za-z0-9._-]{6,20}$/.test(dato)))return json({ok:false,error:'CBU o alias inválido'},400);
    const {error}=await admin.from('users').update({dato_bancario:dato||null}).eq('id',actorId);if(error)throw error;
  return json({ok:true,dato_bancario:dato});
  }
  if(action!=='load')return json({ok:false,error:'Acción no válida'},400);
  const periodo=String(body.periodo||'');if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(periodo))throw new Error('Mes inválido');
  const first=`${periodo}-01`;
  const last=new Date(Date.UTC(Number(periodo.slice(0,4)),Number(periodo.slice(5,7)),0)).toISOString().slice(0,10);
  const six=new Date(Date.UTC(Number(periodo.slice(0,4)),Number(periodo.slice(5,7))-6,1)).toISOString().slice(0,7);
  // Cada consulta está restringida a user_id del token autenticado, nunca se admite un ID del navegador.
  const [weekly,fortnight,sales,compat,base,historyWeek,historyFortnight,modalidades,asistencias,horarios]=await Promise.all([
    admin.from('niki_liquidaciones_semanales').select('*').eq('user_id',actorId).lte('desde',last).gte('hasta',first).order('version',{ascending:false}),
    admin.from('niki_liquidaciones_quincenales').select('*').eq('user_id',actorId).eq('periodo',periodo).order('version',{ascending:false}),
    admin.from('comisiones_agendapro_shadow').select('local_id,fecha_pago,servicio,cliente,precio,comision,sale_id,source_item_id,item_type').eq('user_id',actorId).gte('fecha_pago',first).lte('fecha_pago',last).limit(5000),
    admin.from('vw_comisiones_agendapro_compat').select('local_id,fecha_pago,servicio,cliente,precio,comision,source_item_id,item_type').eq('user_id',actorId).gte('fecha_pago',first).lte('fecha_pago',last).limit(5000),
    admin.from('vw_comisiones_agendapro_base').select('local_id,fecha_pago,servicio,servicio_agendapro,cliente,precio_efectivo,precio_cobrado_agendapro,source_item_id,item_type,sale_id,estado').eq('user_id',actorId).gte('fecha_pago',first).lte('fecha_pago',last).limit(5000),
    admin.from('niki_liquidaciones_semanales').select('desde,local_id,estado,total,version').eq('user_id',actorId).gte('desde',`${six}-01`).lte('desde',last).order('version',{ascending:false}),
    admin.from('niki_liquidaciones_quincenales').select('periodo,quincena,local_id,estado,total,version').eq('user_id',actorId).gte('periodo',six).lte('periodo',periodo).order('version',{ascending:false}),
    admin.from('comisiones_quincenales_locales').select('local_id,modalidad,fecha_desde').lte('fecha_desde',last),
    admin.from('asistencias').select('local_id,fecha,estado,entrada_real,salida_real').eq('user_id',actorId).gte('fecha',first).lte('fecha',last),
    admin.from('horarios').select('local_id,fecha,entrada,salida,trabaja').eq('user_id',actorId).gte('fecha',first).lte('fecha',last)
  ]);
  for(const r of [weekly,fortnight,sales,compat,base,historyWeek,historyFortnight,modalidades,asistencias,horarios])if(r.error)throw r.error;
  const ws=new Map<string,any>();for(const r of weekly.data||[]){const key=`${r.local_id}|${r.desde}|${r.hasta}`;if(!ws.has(key))ws.set(key,r);}
  const qs=new Map<string,any>();for(const r of fortnight.data||[]){const key=`${r.local_id}|${r.periodo}|${r.quincena}`;if(!qs.has(key))qs.set(key,r);}
  const liqs:any[]=[];
  for(const r of ws.values())liqs.push({...r,key:`semanal:${r.id}`,modalidad:'semanal'});
  for(const r of qs.values()){
    const day=r.quincena===1?'01':'16',end=r.quincena===1?'15':last.slice(8);
    liqs.push({...r,desde:`${r.periodo}-${day}`,hasta:`${r.periodo}-${end}`,key:`quincenal:${r.id}`,modalidad:'quincenal'});
  }
  const weeklyIds=liqs.filter(x=>x.modalidad==='semanal').map(x=>x.id);
  const fortnightIds=liqs.filter(x=>x.modalidad==='quincenal').map(x=>x.id);
  const [wp,qp,loc]=await Promise.all([
    weeklyIds.length?admin.from('niki_pagos_semanales').select('id,liquidacion_id,importe,medio,fecha_pago,referencia,anulado_en').in('liquidacion_id',weeklyIds):Promise.resolve({data:[],error:null}),
    fortnightIds.length?admin.from('niki_pagos_comisiones').select('id,liquidacion_id,importe,medio,fecha_pago,referencia,anulado_en').in('liquidacion_id',fortnightIds):Promise.resolve({data:[],error:null}),
    admin.from('locales').select('id,nombre')
  ]);
  if(wp.error||qp.error||loc.error)throw(wp.error||qp.error||loc.error);
  const nameById=new Map((loc.data||[]).map((x:any)=>[Number(x.id),x.nombre]));
  const payments=[...(wp.data||[]).filter((p:any)=>!p.anulado_en).map((p:any)=>({...p,liquidacion_key:`semanal:${p.liquidacion_id}`})),...(qp.data||[]).filter((p:any)=>!p.anulado_en).map((p:any)=>({...p,liquidacion_key:`quincenal:${p.liquidacion_id}`}))];
  const tend=new Map<string,number>();
  for(const r of historyWeek.data||[]){const k=`${r.local_id}|${r.desde}`;if(!tend.has(k)&&r.estado==='revisada')tend.set(k,safeMoney(r.total));else if(!tend.has(k))tend.set(k,0);}
  const tendQ=new Map<string,number>();
  for(const r of historyFortnight.data||[]){const k=`${r.local_id}|${r.periodo}|${r.quincena}`;if(!tendQ.has(k)&&r.estado==='revisada')tendQ.set(k,safeMoney(r.total));else if(!tendQ.has(k))tendQ.set(k,0);}
  const tendencia:any[]=[];for(const [key,total] of tend){const [local_id,desde]=key.split('|');tendencia.push({local_id:Number(local_id),periodo:desde.slice(0,7),total});}
  for(const [key,total] of tendQ){const [local_id,month]=key.split('|');tendencia.push({local_id:Number(local_id),periodo:month,total});}
  // Se separan el precio cobrado y el precio histórico computable.
  // La vista base permite obtener clientes incluso si aún falta una vinculación
  // o la lista de precios vigente. Jamás se aplica 40% al precio cobrado como
  // sustituto de la comisión oficial.
  const keyOf=(x:any)=>`${String(x.item_type||'')}|${String(x.source_item_id||'')}`;
  const compBy=new Map<string,any>();
  for(const x of compat.data||[])compBy.set(keyOf(x),x);
  const baseBy=new Map<string,any>();
  for(const x of base.data||[])baseBy.set(keyOf(x),x);
  const salesBy=new Map<string,any>();
  for(const x of sales.data||[])salesBy.set(keyOf(x),x);
  // Para ventas no vinculadas a la vista base, recuperar datos directos de origen.
  const saleIds=[...new Set([...baseBy.values(),...salesBy.values()].map((x:any)=>Number(x.sale_id)).filter(Boolean))];
  const saleClients=new Map<number,string>();
  if(saleIds.length){
    for(let offset=0;offset<saleIds.length;offset+=200){
      const {data:raw,error:rawErr}=await admin.from('agenda_sales')
        .select('sale_id,client_first_name,client_last_name').in('sale_id',saleIds.slice(offset,offset+200));
      if(rawErr)throw rawErr;
      for(const r of raw||[]){const name=[r.client_first_name,r.client_last_name].filter(Boolean).join(' ').trim();if(name)saleClients.set(Number(r.sale_id),name);}
    }
  }
  const mergedSales:any[]=[];
  const allKeys=new Set([...salesBy.keys(),...baseBy.keys(),...compBy.keys()]);
  for(const key of allKeys){
    const x=salesBy.get(key)||{};const b=baseBy.get(key)||{};const c=compBy.get(key)||{};
    const precioHistorico=c.precio??b.precio_efectivo??x.precio??null;
    const comisionHistorica=c.comision??(precioHistorico!=null?Math.round(Number(precioHistorico)*40)/100:null);
    const nombre=(c.cliente||b.cliente||saleClients.get(Number(b.sale_id||x.sale_id))||x.cliente||'').trim();
    mergedSales.push({local_id:c.local_id??b.local_id??x.local_id,fecha_pago:c.fecha_pago??b.fecha_pago??x.fecha_pago,
      servicio:c.servicio||b.servicio||b.servicio_agendapro||x.servicio,
      cliente:nombre||null,precio:precioHistorico,comision:comisionHistorica,
      precio_cobrado:b.precio_cobrado_agendapro??null,
      estado_origen:b.estado||((c.source_item_id!=null)?'OK':'SIN_VALIDAR'),
      fuente_importe:c.precio!=null?'vista_compat':b.precio_efectivo!=null?'vista_base':x.precio!=null?'shadow':'sin_precio',
      source_item_id:c.source_item_id??b.source_item_id??x.source_item_id,item_type:c.item_type??b.item_type??x.item_type});
  }
  return json({ok:true,dato_bancario:user.dato_bancario||'',liquidaciones:liqs.map(x=>({key:x.key,modalidad:x.modalidad,desde:x.desde,hasta:x.hasta,local_id:x.local_id,local_nombre:nameById.get(Number(x.local_id))||`Local ${x.local_id}`,estado:x.estado,version:x.version,total:x.total,comision:x.comision,complemento_minimo:x.complemento_minimo,ajustes_garantia:x.ajustes_garantia,adelantos:x.adelantos,porcentaje:x.porcentaje})),pagos:payments,servicios:mergedSales.map((x:any)=>({local_id:x.local_id,fecha_pago:x.fecha_pago,servicio:x.servicio,cliente:x.cliente,precio:x.precio,comision:x.comision,precio_cobrado:x.precio_cobrado,estado_origen:x.estado_origen,fuente_importe:x.fuente_importe,source_item_id:x.source_item_id,item_type:x.item_type})),tendencia,modalidades:modalidades.data||[],asistencias:asistencias.data||[],horarios:horarios.data||[],locales:(loc.data||[]).filter((l:any)=>liqs.some(x=>Number(x.local_id)===Number(l.id))||(sales.data||[]).some((x:any)=>Number(x.local_id)===Number(l.id)))});
 }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},400);}
});
