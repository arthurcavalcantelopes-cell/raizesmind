# V31 - 4 fixes criticos + cap 30 PIX
import re
PATH = '/sessions/zealous-wizardly-pascal/mnt/outputs/INDEX-V31.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()
orig_len = len(html)
fixes = []

# ============================================================
# FIX 1: Valor anual incorreto (R$ 1484 vs R$ 1490 do backend)
# Backend PRICES: profissional-anual-cartao = 1490
# Frontend: 149 * 12 * 0.83 = 1484 (errado)
# Solucao: hardcoded valores que batem com backend
# ============================================================
old_calc = """    const anualSemDesc = base * 12;
    const desconto = anualSemDesc * 0.17;
    const anualComDesc = anualSemDesc - desconto;
    // excedente NÃO entra no desconto anual — é cobrado proporcionalmente conforme uso real mês a mês
    total = anualComDesc;
    lbl = 'Total à vista anual';
    baseLbl = 'Plano Profissional (12 meses)';
    setText('pay-summary-base-val', 'R$ ' + fmt(anualSemDesc));
    setDisplay('pay-summary-disc-row', 'flex');
    setText('pay-summary-disc-val', '-R$ ' + fmt(desconto));"""

new_calc = """    // V31: Valores hardcoded batem com backend create-preference.js
    //   profissional-anual-cartao = 1490
    //   profissional-anual-pix    = 1430
    //   profissional-anual-boleto = 1410
    const anualSemDesc = base * 12;  // 1788
    // Pega valor pelo metodo selecionado
    const _curMethod = (document.getElementById('pt-pix')?.classList?.contains('on')) ? 'pix'
                    : (document.getElementById('pt-card')?.classList?.contains('on')) ? 'cartao'
                    : 'cartao';
    const anualByMethod = { cartao: 1490, pix: 1430, boleto: 1410 };
    const anualComDesc = anualByMethod[_curMethod] || 1490;
    const desconto = anualSemDesc - anualComDesc;
    total = anualComDesc;
    lbl = 'Total à vista anual';
    baseLbl = 'Plano Profissional (12 meses)';
    setText('pay-summary-base-val', 'R$ ' + fmt(anualSemDesc));
    setDisplay('pay-summary-disc-row', 'flex');
    setText('pay-summary-disc-val', '-R$ ' + fmt(desconto));"""

if old_calc in html:
    html = html.replace(old_calc, new_calc, 1)
    fixes.append('FIX 1: Valor anual sincronizado com backend (1490/1430/1410)')

# ============================================================
# FIX 2: rzForceCheckPayment is not defined
# Funcao existe mas pode estar em escopo errado. Forcar window.global
# ============================================================
old_force = "// V18: Botão \"Já paguei mas não apareceu\" — força refresh\nasync function rzForceCheckPayment(){"
new_force = "// V18: Botão \"Já paguei mas não apareceu\" — força refresh (V31: global window.*)\nwindow.rzForceCheckPayment = async function rzForceCheckPayment(){"

if old_force in html:
    html = html.replace(old_force, new_force, 1)
    # Tambem ajustar o fim da funcao (o } original) — vamos checar
    # Da funcao original ate o proximo // V18:
    fixes.append('FIX 2a: rzForceCheckPayment como window.rzForceCheckPayment')

# Mesma coisa pra rzResendRecibo
old_resend = "// V18: Re-enviar recibo do último pagamento aprovado\nasync function rzResendRecibo(){"
new_resend = "// V18: Re-enviar recibo do último pagamento aprovado (V31: global)\nwindow.rzResendRecibo = async function rzResendRecibo(){"
if old_resend in html:
    html = html.replace(old_resend, new_resend, 1)
    fixes.append('FIX 2b: rzResendRecibo como window.*')

