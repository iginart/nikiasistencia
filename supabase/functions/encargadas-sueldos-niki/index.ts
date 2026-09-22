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
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  } catch { return null; }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function dateParts(key: string) {
  const [y,m,d] = String(key || "").slice(0,10).split("-").map(Number);
  return { y, m, d };
}
function dateUtc(key: string) {
  const { y,m,d } = dateParts(key);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function dateKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function addDays(key: string, days: number) {
  const d = dateUtc(key); d.setUTCDate(d.getUTCDate()+days); return dateKey(d);
}
function monthRange(periodo: string) {
  if (!/^\d{4}-\d{2}$/.test(periodo)) throw new Error("Período inválido.");
  const [y,m] = periodo.split("-").map(Number);
  const desde = `${y}-${String(m).padStart(2,"0")}-01`;
  const end = new Date(Date.UTC(y, m, 0));
  return { desde, hasta: dateKey(end), y, m };
}
function minutes(value: string | null | undefined) {
  if (!value) return null;
  const [h,m] = String(value).slice(0,5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h*60+m;
}
function hoursOutside(planDesde: string | null, planHasta: string | null, realDesde: string | null, realHasta: string | null) {
  const rs = minutes(realDesde), re = minutes(realHasta);
  if (rs == null || re == null || re <= rs) return 0;
  const ps = minutes(planDesde), pe = minutes(planHasta);
  if (ps == null || pe == null || pe <= ps) return (re-rs)/60;
  const before = Math.max(0, Math.min(re, ps) - rs);
  const after = Math.max(0, re - Math.max(rs, pe));
  return (before + after) / 60;
}
function worked(row: any) {
  if (!row) return false;
  if (["ausencia","vacaciones"].includes(String(row.estado || ""))) return false;
  const rs = minutes(row.hora_real_desde), re = minutes(row.hora_real_hasta);
  return rs != null && re != null && re > rs;
}
function weekType(fecha: string, refA: string | null) {
  if (!refA) return "a";
  const d = dateUtc(fecha), r = dateUtc(refA);
  const diff = Math.floor((d.getTime() - r.getTime()) / 86400000);
  const weeks = Math.floor(diff / 7);
  return Math.abs(weeks % 2) === 0 ? "a" : "b";
}
function dayOfWeek(fecha: string) {
  const js = dateUtc(fecha).getUTCDay();
  return js === 0 ? 7 : js;
}
function monthsWorkedInSemester(hist: any[], userId: number, start: string, end: string) {
  const rows = (hist || []).filter((x:any)=>Number(x.user_id)===Number(userId));
  let count = 0;
  const startDate = dateUtc(start);
  for (let i=0;i<6;i++) {
    const d = new Date(startDate); d.setUTCMonth(d.getUTCMonth()+i);
    const monthStart = dateKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const monthEnd = dateKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)));
    if (monthStart > end) break;
    const active = rows.some((r:any)=>String(r.fecha_inicio||"") <= monthEnd && (!r.fecha_fin || String(r.fecha_fin) >= monthStart));
    if (active) count += 1;
  }
  return count;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const secret = Deno.env.get("NIKI_SESSION_SECRET") || Deno.env.get("NIKI_IMPORT_TOKEN") || "";
    if (!secret) return json({ ok:false,error:"Falta configurar NIKI_SESSION_SECRET." },500);
    const admin = createClient(url, serviceKey, { auth:{ persistSession:false } });
    const body = await req.json().catch(() => ({}));
    const actorId = Number(body.actor_id || 0);
    const sessionToken = String(body.session_token || "");
    const action = String(body.action || "");
    const session = await verifySession(sessionToken, secret);
    if (!actorId || !session || Number(session.uid) !== actorId) return json({ ok:false,error:"Sesión inválida o vencida." },401);
    const { data:actor,error:actorError } = await admin.from("users").select("id,nombre,rol,activo").eq("id",actorId).maybeSingle();
    if (actorError || !actor || !actor.activo) return json({ ok:false,error:"Sesión inválida o vencida." },401);
    if (!["admin","casa_matriz","franquiciado","encargada"].includes(actor.rol)) return json({ ok:false,error:"No tenés acceso a información salarial de encargadas." },403);

    const localRows = async () => {
      if (actor.rol === "admin") {
        const { data,error } = await admin.from("locales").select("id");
        if (error) throw error;
        return (data||[]).map((x:any)=>Number(x.id));
      }
      if (actor.rol === "encargada") {
        const { data,error } = await admin.from("encargado_locales").select("local_id").eq("user_id",actor.id);
        if (error) throw error; return (data||[]).map((x:any)=>Number(x.local_id));
      }
      if (actor.rol === "franquiciado") {
        const { data,error } = await admin.from("usuario_locales").select("local_id").eq("user_id",actor.id);
        if (error) throw error; return (data||[]).map((x:any)=>Number(x.local_id));
      }
      const [{data:propios,error:e1},{data:extra,error:e2}] = await Promise.all([
        admin.from("locales").select("id").eq("tipo_local","propio"),
        admin.from("usuario_locales").select("local_id").eq("user_id",actor.id),
      ]);
      if (e1) throw e1; if (e2) throw e2;
      return Array.from(new Set([...(propios||[]).map((x:any)=>Number(x.id)),...(extra||[]).map((x:any)=>Number(x.local_id))]));
    };
    const allowedLocalIds = await localRows();

    const canAccessEncargada = async (targetUserId:number) => {
      if (actor.rol === "admin") return true;
      if (actor.rol === "encargada") return Number(actor.id) === Number(targetUserId);
      const { data:u,error:uError } = await admin.from("users").select("id,rol,activo,nombre").eq("id",targetUserId).maybeSingle();
      if (uError) throw uError;
      if (!u) return false;
      const { data:rels,error:rError } = await admin.from("encargado_locales").select("local_id").eq("user_id",targetUserId);
      if (rError) throw rError;
      return (rels||[]).some((r:any)=>allowedLocalIds.includes(Number(r.local_id)));
    };

    if (action === "salary_history") {
      const targetUserId = actor.rol === "encargada" ? actor.id : Number(body.target_user_id || 0);
      if (!targetUserId || !(await canAccessEncargada(targetUserId))) return json({ ok:false,error:"Encargada fuera de tu alcance." },403);
      const { data:rows,error } = await admin.from("encargada_sueldo_historial").select("*").eq("user_id",targetUserId).order("vigencia_desde",{ascending:false});
      if (error) throw error;
      return json({ ok:true, rows:rows||[] });
    }

    if (action === "salary_save") {
      if (!["admin","casa_matriz","franquiciado"].includes(actor.rol)) return json({ok:false,error:"Tu perfil es de solo lectura para datos salariales."},403);
      const targetUserId = Number(body.target_user_id || 0);
      if (!targetUserId || !(await canAccessEncargada(targetUserId))) return json({ ok:false,error:"Encargada fuera de tu alcance." },403);
      const vigencia = String(body.vigencia_desde || "");
      const sueldo = Number(body.sueldo_base || 0);
      const horas = Number(body.horas_diarias_habituales || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) return json({ok:false,error:"Indicá la fecha de vigencia."},400);
      if (!(sueldo > 0)) return json({ok:false,error:"El sueldo base debe ser mayor a cero."},400);
      if (!(horas > 0 && horas <= 24)) return json({ok:false,error:"Las horas diarias habituales deben ser mayores a cero y hasta 24."},400);
      const payload = { user_id:targetUserId,vigencia_desde:vigencia,sueldo_base:sueldo,horas_diarias_habituales:horas,observacion:String(body.observacion||"").trim()||null,creado_por_user_id:actor.id,actualizado_por_user_id:actor.id,actualizado_en:new Date().toISOString() };
      const { data,error } = await admin.from("encargada_sueldo_historial").upsert(payload,{onConflict:"user_id,vigencia_desde"}).select();
      if (error) throw error;
      return json({ok:true,row:data?.[0]||null});
    }

    if (action === "preliquidacion") {
      const periodo = String(body.periodo || "");
      const { desde,hasta,y,m } = monthRange(periodo);
      const requestedLocalId = body.local_id ? Number(body.local_id) : null;
      if (requestedLocalId && !allowedLocalIds.includes(requestedLocalId)) return json({ok:false,error:"Sucursal fuera de tu alcance."},403);
      const localIds = requestedLocalId ? [requestedLocalId] : allowedLocalIds;
      if (!localIds.length) return json({ok:true,periodo,rows:[],locales:[]});

      const { data:encRel,error:relError } = await admin.from("encargado_locales").select("user_id,local_id").in("local_id",localIds);
      if (relError) throw relError;
      let userIds = Array.from(new Set((encRel||[]).map((x:any)=>Number(x.user_id))));
      if (actor.rol === "encargada") userIds = userIds.filter((id:number)=>id===Number(actor.id));
      const requestedUserId = body.target_user_id ? Number(body.target_user_id) : null;
      if (requestedUserId) {
        if (!(await canAccessEncargada(requestedUserId))) return json({ok:false,error:"Encargada fuera de tu alcance."},403);
        userIds = userIds.filter((id:number)=>id===requestedUserId);
      }
      if (!userIds.length) return json({ok:true,periodo,rows:[],locales:[]});

      const semesterStartMonth = m <= 6 ? 1 : 7;
      const semDesde = `${y}-${String(semesterStartMonth).padStart(2,"0")}-01`;
      const semHasta = m <= 6 ? `${y}-06-30` : `${y}-12-31`;

      const [usersQ,localesQ,planQ,weekQ,cfgQ,realQ,ferQ,salaryQ,histQ] = await Promise.all([
        admin.from("users").select("id,nombre,activo").in("id",userIds),
        admin.from("locales").select("id,nombre").in("id",localIds),
        admin.from("encargada_planificacion").select("*").in("local_id",localIds).gte("fecha",desde).lte("fecha",hasta),
        admin.from("encargada_semana_tipo").select("*").in("local_id",localIds),
        admin.from("encargada_planificacion_config").select("*").in("local_id",localIds),
        admin.from("encargada_jornada_real").select("*").in("local_id",localIds).gte("fecha",desde).lte("fecha",hasta),
        admin.from("feriados").select("fecha,descripcion").gte("fecha",desde).lte("fecha",hasta),
        admin.from("encargada_sueldo_historial").select("*").in("user_id",userIds).lte("vigencia_desde",hasta).order("vigencia_desde",{ascending:true}),
        admin.from("usuario_historial_laboral").select("user_id,fecha_inicio,fecha_fin").in("user_id",userIds),
      ]);
      const err = [usersQ,localesQ,planQ,weekQ,cfgQ,realQ,ferQ,salaryQ,histQ].find((x:any)=>x.error)?.error; if (err) throw err;
      const users = usersQ.data||[], locales = localesQ.data||[], confirmed = planQ.data||[], templates = weekQ.data||[], configs = cfgQ.data||[], real = realQ.data||[], feriados = new Set((ferQ.data||[]).map((x:any)=>String(x.fecha)));
      const salary = salaryQ.data||[], laborHist = histQ.data||[];
      const confirmedByKey = new Map<string,any>();
      confirmed.forEach((r:any)=>confirmedByKey.set(`${r.local_id}|${r.user_id}|${r.fecha}`,r));
      const cfgByLocal = new Map(configs.map((c:any)=>[Number(c.local_id),c]));
      const templateByKey = new Map<string,any>();
      templates.forEach((r:any)=>templateByKey.set(`${r.local_id}|${r.user_id}|${r.dia_semana}|${r.tipo_semana}`,r));
      const rels = encRel||[];
      const planRows:any[] = [];
      for (let f=desde; f<=hasta; f=addDays(f,1)) {
        const dow = dayOfWeek(f);
        for (const rel of rels) {
          const uid=Number(rel.user_id), lid=Number(rel.local_id);
          if (!userIds.includes(uid) || !localIds.includes(lid)) continue;
          const conf = confirmedByKey.get(`${lid}|${uid}|${f}`);
          if (conf) { planRows.push({local_id:lid,user_id:uid,fecha:f,hora_desde:conf.hora_desde,hora_hasta:conf.hora_hasta,fuente:"confirmado"}); continue; }
          const wt = weekType(f, cfgByLocal.get(lid)?.fecha_referencia_a || null);
          const specific = templateByKey.get(`${lid}|${uid}|${dow}|${wt}`);
          const common = templateByKey.get(`${lid}|${uid}|${dow}|todas`);
          const t = specific || common;
          if (t?.hora_desde && t?.hora_hasta) planRows.push({local_id:lid,user_id:uid,fecha:f,hora_desde:t.hora_desde,hora_hasta:t.hora_hasta,fuente:"semana_tipo"});
        }
      }
      const planByKey = new Map(planRows.map(r=>[`${r.local_id}|${r.user_id}|${r.fecha}`,r]));
      const realByUser = new Map<number,any[]>();
      (real||[]).filter((r:any)=>userIds.includes(Number(r.user_id))).forEach((r:any)=>{ const uid=Number(r.user_id); if(!realByUser.has(uid))realByUser.set(uid,[]);realByUser.get(uid)!.push(r); });
      const rows = users.map((u:any)=>{
        const uid=Number(u.id);
        const plans=planRows.filter((p:any)=>Number(p.user_id)===uid);
        const reals=realByUser.get(uid)||[];
        const agendados=new Set(plans.map((p:any)=>String(p.fecha)));
        const trabajados=new Set(reals.filter(worked).map((r:any)=>String(r.fecha)));
        const ausencias=new Set(reals.filter((r:any)=>String(r.estado)==="ausencia").map((r:any)=>String(r.fecha)));
        let extra=0;
        reals.filter(worked).forEach((r:any)=>{
          const plan = planByKey.get(`${r.local_id}|${uid}|${r.fecha}`);
          const pd = r.hora_plan_desde || plan?.hora_desde || null;
          const ph = r.hora_plan_hasta || plan?.hora_hasta || null;
          extra += hoursOutside(pd, ph, r.hora_real_desde, r.hora_real_hasta);
        });
        extra = Math.round(extra*100)/100;
        const feriadosTrabajados = new Set(reals.filter((r:any)=>worked(r)&&feriados.has(String(r.fecha))).map((r:any)=>String(r.fecha))).size;
        const salaryRows=salary.filter((s:any)=>Number(s.user_id)===uid&&String(s.vigencia_desde)<=hasta);
        const current=salaryRows.length?salaryRows[salaryRows.length-1]:null;
        const sueldoBase=Number(current?.sueldo_base||0), horasDia=Number(current?.horas_diarias_habituales||0);
        const valorHoraExtra = sueldoBase>0&&horasDia>0 ? sueldoBase/30/horasDia : 0;
        const montoExtras = valorHoraExtra*extra;
        const montoFeriados = sueldoBase>0 ? sueldoBase/30*feriadosTrabajados : 0;
        const semSalary=salary.filter((s:any)=>Number(s.user_id)===uid&&String(s.vigencia_desde)<=semHasta);
        const bestBase = semSalary.length ? Math.max(...semSalary.map((s:any)=>Number(s.sueldo_base||0))) : sueldoBase;
        const mesesTrabajados = monthsWorkedInSemester(laborHist,uid,semDesde,semHasta);
        const aguinaldo = (m===6||m===12) && bestBase>0 ? (bestBase/2)*(mesesTrabajados/6) : 0;
        const total = sueldoBase + montoExtras + montoFeriados + aguinaldo;
        const detail = Array.from(new Set([...plans.map((p:any)=>String(p.fecha)),...reals.map((r:any)=>String(r.fecha))])).sort().map(fecha=>{
          const dayPlans=plans.filter((p:any)=>String(p.fecha)===fecha);
          const dayReals=reals.filter((r:any)=>String(r.fecha)===fecha);
          const extraDay = dayReals.filter(worked).reduce((acc:number,r:any)=>{ const p=planByKey.get(`${r.local_id}|${uid}|${fecha}`); return acc+hoursOutside(r.hora_plan_desde||p?.hora_desde||null,r.hora_plan_hasta||p?.hora_hasta||null,r.hora_real_desde,r.hora_real_hasta); },0);
          return { fecha, agendado:dayPlans.length>0, trabajado:dayReals.some(worked), ausencia:dayReals.some((r:any)=>String(r.estado)==="ausencia"), cambio_turno:dayReals.some((r:any)=>String(r.estado)==="cambio_turno"), feriado:feriados.has(fecha), horas_extra:Math.round(extraDay*100)/100, plan:dayPlans, real:dayReals };
        });
        return { user_id:uid,nombre:u.nombre,dias_agendados:agendados.size,dias_trabajados:trabajados.size,ausencias:ausencias.size,horas_extra:extra,feriados_trabajados:feriadosTrabajados,sueldo_base:sueldoBase,horas_diarias_habituales:horasDia,valor_hora_extra:valorHoraExtra,monto_horas_extra:montoExtras,monto_feriados:montoFeriados,aguinaldo,mejor_sueldo_base_semestre:bestBase,meses_trabajados_semestre:mesesTrabajados,total_estimado:total,config_vigencia_desde:current?.vigencia_desde||null,detalle:detail};
      }).sort((a:any,b:any)=>String(a.nombre||"").localeCompare(String(b.nombre||"")));
      return json({ok:true,periodo,rows,locales});
    }

    return json({ok:false,error:"Acción inválida."},400);
  } catch (e) {
    console.error(e);
    return json({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
