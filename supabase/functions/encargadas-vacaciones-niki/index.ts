import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function errorText(value: unknown){if(value instanceof Error)return value.message;if(typeof value==="string")return value;if(value&&typeof value==="object"){const v=value as Record<string,unknown>;const parts=[v.message,v.details,v.hint,v.code].filter(Boolean).map(String);if(parts.length)return parts.join(" · ");try{return JSON.stringify(value)}catch{}}return String(value??"Error inesperado");}
function json(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers:{...cors,"Content-Type":"application/json"} }); }
function b64url(input: string | ArrayBuffer){const bytes=typeof input==="string"?new TextEncoder().encode(input):new Uint8Array(input);let bin="";bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function fromB64url(input:string){const n=input.replace(/-/g,"+").replace(/_/g,"/");return atob(n+"=".repeat((4-n.length%4)%4));}
async function hmacSha256(message:string,secret:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));}
async function verifySession(token:string,secret:string){const [body,sig]=String(token||"").split(".");if(!body||!sig||await hmacSha256(body,secret)!==sig)return null;try{const p=JSON.parse(fromB64url(body));if(!p?.uid||!p?.exp||Number(p.exp)<Math.floor(Date.now()/1000))return null;return p;}catch{return null;}}
function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]||c));}
function dateUtc(key:string){const [y,m,d]=key.split("-").map(Number);return new Date(Date.UTC(y,m-1,d));}
function dateKey(d:Date){return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;}
function eachDay(a:string,b:string){const out:string[]=[];for(let d=dateUtc(a);d<=dateUtc(b);d=new Date(d.getTime()+86400000))out.push(dateKey(d));return out;}
function daysInclusive(a:string,b:string){return Math.floor((dateUtc(b).getTime()-dateUtc(a).getTime())/86400000)+1;}
function isDate(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v);}
function isPeriodo(v:string){return /^\d{4}-\d{2}$/.test(v);}
function minOf(t:string|null|undefined){if(!t)return null;const [h,m]=String(t).slice(0,5).split(":").map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null;}
function overlap(a1:string,a2:string,b1:string,b2:string){const x1=minOf(a1),x2=minOf(a2),y1=minOf(b1),y2=minOf(b2);return x1!=null&&x2!=null&&y1!=null&&y2!=null&&Math.max(x1,y1)<Math.min(x2,y2);}
async function sendMail(to:string,name:string,subject:string,htmlContent:string){const apiKey=Deno.env.get("BREVO_API_KEY"),senderEmail=Deno.env.get("BREVO_SENDER_EMAIL"),senderName=Deno.env.get("BREVO_SENDER_NAME")||"Niki Beauty Bar";if(!apiKey||!senderEmail)return {sent:false};const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{accept:"application/json","api-key":apiKey,"content-type":"application/json"},body:JSON.stringify({sender:{email:senderEmail,name:senderName},to:[{email:to,name}],subject,htmlContent})});if(!r.ok)throw new Error(`Brevo: ${await r.text()||r.status}`);return {sent:true};}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"Metodo no permitido"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,secret=Deno.env.get("NIKI_SESSION_SECRET")||Deno.env.get("NIKI_IMPORT_TOKEN")||"";
    if(!secret)return json({ok:false,error:"Falta NIKI_SESSION_SECRET"},500);
    const admin=createClient(url,key,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const actorId=Number(body.actor_id||0),action=String(body.action||""),token=String(body.session_token||"");
    const session=await verifySession(token,secret);
    if(!actorId||!session||Number(session.uid)!==actorId)return json({ok:false,error:"Sesion invalida o vencida"},401);
    const {data:actor,error:ae}=await admin.from("users").select("id,nombre,email,rol,activo,local_id").eq("id",actorId).maybeSingle();if(ae)throw ae;
    if(!actor||actor.activo===false)return json({ok:false,error:"Usuario no autorizado"},403);

    const allApprover=["admin","casa_matriz"].includes(actor.rol);
    const canConfigure=["admin","casa_matriz","franquiciado"].includes(actor.rol);
    if(!["admin","casa_matriz","franquiciado","encargada","manicura"].includes(actor.rol))return json({ok:false,error:"Sin permiso para consultar vacaciones"},403);
    let scopePromise:Promise<any>|null=null;
    const localScope=()=>scopePromise||(scopePromise=(async()=>{
      const [{data:locals,error:le},{data:assignments,error:ue},{data:enc,error:ee},{data:history,error:he}]=await Promise.all([
        admin.from("locales").select("id,nombre,tipo_local,activo").order("nombre"),
        admin.from("usuario_locales").select("local_id").eq("user_id",actorId),
        admin.from("encargado_locales").select("local_id").eq("user_id",actorId),
        actor.rol==="manicura"?admin.from("manicura_historial_locales").select("local_id,fecha_inicio,fecha_fin").eq("user_id",actorId).lte("fecha_inicio",dateKey(new Date())):Promise.resolve({data:[],error:null})
      ]);if(le||ue||ee||he)throw(le||ue||ee||he);
      const assigned=new Set<number>((assignments||[]).map((x:any)=>Number(x.local_id))),operational=new Set<number>((enc||[]).map((x:any)=>Number(x.local_id))),today=dateKey(new Date());
      const active=(history||[]).filter((x:any)=>!x.fecha_fin||String(x.fecha_fin)>=today).map((x:any)=>Number(x.local_id));
      let ids:number[]=[];
      if(actor.rol==="admin")ids=(locals||[]).map((l:any)=>Number(l.id));
      else if(actor.rol==="casa_matriz")ids=(locals||[]).filter((l:any)=>(l.tipo_local||"propio")==="propio"||assigned.has(Number(l.id))).map((l:any)=>Number(l.id));
      else if(actor.rol==="franquiciado")ids=[...assigned];
      else if(actor.rol==="encargada")ids=[...operational];
      else ids=[...active,...operational,...(!active.length&&actor.local_id?[Number(actor.local_id)]:[])];
      const set=new Set<number>(ids.filter(Boolean));return {ids:[...set],set,locals:(locals||[]).filter((l:any)=>set.has(Number(l.id)))};
    })());
    const franchiseLocalIds=async()=>actor.rol==="franquiciado"?(await localScope()).set:new Set<number>();
    const canApproveLocal=async(localId:number|null)=>{if(!canConfigure)return false;if(localId==null)return allApprover;return (await localScope()).set.has(Number(localId));};
    const readAll=async(build:()=>any)=>{const out:any[]=[];let offset=0;for(let page=0;page<1000;page++){const {data,error}=await build().range(offset,offset+499);if(error)throw error;if(!Array.isArray(data))throw new Error("Respuesta de vacaciones incompleta");if(!data.length)return out;out.push(...data);offset+=data.length;}throw new Error("No se pudo completar la consulta de vacaciones");};
    const requestedLocal=async()=>{if(body.local_id==null||body.local_id==="")return null;const lid=Number(body.local_id);if(!Number.isSafeInteger(lid)||!(await localScope()).set.has(lid))throw Object.assign(new Error("Sucursal fuera de tu alcance"),{status:403});return lid;};
    const unresolved=(r:any)=>r.estado==="solicitada"&&!r.resuelto_en&&!r.resuelto_por_user_id;

    const profilesFor=async(userId:number)=>{
      const {data:u,error:ue}=await admin.from("users").select("id,rol,nombre,email,activo,local_id").eq("id",userId).maybeSingle();if(ue)throw ue;if(!u)return null;
      if(u.rol==="casa_matriz")return {user:u,profiles:["casa_matriz"],localIds:[]};
      const today=dateKey(new Date());
      const [{data:man,error:me},{data:enc,error:ee}]=await Promise.all([
        admin.from("manicura_historial_locales").select("local_id,fecha_inicio,fecha_fin").eq("user_id",userId).lte("fecha_inicio",today),
        admin.from("encargado_locales").select("local_id").eq("user_id",userId)
      ]);if(me||ee)throw(me||ee);
      const activeMan=(man||[]).filter((x:any)=>!x.fecha_fin||String(x.fecha_fin)>=today);
      const profiles:string[]=[];if(activeMan.length||u.rol==="manicura")profiles.push("manicura");if((enc||[]).length||u.rol==="encargada")profiles.push("encargada");
      const localIds=[...new Set([...(activeMan||[]).map((x:any)=>Number(x.local_id)),...(enc||[]).map((x:any)=>Number(x.local_id)),...(!activeMan.length&&u.rol==="manicura"&&u.local_id?[Number(u.local_id)]:[])].filter(Boolean))];
      return {user:u,profiles:[...new Set(profiles)],localIds};
    };
    const readRequest=async(id:number)=>{const {data,error}=await admin.from("encargada_vacaciones_solicitudes").select("*").eq("id",id).maybeSingle();if(error)throw error;return data;};
    const canRead=async(r:any)=>{
      if(!r)return false;
      const lid=r.local_id_solicitud==null?null:Number(r.local_id_solicitud),within=lid==null?(actor.rol==="admin"||(actor.rol==="casa_matriz"&&(r.perfiles_impactados||[]).includes("casa_matriz"))):(await localScope()).set.has(lid);
      return within&&(Number(r.user_id)===actorId||await canApproveLocal(lid));
    };

    const capacityFor=async(r:any)=>{
      const profiles=Array.isArray(r.perfiles_impactados)&&r.perfiles_impactados.length?r.perfiles_impactados:["encargada"];
      const days=eachDay(r.fecha_inicio,r.fecha_fin),refLocal=r.local_id_solicitud==null?null:Number(r.local_id_solicitud);
      const [{data:quotas,error:qe},{data:approved,error:ve},{data:manSchedules,error:mse},{data:encPlan,error:epe}]=await Promise.all([
        admin.from("vacaciones_cupos").select("local_id,perfil,cupo_simultaneo,activo").eq("activo",true),
        admin.from("encargada_vacaciones_solicitudes").select("id,user_id,fecha_inicio,fecha_fin,local_id_solicitud,perfiles_impactados,impacto_cupos,estado").eq("estado","aprobada").lte("fecha_inicio",r.fecha_fin).gte("fecha_fin",r.fecha_inicio).neq("id",r.id||0),
        profiles.includes("manicura")?admin.from("horarios").select("fecha,local_id,trabaja").eq("user_id",r.user_id).gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin):Promise.resolve({data:[],error:null}),
        profiles.includes("encargada")?admin.from("encargada_planificacion").select("fecha,local_id").eq("user_id",r.user_id).gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin):Promise.resolve({data:[],error:null})
      ]);if(qe||ve||mse||epe)throw(qe||ve||mse||epe);
      const qmap=new Map<string,number>((quotas||[]).map((q:any)=>[`${q.perfil}|${q.local_id==null?"cm":Number(q.local_id)}`,Number(q.cupo_simultaneo)]));
      const impacts:any[]=[];
      for(const f of days){
        for(const profile of profiles){
          let localIds:(number|null)[]=[];
          if(profile==="casa_matriz")localIds=[null];
          else if(profile==="manicura")localIds=Array.from(new Set<number>((manSchedules||[]).filter((x:any)=>x.fecha===f&&x.trabaja!==false&&x.local_id!=null).map((x:any)=>Number(x.local_id))));
          else if(profile==="encargada")localIds=Array.from(new Set<number>((encPlan||[]).filter((x:any)=>x.fecha===f&&x.local_id!=null).map((x:any)=>Number(x.local_id))));
          if(!localIds.length)localIds=[refLocal];
          for(const lid of localIds){
            if(profile!=="casa_matriz"&&!lid)continue;
            let occupied=0;
            for(const other of approved||[]){
              const detailed=Array.isArray(other.impacto_cupos)?other.impacto_cupos:[];
              if(detailed.length){if(detailed.some((x:any)=>x.fecha===f&&x.perfil===profile&&Number(x.local_id||0)===Number(lid||0)))occupied++;continue;}
              const ops=Array.isArray(other.perfiles_impactados)&&other.perfiles_impactados.length?other.perfiles_impactados:["encargada"];
              if(f>=other.fecha_inicio&&f<=other.fecha_fin&&ops.includes(profile)&&Number(other.local_id_solicitud||0)===Number(lid||0))occupied++;
            }
            const quota=qmap.get(`${profile}|${lid==null?"cm":Number(lid)}`);
            impacts.push({fecha:f,perfil:profile,local_id:lid,cupo:quota??null,ocupados:occupied,proyectado:occupied+1,excede:quota!=null&&occupied+1>quota});
          }
        }
      }
      return impacts;
    };

    if(action==="setup"){
      if(!canConfigure)return json({ok:false,error:"Sin permiso"},403);
      const [{data:quotas,error:qe},{data:respons,error:re},{data:cm,error:ce},{data:locals,error:le}]=await Promise.all([
        admin.from("vacaciones_cupos").select("*").order("perfil").order("local_id"),
        admin.from("vacaciones_responsables_local").select("*").eq("activo",true),
        admin.from("users").select("id,nombre,email,activo").eq("rol","casa_matriz").eq("activo",true).order("nombre"),
        admin.from("locales").select("id,nombre,tipo_local,activo").order("nombre")
      ]);if(qe||re||ce||le)throw(qe||re||ce||le);
      let allowed=(locals||[]).filter((l:any)=>l.activo!==false);
      const scope=await localScope();allowed=allowed.filter((l:any)=>scope.set.has(Number(l.id)));
      if(actor.rol==="franquiciado"){const set=await franchiseLocalIds();allowed=allowed.filter((l:any)=>set.has(Number(l.id)));}
      return json({ok:true,quotas:(quotas||[]).filter((q:any)=>q.local_id==null?allApprover:scope.set.has(Number(q.local_id))),responsibles:(respons||[]).filter((r:any)=>scope.set.has(Number(r.local_id))),casa_matriz_users:cm||[],locals:allowed,can_assign_responsibles:["admin","casa_matriz"].includes(actor.rol)});
    }

    if(action==="save_quota"){
      if(!canConfigure)return json({ok:false,error:"Sin permiso"},403);
      const profile=String(body.perfil||""),localId=body.local_id==null?null:Number(body.local_id),cupo=Number(body.cupo_simultaneo);
      if(!["manicura","encargada","casa_matriz"].includes(profile)||!Number.isInteger(cupo)||cupo<0||cupo>99)return json({ok:false,error:"Cupo invalido"},400);
      if(profile==="casa_matriz"&&actor.rol==="franquiciado")return json({ok:false,error:"Franquiciado solo puede configurar su local"},403);
      if(profile!=="casa_matriz"){if(!localId)return json({ok:false,error:"Falta local"},400);if(!await canApproveLocal(localId))return json({ok:false,error:"Sin permiso para ese local"},403);}
      const now=new Date().toISOString();
      let q=admin.from("vacaciones_cupos").select("id").eq("perfil",profile);q=localId==null?q.is("local_id",null):q.eq("local_id",localId);const {data:found,error:fe}=await q.maybeSingle();if(fe)throw fe;
      const payload={local_id:profile==="casa_matriz"?null:localId,perfil:profile,cupo_simultaneo:cupo,activo:true,actualizado_por_user_id:actorId,actualizado_en:now};
      const result=found?.id?await admin.from("vacaciones_cupos").update(payload).eq("id",found.id).select().single():await admin.from("vacaciones_cupos").insert(payload).select().single();if(result.error)throw result.error;
      return json({ok:true,row:result.data});
    }

    if(action==="set_responsibles"){
      if(!["admin","casa_matriz"].includes(actor.rol))return json({ok:false,error:"Solo Administracion o Casa Matriz pueden asignar responsables"},403);
      const localId=Number(body.local_id||0),ids=(Array.isArray(body.user_ids)?body.user_ids:[]).map(Number).filter(Boolean);if(!localId)return json({ok:false,error:"Falta local"},400);if(!await canApproveLocal(localId))return json({ok:false,error:"Sucursal fuera de tu alcance"},403);
      const {error:de}=await admin.from("vacaciones_responsables_local").delete().eq("local_id",localId);if(de)throw de;
      if(ids.length){const rows=ids.map((uid:number)=>({local_id:localId,user_id:uid,activo:true,creado_por_user_id:actorId,actualizado_en:new Date().toISOString()}));const {error:ie}=await admin.from("vacaciones_responsables_local").insert(rows);if(ie)throw ie;}
      return json({ok:true});
    }

    if(action==="list"){
      const scope=await localScope(),lid=await requestedLocal();
      const raw=await readAll(()=>{let q=admin.from("encargada_vacaciones_solicitudes").select("*").order("fecha_inicio",{ascending:false}).order("id");if(lid)q=q.eq("local_id_solicitud",lid);if(!canConfigure)q=q.eq("user_id",actorId);return q;});
      const rows:any[]=[];
      for(const r of raw)if(await canRead(r))rows.push({...r,impacto_cupos:(Array.isArray(r.impacto_cupos)?r.impacto_cupos:[]).filter((x:any)=>x.local_id==null?allApprover:scope.set.has(Number(x.local_id))),puede_revisar:await canApproveLocal(r.local_id_solicitud==null?null:Number(r.local_id_solicitud)),puede_eliminar:unresolved(r)&&(Number(r.user_id)===actorId||await canApproveLocal(r.local_id_solicitud==null?null:Number(r.local_id_solicitud)))});
      const ids=[...new Set(rows.map((r:any)=>Number(r.user_id)))];
      const [{data:users,error:ue},{data:respons,error:re}]=await Promise.all([ids.length?admin.from("users").select("id,nombre,rol,activo").in("id",ids):Promise.resolve({data:[],error:null}),scope.ids.length?admin.from("vacaciones_responsables_local").select("local_id,user_id").eq("activo",true).in("local_id",scope.ids):Promise.resolve({data:[],error:null})]);if(ue||re)throw(ue||re);
      return json({ok:true,vacaciones_version:3,rows,users:users||[],responsibles:respons||[],locales:scope.locals});
    }

    if(action==="gantt"){
      const scope=await localScope(),lid=await requestedLocal(),desde=String(body.desde||""),hasta=String(body.hasta||"");
      if(!isDate(desde)||!isDate(hasta)||dateKey(dateUtc(desde))!==desde||dateKey(dateUtc(hasta))!==hasta||hasta<desde||daysInclusive(desde,hasta)>366)return json({ok:false,error:"Rango inválido; máximo un año"},400);
      const visible=new Set<number>(lid?[lid]:scope.ids);
      if(!visible.size)return json({ok:true,vacaciones_version:3,rows:[],users:[],locales:scope.locals});
      const [raw,hist,enc,legacy]=await Promise.all([
        readAll(()=>admin.from("encargada_vacaciones_solicitudes").select("id,user_id,fecha_inicio,fecha_fin,local_id_solicitud,perfiles_impactados,impacto_cupos,estado").in("estado",["solicitada","aprobada","rechazada","cancelada"]).lte("fecha_inicio",hasta).gte("fecha_fin",desde).order("id")),
        readAll(()=>admin.from("manicura_historial_locales").select("id,user_id,local_id,fecha_inicio,fecha_fin").in("local_id",[...visible]).lte("fecha_inicio",hasta).order("id")),
        readAll(()=>admin.from("encargado_locales").select("user_id,local_id").in("local_id",[...visible]).order("user_id").order("local_id")),
        readAll(()=>admin.from("users").select("id,nombre,rol,activo,local_id").eq("rol","manicura").in("local_id",[...visible]).order("id"))
      ]);
      // Una persona puede ocupar ambos puestos, incluso en distintas sucursales.
      const roster=new Map<number,Map<number,Set<string>>>();
      const add=(uid:number,local:number,puesto:string)=>{if(!visible.has(local))return;if(!roster.has(uid))roster.set(uid,new Map());const locals=roster.get(uid)!;if(!locals.has(local))locals.set(local,new Set());locals.get(local)!.add(puesto);};
      for(const h of hist)if(!h.fecha_fin||String(h.fecha_fin)>=desde)add(Number(h.user_id),Number(h.local_id),"manicura");
      for(const e of enc)add(Number(e.user_id),Number(e.local_id),"encargada");
      for(const u of legacy)if(!hist.some((h:any)=>Number(h.user_id)===Number(u.id)))add(Number(u.id),Number(u.local_id),"manicura");
      const candidates=raw.map((r:any)=>{const related=[Number(r.local_id_solicitud),...(Array.isArray(r.impacto_cupos)?r.impacto_cupos:[]).map((x:any)=>Number(x.local_id))];return {r,locals:[...new Set(related.filter(id=>visible.has(id)))]};}).filter(x=>x.locals.length);
      const userIds=[...new Set([...roster.keys(),...candidates.map(x=>Number(x.r.user_id))])];
      const people=userIds.length?await readAll(()=>admin.from("users").select("id,nombre,rol,activo").in("id",userIds).order("id")):[];
      const peopleMap=new Map(people.map((u:any)=>[Number(u.id),u]));
      const rows=candidates.map(({r,locals})=>{
        const explicit=(Array.isArray(r.perfiles_impactados)?r.perfiles_impactados:[]).filter((x:string)=>["encargada","manicura"].includes(x));
        const puestos=[...new Set<string>(explicit.length?explicit:(peopleMap.get(Number(r.user_id))?.rol==="manicura"?["manicura"]:peopleMap.get(Number(r.user_id))?.rol==="encargada"?["encargada"]:[]))];
        const impacts=(Array.isArray(r.impacto_cupos)?r.impacto_cupos:[]).filter((x:any)=>visible.has(Number(x.local_id))&&puestos.includes(x.perfil));
        const asignaciones=Array.from(new Map<string,{local_id:number,puesto:string}>((impacts.length?impacts.map((x:any)=>({local_id:Number(x.local_id),puesto:String(x.perfil)})):locals.flatMap(local_id=>puestos.map(puesto=>({local_id,puesto})))).map((x:any)=>[`${x.local_id}|${x.puesto}`,x])).values());
        return {id:r.id,user_id:r.user_id,fecha_inicio:r.fecha_inicio,fecha_fin:r.fecha_fin,estado:r.estado,local_ids:[...new Set(asignaciones.map(x=>x.local_id))],puestos,asignaciones};
      }).filter(r=>r.puestos.length);
      for(const r of rows)for(const a of r.asignaciones)add(Number(r.user_id),a.local_id,a.puesto);
      const users=people.filter((u:any)=>roster.has(Number(u.id))&&(u.activo!==false||rows.some(r=>Number(r.user_id)===Number(u.id)))).map((u:any)=>({id:u.id,nombre:u.nombre,local_ids:[...roster.get(Number(u.id))!.keys()],asignaciones:[...roster.get(Number(u.id))!].flatMap(([local_id,puestos])=>[...puestos].map(puesto=>({local_id,puesto})))}));
      return json({ok:true,vacaciones_version:3,rows,users,locales:scope.locals});
    }

    if(action==="delete"){
      const id=Number(body.id||0);if(!Number.isSafeInteger(id)||id<=0)return json({ok:false,error:"Solicitud inválida"},400);
      const r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);
      if(!await canRead(r))return json({ok:false,error:"Solicitud fuera de tu alcance"},403);
      if(!unresolved(r))return json({ok:false,error:"Sólo se pueden eliminar solicitudes pendientes sin resolución"},409);
      if(Number(r.user_id)!==actorId&&!await canApproveLocal(r.local_id_solicitud==null?null:Number(r.local_id_solicitud)))return json({ok:false,error:"Sin permiso para eliminar esta solicitud"},403);
      const {data:deleted,error}=await admin.from("encargada_vacaciones_solicitudes").delete().eq("id",id).eq("estado","solicitada").is("resuelto_en",null).is("resuelto_por_user_id",null).select("id");if(error)throw error;
      if(!deleted?.length)return json({ok:false,error:"La solicitud fue revisada o eliminada mientras la consultabas. Actualizá el listado."},409);
      return json({ok:true,id});
    }


    if(action==="calendar"){
      const localId=Number(body.local_id||0),desde=String(body.desde||""),hasta=String(body.hasta||"");
      if(!localId||!isDate(desde)||!isDate(hasta)||hasta<desde)return json({ok:false,error:"Rango o local invalido"},400);
      if(!(await localScope()).set.has(localId))return json({ok:false,error:"Sin permiso para consultar vacaciones del local"},403);
      const {data:rows,error}=await admin.from("encargada_vacaciones_solicitudes").select("id,user_id,fecha_inicio,fecha_fin,local_id_solicitud,perfiles_impactados,impacto_cupos,estado").eq("estado","aprobada").lte("fecha_inicio",hasta).gte("fecha_fin",desde);if(error)throw error;
      const filtered=(rows||[]).filter((r:any)=>{const impacts=Array.isArray(r.impacto_cupos)?r.impacto_cupos:[];if(impacts.length)return impacts.some((x:any)=>Number(x.local_id||0)===localId&&x.fecha>=desde&&x.fecha<=hasta);return Number(r.local_id_solicitud||0)===localId;});
      const ids=[...new Set(filtered.map((r:any)=>Number(r.user_id)))];
      const {data:users,error:ue}=ids.length?await admin.from("users").select("id,nombre,rol,activo").in("id",ids):{data:[],error:null};if(ue)throw ue;
      return json({ok:true,rows:filtered.map((r:any)=>({...r,impacto_cupos:(r.impacto_cupos||[]).filter((x:any)=>Number(x.local_id)===localId)})),users:users||[]});
    }

    if(action==="create"){
      if(actor.rol==="franquiciado"||actor.rol==="admin")return json({ok:false,error:"Este perfil administra solicitudes pero no tiene cupo personal configurado en esta version."},400);
      const info=await profilesFor(actorId);if(!info||!info.profiles.length)return json({ok:false,error:"No encontramos un perfil operativo para solicitar vacaciones."},400);
      const desde=String(body.fecha_inicio||""),hasta=String(body.fecha_fin||"");if(!isDate(desde)||!isDate(hasta)||hasta<desde)return json({ok:false,error:"Indica un rango de fechas valido."},400);
      let localId=body.local_id_solicitud==null?null:Number(body.local_id_solicitud);
      if(!info.profiles.includes("casa_matriz")){
        if(!localId&&info.localIds.length===1)localId=info.localIds[0];
        if(!localId||!info.localIds.includes(localId))return json({ok:false,error:"Selecciona el local al que corresponde la solicitud."},400);
      }else localId=null;
      const {data:existing,error:ee}=await admin.from("encargada_vacaciones_solicitudes").select("id,fecha_inicio,fecha_fin,estado").eq("user_id",actorId).in("estado",["solicitada","aprobada"]).lte("fecha_inicio",hasta).gte("fecha_fin",desde);if(ee)throw ee;if(existing?.length)return json({ok:false,error:"Ya existe una solicitud pendiente o aprobada que se superpone con esas fechas."},409);
      const payload={user_id:actorId,fecha_inicio:desde,fecha_fin:hasta,anio_vacaciones:Number(body.anio_vacaciones||desde.slice(0,4)),estado:"solicitada",observacion_solicitante:String(body.observacion||"").trim()||null,local_id_solicitud:localId,perfiles_impactados:info.profiles,impacto_cupos:[],actualizado_en:new Date().toISOString()};
      const {data,error}=await admin.from("encargada_vacaciones_solicitudes").insert(payload).select().single();if(error)throw error;
      return json({ok:true,row:data});
    }

    if(action==="detail"){
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);if(!await canRead(r))return json({ok:false,error:"Sin permiso"},403);
      const profiles=Array.isArray(r.perfiles_impactados)&&r.perfiles_impactados.length?r.perfiles_impactados:["encargada"],days=eachDay(r.fecha_inicio,r.fecha_fin),manager=profiles.includes("encargada");
      const capacity=await capacityFor(r);
      const scope=await localScope();if(capacity.some((x:any)=>x.local_id!=null&&!scope.set.has(Number(x.local_id))))return json({ok:false,error:"La solicitud afecta sucursales fuera de tu alcance. Debe revisarla un perfil con acceso a todas ellas."},403);
      if(!manager)return json({ok:true,row:r,days,plan:[],segments:[],candidates:[],missing_confirmations:[],capacity,requires_coverage:false});
      const [{data:plan,error:pe},{data:marks,error:me},{data:rels,error:re},{data:segments,error:se}]=await Promise.all([
        admin.from("encargada_planificacion").select("*").eq("user_id",r.user_id).gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin).order("fecha"),
        admin.from("encargada_planificacion_confirmaciones").select("local_id,fecha").gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin),
        admin.from("encargado_locales").select("user_id,local_id"),
        admin.from("encargada_coberturas_segmentos").select("*").eq("solicitud_vacaciones_id",id).order("fecha")
      ]);if(pe||me||re||se)throw(pe||me||re||se);
      const markSet=new Set((marks||[]).map((x:any)=>`${x.local_id}|${x.fecha}`));const missing=(plan||[]).filter((p:any)=>!markSet.has(`${p.local_id}|${p.fecha}`));
      const relatedLocalIds=[...new Set((plan||[]).map((x:any)=>Number(x.local_id)).filter(Boolean))];if(!relatedLocalIds.length&&r.local_id_solicitud)relatedLocalIds.push(Number(r.local_id_solicitud));
      const candidateIds=[...new Set((rels||[]).filter((x:any)=>!relatedLocalIds.length||relatedLocalIds.includes(Number(x.local_id))).map((x:any)=>Number(x.user_id)).filter((x:number)=>x!==Number(r.user_id)))];
      const {data:candidates,error:ce}=candidateIds.length?await admin.from("users").select("id,nombre,email,activo").in("id",candidateIds).eq("activo",true):{data:[],error:null};if(ce)throw ce;
      return json({ok:true,row:r,plan:plan||[],segments:segments||[],candidates:candidates||[],missing_confirmations:missing,days,capacity,requires_coverage:true});
    }

    if(action==="cancel"){
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);if(!await canRead(r))return json({ok:false,error:"Solicitud fuera de tu alcance"},403);const canApprove=await canApproveLocal(r.local_id_solicitud==null?null:Number(r.local_id_solicitud));if(Number(r.user_id)!==actorId&&!canApprove)return json({ok:false,error:"Sin permiso"},403);if(["rechazada","cancelada"].includes(r.estado))return json({ok:false,error:"La solicitud ya esta cerrada."},409);if(r.estado==="aprobada"&&!canApprove)return json({ok:false,error:"Una vacacion aprobada solo puede cancelarla quien administra el cupo."},403);
      const now=new Date().toISOString();const {data:changed,error}=await admin.from("encargada_vacaciones_solicitudes").update({estado:"cancelada",cancelado_por_user_id:actorId,cancelado_en:now,actualizado_en:now}).eq("id",id).eq("estado",r.estado).select("id");if(error)throw error;if(!changed?.length)return json({ok:false,error:"La solicitud cambió. Actualizá el listado."},409);
      await Promise.all([admin.from("encargada_coberturas_segmentos").update({estado:"cancelada",actualizado_por_user_id:actorId,actualizado_en:now}).eq("solicitud_vacaciones_id",id),admin.from("encargada_jornada_real").delete().eq("solicitud_vacaciones_id",id).eq("origen","vacaciones")]);
      return json({ok:true});
    }

    if(action==="reject"){
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);if(!await canApproveLocal(r.local_id_solicitud==null?null:Number(r.local_id_solicitud)))return json({ok:false,error:"Sin permiso para aprobar este local."},403);if(r.estado!=="solicitada")return json({ok:false,error:"La solicitud ya fue resuelta."},409);
      const now=new Date().toISOString(),obs=String(body.observacion||"").trim()||null;const {data:changed,error}=await admin.from("encargada_vacaciones_solicitudes").update({estado:"rechazada",observacion_resolucion:obs,resuelto_por_user_id:actorId,resuelto_en:now,actualizado_en:now}).eq("id",id).eq("estado","solicitada").is("resuelto_en",null).is("resuelto_por_user_id",null).select("id");if(error)throw error;if(!changed?.length)return json({ok:false,error:"La solicitud cambió. Actualizá el listado."},409);
      const {data:u}=await admin.from("users").select("nombre,email").eq("id",r.user_id).single();if(u?.email)await sendMail(u.email,u.nombre||"Equipo Niki","Solicitud de vacaciones rechazada",`<div style="font-family:Montserrat,Arial,sans-serif"><h2>Solicitud de vacaciones</h2><p>Hola ${esc(u.nombre)},</p><p>Tu solicitud del <strong>${esc(r.fecha_inicio)}</strong> al <strong>${esc(r.fecha_fin)}</strong> fue rechazada.</p>${obs?`<p>Observacion: ${esc(obs)}</p>`:""}</div>`).catch(()=>null);
      return json({ok:true});
    }

    if(action==="approve"){
      const id=Number(body.id||0),r=await readRequest(id);if(!r)return json({ok:false,error:"Solicitud inexistente"},404);if(!await canApproveLocal(r.local_id_solicitud==null?null:Number(r.local_id_solicitud)))return json({ok:false,error:"Sin permiso para aprobar este local."},403);if(r.estado!=="solicitada")return json({ok:false,error:"La solicitud ya fue resuelta."},409);
      const capacity=await capacityFor(r),scope=await localScope();if(capacity.some((x:any)=>x.local_id!=null&&!scope.set.has(Number(x.local_id))))return json({ok:false,error:"La solicitud afecta sucursales fuera de tu alcance"},403);const exceeded=capacity.find((x:any)=>x.excede);if(exceeded)return json({ok:false,error:`No hay cupo de vacaciones el ${exceeded.fecha} para ${exceeded.perfil}. Cupo ${exceeded.cupo}, proyectado ${exceeded.proyectado}.`,capacity},409);
      const profiles=Array.isArray(r.perfiles_impactados)&&r.perfiles_impactados.length?r.perfiles_impactados:["encargada"],manager=profiles.includes("encargada"),segments=Array.isArray(body.segments)?body.segments:[],periodo=String(body.periodo_liquidacion||r.fecha_inicio.slice(0,7));if(!isPeriodo(periodo))return json({ok:false,error:"Periodo de liquidacion invalido."},400);
      let planRows:any[]=[];
      if(manager){
        const {data:plan,error:pe}=await admin.from("encargada_planificacion").select("*").eq("user_id",r.user_id).gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin).order("fecha");if(pe)throw pe;planRows=plan||[];
        const {data:marks,error:me}=await admin.from("encargada_planificacion_confirmaciones").select("local_id,fecha").gte("fecha",r.fecha_inicio).lte("fecha",r.fecha_fin);if(me)throw me;const markSet=new Set((marks||[]).map((x:any)=>`${x.local_id}|${x.fecha}`));const missing=planRows.find((p:any)=>!markSet.has(`${p.local_id}|${p.fecha}`));if(missing)return json({ok:false,error:`No se puede aprobar: la planificacion del ${missing.fecha} no esta confirmada.`},409);
        if(planRows.length!==segments.length)return json({ok:false,error:"Debe definirse un reemplazo para cada turno confirmado comprendido por las vacaciones."},400);
        for(const p of planRows){const s=segments.find((x:any)=>Number(x.local_id)===Number(p.local_id)&&String(x.fecha)===String(p.fecha)&&String(x.hora_desde).slice(0,5)===String(p.hora_desde).slice(0,5)&&String(x.hora_hasta).slice(0,5)===String(p.hora_hasta).slice(0,5));if(!s||!Number(s.reemplazo_user_id)||Number(s.reemplazo_user_id)===Number(r.user_id))return json({ok:false,error:`Falta reemplazo valido para ${p.fecha} ${String(p.hora_desde).slice(0,5)}-${String(p.hora_hasta).slice(0,5)}.`},400);}
        for(const s of segments){const uid=Number(s.reemplazo_user_id),lid=Number(s.local_id),fecha=String(s.fecha);const [{data:rp,error:rpe},{data:cs,error:cse}]=await Promise.all([admin.from("encargada_planificacion").select("local_id,hora_desde,hora_hasta").eq("user_id",uid).eq("fecha",fecha),admin.from("encargada_coberturas_segmentos").select("local_id,hora_desde,hora_hasta,estado").eq("reemplazo_user_id",uid).eq("fecha",fecha).neq("estado","cancelada")]);if(rpe||cse)throw(rpe||cse);const conflict=[...(rp||[]),...(cs||[])].find((x:any)=>Number(x.local_id)!==lid&&overlap(String(s.hora_desde),String(s.hora_hasta),String(x.hora_desde),String(x.hora_hasta)));if(conflict)return json({ok:false,error:`El reemplazo seleccionado tiene un horario superpuesto en otra sucursal el ${fecha}.`},409);}
      }
      const now=new Date().toISOString(),base=body.remuneracion_base_vacaciones==null?null:Number(body.remuneracion_base_vacaciones);const {data:changed,error:ue}=await admin.from("encargada_vacaciones_solicitudes").update({estado:"aprobada",periodo_liquidacion:periodo,remuneracion_base_vacaciones:Number.isFinite(base)?base:null,observacion_resolucion:String(body.observacion||"").trim()||null,resuelto_por_user_id:actorId,resuelto_en:now,impacto_cupos:capacity,actualizado_en:now}).eq("id",id).eq("estado","solicitada").is("resuelto_en",null).is("resuelto_por_user_id",null).select("id");if(ue)throw ue;if(!changed?.length)return json({ok:false,error:"La solicitud cambió. Actualizá el listado."},409);
      if(manager){
        await admin.from("encargada_coberturas_segmentos").delete().eq("solicitud_vacaciones_id",id);
        if(segments.length){const cov=segments.map((s:any)=>({origen:"vacaciones",solicitud_vacaciones_id:id,local_id:Number(s.local_id),fecha:String(s.fecha),reemplazado_user_id:Number(r.user_id),reemplazo_user_id:Number(s.reemplazo_user_id),hora_desde:String(s.hora_desde).slice(0,5),hora_hasta:String(s.hora_hasta).slice(0,5),estado:"planificada",motivo:"Vacaciones",creado_por_user_id:actorId,actualizado_por_user_id:actorId,actualizado_en:now}));const {error:ce}=await admin.from("encargada_coberturas_segmentos").insert(cov);if(ce)throw ce;}
        if(planRows.length){const vacRows=planRows.map((p:any)=>({fecha:p.fecha,local_id:Number(p.local_id),user_id:Number(r.user_id),hora_plan_desde:p.hora_desde,hora_plan_hasta:p.hora_hasta,hora_real_desde:null,hora_real_hasta:null,estado:"vacaciones",reemplaza_user_id:null,comentario:"Vacaciones aprobadas",motivo_ausencia:"Vacaciones",origen:"vacaciones",solicitud_vacaciones_id:id,creado_por_user_id:actorId,actualizado_por_user_id:actorId,actualizado_en:now}));const {error:ve}=await admin.from("encargada_jornada_real").upsert(vacRows,{onConflict:"local_id,user_id,fecha"});if(ve)throw ve;}
      }
      const {data:u}=await admin.from("users").select("nombre,email").eq("id",r.user_id).single();if(u?.email)await sendMail(u.email,u.nombre||"Equipo Niki","Vacaciones aprobadas",`<div style="font-family:Montserrat,Arial,sans-serif"><h2 style="color:#72243e">Vacaciones aprobadas</h2><p>Hola ${esc(u.nombre)},</p><p>Tu solicitud del <strong>${esc(r.fecha_inicio)}</strong> al <strong>${esc(r.fecha_fin)}</strong> fue aprobada.</p></div>`).catch(()=>null);
      return json({ok:true,dias:daysInclusive(r.fecha_inicio,r.fecha_fin),capacity});
    }

    return json({ok:false,error:"Accion invalida"},400);
  }catch(e){console.error(e);return json({ok:false,error:errorText(e)},Number((e as any)?.status)===403?403:500);}
});

