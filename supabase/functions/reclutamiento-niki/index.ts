import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function b64url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

async function hmacSha256(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64url(sig);
}

async function verifySession(token: string, secret: string) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = await hmacSha256(body, secret);
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(fromB64url(body));
    if (!payload?.uid || !payload?.exp) return null;
    if (Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession:false } });
    const sessionSecret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!sessionSecret) return json({ ok:false, error:"Falta configurar NIKI_SESSION_SECRET." },500);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const actorId = Number(body.actor_id || 0);
    const sessionToken = String(body.session_token || "");
    if (!actorId || !sessionToken) return json({ ok:false,error:"Sesión inválida." },401);

    const sessionPayload = await verifySession(sessionToken, sessionSecret);
    if (!sessionPayload || Number(sessionPayload.uid) !== actorId) return json({ ok:false,error:"Sesión inválida o vencida." },401);

    const { data:actor,error:actorError } = await admin.from("users").select("id,rol,activo").eq("id",actorId).maybeSingle();
    if (actorError || !actor || !actor.activo) return json({ ok:false,error:"Sesión inválida o vencida." },401);
    if (!["admin","casa_matriz"].includes(actor.rol)) return json({ ok:false,error:"No tenés permiso para administrar reclutamiento." },403);

    const audit = async (candidataId:number|null, accion:string, detalle:string, datos:unknown=null) => {
      await admin.from("reclutamiento_auditoria").insert({ candidata_id:candidataId,user_id:actor.id,accion,detalle,datos });
    };
    const canAuthorize = async (candidataId:number) => {
      if (actor.rol === "admin") return true;
      const { data:c } = await admin.from("reclutamiento_candidatas").select("puesto").eq("id",candidataId).maybeSingle();
      if (!c) return false;
      const { data:a } = await admin.from("reclutamiento_autorizadores").select("user_id").eq("user_id",actor.id).eq("puesto",c.puesto).eq("activo",true).maybeSingle();
      return !!a;
    };

    const canEditInstance = async (instanciaId:number) => {
      if (actor.rol === "admin") return true;
      const { data:assigned,error } = await admin
        .from("reclutamiento_instancia_evaluadores")
        .select("instancia_id")
        .eq("instancia_id",instanciaId)
        .eq("user_id",actor.id)
        .maybeSingle();
      if (error) throw error;
      return !!assigned;
    };

    const stageCompletion = async (candidataId:number, orden:number) => {
      const { data:previous,error } = await admin
        .from("reclutamiento_instancias")
        .select("id,orden,nombre,tipo,obligatoria,estado,recomendacion")
        .eq("candidata_id",candidataId)
        .eq("obligatoria",true)
        .lt("orden",orden)
        .order("orden");
      if (error) throw error;
      const rows = previous || [];
      const pendiente = rows.find((x:any)=>!["realizada","aprobada"].includes(String(x.estado||"")));
      if (pendiente) return { ok:false, reason:`Primero debe completarse "${pendiente.nombre}".` };
      const desfavorable = rows.find((x:any)=>x.tipo !== "documentacion" && !["si","con_reservas"].includes(String(x.recomendacion||"")));
      if (desfavorable) {
        const extra = String(desfavorable.recomendacion||"") === "no"
          ? "El resultado anterior fue No."
          : "Falta definir una recomendación favorable en la etapa anterior.";
        return { ok:false, reason:`No se puede completar esta etapa. ${extra} (${desfavorable.nombre})` };
      }
      return { ok:true, reason:"" };
    };





    if (action === "candidate_process") {
      const candidataId=Number(body.candidata_id||0);
      if(!candidataId) return json({ok:false,error:"Candidata inválida."},400);
      const [{data:cand,error:cError},{data:inst,error:iError},{data:loc,error:lError},{data:svc,error:sError},{data:tests,error:tError},{data:files,error:fError},{data:aps,error:aError},{data:ev,error:eError}] = await Promise.all([
        admin.from("reclutamiento_candidatas").select("*").eq("id",candidataId).maybeSingle(),
        admin.from("reclutamiento_instancias").select("*").eq("candidata_id",candidataId).order("orden"),
        admin.from("reclutamiento_candidata_locales").select("*").eq("candidata_id",candidataId),
        admin.from("reclutamiento_candidata_servicios").select("*").eq("candidata_id",candidataId),
        admin.from("reclutamiento_prueba_servicios").select("*").in("instancia_id",(await admin.from("reclutamiento_instancias").select("id").eq("candidata_id",candidataId)).data?.map((x:any)=>x.id)||[-1]),
        admin.from("reclutamiento_archivos").select("*").eq("candidata_id",candidataId).order("creado_en",{ascending:false}),
        admin.from("reclutamiento_aprobaciones").select("*").eq("candidata_id",candidataId).eq("activa",true),
        admin.from("reclutamiento_instancia_evaluadores").select("*").in("instancia_id",(await admin.from("reclutamiento_instancias").select("id").eq("candidata_id",candidataId)).data?.map((x:any)=>x.id)||[-1]),
      ]);
      const err=[cError,iError,lError,sError,tError,fError,aError,eError].find(Boolean); if(err) throw err;
      if(!cand) return json({ok:false,error:"Candidata inexistente."},404);
      return json({ok:true,data:{candidata:cand,instancias:inst||[],locales:loc||[],servicios:svc||[],pruebas:tests||[],archivos:files||[],aprobaciones:aps||[],evaluadores:ev||[]}});
    }

    if (action === "event_detail") {
      const instanciaId=Number(body.instancia_id||0);
      if(!instanciaId) return json({ok:false,error:"Etapa inválida."},400);
      const {data:assignedCalendar,error:assignedCalendarError}=await admin
        .from("reclutamiento_instancia_evaluadores")
        .select("instancia_id")
        .eq("instancia_id",instanciaId)
        .eq("user_id",actor.id)
        .maybeSingle();
      if(assignedCalendarError) throw assignedCalendarError;
      const calendarEditable=!!assignedCalendar;

      const {data:inst,error:iError}=await admin
        .from("reclutamiento_instancias")
        .select("*")
        .eq("id",instanciaId)
        .maybeSingle();
      if(iError) throw iError;
      if(!inst) return json({ok:false,error:"Etapa inexistente."},404);

      const [{data:cand,error:cError},{data:ev,error:eError},{data:tests,error:tError},{data:files,error:fError}] = await Promise.all([
        admin.from("reclutamiento_candidatas").select("id,nombre,puesto,estado").eq("id",inst.candidata_id).maybeSingle(),
        admin.from("reclutamiento_instancia_evaluadores").select("instancia_id,user_id").eq("instancia_id",instanciaId),
        admin.from("reclutamiento_prueba_servicios").select("*").eq("instancia_id",instanciaId).order("id"),
        admin.from("reclutamiento_archivos").select("*").eq("instancia_id",instanciaId).order("creado_en",{ascending:false}),
      ]);
      if(cError) throw cError;
      if(eError) throw eError;
      if(tError) throw tError;
      if(fError) throw fError;
      const completion=await stageCompletion(Number(inst.candidata_id),Number(inst.orden||0));
      return json({ok:true,detail:{
        ...inst,
        candidata:cand||null,
        evaluador_ids:(ev||[]).map((x:any)=>Number(x.user_id)),
        pruebas:tests||[],
        archivos:files||[],
        editable:calendarEditable,
        can_complete:completion.ok,
        completion_reason:completion.reason,
      }});
    }

    if (action === "config_load") {
      const [circuitos,plantillas,autorizadores] = await Promise.all([
        admin.from("reclutamiento_circuitos").select("*").order("puesto").order("nombre"),
        admin.from("reclutamiento_etapas_plantilla").select("*").order("circuito_id").order("orden"),
        admin.from("reclutamiento_autorizadores").select("*"),
      ]);
      const error=[circuitos,plantillas,autorizadores].find((x:any)=>x.error)?.error;
      if(error) throw error;
      return json({ok:true,data:{
        circuitos:circuitos.data||[],
        plantillas:plantillas.data||[],
        candidatas:[],locales:[],servicios:[],instancias:[],evaluadores:[],pruebas:[],archivos:[],aprobaciones:[],
        autorizadores:autorizadores.data||[],
      }});
    }

    if (action === "calendar") {
      const desde = String(body.desde || "");
      const hasta = String(body.hasta || "");
      const scope = String(body.scope || "mine");
      let evaluatorRows:any[] = [];
      let instanciaIds:number[] | null = null;

      if (scope !== "all") {
        const { data:ev,error:evError } = await admin
          .from("reclutamiento_instancia_evaluadores")
          .select("instancia_id,user_id")
          .eq("user_id",actor.id);
        if (evError) throw evError;
        evaluatorRows = ev || [];
        instanciaIds = evaluatorRows.map((x:any)=>Number(x.instancia_id)).filter(Boolean);
        if (!instanciaIds.length) return json({ok:true,eventos:[]});
      }

      let q = admin
        .from("reclutamiento_instancias")
        .select("id,candidata_id,orden,nombre,tipo,estado,fecha_hora,local_id,modalidad,comentarios,recomendacion,resultado,realizada_en")
        .not("fecha_hora","is",null)
        .order("fecha_hora",{ascending:true});
      if (desde) q = q.gte("fecha_hora",desde);
      if (hasta) q = q.lt("fecha_hora",hasta);
      if (instanciaIds) q = q.in("id",instanciaIds);
      const { data:instancias,error:iError } = await q;
      if (iError) throw iError;
      const rows = instancias || [];
      if (!rows.length) return json({ok:true,eventos:[]});

      const ids = rows.map((x:any)=>Number(x.id));
      const candidataIds = Array.from(new Set(rows.map((x:any)=>Number(x.candidata_id))));
      const [{data:candidatas,error:cError},{data:allEv,error:eError},{data:allStages,error:sError}] = await Promise.all([
        admin.from("reclutamiento_candidatas").select("id,nombre,puesto,estado").in("id",candidataIds),
        admin.from("reclutamiento_instancia_evaluadores").select("instancia_id,user_id").in("instancia_id",ids),
        admin.from("reclutamiento_instancias").select("id,candidata_id,orden,nombre,tipo,obligatoria,estado,recomendacion").in("candidata_id",candidataIds).order("candidata_id").order("orden"),
      ]);
      if (cError) throw cError;
      if (eError) throw eError;
      if (sError) throw sError;
      const candMap = new Map((candidatas||[]).map((c:any)=>[Number(c.id),c]));
      const eventos = rows.map((i:any)=>{
        const previous=(allStages||[]).filter((x:any)=>Number(x.candidata_id)===Number(i.candidata_id)&&x.obligatoria&&Number(x.orden)<Number(i.orden));
        const pendiente=previous.find((x:any)=>!["realizada","aprobada"].includes(String(x.estado||"")));
        const desfavorable=previous.find((x:any)=>x.tipo!=="documentacion"&&!["si","con_reservas"].includes(String(x.recomendacion||"")));
        const canComplete=!pendiente&&!desfavorable;
        const reason=pendiente
          ? `Primero debe completarse "${pendiente.nombre}".`
          : desfavorable
            ? (String(desfavorable.recomendacion||"")==="no" ? `El resultado de "${desfavorable.nombre}" fue No.` : `Falta una recomendación favorable en "${desfavorable.nombre}".`)
            : "";
        return {
          ...i,
          candidata:candMap.get(Number(i.candidata_id)) || null,
          evaluador_ids:(allEv||[]).filter((e:any)=>Number(e.instancia_id)===Number(i.id)).map((e:any)=>Number(e.user_id)),
          editable: (allEv||[]).some((e:any)=>Number(e.instancia_id)===Number(i.id) && Number(e.user_id)===Number(actor.id)),
          can_complete:canComplete,
          completion_reason:reason,
        };
      });
      return json({ok:true,eventos});
    }

    if (action === "pending_approvals") {
      let puestos:string[] = ["manicura","encargada"];
      if (actor.rol !== "admin") {
        const {data:auth,error:aError}=await admin
          .from("reclutamiento_autorizadores")
          .select("puesto")
          .eq("user_id",actor.id)
          .eq("activo",true);
        if (aError) throw aError;
        puestos=(auth||[]).map((x:any)=>String(x.puesto));
        if (!puestos.length) return json({ok:true,candidatas:[]});
      }

      const {data:candidatas,error:cError}=await admin
        .from("reclutamiento_candidatas")
        .select("id,nombre,email,telefono,puesto,estado,circuito_id,actualizado_en")
        .eq("estado","pendiente_aprobacion")
        .in("puesto",puestos)
        .order("actualizado_en",{ascending:false});
      if (cError) throw cError;
      const rows=candidatas||[];
      if (!rows.length) return json({ok:true,candidatas:[]});

      const ids=rows.map((x:any)=>Number(x.id));
      const circuitIds=Array.from(new Set(rows.map((x:any)=>Number(x.circuito_id)).filter(Boolean)));
      const [{data:aps,error:apError},{data:circs,error:ciError}] = await Promise.all([
        admin.from("reclutamiento_aprobaciones").select("id,candidata_id,user_id,decision,activa,actualizado_en").in("candidata_id",ids).eq("activa",true),
        circuitIds.length ? admin.from("reclutamiento_circuitos").select("id,aprobaciones_requeridas").in("id",circuitIds) : Promise.resolve({data:[],error:null} as any),
      ]);
      if (apError) throw apError;
      if (ciError) throw ciError;
      const circMap=new Map((circs||[]).map((c:any)=>[Number(c.id),c]));
      const pendientes=rows.filter((c:any)=>!(aps||[]).some((a:any)=>Number(a.candidata_id)===Number(c.id)&&Number(a.user_id)===Number(actor.id)))
        .map((c:any)=>({
          ...c,
          aprobaciones:(aps||[]).filter((a:any)=>Number(a.candidata_id)===Number(c.id)&&a.decision==="aprobada").length,
          rechazos:(aps||[]).filter((a:any)=>Number(a.candidata_id)===Number(c.id)&&a.decision==="rechazada").length,
          requeridas:Number(circMap.get(Number(c.circuito_id))?.aprobaciones_requeridas||2),
        }));
      return json({ok:true,candidatas:pendientes});
    }

    if (action === "load" || action === "available") {
      if (action === "available") {
        const { data,error } = await admin.from("reclutamiento_candidatas").select("*").eq("estado","disponible").order("nombre");
        if (error) throw error;
        return json({ ok:true,candidatas:data || [] });
      }
      const [circuitos,plantillas,candidatas,locales,servicios,instancias,evaluadores,pruebas,archivos,aprobaciones,autorizadores] = await Promise.all([
        admin.from("reclutamiento_circuitos").select("*").order("puesto").order("nombre"),
        admin.from("reclutamiento_etapas_plantilla").select("*").order("circuito_id").order("orden"),
        admin.from("reclutamiento_candidatas").select("*").order("actualizado_en",{ascending:false}),
        admin.from("reclutamiento_candidata_locales").select("*"),
        admin.from("reclutamiento_candidata_servicios").select("*"),
        admin.from("reclutamiento_instancias").select("*").order("candidata_id").order("orden"),
        admin.from("reclutamiento_instancia_evaluadores").select("*"),
        admin.from("reclutamiento_prueba_servicios").select("*").order("instancia_id").order("id"),
        admin.from("reclutamiento_archivos").select("*").order("creado_en",{ascending:false}),
        admin.from("reclutamiento_aprobaciones").select("*").order("actualizado_en",{ascending:false}),
        admin.from("reclutamiento_autorizadores").select("*"),
      ]);
      const error = [circuitos,plantillas,candidatas,locales,servicios,instancias,evaluadores,pruebas,archivos,aprobaciones,autorizadores].find(x=>x.error)?.error;
      if (error) throw error;
      return json({ ok:true,data:{ circuitos:circuitos.data||[],plantillas:plantillas.data||[],candidatas:candidatas.data||[],locales:locales.data||[],servicios:servicios.data||[],instancias:instancias.data||[],evaluadores:evaluadores.data||[],pruebas:pruebas.data||[],archivos:archivos.data||[],aprobaciones:aprobaciones.data||[],autorizadores:autorizadores.data||[] } });
    }

    if (action === "save_candidate") {
      const p = body.candidate || {};
      if (!String(p.nombre||"").trim() || !["manicura","encargada"].includes(p.puesto)) throw new Error("Nombre y puesto son obligatorios.");
      let id = Number(p.id || 0);
      let circuitoId = Number(p.circuito_id || 0) || null;
      if (!circuitoId) {
        const { data:c } = await admin.from("reclutamiento_circuitos").select("id").eq("puesto",p.puesto).eq("activo",true).order("id").limit(1).maybeSingle();
        circuitoId = c?.id || null;
      }
      const payload = { nombre:String(p.nombre).trim(),email:p.email||null,telefono:p.telefono||null,puesto:p.puesto,circuito_id:circuitoId,origen:p.origen||null,disponibilidad_desde:p.disponibilidad_desde||null,disponibilidad_horaria:p.disponibilidad_horaria||null,observaciones:p.observaciones||null,actualizado_por_user_id:actor.id };
      if (id) {
        const { error } = await admin.from("reclutamiento_candidatas").update(payload).eq("id",id); if (error) throw error;
      } else {
        const { data,error } = await admin.from("reclutamiento_candidatas").insert({ ...payload,creado_por_user_id:actor.id }).select("id").single(); if (error) throw error; id=data.id;
      }
      await admin.from("reclutamiento_candidata_locales").delete().eq("candidata_id",id);
      const localIds = Array.isArray(body.local_ids) ? body.local_ids.map(Number).filter(Boolean) : [];
      if (localIds.length) { const { error } = await admin.from("reclutamiento_candidata_locales").insert(localIds.map((local_id:number)=>({candidata_id:id,local_id}))); if (error) throw error; }
      await admin.from("reclutamiento_candidata_servicios").delete().eq("candidata_id",id);
      const svcs = Array.isArray(body.servicios) ? body.servicios : [];
      if (svcs.length) { const { error } = await admin.from("reclutamiento_candidata_servicios").insert(svcs.map((x:any)=>({candidata_id:id,servicio_id:Number(x.servicioId),realiza:!!x.realiza,observacion:x.observacion||null}))); if (error) throw error; }
      await audit(id,p.id?"CANDIDATA_EDITADA":"CANDIDATA_CREADA",payload.nombre,{puesto:p.puesto});
      return json({ ok:true,id });
    }

    if (action === "save_stage") {
      const id=Number(body.instancia_id||0); if(!id)throw new Error("Etapa inválida.");
      if (actor.rol !== "admin") {
        const {data:assigned,error:assignedError}=await admin
          .from("reclutamiento_instancia_evaluadores")
          .select("instancia_id")
          .eq("instancia_id",id)
          .eq("user_id",actor.id)
          .maybeSingle();
        if (assignedError) throw assignedError;
        if (!assigned) return json({ok:false,error:"Solo el evaluador asignado o Admin puede editar esta entrevista o prueba."},403);
      }
      const { data:inst }=await admin.from("reclutamiento_instancias").select("candidata_id,nombre,orden,tipo,estado").eq("id",id).maybeSingle(); if(!inst)throw new Error("Etapa inexistente.");
      const { data:cand }=await admin.from("reclutamiento_candidatas").select("circuito_id").eq("id",inst.candidata_id).single();
      const { data:circ }=await admin.from("reclutamiento_circuitos").select("aprobaciones_requeridas").eq("id",cand.circuito_id).maybeSingle();
      const { count:approved }=await admin.from("reclutamiento_aprobaciones").select("id",{count:"exact",head:true}).eq("candidata_id",inst.candidata_id).eq("activa",true).eq("decision","aprobada");
      if ((approved||0) >= (circ?.aprobaciones_requeridas||2)) return json({ok:false,error:"La candidata ya está autorizada. Un autorizador debe retirar su aprobación antes de editar evaluaciones."},409);
      const p=body.stage||{};
      if (String(p.estado||"") === "realizada") {
        const completion=await stageCompletion(Number(inst.candidata_id),Number(inst.orden||0));
        if(!completion.ok) return json({ok:false,error:completion.reason},409);
      }
      const { data:updated,error }=await admin.from("reclutamiento_instancias").update({fecha_hora:p.fecha_hora||null,local_id:p.local_id||null,modalidad:p.modalidad||null,comentarios:p.comentarios||null,recomendacion:p.recomendacion||null,resultado:p.resultado||null,estado:p.estado||"pendiente",realizada_en:p.realizada_en||null,actualizado_por_user_id:actor.id}).eq("id",id).select("*").single(); if(error)throw error;
      await admin.from("reclutamiento_instancia_evaluadores").delete().eq("instancia_id",id);
      const ev=Array.isArray(body.evaluador_ids)?body.evaluador_ids.map(Number).filter(Boolean):[];
      if(ev.length){const {error:e}=await admin.from("reclutamiento_instancia_evaluadores").insert(ev.map((user_id:number)=>({instancia_id:id,user_id})));if(e)throw e;}
      await audit(inst.candidata_id,p.estado==="realizada"?"ETAPA_REALIZADA":"ETAPA_GUARDADA",inst.nombre,{instanciaId:id});
      const {data:candidateNow}=await admin.from("reclutamiento_candidatas").select("estado").eq("id",inst.candidata_id).maybeSingle();
      return json({ok:true,instancia:updated,evaluador_ids:ev,candidata_estado:candidateNow?.estado||null});
    }

    if (action === "test_service_create") {
      const instanciaId=Number(body.instancia_id||0);
      if(!(await canEditInstance(instanciaId))) return json({ok:false,error:"Solo el evaluador asignado o Admin puede editar esta prueba."},403);
      const {data:inst}=await admin.from("reclutamiento_instancias").select("candidata_id").eq("id",instanciaId).maybeSingle();if(!inst)throw new Error("Prueba inválida.");
      const {data,error}=await admin.from("reclutamiento_prueba_servicios").insert({instancia_id:instanciaId,servicio_id:body.servicio_id||null,servicio_nombre:String(body.servicio_nombre||"Servicio")}).select("id").single();if(error)throw error;await audit(inst.candidata_id,"SERVICIO_PRUEBA_AGREGADO",String(body.servicio_nombre||"Servicio"),{id:data.id});return json({ok:true,id:data.id});
    }
    if (action === "test_service_update" || action === "test_service_delete") {
      const id=Number(body.id||0);const {data:row}=await admin.from("reclutamiento_prueba_servicios").select("instancia_id,servicio_nombre").eq("id",id).maybeSingle();if(!row)throw new Error("Servicio de prueba inválido.");
      if(!(await canEditInstance(Number(row.instancia_id)))) return json({ok:false,error:"Solo el evaluador asignado o Admin puede editar esta prueba."},403);
      const {data:inst}=await admin.from("reclutamiento_instancias").select("candidata_id").eq("id",row.instancia_id).single();
      if(action==="test_service_delete"){const {error}=await admin.from("reclutamiento_prueba_servicios").delete().eq("id",id);if(error)throw error;await audit(inst.candidata_id,"SERVICIO_PRUEBA_ELIMINADO",row.servicio_nombre);}
      else{const {error}=await admin.from("reclutamiento_prueba_servicios").update({resultado:body.patch?.resultado??undefined,comentario:body.patch?.comentario??undefined,puntaje:body.patch?.puntaje??undefined,actualizado_en:new Date().toISOString()}).eq("id",id);if(error)throw error;await audit(inst.candidata_id,"SERVICIO_PRUEBA_EDITADO",row.servicio_nombre);}
      return json({ok:true});
    }

    if (action === "approval") {
      const candidataId=Number(body.candidata_id||0), decision=String(body.decision||"");if(!["aprobada","rechazada"].includes(decision))throw new Error("Decisión inválida.");if(!(await canAuthorize(candidataId)))return json({ok:false,error:"No sos autorizador/a de RRHH para este puesto."},403);
      if(decision==="aprobada") { const { count }=await admin.from("reclutamiento_instancias").select("id",{count:"exact",head:true}).eq("candidata_id",candidataId).eq("obligatoria",true).not("estado","in",'(realizada,aprobada)'); if((count||0)>0)return json({ok:false,error:"Todavía hay instancias obligatorias pendientes."},409); }
      const {data:current}=await admin.from("reclutamiento_aprobaciones").select("id").eq("candidata_id",candidataId).eq("user_id",actor.id).maybeSingle();
      if(current){const {error}=await admin.from("reclutamiento_aprobaciones").update({decision,comentario:body.comentario||null,activa:true,actualizado_en:new Date().toISOString()}).eq("id",current.id);if(error)throw error;}else{const{error}=await admin.from("reclutamiento_aprobaciones").insert({candidata_id:candidataId,user_id:actor.id,decision,comentario:body.comentario||null,activa:true});if(error)throw error;}
      await audit(candidataId,decision==="aprobada"?"APROBACION_RRHH":"RECHAZO_RRHH",`Decisión de ${actor.id}`);return json({ok:true});
    }
    if (action === "approval_remove") {
      const candidataId=Number(body.candidata_id||0);if(!(await canAuthorize(candidataId)))return json({ok:false,error:"No sos autorizador/a para este puesto."},403);const {error}=await admin.from("reclutamiento_aprobaciones").update({activa:false,actualizado_en:new Date().toISOString()}).eq("candidata_id",candidataId).eq("user_id",actor.id).eq("activa",true);if(error)throw error;await audit(candidataId,"APROBACION_RETIRADA",`Usuario ${actor.id}`);return json({ok:true});
    }

    if (action === "candidate_status") {
      const id=Number(body.candidata_id||0),estado=String(body.estado||"");if(!["en_pausa","en_proceso","desistio","rechazada","nueva"].includes(estado))throw new Error("Estado manual inválido.");const{error}=await admin.from("reclutamiento_candidatas").update({estado,actualizado_por_user_id:actor.id}).eq("id",id);if(error)throw error;await audit(id,"ESTADO_CAMBIADO",estado);return json({ok:true});
    }

    if (action === "file_add" || action === "file_delete") {
      if(action==="file_add"){const p=body.file||{};const{error}=await admin.from("reclutamiento_archivos").insert({...p,creado_por_user_id:actor.id});if(error)throw error;await audit(Number(p.candidata_id),"ARCHIVO_SUBIDO",String(p.nombre_archivo||"archivo"));}
      else{const id=Number(body.id||0);const{data:r}=await admin.from("reclutamiento_archivos").select("candidata_id,nombre_archivo").eq("id",id).maybeSingle();const{error}=await admin.from("reclutamiento_archivos").delete().eq("id",id);if(error)throw error;if(r)await audit(r.candidata_id,"ARCHIVO_ELIMINADO",r.nombre_archivo);}
      return json({ok:true});
    }

    if (["config_circuit","config_authorizer","config_stage_create","config_stage_delete"].includes(action)) {
      if(actor.rol!=="admin")return json({ok:false,error:"Solo Admin puede modificar la configuración de reclutamiento."},403);
      if(action==="config_circuit"){const{error}=await admin.from("reclutamiento_circuitos").update({aprobaciones_requeridas:Number(body.aprobaciones_requeridas||2)}).eq("id",Number(body.id));if(error)throw error;}
      if(action==="config_authorizer"){const uid=Number(body.user_id),puesto=String(body.puesto),activo=!!body.activo;const{data:r}=await admin.from("reclutamiento_autorizadores").select("user_id").eq("user_id",uid).eq("puesto",puesto).maybeSingle();if(r){const{error}=await admin.from("reclutamiento_autorizadores").update({activo}).eq("user_id",uid).eq("puesto",puesto);if(error)throw error;}else{const{error}=await admin.from("reclutamiento_autorizadores").insert({user_id:uid,puesto,activo});if(error)throw error;}}
      if(action==="config_stage_create"){const{error}=await admin.from("reclutamiento_etapas_plantilla").insert(body.stage);if(error)throw error;}
      if(action==="config_stage_delete"){const{error}=await admin.from("reclutamiento_etapas_plantilla").delete().eq("id",Number(body.id));if(error)throw error;}
      return json({ok:true});
    }

    if (action === "candidate_incorporated") {
      const id=Number(body.candidata_id||0),userId=Number(body.user_id||0);if(!id||!userId)throw new Error("Datos de incorporación incompletos.");const{error}=await admin.from("reclutamiento_candidatas").update({estado:"incorporada",user_id:userId,actualizado_por_user_id:actor.id}).eq("id",id);if(error)throw error;await audit(id,"CANDIDATA_INCORPORADA",`Usuario ${userId}`,{userId});return json({ok:true});
    }

    return json({ ok:false,error:"Acción no válida." },400);
  } catch (error) {
    return json({ ok:false,error:error instanceof Error?error.message:String(error) },400);
  }
});

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});}
