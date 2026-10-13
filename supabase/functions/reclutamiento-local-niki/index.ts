import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
function b64url(input:string|ArrayBuffer){const bytes=typeof input==="string"?new TextEncoder().encode(input):new Uint8Array(input);let bin="";bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function fromB64url(input:string){const n=input.replace(/-/g,"+").replace(/_/g,"/");return atob(n+"=".repeat((4-n.length%4)%4));}
async function hmacSha256(message:string,secret:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));}
async function verifySession(token:string,secret:string){const [body,sig]=String(token||"").split(".");if(!body||!sig||await hmacSha256(body,secret)!==sig)return null;try{const p=JSON.parse(fromB64url(body));if(!p?.uid||!p?.exp||Number(p.exp)<Math.floor(Date.now()/1000))return null;return p;}catch{return null;}}
const uniq=(xs:any[])=>Array.from(new Set((xs||[]).map(Number).filter(Boolean)));
const sanitizeCompetencias=(raw:any)=>{
  const src=raw&&typeof raw==="object"?raw:{};
  const tri=(v:any)=>v===true?true:v===false?false:null;
  const manos=tri(src?.manos?.realiza),pies=tri(src?.pies?.realiza),cejas=tri(src?.cejas_pestanas?.realiza);
  return {
    manos:{realiza:manos,acrilico:manos===false?false:tri(src?.manos?.acrilico),softgel:manos===false?false:tri(src?.manos?.softgel)},
    pies:{realiza:pies,pedicuria_bisturi:pies===false?false:tri(src?.pies?.pedicuria_bisturi)},
    cejas_pestanas:{realiza:cejas,perfilado:cejas===false?false:tri(src?.cejas_pestanas?.perfilado),hilo:cejas===false?false:tri(src?.cejas_pestanas?.hilo)},
  };
};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"Método no permitido."},405);
  try{
    const url=Deno.env.get("SUPABASE_URL")!, serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret=Deno.env.get("NIKI_SESSION_SECRET")||Deno.env.get("NIKI_IMPORT_TOKEN")||"";
    if(!secret)return json({ok:false,error:"Falta configurar NIKI_SESSION_SECRET."},500);
    const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||""),actorId=Number(body.actor_id||0),token=String(body.session_token||"");
    const session=await verifySession(token,secret);
    if(!actorId||!session||Number(session.uid)!==actorId)return json({ok:false,error:"Sesión inválida o vencida."},401);
    const {data:actor,error:ae}=await admin.from("users").select("id,rol,activo").eq("id",actorId).maybeSingle();
    if(ae||!actor||actor.activo===false)return json({ok:false,error:"Sesión inválida o vencida."},401);
    if(!["admin","casa_matriz","franquiciado","encargada"].includes(actor.rol))return json({ok:false,error:"No tenés permiso para cargar candidatas."},403);

    const central=["admin","casa_matriz"].includes(actor.rol);
    const {data:localRows,error:le}=central
      ? await admin.from("locales").select("id")
      : actor.rol==="franquiciado"
        ? await admin.from("usuario_locales").select("local_id").eq("user_id",actor.id)
        : await admin.from("encargado_locales").select("local_id").eq("user_id",actor.id);
    if(le)throw le;
    const actorLocalIds=uniq((localRows||[]).map((x:any)=>central?x.id:x.local_id));
    if(!actorLocalIds.length)return json({ok:false,error:"No tenés locales asignados para Reclutamiento."},403);
    const actorLocalSet=new Set(actorLocalIds);
    const intakeOnly=actor.rol==="encargada";

    const audit=async(candidataId:number|null,accion:string,detalle:string,datos:unknown=null)=>{await admin.from("reclutamiento_auditoria").insert({candidata_id:candidataId,user_id:actor.id,accion,detalle,datos}).catch(()=>null);};
    const candidateLocalIds=async(id:number)=>{const {data,error}=await admin.from("reclutamiento_candidata_locales").select("local_id").eq("candidata_id",id);if(error)throw error;return uniq((data||[]).map((x:any)=>x.local_id));};
    const candidateInScope=async(id:number)=>{const ids=await candidateLocalIds(id);return ids.some(x=>actorLocalSet.has(Number(x)));};
    const assertCandidateScope=async(id:number)=>{if(!id||!(await candidateInScope(id)))throw new Error("La candidata no pertenece a tus sucursales.");};
    const searchLocalIds=async(id:number)=>{const {data,error}=await admin.from("reclutamiento_busqueda_locales").select("local_id").eq("busqueda_id",id);if(error)throw error;return uniq((data||[]).map((x:any)=>x.local_id));};
    const assertSearchScope=async(id:number)=>{const ids=await searchLocalIds(id);if(!ids.some(x=>actorLocalSet.has(Number(x))))throw new Error("La búsqueda no pertenece a tus sucursales.");};
    const ensureSelectedLocals=(ids:any[],required=true)=>{const clean=uniq(ids);if(required&&!clean.length)throw new Error("Seleccioná al menos una de tus sucursales.");if(clean.some(x=>!actorLocalSet.has(Number(x))))throw new Error("Solo podés trabajar con tus sucursales asignadas.");return clean;};
    const scopedCandidateIds=async()=>{const {data,error}=await admin.from("reclutamiento_candidata_locales").select("candidata_id,local_id").in("local_id",actorLocalIds);if(error)throw error;return uniq((data||[]).map((x:any)=>x.candidata_id));};
    const scopedSearchIds=async()=>{const {data,error}=await admin.from("reclutamiento_busqueda_locales").select("busqueda_id,local_id").in("local_id",actorLocalIds);if(error)throw error;return uniq((data||[]).map((x:any)=>x.busqueda_id));};
    const stageCompletion=async(candidataId:number,orden:number)=>{const {data,error}=await admin.from("reclutamiento_instancias").select("id,orden,nombre,tipo,obligatoria,estado,recomendacion").eq("candidata_id",candidataId).eq("obligatoria",true).lt("orden",orden).order("orden");if(error)throw error;const rows=data||[];const pendiente=rows.find((x:any)=>!["realizada","aprobada"].includes(String(x.estado||"")));if(pendiente)return{ok:false,reason:`Primero debe completarse "${pendiente.nombre}".`};const desf=rows.find((x:any)=>x.tipo!=="documentacion"&&!["si","con_reservas"].includes(String(x.recomendacion||"")));if(desf)return{ok:false,reason:String(desf.recomendacion||"")==="no"?`El resultado de "${desf.nombre}" fue No.`:`Falta una recomendación favorable en "${desf.nombre}".`};return{ok:true,reason:""};};

    if(intakeOnly && !["save_candidate","file_add"].includes(action))return json({ok:false,error:"Las encargadas solo pueden cargar nuevas candidatas para sus locales."},403);

    if(action==="load"){
      const candIds=await scopedCandidateIds(), searchIds=await scopedSearchIds();
      const [circuitos,plantillas,candidatas,locs,servicios,instancias,busquedas,busqLoc,busqSvc]=await Promise.all([
        admin.from("reclutamiento_circuitos").select("*").order("puesto").order("nombre"),
        admin.from("reclutamiento_etapas_plantilla").select("*").order("circuito_id").order("orden"),
        candIds.length?admin.from("reclutamiento_candidatas").select("*").in("id",candIds).order("actualizado_en",{ascending:false}):Promise.resolve({data:[],error:null} as any),
        candIds.length?admin.from("reclutamiento_candidata_locales").select("*").in("candidata_id",candIds).in("local_id",actorLocalIds):Promise.resolve({data:[],error:null} as any),
        candIds.length?admin.from("reclutamiento_candidata_servicios").select("*").in("candidata_id",candIds):Promise.resolve({data:[],error:null} as any),
        candIds.length?admin.from("reclutamiento_instancias").select("*").in("candidata_id",candIds).order("candidata_id").order("orden"):Promise.resolve({data:[],error:null} as any),
        searchIds.length?admin.from("reclutamiento_busquedas").select("*").in("id",searchIds).order("actualizado_en",{ascending:false}):Promise.resolve({data:[],error:null} as any),
        searchIds.length?admin.from("reclutamiento_busqueda_locales").select("*").in("busqueda_id",searchIds).in("local_id",actorLocalIds):Promise.resolve({data:[],error:null} as any),
        searchIds.length?admin.from("reclutamiento_busqueda_servicios").select("*").in("busqueda_id",searchIds):Promise.resolve({data:[],error:null} as any),
      ]);
      const err=[circuitos,plantillas,candidatas,locs,servicios,instancias,busquedas,busqLoc,busqSvc].find((x:any)=>x.error)?.error;if(err)throw err;
      const inst=instancias.data||[],instIds=uniq(inst.map((x:any)=>x.id));
      const [evaluadores,pruebas,archivos,aprobaciones,busqCand]=await Promise.all([
        instIds.length?admin.from("reclutamiento_instancia_evaluadores").select("*").in("instancia_id",instIds):Promise.resolve({data:[],error:null} as any),
        instIds.length?admin.from("reclutamiento_prueba_servicios").select("*").in("instancia_id",instIds).order("instancia_id").order("id"):Promise.resolve({data:[],error:null} as any),
        candIds.length?admin.from("reclutamiento_archivos").select("*").in("candidata_id",candIds).order("creado_en",{ascending:false}):Promise.resolve({data:[],error:null} as any),
        candIds.length?admin.from("reclutamiento_aprobaciones").select("*").in("candidata_id",candIds).order("actualizado_en",{ascending:false}):Promise.resolve({data:[],error:null} as any),
        searchIds.length&&candIds.length?admin.from("reclutamiento_busqueda_candidatas").select("*").in("busqueda_id",searchIds).in("candidata_id",candIds):Promise.resolve({data:[],error:null} as any),
      ]);
      const err2=[evaluadores,pruebas,archivos,aprobaciones,busqCand].find((x:any)=>x.error)?.error;if(err2)throw err2;
      return json({ok:true,data:{circuitos:circuitos.data||[],plantillas:plantillas.data||[],candidatas:candidatas.data||[],locales:locs.data||[],servicios:servicios.data||[],instancias:inst,evaluadores:evaluadores.data||[],pruebas:pruebas.data||[],archivos:archivos.data||[],aprobaciones:aprobaciones.data||[],autorizadores:[],busquedas:busquedas.data||[],busquedaLocales:busqLoc.data||[],busquedaServicios:busqSvc.data||[],busquedaCandidatas:busqCand.data||[]}});
    }

    if(action==="available"){
      const ids=await scopedCandidateIds();if(!ids.length)return json({ok:true,candidatas:[]});const {data,error}=await admin.from("reclutamiento_candidatas").select("*").in("id",ids).eq("estado","disponible").order("nombre");if(error)throw error;return json({ok:true,candidatas:data||[]});
    }

    if(action==="candidate_process"){
      const id=Number(body.candidata_id||0);await assertCandidateScope(id);
      const {data:cand,error:ce}=await admin.from("reclutamiento_candidatas").select("*").eq("id",id).maybeSingle();if(ce)throw ce;if(!cand)return json({ok:false,error:"Candidata inexistente."},404);
      const {data:inst,error:ie}=await admin.from("reclutamiento_instancias").select("*").eq("candidata_id",id).order("orden");if(ie)throw ie;const instIds=uniq((inst||[]).map((x:any)=>x.id));
      const [loc,svc,tests,files,aps,ev]=await Promise.all([
        admin.from("reclutamiento_candidata_locales").select("*").eq("candidata_id",id).in("local_id",actorLocalIds),admin.from("reclutamiento_candidata_servicios").select("*").eq("candidata_id",id),instIds.length?admin.from("reclutamiento_prueba_servicios").select("*").in("instancia_id",instIds):Promise.resolve({data:[],error:null} as any),admin.from("reclutamiento_archivos").select("*").eq("candidata_id",id).order("creado_en",{ascending:false}),admin.from("reclutamiento_aprobaciones").select("*").eq("candidata_id",id).eq("activa",true),instIds.length?admin.from("reclutamiento_instancia_evaluadores").select("*").in("instancia_id",instIds):Promise.resolve({data:[],error:null} as any)
      ]);const err=[loc,svc,tests,files,aps,ev].find((x:any)=>x.error)?.error;if(err)throw err;return json({ok:true,data:{candidata:cand,instancias:inst||[],locales:loc.data||[],servicios:svc.data||[],pruebas:tests.data||[],archivos:files.data||[],aprobaciones:aps.data||[],evaluadores:ev.data||[]}});
    }

    if(action==="calendar"){
      const candIds=await scopedCandidateIds();if(!candIds.length)return json({ok:true,eventos:[]});const desde=String(body.desde||""),hasta=String(body.hasta||""),scope=String(body.scope||"all");let instanceFilter:number[]|null=null;
      if(scope!=="all"){const {data:ev,error}=await admin.from("reclutamiento_instancia_evaluadores").select("instancia_id").eq("user_id",actor.id);if(error)throw error;instanceFilter=uniq((ev||[]).map((x:any)=>x.instancia_id));if(!instanceFilter.length)return json({ok:true,eventos:[]});}
      let q=admin.from("reclutamiento_instancias").select("id,candidata_id,orden,nombre,tipo,estado,fecha_hora,local_id,modalidad,comentarios,recomendacion,resultado,realizada_en").in("candidata_id",candIds).not("fecha_hora","is",null).order("fecha_hora",{ascending:true});if(desde)q=q.gte("fecha_hora",desde);if(hasta)q=q.lt("fecha_hora",hasta);if(instanceFilter)q=q.in("id",instanceFilter);const {data:rows,error}=await q;if(error)throw error;if(!(rows||[]).length)return json({ok:true,eventos:[]});const ids=uniq((rows||[]).map((x:any)=>x.id)),cids=uniq((rows||[]).map((x:any)=>x.candidata_id));const [cands,evs,stages]=await Promise.all([admin.from("reclutamiento_candidatas").select("id,nombre,puesto,estado").in("id",cids),admin.from("reclutamiento_instancia_evaluadores").select("instancia_id,user_id").in("instancia_id",ids),admin.from("reclutamiento_instancias").select("id,candidata_id,orden,nombre,tipo,obligatoria,estado,recomendacion").in("candidata_id",cids).order("candidata_id").order("orden")]);const er=[cands,evs,stages].find((x:any)=>x.error)?.error;if(er)throw er;const cm=new Map((cands.data||[]).map((c:any)=>[Number(c.id),c]));const eventos=(rows||[]).map((i:any)=>{const previous=(stages.data||[]).filter((x:any)=>Number(x.candidata_id)===Number(i.candidata_id)&&x.obligatoria&&Number(x.orden)<Number(i.orden));const pendiente=previous.find((x:any)=>!["realizada","aprobada"].includes(String(x.estado||"")));const desf=previous.find((x:any)=>x.tipo!=="documentacion"&&!["si","con_reservas"].includes(String(x.recomendacion||"")));return{...i,candidata:cm.get(Number(i.candidata_id))||null,evaluador_ids:(evs.data||[]).filter((e:any)=>Number(e.instancia_id)===Number(i.id)).map((e:any)=>Number(e.user_id)),editable:true,can_complete:!pendiente&&!desf,completion_reason:pendiente?`Primero debe completarse "${pendiente.nombre}".`:desf?(String(desf.recomendacion||"")==="no"?`El resultado de "${desf.nombre}" fue No.`:`Falta una recomendación favorable en "${desf.nombre}".`):""};});return json({ok:true,eventos});
    }

    if(action==="event_detail"){
      const id=Number(body.instancia_id||0);const {data:inst,error}=await admin.from("reclutamiento_instancias").select("*").eq("id",id).maybeSingle();if(error)throw error;if(!inst)return json({ok:false,error:"Etapa inexistente."},404);await assertCandidateScope(Number(inst.candidata_id));const [cand,ev,tests,files]=await Promise.all([admin.from("reclutamiento_candidatas").select("id,nombre,puesto,estado").eq("id",inst.candidata_id).maybeSingle(),admin.from("reclutamiento_instancia_evaluadores").select("instancia_id,user_id").eq("instancia_id",id),admin.from("reclutamiento_prueba_servicios").select("*").eq("instancia_id",id).order("id"),admin.from("reclutamiento_archivos").select("*").eq("instancia_id",id).order("creado_en",{ascending:false})]);const er=[cand,ev,tests,files].find((x:any)=>x.error)?.error;if(er)throw er;const completion=await stageCompletion(Number(inst.candidata_id),Number(inst.orden||0));return json({ok:true,detail:{...inst,candidata:cand.data||null,evaluador_ids:(ev.data||[]).map((x:any)=>Number(x.user_id)),pruebas:tests.data||[],archivos:files.data||[],editable:true,can_complete:completion.ok,completion_reason:completion.reason}});
    }

    if(action==="save_candidate"){
      const p=body.candidate||{};if(!String(p.nombre||"").trim()||!["manicura","encargada"].includes(String(p.puesto||"")))throw new Error("Nombre y puesto son obligatorios.");let id=Number(p.id||0);if(intakeOnly&&id)return json({ok:false,error:"Las encargadas no pueden editar candidatas ya cargadas."},403);if(id)await assertCandidateScope(id);const selected=ensureSelectedLocals(body.local_ids,true);let circuitoId=Number(p.circuito_id||0)||null;if(!circuitoId){const {data:c}=await admin.from("reclutamiento_circuitos").select("id").eq("puesto",p.puesto).eq("activo",true).order("id").limit(1).maybeSingle();circuitoId=c?.id||null;}const payload={nombre:String(p.nombre).trim(),email:p.email||null,telefono:p.telefono||null,puesto:p.puesto,circuito_id:circuitoId,origen:p.origen||null,disponibilidad_desde:p.disponibilidad_desde||null,disponibilidad_tipo:p.disponibilidad_tipo||"full",disponibilidad_turno:p.disponibilidad_turno||null,trabaja_feriados:p.trabaja_feriados===true,dias_franco:p.dias_franco||null,observaciones:p.observaciones||null,competencias:p.puesto==="manicura"?sanitizeCompetencias(p.competencias):{},actualizado_por_user_id:actor.id};if(id){const {error}=await admin.from("reclutamiento_candidatas").update(payload).eq("id",id);if(error)throw error;}else{const {data,error}=await admin.from("reclutamiento_candidatas").insert({...payload,creado_por_user_id:actor.id}).select("id").single();if(error)throw error;id=Number(data.id);}if(actor.rol==="franquiciado"&&p.id){await admin.from("reclutamiento_candidata_locales").delete().eq("candidata_id",id).in("local_id",actorLocalIds);}else{await admin.from("reclutamiento_candidata_locales").delete().eq("candidata_id",id);}const {error:locErr}=await admin.from("reclutamiento_candidata_locales").insert(selected.map(local_id=>({candidata_id:id,local_id})));if(locErr)throw locErr;await admin.from("reclutamiento_candidata_servicios").delete().eq("candidata_id",id);const svcs=Array.isArray(body.servicios)?body.servicios:[];if(svcs.length){const {error}=await admin.from("reclutamiento_candidata_servicios").insert(svcs.map((x:any)=>({candidata_id:id,servicio_id:Number(x.servicioId),realiza:!!x.realiza,observacion:x.observacion||null})));if(error)throw error;}if(Array.isArray(body.busqueda_ids)&&!intakeOnly){if(actor.rol==="franquiciado"){const scopedSearch=await scopedSearchIds();if(scopedSearch.length)await admin.from("reclutamiento_busqueda_candidatas").delete().eq("candidata_id",id).in("busqueda_id",scopedSearch);const ids=uniq(body.busqueda_ids).filter(x=>scopedSearch.includes(x));if(ids.length){const {error}=await admin.from("reclutamiento_busqueda_candidatas").insert(ids.map(busqueda_id=>({busqueda_id,candidata_id:id,creado_por_user_id:actor.id})));if(error)throw error;}}else{await admin.from("reclutamiento_busqueda_candidatas").delete().eq("candidata_id",id);const ids=uniq(body.busqueda_ids);if(ids.length){const {error}=await admin.from("reclutamiento_busqueda_candidatas").insert(ids.map(busqueda_id=>({busqueda_id,candidata_id:id,creado_por_user_id:actor.id})));if(error)throw error;}}}await audit(id,p.id?"CANDIDATA_EDITADA":"CANDIDATA_CREADA",payload.nombre,{puesto:p.puesto,rol:actor.rol});return json({ok:true,id});
    }

    if(action==="search_save"){
      const p=body.search||{};if(!String(p.titulo||"").trim())throw new Error("El título de la búsqueda es obligatorio.");if(!["manicura","encargada"].includes(String(p.puesto||"")))throw new Error("Puesto inválido.");let id=Number(p.id||0);if(id)await assertSearchScope(id);const selected=ensureSelectedLocals(body.local_ids,true);const payload={titulo:String(p.titulo).trim(),pedido_original:String(p.pedido_original||"").trim()||null,puesto:String(p.puesto),cantidad_vacantes:Math.max(1,Number(p.cantidad_vacantes||1)),prioridad:String(p.prioridad||"media"),estado:String(p.estado||"abierta"),turno:String(p.turno||"indistinto"),hora_desde:p.hora_desde||null,hora_hasta:p.hora_hasta||null,sabados:String(p.sabados||"indistinto"),fin_semana_completo:p.fin_semana_completo===true,trabaja_feriados:p.trabaja_feriados===null||p.trabaja_feriados===undefined?null:p.trabaja_feriados===true,zona_residencia:String(p.zona_residencia||"").trim()||null,experiencia_min_meses:p.experiencia_min_meses?Number(p.experiencia_min_meses):null,fecha_necesidad:p.fecha_necesidad||null,observaciones:String(p.observaciones||"").trim()||null,actualizado_por_user_id:actor.id,actualizado_en:new Date().toISOString()};if(id){const {error}=await admin.from("reclutamiento_busquedas").update(payload).eq("id",id);if(error)throw error;await admin.from("reclutamiento_busqueda_locales").delete().eq("busqueda_id",id).in("local_id",actorLocalIds);}else{const {data,error}=await admin.from("reclutamiento_busquedas").insert({...payload,creado_por_user_id:actor.id}).select("id").single();if(error)throw error;id=Number(data.id);}const {error:locErr}=await admin.from("reclutamiento_busqueda_locales").insert(selected.map(local_id=>({busqueda_id:id,local_id})));if(locErr)throw locErr;await admin.from("reclutamiento_busqueda_servicios").delete().eq("busqueda_id",id);const reqs=Array.isArray(body.servicios)?body.servicios:[];if(reqs.length){const {error}=await admin.from("reclutamiento_busqueda_servicios").insert(reqs.map((x:any)=>({busqueda_id:id,servicio_id:Number(x.servicioId||x.servicio_id),nivel:String(x.nivel||"preferente")})));if(error)throw error;}if(Array.isArray(body.candidata_ids)){await admin.from("reclutamiento_busqueda_candidatas").delete().eq("busqueda_id",id);const allowedCand=await scopedCandidateIds();const ids=uniq(body.candidata_ids).filter(x=>allowedCand.includes(x));if(ids.length){const {error}=await admin.from("reclutamiento_busqueda_candidatas").insert(ids.map(candidata_id=>({busqueda_id:id,candidata_id,creado_por_user_id:actor.id})));if(error)throw error;}}return json({ok:true,id});
    }

    if(action==="search_candidate_set"){
      const sid=Number(body.busqueda_id||0),cid=Number(body.candidata_id||0),activo=body.activo!==false;await assertSearchScope(sid);await assertCandidateScope(cid);if(activo){const {data:exists,error}=await admin.from("reclutamiento_busqueda_candidatas").select("busqueda_id").eq("busqueda_id",sid).eq("candidata_id",cid).maybeSingle();if(error)throw error;if(!exists){const {error:e}=await admin.from("reclutamiento_busqueda_candidatas").insert({busqueda_id:sid,candidata_id:cid,creado_por_user_id:actor.id});if(e)throw e;}}else{const {error}=await admin.from("reclutamiento_busqueda_candidatas").delete().eq("busqueda_id",sid).eq("candidata_id",cid);if(error)throw error;}return json({ok:true});
    }
    if(action==="search_status"){const id=Number(body.id||0),estado=String(body.estado||"");await assertSearchScope(id);if(!["abierta","en_proceso","pausada","cubierta","cerrada"].includes(estado))throw new Error("Estado inválido.");const {error}=await admin.from("reclutamiento_busquedas").update({estado,actualizado_por_user_id:actor.id,actualizado_en:new Date().toISOString()}).eq("id",id);if(error)throw error;return json({ok:true});}

    if(action==="save_stage"){
      const id=Number(body.instancia_id||0);const {data:inst,error:ie}=await admin.from("reclutamiento_instancias").select("candidata_id,nombre,orden,tipo,estado").eq("id",id).maybeSingle();if(ie)throw ie;if(!inst)throw new Error("Etapa inexistente.");await assertCandidateScope(Number(inst.candidata_id));const p=body.stage||{};if(p.local_id&&!actorLocalSet.has(Number(p.local_id)))return json({ok:false,error:"Solo podés programar etapas en tus sucursales."},403);if(String(p.estado||"")==="realizada"){const completion=await stageCompletion(Number(inst.candidata_id),Number(inst.orden||0));if(!completion.ok)return json({ok:false,error:completion.reason},409);if(!String(p.recomendacion||"").trim())return json({ok:false,error:"La recomendación es obligatoria."},409);if(!String(p.resultado||"").trim())return json({ok:false,error:"El resultado / sugerencia es obligatorio."},409);if(inst.tipo==="prueba_tecnica"){const {data:rows,error}=await admin.from("reclutamiento_prueba_servicios").select("id,resultado").eq("instancia_id",id);if(error)throw error;if(!(rows||[]).length)return json({ok:false,error:"La prueba técnica debe tener al menos un servicio evaluado."},409);if((rows||[]).some((x:any)=>!String(x.resultado||"").trim()))return json({ok:false,error:"Todos los servicios deben tener resultado."},409);}}
      const {data:updated,error}=await admin.from("reclutamiento_instancias").update({fecha_hora:p.fecha_hora||null,local_id:p.local_id||null,modalidad:p.modalidad||null,comentarios:p.comentarios||null,recomendacion:p.recomendacion||null,resultado:p.resultado||null,estado:p.estado||"pendiente",realizada_en:p.realizada_en||null,actualizado_por_user_id:actor.id}).eq("id",id).select("*").single();if(error)throw error;await admin.from("reclutamiento_instancia_evaluadores").delete().eq("instancia_id",id);const ev=uniq(body.evaluador_ids||[]);if(ev.length){const {error:e}=await admin.from("reclutamiento_instancia_evaluadores").insert(ev.map(user_id=>({instancia_id:id,user_id})));if(e)throw e;}await audit(inst.candidata_id,p.estado==="realizada"?"ETAPA_REALIZADA":"ETAPA_GUARDADA",inst.nombre,{instanciaId:id});const {data:candidateNow}=await admin.from("reclutamiento_candidatas").select("estado").eq("id",inst.candidata_id).maybeSingle();return json({ok:true,instancia:updated,evaluador_ids:ev,candidata_estado:candidateNow?.estado||null});
    }

    if(action==="test_service_create"){
      const iid=Number(body.instancia_id||0);const {data:inst,error}=await admin.from("reclutamiento_instancias").select("candidata_id").eq("id",iid).maybeSingle();if(error)throw error;if(!inst)throw new Error("Prueba inválida.");await assertCandidateScope(Number(inst.candidata_id));const {data,error:ce}=await admin.from("reclutamiento_prueba_servicios").insert({instancia_id:iid,servicio_id:body.servicio_id||null,servicio_nombre:String(body.servicio_nombre||"Servicio")}).select("id").single();if(ce)throw ce;return json({ok:true,id:data.id});
    }
    if(action==="test_service_update"||action==="test_service_delete"){
      const id=Number(body.id||0);const {data:row,error}=await admin.from("reclutamiento_prueba_servicios").select("instancia_id,servicio_nombre").eq("id",id).maybeSingle();if(error)throw error;if(!row)throw new Error("Servicio inválido.");const {data:inst}=await admin.from("reclutamiento_instancias").select("candidata_id").eq("id",row.instancia_id).maybeSingle();if(!inst)throw new Error("Prueba inválida.");await assertCandidateScope(Number(inst.candidata_id));if(action==="test_service_delete"){const {error:e}=await admin.from("reclutamiento_prueba_servicios").delete().eq("id",id);if(e)throw e;}else{const {error:e}=await admin.from("reclutamiento_prueba_servicios").update({resultado:body.patch?.resultado??undefined,comentario:body.patch?.comentario??undefined,puntaje:body.patch?.puntaje??undefined,actualizado_en:new Date().toISOString()}).eq("id",id);if(e)throw e;}return json({ok:true});
    }

    if(action==="candidate_status"){
      const id=Number(body.candidata_id||0),estado=String(body.estado||"");await assertCandidateScope(id);if(!["en_pausa","en_proceso","desistio","rechazada","nueva"].includes(estado))throw new Error("Estado inválido.");const {error}=await admin.from("reclutamiento_candidatas").update({estado,actualizado_por_user_id:actor.id}).eq("id",id);if(error)throw error;return json({ok:true});
    }

    if(action==="file_add"){
      const p=body.file||{},cid=Number(p.candidata_id||0);if(intakeOnly){const {data:c}=await admin.from("reclutamiento_candidatas").select("creado_por_user_id").eq("id",cid).maybeSingle();if(!c||Number(c.creado_por_user_id)!==Number(actor.id))return json({ok:false,error:"Solo podés adjuntar archivos a la candidata que acabás de cargar."},403);}else await assertCandidateScope(cid);const {data:created,error}=await admin.from("reclutamiento_archivos").insert({...p,creado_por_user_id:actor.id}).select("*").single();if(error)throw error;return json({ok:true,file:created});
    }
    if(action==="file_delete"){
      const id=Number(body.id||0);const {data:r,error}=await admin.from("reclutamiento_archivos").select("candidata_id").eq("id",id).maybeSingle();if(error)throw error;if(!r)throw new Error("Archivo inexistente.");await assertCandidateScope(Number(r.candidata_id));const {error:e}=await admin.from("reclutamiento_archivos").delete().eq("id",id);if(e)throw e;return json({ok:true});
    }

    if(action==="pending_approvals")return json({ok:true,candidatas:[]});
    if(["approval","approval_remove","candidate_incorporated","config_load","config_circuit","config_authorizer","config_stage_create","config_stage_delete"].includes(action))return json({ok:false,error:"Esta acción queda reservada a Casa Matriz / Admin."},403);
    return json({ok:false,error:"Acción no válida."},400);
  }catch(e){console.error(e);return json({ok:false,error:e instanceof Error?e.message:String(e)},400);}
});
