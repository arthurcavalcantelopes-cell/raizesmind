// functions/send-transactional.js
// Cloudflare Function que envia os 9 emails transacionais do Raízes via Resend.
// HTMLs ficam aqui (server-side). Frontend chama:
//   POST /send-transactional { template: 'convite_aceito', params: {...} }
//
// Sem UI de template no Resend. Templates ficam neste arquivo e são compilados
// com placeholder simples (Mustache-like). Único requisito: env var RESEND_API_KEY.

const FROM = "Raízes <noreply@raizesmind.com.br>";
const REPLY_TO = "raizesmindsuporte@gmail.com";

// ─── Templates (assunto + HTML) ─────────────────────────────────────
const TEMPLATES = {
  welcome_pro: {
    subject: (p) => `Bem-vindo(a) ao Raízes, ${p.to_name || ""} 🌱`,
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:26px;line-height:1.2;margin:0 0 16px;">Bem-vindo(a) ao Raízes.</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.6;">
        Sua conta foi criada. Você pode começar cadastrando seus primeiros 5 pacientes sem custo, no plano Sementé.
      </p>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.6;color:#5f5443;">
        O Raízes segue as diretrizes do CFM e da LGPD. Prontuários guardados por 20 anos, criptografia de ponta a ponta,
        e você é o único responsável pelo vínculo com o paciente.
      </p>
      ${button(p.login_url, "Abrir Raízes")}
    `)
  },

  welcome_paciente: {
    subject: (p) => `${p.pro_name || "Seu profissional"} te acompanha aqui no Raízes 🌿`,
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:26px;line-height:1.2;margin:0 0 16px;">Sua conta está pronta.</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.6;">
        Você foi vinculado(a) ao acompanhamento com <strong>${esc(p.pro_name)}</strong>.
        A partir de agora, seus registros de humor, medicação e atividades ficam guardados só entre vocês dois.
      </p>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.6;color:#5f5443;">
        O journaling (diário aberto) é <strong>totalmente seu</strong> — nem seu profissional vê. Isso é regra da plataforma.
      </p>
      ${button(p.login_url, "Entrar")}
      <p style="font-family:Jost,sans-serif;font-size:12px;color:#7a5c40;margin-top:40px;font-style:italic;text-align:center;">
        "A cura como a natureza cura — devagar, silenciosa, com raízes profundas."
      </p>
    `)
  },

  d3_paciente_inativo: {
    subject: () => "Sem pressa. Só um lembrete gentil.",
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:24px;line-height:1.2;margin:0 0 16px;">Está tudo bem por aí?</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.65;">
        Faz 3 dias que você não abriu o Raízes. Sem culpa — a vida acontece.
      </p>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.6;color:#5f5443;">
        Se quiser, deixa um registro rápido de como está o humor. Um clique e pronto.
      </p>
      ${button(p.login_url, "Como estou hoje")}
    `)
  },

  d7_pro_sem_convidar: {
    subject: () => "Precisa de ajuda pra convidar o primeiro paciente?",
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:24px;line-height:1.2;margin:0 0 16px;">Vamos plantar a primeira semente?</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.65;">
        Faz uma semana que você criou a conta. O primeiro passo é convidar 1 paciente —
        a plataforma toda se organiza a partir dele.
      </p>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.6;color:#5f5443;">
        Você envia o e-mail dele(a) → ele(a) cria a própria conta → vocês ficam vinculados.
        Sem cadastro em massa. Sem pedir CPF pra ninguém.
      </p>
      ${button(p.login_url + "#convite", "Convidar 1º paciente")}
      <p style="font-family:Jost,sans-serif;font-size:12px;color:#7a5c40;margin-top:32px;">
        Dúvidas? Responda esse email — a gente lê.
      </p>
    `)
  },

  d_menos_3_renovacao: {
    subject: () => "Sua assinatura renova em 3 dias",
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:24px;line-height:1.2;margin:0 0 16px;">Sua assinatura Profissional renova em 3 dias.</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.65;">
        Renovação prevista para <strong>${esc(p.data_renovacao)}</strong>, no valor de R$ ${esc(p.valor || "149,00")}.
      </p>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.6;color:#5f5443;">
        Nada precisa ser feito. Renovação automática, sem multa se cancelar.
      </p>
      ${button(p.login_url + "#financeiro", "Ver minha assinatura")}
    `)
  },

  convite_aceito: {
    subject: (p) => `${p.pat_name || "Paciente"} aceitou seu convite 🌿`,
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:24px;line-height:1.2;margin:0 0 16px;">Vínculo criado.</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.65;">
        <strong>${esc(p.pat_name)}</strong> (${esc(p.pat_email)}) aceitou seu convite e já pode receber acompanhamento pelo Raízes.
      </p>
      ${button(p.login_url + "#pr-pacientes", "Abrir prontuário")}
    `)
  },

  reset_password: {
    subject: () => "Seu código para redefinir a senha",
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:24px;line-height:1.2;margin:0 0 16px;">Redefinição de senha</h1>
      <p style="font-family:Jost,sans-serif;font-size:16px;line-height:1.65;">
        Alguém pediu para redefinir a senha da sua conta ${esc(p.to_email)}. Se foi você, use o código abaixo:
      </p>
      <div style="background:#f6f1e8;border-radius:12px;padding:24px;text-align:center;margin:20px 0;">
        <div style="font-family:Georgia,serif;font-size:42px;letter-spacing:8px;color:#3d5230;font-weight:500;">
          ${esc(p.code)}
        </div>
      </div>
      <p style="font-family:Jost,sans-serif;font-size:13px;color:#5f5443;line-height:1.6;">
        O código expira em 15 minutos. Se não foi você, ignore este email — sua conta segue segura.
      </p>
    `)
  },

  senha_alterada: {
    subject: () => "Sua senha foi alterada",
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:22px;line-height:1.2;margin:0 0 16px;">Sua senha foi alterada.</h1>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.65;">
        Data: ${esc(p.data_alteracao)} · Origem: ${esc(p.origem || "App")}
      </p>
      <p style="font-family:Jost,sans-serif;font-size:14px;color:#5f5443;line-height:1.6;">
        Se não foi você, avise imediatamente em raizesmindsuporte@gmail.com.
        Podemos ajudar a recuperar o acesso e revisar o que aconteceu.
      </p>
    `)
  },

  incidente_lgpd: {
    subject: () => "Aviso importante sobre seus dados no Raízes",
    html: (p) => wrap(`
      <h1 style="font-weight:400;font-size:22px;line-height:1.2;margin:0 0 16px;">Aviso obrigatório (LGPD art. 48)</h1>
      <p style="font-family:Jost,sans-serif;font-size:15px;line-height:1.65;">${esc(p.summary)}</p>
      <p style="font-family:Jost,sans-serif;font-size:14px;color:#5f5443;line-height:1.6;">
        Detectado em: ${esc(p.detected_at)}<br>
        Medidas tomadas: ${esc(p.mitigacao || "Em análise pela equipe.")}<br>
        Contato para dúvidas: <a href="${esc(p.contact_url)}">falar com nosso encarregado LGPD</a>
      </p>
      <p style="font-family:Jost,sans-serif;font-size:12px;color:#7a5c40;margin-top:32px;">
        Esse email é enviado por obrigação legal em caso de incidente que possa afetar seus direitos.
      </p>
    `)
  }
};

