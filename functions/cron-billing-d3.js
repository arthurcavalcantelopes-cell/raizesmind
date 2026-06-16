// functions/cron-billing-d3.js — V9 Cron Trigger (D-3 aviso de vencimento)
// Configurar no Cloudflare: Project → Settings → Triggers → Cron Triggers
//   Cron: 0 11 * * *  (todo dia 11h UTC = 8h Brasília)
//
// VARS:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, SITE_URL

export async function scheduled(event, env, ctx){
  return ctx.waitUntil(runBillingD3(env));
}

export async function onRequest(context){
  // Endpoint manual de teste
  const { env, request } = context;
  if(request.method !== 'POST') return new Response('Use POST', { status:405 });
  await runBillingD3(env);
  return new Response('Cron D-3 executado', { status:200 });
}

async function runBillingD3(env){
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY = env.RESEND_API_KEY;
  const SITE_URL = env.SITE_URL || 'https://raizesmind.com.br';
  if(!SUPABASE_URL || !SUPABASE_KEY || !RESEND_KEY){
    console.error('[cron-d3] missing env vars');
    return;
  }

  // Calcula data D+3
  const d3 = new Date(); d3.setDate(d3.getDate() + 3);
  const dateStr = d3.toISOString().slice(0,10);

  try {
    // Busca pros com next_billing = d+3
    const r = await fetch(SUPABASE_URL + '/rest/v1/pro_data?select=user_id,subscription_next_billing,plano,subscription_cycle&subscription_next_billing=eq.' + dateStr + '&subscription_active=eq.true', {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    });
    const pros = await r.json();
    console.log('[cron-d3] ' + pros.length + ' pros para avisar');

    for(const pro of pros){
      try {
        // Pega e-mail e nome do profile
        const pr = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=email,name&id=eq.' + pro.user_id, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
        });
        const [profile] = await pr.json();
        if(!profile || !profile.email) continue;

        // Conta pacientes ativos pra calcular excedente
        const apr = await fetch(SUPABASE_URL + '/rest/v1/pro_active_patients_count?pro_id=eq.' + pro.user_id, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
        });
        const counts = await apr.json();
        const ativos = counts[0]?.ativos || 0;
        const excedente = Math.max(0, ativos - 30);
        const base = pro.subscription_cycle === 'anual' ? 0 : 149; // anual já pago, só cobra excedente mês a mês
        const extra = excedente * 2.50;
        const total = base + extra;

        const html = buildEmailD3(profile.name || 'Profissional', ativos, excedente, base, extra, total, SITE_URL);
        await fetch('https://api.resend.com/emails', {
          method:'POST',
          headers:{ 'Authorization':'Bearer '+RESEND_KEY, 'Content-Type':'application/json' },
          body: JSON.stringify({
            from: 'Raízes <noreply@raizesmind.com.br>',
            to: [profile.email],
            subject: 'Sua assinatura Raízes renova em 3 dias',
            html: html
          })
        });
        console.log('[cron-d3] enviado para ' + profile.email);
      } catch(e){ console.error('[cron-d3] erro ao processar pro', pro.user_id, e); }
    }
  } catch(e){ console.error('[cron-d3] fatal', e); }
}

function buildEmailD3(name, ativos, excedente, base, extra, total, site){
  const fmt = n => n.toFixed(2).replace('.', ',');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8f3ea;font-family:Arial,sans-serif;color:#1e150b;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:.7rem;overflow:hidden;box-shadow:0 6px 20px rgba(46,82,48,.08);">
    <div style="background:linear-gradient(135deg,#3d5230,#5a7a3e);color:#fff;padding:2rem 1.6rem;text-align:center;">
      <div style="font-size:2rem;">🌳</div>
      <div style="font-family:Georgia,serif;font-size:1.6rem;margin-top:.4rem;">Raízes</div>
      <div style="font-size:.84rem;opacity:.9;margin-top:.2rem;">Sua assinatura renova em 3 dias</div>
    </div>
    <div style="padding:2rem 1.8rem;font-size:.95rem;line-height:1.65;">
      <p>Olá <strong>${name}</strong> 👋</p>
      <p>Sua assinatura Raízes vai renovar em <strong>3 dias</strong>. Aqui está o resumo:</p>
      <div style="background:#f6f1e8;border-radius:.5rem;padding:1rem 1.2rem;margin:1rem 0;font-size:.88rem;line-height:1.7;">
        <div>📊 Pacientes ativos: <strong>${ativos}</strong></div>
        ${excedente > 0 ? '<div>Excedente: <strong>'+excedente+'</strong> × R$ 2,50 = <strong>R$ '+fmt(extra)+'</strong></div>' : '<div>Sem excedente — todos seus pacientes ativos estão dentro do plano base. 🌱</div>'}
        <div style="margin-top:.5rem;font-size:1rem;border-top:1px solid #eee;padding-top:.5rem;">💚 Total a cobrar: <strong>R$ ${fmt(total)}</strong></div>
      </div>
      <p style="font-size:.82rem;color:#7a5c40;">Quer cancelar antes da renovação? <a href="${site}/" style="color:#3d5230;">Acesse o painel financeiro</a>.</p>
      <hr style="border:none;border-top:1px solid #ede4d3;margin:1.5rem 0;">
      <p style="font-size:.78rem;color:#7a5c40;text-align:center;font-style:italic;">Sua prática cresce, a gente acompanha.<br><strong>Equipe Raízes</strong></p>
    </div>
  </div>
</body></html>`;
}
