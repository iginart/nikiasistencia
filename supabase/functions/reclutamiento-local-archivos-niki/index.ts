import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
function b64url(input:string|ArrayBuffer){const bytes=typeof input==="string"?new TextEncoder().encode(input):new Uint8Array(input);let bin="";bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function fromB64url(input:string){const n=input.replace(/-/g,"+").replace(/_/g,"/");return atob(n+"=".repeat((4-n.length%4)%4));}
async function hmacSha256(message:string,secret:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64url(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));}
async function verifySession(token:string,secret:string){const [body,sig]=String(token||"").split(".");if(!body||!sig||await hmacSha256(body,secret)!==sig)return null;try{const p=JSON.parse(fromB64url(body));if(!p?.uid||!p?.exp||Number(p.exp)<Math.floor(Date.now()/1000))return null;return p;}catch{return null;}}
const uniq=(xs:any[])=>Array.from(new Set((xs||[]).map(Number).filter(Boolean)));
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,secret=Deno.env.get("NIKI_SESSION_SECRET")||Deno.env.get("NIKI_IMPORT_TOKEN")||"";
    if(!secret)return json({ok:false,error:"Falta configurar NIKI_SESSION_SECRET."},500);
    const admin=createClient(url,key,{auth:{persistSession:false}}),form=await req.formData();
    const action=String(form.get("action")||""),actorId=Number(form.get("actor_id")||0),token=String(form.get("session_token")||""),candidataId=Number(form.get("candidata_id")||0),instanciaId=Number(form.get("instancia_id")||0)||null,tipo=String(form.get("tipo")||"otro"),path=String(form.get("path")||""),expiresIn=Math.min(3600,Math.max(60,Number(form.get("expires_in")||600)));
    const session=await verifySession(token,secret);if(!actorId||!candidataId||!session||Number(session.uid)!==actorId)return json({ok:false,error:"Sesión inválida o vencida."},401);
    const {data:actor,error:ae}=await admin.from("users").select("id,rol,activo").eq("id",actorId).maybeSingle();if(ae||!actor||actor.activo===false)return json({ok:false,error:"Sesión inválida o vencida."},401);if(!["franquiciado","encargada"].includes(actor.rol))return json({ok:false,error:"Perfil no habilitado."},403);
    const {data:lr,error:le}=actor.rol==="franquiciado"?await admin.from("usuario_locales").select("local_id").eq("user_id",actor.id):await admin.from("encargado_locales").select("local_id").eq("user_id",actor.id);if(le)throw le;const actorLocals=new Set(uniq((lr||[]).map((x:any)=>x.local_id)));
    const {data:candidate,error:ce}=await admin.from("reclutamiento_candidatas").select("id,creado_por_user_id").eq("id",candidataId).maybeSingle();if(ce)throw ce;if(!candidate)return json({ok:false,error:"La candidata no existe."},404);
    const {data:rels,error:re}=await admin.from("reclutamiento_candidata_locales").select("local_id").eq("candidata_id",candidataId);if(re)throw re;const candidateLocals=uniq((rels||[]).map((x:any)=>x.local_id));const inScope=candidateLocals.some(x=>actorLocals.has(Number(x)));if(!inScope)return json({ok:false,error:"La candidata no pertenece a tus sucursales."},403);
    if(actor.rol==="encargada"){
      if(Number(candidate.creado_por_user_id)!==Number(actor.id))return json({ok:false,error:"Solo podés adjuntar archivos a candidatas cargadas por vos."},403);
      if(instanciaId)return json({ok:false,error:"Las encargadas no pueden acceder a archivos de procesos."},403);
      if(action!=="upload")return json({ok:false,error:"Las encargadas solo pueden adjuntar archivos al cargar la candidata."},403);
    }
    const prefix=`${candidataId}/`;if(action!=="upload"&&(!path||!path.startsWith(prefix)))return json({ok:false,error:"Ruta de archivo inválida."},400);
    if(action==="upload"){
      const file=form.get("file");if(!(file instanceof File))throw new Error("No se recibió el archivo.");const allowed=["image/jpeg","image/png","image/webp","application/pdf"];if(!allowed.includes(file.type))throw new Error("Formato de archivo no permitido.");const max=file.type==="application/pdf"?5*1024*1024:2*1024*1024;if(file.size>max)throw new Error("El archivo supera el tamaño permitido.");const safe=file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_");const folder=tipo==="cv"?"cv":instanciaId?`instancias/${instanciaId}`:"general";const storagePath=`${candidataId}/${folder}/${Date.now()}_${safe}`;const bytes=new Uint8Array(await file.arrayBuffer());const {error}=await admin.storage.from("reclutamiento").upload(storagePath,bytes,{contentType:file.type,upsert:false});if(error)throw error;return json({ok:true,path:storagePath,name:file.name,size:file.size,mimeType:file.type});
    }
    if(action==="sign"){const {data,error}=await admin.storage.from("reclutamiento").createSignedUrl(path,expiresIn);if(error)throw error;return json({ok:true,url:data.signedUrl});}
    if(action==="delete"){const {error}=await admin.storage.from("reclutamiento").remove([path]);if(error)throw error;return json({ok:true});}
    return json({ok:false,error:"Acción no válida."},400);
  }catch(e){console.error(e);return json({ok:false,error:e instanceof Error?e.message:String(e)},400);}
});
