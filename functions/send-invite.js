// functions/send-invite.js — Cloudflare Pages Function
// Envia e-mail de convite pra paciente via Resend API
//
// VARIÁVEIS DE AMBIENTE:
//   RESEND_API_KEY  - API key do Resend (resend.com)
//   SITE_URL        - https://raizesmind.com.br

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS'){
    return new Response(null, { status:204, headers:{
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type'
    }});
  }
  if(request.method !== 'POST') return new Response('Method not allowed', { status:405 });

  let body;
  try { body = await request.json(); } catch(e){ return new Response('Invalid JSON', { status:400 }); }
  const { token, pro_email, pro_name, patient_name, patient_email } = body;
  if(!token || !patient_email || !patient_name){ return new Response('Missing fields', { status:400 }); }

  const RESEND_KEY = env.RESEND_API_KEY;
  if(!RESEND_KEY){
    return new Response(JSON.stringify({ ok:false, error:'RESEND_API_KEY missing' }), { status:500, headers:{'Content-Type':'application/json'} });
  }
  const SITE_URL = env.SITE_URL || 'https://raizesmind.com.br';
  const inviteUrl = `${SITE_URL}/?invite=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Raízes</title></head>
<body style="margin:0;padding:0;background:#f8f3ea;font-family:'Helvetica Neue',Arial,sans-serif;color:#1e150b;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:.7rem;overflow:hidden;box-shadow:0 6px 20px rgba(46,82,48,.08);">
    <div style="background:linear-gradient(135deg,#3d5230,#5a7a3e);color:#fff;padding:2rem 1.6rem;text-align:center;">
      <div style="font-size:2rem;">🌳</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:1.6rem;margin-top:.4rem;">Raízes</div>
      <div style="font-size:.84rem;opacity:.9;margin-top:.2rem;">Saúde Mental Online</div>
    </div>
    <div style="padding:2rem 1.8rem;font-size:.95rem;line-height:1.65;">
      <p>Oi <strong>${escapeHTML(patient_name)}</strong>! 👋</p>
      <p>Seu profissional convidou você para começar sua jornada na <strong>Raízes</strong> — uma plataforma de saúde mental que vai te acompanhar entre as consultas.</p>
      <div style="background:#f6f1e8;border-radius:.55rem;padding:1.1rem 1.2rem;margin:1.4rem 0;font-size:.88rem;line-height:1.7;">
        🌱 <strong>O que você terá:</strong><br>
        • Registro do seu humor para descobrir padrões<br>
        • Lembretes de medicação e atividades<br>
        • Práticas guiadas de mindfulness<br>
        • Acompanhamento integrado com seu profissional<br>
        • Caixa SOS para momentos de crise
      </div>
      <p>É <strong>100% gratuito</strong> para você, e tudo que você escrever é confidencial — só você e seu profissional enxergam.</p>
      <div style="text-align:center;margin:2rem 0;">
        <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(135deg,#3d5230,#5a7a3e);color:#fff;padding:.95rem 2rem;border-radius:.5rem;text-decoration:none;font-weight:500;font-size:1rem;">🌳 Criar minha conta</a>
      </div>
      <p style="font-size:.78rem;color:#7a5c40;text-align:center;">Esse convite expira em 7 dias.</p>
      <hr style="border:none;border-top:1px solid #ede4d3;margin:1.5rem 0;">
      <p style="font-size:.78rem;color:#7a5c40;line-height:1.6;text-align:center;font-style:italic;">Com cuidado,<br><strong>Equipe Raízes</strong><br><a href="${SITE_URL}" style="color:#3d5230;">raizesmind.com.br</a></p>
    </div>
  </div>
  <div style="text-align:center;font-size:.7rem;color:#a88060;padding:1rem;">
    Você está recebendo esse e-mail porque um profissional convidou você para a Raízes.<br>
    Se não foi você, ignore essa mensagem.
  </div>
</body></html>`;

  try{
    const r = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ 'Authorization':'Bearer ' + RESEND_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({
        from: 'Raízes <noreply@raizesmind.com.br>',
        to: [patient_email],
        subject: 'Seu profissional te convidou para começar sua jornada na Raízes',
        html: html
      })
    });
    const data = await r.json();
    if(!r.ok){ return new Response(JSON.stringify({ ok:false, error:data }), { status:r.status, headers:{'Content-Type':'application/json'} }); }
    return new Response(JSON.stringify({ ok:true, id:data.id }), { status:200, headers:{'Content-Type':'application/json'} });
  } catch(err){
    return new Response(JSON.stringify({ ok:false, error:String(err) }), { status:500, headers:{'Content-Type':'application/json'} });
  }
}

function escapeHTML(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
