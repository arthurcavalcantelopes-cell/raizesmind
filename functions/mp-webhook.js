// functions/mp-webhook.js — V19 BUGFIX (recriado V27)
// V19: aceita external_reference como UUID (userId direto) OU email

export async function onRequest(context){
  const { request, env } = context;
  if(request.method !== 'POST' && request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_KEY = env.RESEND_API_KEY;
  const SITE_URL = env.SITE_URL || 'https://raizesmind.com.br';

  if(!ACCESS_TOKEN){ console.error('[mp-webhook] MP_ACCESS_TOKEN missing'); return new Response('MP_ACCESS_TOKEN missing', { status: 500 }); }
  if(!SUPABASE_URL || !SUPABASE_KEY){ console.error('[mp-webhook] Supabase env missing'); return new Response('Supabase env missing', { status: 500 }); }

  const url = new URL(request.url);
  const params = url.searchParams;
  const topic = params.get('type') || params.get('topic');
  const paymentId = params.get('id') || params.get('data.id');

  let payload = null;
  if(request.method === 'POST'){ try { payload = await request.json(); } catch(e){} }
  const id = paymentId || (payload && payload.data && payload.data.id);

  if(topic !== 'payment' || !id){ console.log('[mp-webhook] ignored - not payment notification:', topic, id); return new Response('Ignored', { status: 200 }); }

  console.log('[mp-webhook] processing payment id:', id);

  try {
    const r = await fetch('https://api.mercadopago.com/v1/payments/' + id, {
      headers: { 'Authorization': 'Bearer ' + ACCESS_TOKEN }
    });
    if(!r.ok){ console.error('[mp-webhook] MP fetch failed:', r.status); return new Response('Fetch failed but ack', { status: 200 }); }

    const payment = await r.json();
    const status = payment.status;
    const meta = payment.metadata || {};
    const externalRefRaw = payment.external_reference || meta.email || '';
    const externalRef = String(externalRefRaw).toLowerCase().trim();
    const metaEmail = String(meta.email || '').toLowerCase().trim();
    const payerEmail = String(payment.payer?.email || '').toLowerCase().trim();
    const amount = payment.transaction_amount;
    const method = meta.method || payment.payment_method_id || 'cartao';
    const cardLast4 = payment.card?.last_four_digits || null;
    const cardBrand = payment.payment_method?.id || null;

    console.log('[mp-webhook] payment data:', { id, status, externalRef, metaEmail, payerEmail, amount, method });

    // V19: lookup robusto — UUID direto ou email fallback
    let userId = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalRef);

    if(isUuid){
      try {
        const pr = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=id,email&id=eq.' + encodeURIComponent(externalRef), {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
        });
        const profs = await pr.json();
        if(profs && profs[0]){ userId = profs[0].id; console.log('[mp-webhook] user found by UUID:', userId); }
      } catch(e){ console.error('[mp-webhook] UUID lookup error:', e); }
    }

    if(!userId){
      const candidates = [metaEmail, payerEmail, externalRef].filter(Boolean).filter(s => s.includes('@'));
      for(const candidate of candidates){
        try {
          const pr = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=id,email&email=ilike.' + encodeURIComponent(candidate), {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
          });
          const profs = await pr.json();
          if(profs && profs[0]){ userId = profs[0].id; console.log('[mp-webhook] user found by email:', candidate, '→', userId); break; }
        } catch(e){ console.error('[mp-webhook] email lookup error:', e); }
      }
    }

    if(!userId){
      console.error('[mp-webhook] NO USER FOUND for externalRef:', externalRef, 'metaEmail:', metaEmail, 'payerEmail:', payerEmail);
      return new Response('No user matched', { status: 200 });
    }

    const notifyEmail = metaEmail || payerEmail || (externalRef.includes('@') ? externalRef : null);

    // billing_history (idempotente)
    try {
      const check = await fetch(SUPABASE_URL + '/rest/v1/billing_history?payment_id=eq.' + id, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
      });
      const exists = await check.json();
      if(exists && exists.length){
        console.log('[mp-webhook] payment already in billing_history, skipping insert');
      } else {
        await fetch(SUPABASE_URL + '/rest/v1/billing_history', {
          method: 'POST',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            pro_id: userId, payment_id: id.toString(), amount, method, status,
            card_last4: cardLast4, card_brand: cardBrand,
            plan: meta.plan || null, cycle: meta.cycle || null
          })
        });
      }
    } catch(e){ console.error('[mp-webhook] billing_history error:', e); }

    if(status === 'approved'){
      const nextBilling = (function(c){ const d=new Date(); if(c==='anual') d.setFullYear(d.getFullYear()+1); else d.setMonth(d.getMonth()+1); return d.toISOString().slice(0,10); })(meta.cycle);

      const proDataPayload = {
        user_id: userId,
        plano: meta.cycle === 'anual' ? 'Profissional-anual' : 'Profissional',
        subscription_active: true,
        subscription_started_at: new Date().toISOString(),
        subscription_cycle: meta.cycle || 'mensal',
        subscription_next_billing: nextBilling,
        last_payment_method: method,
        last_payment_amount: amount,
        last_payment_id: id.toString(),
        payment_method_type: method,
        payment_method_last4: cardLast4,
        payment_method_brand: cardBrand
      };

      try {
        const upd = await fetch(SUPABASE_URL + '/rest/v1/pro_data?user_id=eq.' + userId, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify(proDataPayload)
        });
        const updResult = await upd.json();

        if(!updResult || (Array.isArray(updResult) && updResult.length === 0)){
          console.log('[mp-webhook] pro_data not found, inserting');
          await fetch(SUPABASE_URL + '/rest/v1/pro_data', {
            method: 'POST',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify(proDataPayload)
          });
        }
        console.log('[mp-webhook] pro_data updated/inserted for:', userId);
      } catch(e){ console.error('[mp-webhook] pro_data upsert error:', e); }

      if(RESEND_KEY && notifyEmail){
        try {
          const fmt = n => Number(n||0).toFixed(2).replace('.', ',');
          const methodLabel = method === 'cartao' || method === 'credit_card' ? 'Cartão de crédito' : method === 'pix' ? 'PIX' : method === 'boleto' ? 'Boleto' : method;
          const cycleLabel = (meta.cycle === 'anual') ? 'Anual' : 'Mensal';
          const dataFmt = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
          const html = '<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f8f3ea;font-family:Arial,sans-serif;color:#1e150b;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:.7rem;overflow:hidden;"><div style="background:linear-gradient(135deg,#3d5230,#5a7a3e);color:#fff;padding:2rem 1.6rem;text-align:center;"><div style="font-size:2.5rem;">✅</div><div style="font-family:Georgia,serif;font-size:1.5rem;margin-top:.4rem;">Pagamento aprovado</div><div style="font-size:.84rem;opacity:.9;margin-top:.2rem;">Sua assinatura Raízes está ativa</div></div><div style="padding:2rem 1.8rem;font-size:.95rem;line-height:1.7;"><p style="text-align:center;color:#5a3a1e;margin-bottom:1.5rem;">Obrigado por usar a Raízes 🌱</p><div style="background:#f6f1e8;border-radius:.55rem;padding:1.2rem 1.4rem;font-size:.88rem;"><div><strong>Valor pago:</strong> R$ ' + fmt(amount) + '</div><div><strong>Método:</strong> ' + methodLabel + '</div><div><strong>Ciclo:</strong> ' + cycleLabel + '</div><div><strong>Próximo vencimento:</strong> ' + new Date(nextBilling).toLocaleDateString('pt-BR') + '</div><div><strong>Data:</strong> ' + dataFmt + '</div><div><strong>ID transação:</strong> ' + id + '</div></div><p style="font-size:.78rem;color:#7a5c40;margin-top:1.5rem;background:#fef9f3;padding:.8rem 1rem;border-radius:.4rem;">⚠️ Recibo provisório (fase 1 PF). NFSe via SLU em breve. Suporte: <a href="mailto:financeiro@raizesmind.com.br">financeiro@raizesmind.com.br</a></p><p style="font-size:.78rem;color:#7a5c40;text-align:center;font-style:italic;margin-top:1.5rem;"><strong>Equipe Raízes</strong><br><a href="' + SITE_URL + '/">raizesmind.com.br</a></p></div></div></body></html>';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bear