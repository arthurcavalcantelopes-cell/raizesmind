// functions/get-sessions.js — V9 Lista e revoga sessões ativas do usuário
// Requer SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return new Response(null, { status:204, headers: cors() });
  if(request.method !== 'POST') return jr({ error:'Method not allowed' }, 405);

  let body;
  try { body = await request.json(); } catch(e){ return jr({ error:'Invalid JSON' }, 400); }
  const { action, jwt, session_id } = body;
  if(!jwt) return jr({ error:'JWT required' }, 401);

  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if(!SUPABASE_URL || !SUPABASE_KEY) return jr({ error:'Server not configured' }, 500);

  // Verifica usuário a partir do JWT do front
  const userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': SUPABASE_KEY }
  });
  if(!userResp.ok) return jr({ error:'Invalid token' }, 401);
  const user = await userResp.json();
  if(!user || !user.id) return jr({ error:'No user' }, 401);

  if(action === 'list'){
    // Supabase Auth Admin: listar sessões do user
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + user.id + '/sessions', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization':'Bearer '+SUPABASE_KEY }
    });
    if(!r.ok){ return jr({ error:'List failed', status:r.status }, 500); }
    const data = await r.json();
    return jr({ ok:true, sessions: data?.sessions || data || [] });
  }
  if(action === 'revoke'){
    if(!session_id) return jr({ error:'session_id required' }, 400);
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + user.id + '/sessions/' + session_id, {
      method:'DELETE',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization':'Bearer '+SUPABASE_KEY }
    });
    return jr({ ok: r.ok });
  }
  return jr({ error:'Unknown action' }, 400);
}

function cors(){ return { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Content-Type':'application/json' }; }
function jr(obj, status=200){ return new Response(JSON.stringify(obj), { status, headers: cors() }); }
