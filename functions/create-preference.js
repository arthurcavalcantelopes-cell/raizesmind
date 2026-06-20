// functions/create-preference.js — V29 BUGFIX
// V29: corrige excluded_payment_types do PIX que estava excluindo PIX
// V15: 5 combos plan-cycle-method

const PRICES = {
  'profissional-mensal-cartao':   { title: 'Raizes Profissional - Mensal - Cartao',  amount: 149.00 },
  'profissional-anual-cartao':    { title: 'Raizes Profissional - Anual - Cartao',   amount: 1490.00 },
  'profissional-anual-pix':       { title: 'Raizes Profissional - Anual - PIX',      amount: 1430.00 },
  'profissional-anual-boleto':    { title: 'Raizes Profissional - Anual - Boleto',   amount: 1410.00 },
  'profissional-fidelidade-1mes': { title: 'Raizes Profissional - 1o mes (50% OFF)', amount: 75.00 }
};

// V29 FIX: PIX no MP é payment_type "bank_transfer".
// Pra mostrar APENAS PIX, exclui TUDO menos bank_transfer.
const METHOD_FILTERS = {
  pix: {
    excluded_payment_types: [
      { id: 'credit_card' },
      { id: 'debit_card' },
      { id: 'ticket' },         // boleto
      { id: 'atm' },
      { id: 'prepaid_card' },
      { id: 'account_money' }   // carteira MP
      // NÃO excluir bank_transfer — esse é o PIX!
    ]
  },
  cartao: {
    excluded_payment_types: [
      { id: 'ticket' },
      { id: 'bank_transfer' },  // exclui PIX
      { id: 'atm' }
    ]
  },
  boleto: {
    excluded_payment_types: [
      { id: 'credit_card' },
      { id: 'debit_card' },
      { id: 'bank_transfer' },  // exclui PIX
      { id: 'atm' },
      { id: 'prepaid_card' },
      { id: 'account_money' }
    ]
  }
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

export async function onRequest(context){
  const { request, env } = context;

  if(request.method === 'OPTIONS'){
    return new Response(null, { status: 204, headers: cors() });
  }
  if(request.method !== 'POST'){
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors() });
  }

  let body;
  try { body = await request.json(); }
  catch(e){ return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors() }); }

  const { plan, cycle, method, email, name, userId } = body;
  if(!email || !name || !plan || !cycle || !method){
    return new Response(JSON.stringify({ error: 'Campos obrigatorios: plan, cycle, method, email, name' }), { status: 400, headers: cors() });
  }

  const priceKey = plan + '-' + cycle + '-' + method;
  const priceCfg = PRICES[priceKey];
  if(!priceCfg){
    return new Response(JSON.stringify({ error: 'Combinacao invalida: ' + priceKey }), { status: 400, headers: cors() });
  }

  const ACCESS_TOKEN = env.MP_ACCESS_TOKEN;
  if(!ACCESS_TOKEN){
    return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN nao configurado no servidor' }), { status: 500, headers: cors() });
  }
  const SITE_URL = env.SITE_URL || 'https://raizesmind.com.br';

  const preference = {
    items: [{
      title: priceCfg.title,
      description: 'Plataforma Raizes Saude Mental - ' + name + ' - ' + email,
      quantity: 1,
      currency_id: 'BRL',
      unit_price: priceCfg.amount
    }],
    payer: { email: email, name: name },
    payment_methods: METHOD_FILTERS[method] || {},
    back_urls: {
      success: SITE_URL + '/?payment=success&plan=' + plan + '&cycle=' + cycle,
      failure: SITE_URL + '/?payment=failure',
      pending: SITE_URL + '/?payment=pending'
    },
    auto_return: 'approved',
    notification_url: SITE_URL + '/mp-webhook',
    external_reference: userId || email,
    metadata: { plan: plan, cycle: cycle, method: method, email: email, userId: userId || '' },
    statement_descriptor: 'RAIZES SAUDE'
  };

  try{
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preference)
    });
    const data = await r.json();
    if(!r.ok){
      console.error('[MP] error:', data);
      return new Response(JSON.stringify({ error: data.message || 'Erro Mercado Pago', details: data }), { status: r.status, headers: cors() });
    }
    return new Response(JSON.stringify({
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point
    }), { status: 200, headers: cors() });
  } catch(err){
    console.error('[MP] fetch error:', err);
 