// functions/send-cancellation.js — V13 envia confirmação de cancelamento por e-mail

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if(request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await request.json(); } catch(e){ return new Response('Invalid JSON', { status: 400 }); }
  const { pro_email, razao } = body;
  if(!pro_email) return new Response('Missing pro_email', { status: 400 });

  const RESEND_KEY = env.RESEND_API_KEY;
  const SITE_URL = env.SITE_URL || 'https://raizesmind.com.br';
  if(!RESEND_KEY) return new Response('{"ok":false}', { status: 500, headers: cors() });

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8f3ea;padding:1rem;color:#1e150b;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:.7rem;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#5a7a3e,#3d5230);color:#fff;padding:1.8rem 1.6rem;text-align:center;">
        <div style="font-size:2rem;">🌿</div>
        <div style="font-family:Georgia,serif;font-size:1.4rem;margin-top:.4rem;">Sua assinatura foi cancelada</div>
      </div>
      <div style="padding:2rem 1.8rem;font-size:.95rem;line-height:1.65;">
        <p>Recebemos o seu cancelamento. Aqui está o que acontece agora:</p>
        <ul style="margin-left:1.2rem;line-height:1.8;">
          <li>Seu acesso continua <strong>ativo até o vencimento atual</strong> — você não perde nada agora</li>
          <li>Não haverá cobrança no próximo ciclo</li>
          <li>Seus dados (pacientes, prontuários, agenda) <strong>continuam protegidos</strong> conforme CFM (20 anos guarda)</li>
          <li>Você pode voltar a qualquer momento sem reset</li>
        </ul>
        ${razao ? `<div style="background:#f6f1e8;border-radius:.4rem;padding:.8rem 1rem;font-size:.84rem;margin-top:1.2rem;"><strong>Sua razão (obrigado pela sinceridade):</strong><br>${escapeHTML(razao)}</div>` : ''}
        <p style="font-size:.8rem;color:#7a5c40;margin-top:1.5rem;text-align:center;">Sentiremos sua falta 🌱<br><strong>Equipe Raízes</strong><br><a href="${SITE_URL}/" style="color:#3d5230;">raizesmind.com.br</a></p>
      </div>
    </div>
  </body></html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Raízes <noreply@raizesmind.com.br>',
        to: [pro_email],
        subject: 'Sua assinatura Raízes foi cancelada',
        html: html
      })
    });
    return new Response(JSON.stringify({ ok: r.ok }), { status: 200, headers: cors() });
  } catch(e){
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: cors() });
  }
}

function escapeHTML(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cors(){ return { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Content-Type':'application/json' }; }
