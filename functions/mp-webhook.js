// functions/mp-webhook.js — V13 Cloudflare Pages Function
// Recebe notificações Mercado Pago, ativa plano + grava billing_history + envia recibo

export async function onRequest(context){
  const { request, env } = context;
  if(request.method !== 'POST' && request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY = env.RESEND_API_KEY;
  const SITE_URL = env.SITE_URL || 'https://raizesmind.com.br';
  if(!ACCESS_TOKEN) return new Response('MP_ACCESS_TOKEN missing', { status: 500 });

  const url = new URL(request.url);
  const params = url.searchParams;
  const topic = params.get('type') || params.get('topic');
  const paymentId = params.get('id') || params.get('data.id');

  let payload = null;
  if(request.method === 'POST'){
    try { payload = await request.json(); } catch(e){}
  }
  const id = paymentId || (payload && payload.data && payload.data.id);

  if(topic !== 'payment' || !id) return new Response('Ignored', { status: 200 });

  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, {
      headers: { 'Authorization': 'Bearer ' + ACCESS_TOKEN }
    });
    if(!r.ok) return new Response('Fetch failed but ack', { status: 200 });
    const payment = await r.json();
    const status = payment.status;
    const meta = payment.metadata || {};
    const externalRef = payment.external_reference || meta.email;
    const amount = payment.transaction_amount;
    const method = meta.method || payment.payment_method_id || 'cartao';
    const cardLast4 = payment.card?.last_four_digits || null;
    const cardBrand = payment.payment_method?.id || null;

    console.log('[MP webhook]', { id, status, externalRef, amount, method });

    if(SUPABASE_URL && SUPABASE_KEY && externalRef){
      let userId = null;
      try {
        const pr = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=id&email=eq.' + encodeURIComponent(externalRef), {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
        });
        const profs = await pr.json();
        if(profs && profs[0]) userId = profs[0].id;
      } catch(e){ console.warn('[lookup user]', e); }

      // 1. Sempre grava em billing_history
      if(userId){
        try {
          await fetch(SUPABASE_URL + '/rest/v1/billing_history', {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              pro_id: userId, payment_id: id.toString(), amount: amount, method: method, status: status,
              card_last4: cardLast4, card_brand: cardBrand, plan: meta.plan || null, cycle: meta.cycle || null
            })
          });
        } catch(e){ console.warn('[billing_history]', e); }
      }

      // 2. Se aprovado: ativa plano + envia recibo
      if(status === 'approved'){
        const nextBilling = (function(c){ const d=new Date(); if(c==='anual') d.setFullYear(d.getFullYear()+1); else d.setMonth(d.getMonth()+1); return d.toISOString().slice(0,10); })(meta.cycle);
        try {
          await fetch(SUPABASE_URL + '/rest/v1/pro_data?user_id=eq.' + (userId || ''), {
            method: 'PATCH',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              plano: meta.cycle === 'anual' ? 'Profissional-anual' : 'Profissional',
              subscription_active: true,
              subscription_started_at: new Date().toISOString(),
              subscription_cycle: meta.cycle || 'mensal',
              subscription_next_billing: nextBilling,
              last_payment_method: method, last_payment_amount: amount, last_payment_id: id.toString(),
              payment_method_type: method, payment_method_last4: cardLast4, payment_method_brand: cardBrand
            })
          });
        } catch(e){ console.warn('[update pro_data]', e); }

        // 3. Envia recibo por e-mail via Resend
        if(RESEND_KEY && externalRef){
          try {
            const fmt = n => Number(n||0).toFixed(2).replace('.', ',');
            const methodLabel = method === 'cartao' ? 'Cartão de crédito' : method === 'pix' ? 'PIX' : method === 'boleto' ? 'Boleto' : method;
            const cycleLabel = (meta.cycle === 'anual') ? 'Anual' : 'Mensal';
            const data = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
            const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8f3ea;font-family:Arial,sans-serif;color:#1e150b;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:.7rem;overflow:hidden;box-shadow:0 6px 20px rgba(46,82,48,.08);"><div style="background:linear-gradient(135deg,#3d5230,#5a7a3e);color:#fff;padding:2rem 1.6rem;text-align:center;"><div style="font-size:2.5rem;">✅</div><div style="font-family:Georgia,serif;font-size:1.5rem;margin-top:.4rem;">Pagamento aprovado</div><div style="font-size:.84rem;opacity:.9;margin-top:.2rem;">Recibo provisório · Raízes Saúde Mental</div></div><div style="padding:2rem 1.8rem;font-size:.95rem;line-height:1.7;"><p style="text-align:center;color:#5a3a1e;margin-bottom:1.5rem;">Obrigado por usar a Raízes 🌱</p><div style="background:#f6f1e8;border-radius:.55rem;padding:1.2rem 1.4rem;font-size:.88rem;"><div><strong>Valor pago:</strong> R$ ' + fmt(amount) + '</div><div><strong>Método:</strong> ' + methodLabel + '</div><div><strong>Ciclo:</strong> ' + cycleLabel + '</div><div><strong>Data:</strong> ' + data + '</div><div><strong>ID da transação:</strong> ' + id + '</div><div><strong>E-mail pagador:</strong> ' + externalRef + '</div></div><p style="font-size:.78rem;color:#7a5c40;line-height:1.6;margin-top:1.5rem;background:#fef9f3;padding:.8rem 1rem;border-radius:.4rem;">⚠️ <strong>Recibo provisório.</strong> Durante a fase 1 (PF), você pode solicitar recibo simples por e-mail. NFSe será emitida automaticamente após constituição da SLU. Solicitação: <a href="mailto:financeiro@raizesmind.com.br" style="color:#3d5230;">financeiro@raizesmind.com.br</a></p><hr style="border:none;border-top:1px solid #ede4d3;margin:1.5rem 0;"><p style="font-size:.78rem;color:#7a5c40;text-align:center;font-style:italic;">Sua prática cresce, a gente acompanha.<br><strong>Equipe Raízes</strong><br><a href="' + SITE_URL + '/" style="color:#3d5230;">raizesmind.com.br</a></p></div></div></body></html>';
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Raízes <noreply@raizesmind.com.br>',
                to: [externalRef],
                subject: '✅ Pagamento aprovado — Recibo Raízes',
                html: html
              })
            });
          } catch(e){ console.warn('[resend recibo]', e); }
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch(err){
    console.error('[MP webhook] error', err);
    return new Response('Error logged', { status: 200 });
  }
}