// ─── Helpers ────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function wrap(inner) {
  return `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f8f3ea;font-family:Georgia,'Cormorant Garamond',serif;color:#2e1f12;">
  <div style="max-width:560px;margin:0 auto;background:#fdf9f3;padding:32px 24px;">
    ${inner}
    <hr style="border:none;border-top:1px solid #d9cfbc;margin:32px 0 16px;">
    <p style="font-family:Jost,sans-serif;font-size:11px;color:#7a5c40;text-align:center;line-height:1.5;">
      Raízes Saúde Mental · raizesmind.com.br · CFM · LGPD
    </p>
  </div></body></html>`;
}

function button(url, label) {
  return `<a href="${esc(url)}" style="display:inline-block;background:#3d5230;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-family:Jost,sans-serif;font-size:15px;font-weight:500;margin:8px 0;">${esc(label)}</a>`;
}

// ─── Handler ────────────────────────────────────────────────────────
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors() });

  const RESEND_KEY = env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY não configurado" }), { status: 500, headers: cors() });
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400, headers: cors() }); }

  const { template, params } = body || {};
  if (!template || !TEMPLATES[template]) {
    return new Response(JSON.stringify({ error: "Template desconhecido: " + template }), { status: 400, headers: cors() });
  }

  const to = params && params.to_email;
  if (!to) {
    return new Response(JSON.stringify({ error: "params.to_email é obrigatório" }), { status: 400, headers: cors() });
  }

  const tpl = TEMPLATES[template];
  const subject = tpl.subject(params || {});
  const html = tpl.html(params || {});

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject: subject,
        html: html
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("[send-transactional]", template, data);
      return new Response(JSON.stringify({ error: data.message || "Falha Resend", details: data }), { status: r.status, headers: cors() });
    }
    return new Response(JSON.stringify({ ok: true, id: data.id, template: template }), { status: 200, headers: cors() });
  } catch (err) {
    console.error("[send-transactional] fetch:", err);
    return new Response(JSON.stringify({ error: "Erro de rede", details: String(err) }), { status: 500, headers: cors() });
  }
}