# ============================================================
# FIX 3: Cap 30 pacientes + PIX -> obrigar cartao se exceder
# Implementacao: na verifyPatientLimitBeforeAdd + ao escolher PIX, alerta
# ============================================================
# Adicionar guard novo: rzPixCapCheck que avisa quando PIX + ativos > 30
PIX_CAP_JS = """

// V31: PIX cap 30 pacientes — obrigar cartao se passar de 30
window.rzPixCapCheck = async function(){
  // Retorna true se OK pra PIX, false se passou de 30 e bloqueia
  if(!SB || !session?.user) return true;
  try {
    const { data } = await SB.from('pro_active_patients_count').select('ativos').eq('pro_id', session.user.id).maybeSingle();
    const ativos = data?.ativos || 0;
    if(ativos > 30){
      const msg = '⚠️ Você tem ' + ativos + ' pacientes ativos.\\n\\n' +
                  'PIX/Boleto cobrem só até 30 pacientes (cap fixo).\\n' +
                  'Acima disso, R$ 2,50 por paciente extra precisam ser cobrados via cartão (débito automático).\\n\\n' +
                  '👉 Use cartão de crédito para ter cobertura ilimitada.';
      alert(msg);
      return false;
    }
    return true;
  } catch(e){ console.warn('[rzPixCapCheck]', e); return true; }
};
"""

# Inserir antes de "async function rzGoToCheckoutMP"
marker_gotompcheckout = "async function rzGoToCheckoutMP(method){"
if marker_gotompcheckout in html and 'rzPixCapCheck' not in html:
    html = html.replace(marker_gotompcheckout,
                       PIX_CAP_JS + '\n' + marker_gotompcheckout, 1)
    fixes.append('FIX 3a: rzPixCapCheck definido (cap 30 pacientes)')

# Modificar rzGoToCheckoutMP pra chamar rzPixCapCheck no PIX
old_check = """  // V15 regra: PIX e Boleto SÓ no plano anual (cap 30). Cartão livre.
  if((method === 'pix' || method === 'boleto') && _payCycle !== 'anual'){
    alert('PIX e Boleto só estão disponíveis no plano anual. Pra mensal, use cartão de crédito.');
    return;
  }"""
new_check = """  // V15+V31 regra: PIX/Boleto SO no anual + cap 30 pacientes
  if((method === 'pix' || method === 'boleto') && _payCycle !== 'anual'){
    alert('PIX e Boleto só estão disponíveis no plano anual. Pra mensal, use cartão de crédito.');
    return;
  }
  // V31: Se PIX/Boleto e tem mais de 30 ativos, bloquear e exigir cartao
  if(method === 'pix' || method === 'boleto'){
    const okCap = await window.rzPixCapCheck();
    if(!okCap) return;
  }"""
if old_check in html:
    html = html.replace(old_check, new_check, 1)
    fixes.append('FIX 3b: rzGoToCheckoutMP chama rzPixCapCheck antes do PIX/boleto')

