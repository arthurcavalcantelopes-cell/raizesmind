// functions/mp-webhook.js — Cloudflare Pages Function

export async function onRequest(context){
  const { request, env } = context;
  if(request.method !== 'POST' && request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
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

    console.log('[MP webhook]', { id, status, externalRef });

    if(status !== 'approved') return new Response('Status=' + status, { status: 200 });

    if(SUPABASE_URL && SUPABASE_KEY && externalRef){
      const updateBody = {
        plano: meta.cycle === 'anual' ? 'Profissional-anual' : 'Profissional',
        subscription_active: true,
        subscription_started_at: new Date().toISOString(),
        last_payment_method: meta.method,
        last_payment_amount: payment.transaction_amount,
        last_payment_id: id
      };
      const patchRes = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(externalRef),
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(updateBody)
        }
      );
      if(!patchRes.ok){
        const txt = await patchRes.text();
        console.error('[MP webhook] Supabase update failed', patchRes.status, txt);
      }
    }
    return new Response('OK', { status: 200 });
  } catch(err){
    return new Response('Error logged', { status: 200 });
  }
}