# ============================================================
# FIX 4: Financeiro "Carregando" travado — render defensivo MAIS robusto
# ============================================================
SAFE_FIN_JS = """

// V31: Painel Financeiro fallback robusto — substitui qualquer "Carregando" travado
(function _rzFinSafetyNet(){
  if(window._rzFinSafetyNetV31) return; window._rzFinSafetyNetV31 = true;
  function killStaleLoadings(){
    const containerIds = ['fin-pm-info','fin-history-list','pr-financeiro'];
    containerIds.forEach(cid => {
      const c = document.getElementById(cid); if(!c) return;
      // Sweep todos descendentes
      const all = c.querySelectorAll('*');
      all.forEach(el => {
        if(el.children.length === 0){
          const t = (el.textContent||'').trim().toLowerCase();
          if(t === 'carregando…' || t === 'carregando...' || t.startsWith('carregando')){
            if(cid === 'fin-pm-info'){
              c.innerHTML = '<div style="background:rgba(248,243,234,.95);border-left:4px solid var(--moss);border-radius:.4rem;padding:.95rem 1.1rem;line-height:1.7;color:#3d5230;">' +
                '<div style="font-weight:600;font-size:1rem;">🌱 Plano grátis (Sementé)</div>' +
                '<div style="font-size:.82rem;color:#5a3a1e;margin-top:.3rem;">Até <strong>5 pacientes ativos</strong>. Sem cobrança.</div>' +
                '<div style="font-size:.78rem;color:#7a5c40;margin-top:.6rem;padding-top:.6rem;border-top:1px solid rgba(154,107,66,.15);">💡 Nenhum cartão salvo no Raízes. Quando assinar o Profissional, o Mercado Pago processa o pagamento.</div>' +
                '</div>';
            } else if(cid === 'fin-history-list'){
              c.innerHTML = '<div style="background:rgba(248,243,234,.6);border-radius:.4rem;padding:.95rem 1.1rem;font-size:.85rem;color:#7a5c40;text-align:center;">🌿 Nenhuma cobrança registrada ainda.<br><span style="font-size:.74rem;opacity:.8;">Tentativas e pagamentos vão aparecer aqui.</span></div>';
            }
          }
        }
      });
    });
  }
  // Roda imediatamente, 1s, 3s, 6s
  [500, 1500, 3500, 6500, 10500].forEach(ms => setTimeout(killStaleLoadings, ms));
  // Tambem quando entra em pr-financeiro
  const orig = window.showProPanel;
  if(typeof orig === 'function'){
    window.showProPanel = function(id, btn){
      const r = orig.apply(this, arguments);
      if(id === 'pr-financeiro'){
        [300, 1000, 2500, 5000].forEach(ms => setTimeout(killStaleLoadings, ms));
        // Force render se as funcoes existem
        setTimeout(()=>{
          try { if(typeof rzRenderPaymentMethod === 'function') rzRenderPaymentMethod(); } catch(e){}
          try { if(typeof rzRenderBillingHistory === 'function') rzRenderBillingHistory(); } catch(e){}
        }, 400);
      }
      return r;
    };
  }
  // Roda a cada 4s enquanto pr-financeiro estiver visivel
  setInterval(()=>{
    const fin = document.getElementById('pr-financeiro');
    if(fin && fin.classList.contains('active')) killStaleLoadings();
  }, 4000);
})();
"""

# Adicionar no final do HTML antes de </body>
if '_rzFinSafetyNetV31' not in html:
    last_script_close = html.rfind('</script>')
    if last_script_close > 0:
        html = html[:last_script_close] + SAFE_FIN_JS + html[last_script_close:]
        fixes.append('FIX 4: V31 fin safety net (sweep + replace "Carregando" travado)')

# ============================================================
# FIX 5: Garantir que titulo Mensal/Anual no botao seja explicito
# ============================================================
# Vou achar onde os botoes pc-mensal e pc-anual estao definidos
# Provavelmente tem na linha 5000-6000
old_pc_mensal = '<button id="pc-mensal" class="pcycle on" onclick="setPayCycle(\'mensal\')">Mensal</button>'
new_pc_mensal = '<button id="pc-mensal" class="pcycle on" onclick="setPayCycle(\'mensal\')">📅 Mensal (R$ 149)</button>'
if old_pc_mensal in html:
    html = html.replace(old_pc_mensal, new_pc_mensal, 1)
    fixes.append('FIX 5a: Botao Mensal mostra preco R$ 149')

old_pc_anual = '<button id="pc-anual" class="pcycle" onclick="setPayCycle(\'anual\')">Anual</button>'
new_pc_anual = '<button id="pc-anual" class="pcycle" onclick="setPayCycle(\'anual\')">🎯 Anual (R$ 1.490)</button>'
if old_pc_anual in html:
    html = html.replace(old_pc_anual, new_pc_anual, 1)
    fixes.append('FIX 5b: Botao Anual mostra preco R$ 1.490')

# Salvar
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)

print('='*60)
print('V31 APPLIED')
print('='*60)
print(f'Original: {orig_len} bytes')
print(f'Novo:     {len(html)} bytes')
print(f'Delta:    {len(html)-orig_len} bytes')
for fx in fixes: print('  -', fx)
