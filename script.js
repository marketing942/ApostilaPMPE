/* =========================================================
   CPPEM · Resumo Bizurado PMPE
   Formulário → Lead (PixelX) → Google Sheets → Checkout

   Baseado no script da landing PMPE. As regras de tracking
   estão documentadas em C:\Projetos\pmpe\TRACKING.md — as
   seções citadas nos comentários se referem a esse arquivo.
   ========================================================= */

/* ---------- Google Sheets ---------- */
const SHEET_BASE = "https://script.google.com/macros/s/AKfycbxdFplWVSfhTjvyIA7HIWb645xRjGNhBVhTdTf5UMjo0lSpW_A_jCuys0qB4uImKXPQ/exec";
const SHEET_URL  = `${SHEET_BASE}?aba=APOSTILA_PMPE`;

/* ---------- Checkout ---------- */
const CHECKOUT_BASE =
  "https://checkout.cppem.com.br/pay/oferta-03";

/* Usados só quando o visitante chega sem parâmetro nenhum
   (link direto, bio, QR code). Se ele vier de um anúncio, os
   parâmetros reais da URL sempre têm prioridade. */
const UTM_FALLBACK = {
  utm_source:   "site",
  utm_medium:   "organico",
  utm_campaign: "apostila_pmpe",
  utm_content:  "cppem",
  utm_term:     "lp_apostila"
};

/* Parâmetros de origem que devem atravessar a página até o checkout. */
const PASSTHROUGH = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "ttclid", "sck", "src", "xcod", "ref"
];

/* =========================================================
   Tracking de Lead — PixelX / GTM   (§5, §9)

   REGRA DE OURO: exatamente UM emissor de Lead.
   LEAD_MODE = "site"   → o site dispara; a barreira de submit
                          corta a propagação e a regra de submit
                          do painel fica inerte.
   LEAD_MODE = "painel" → o painel dispara, o site não.
   ========================================================= */
const LEAD_MODE   = "site";        // "site" (Modelo B) | "painel" (Modelo A)
const PHONE_MODE  = "celular_br";  // "celular_br" | "celular_ou_fixo_br" | "internacional"
const REDIRECT_DELAY_MS = 1500;    // §7.6 — alinhado ao debounce de 1500ms da PixelX.
                                   // Abaixo disso a navegação cancela a requisição do Lead.
const PIXEL_TIMEOUT_MS  = 3000;    // §8.5 — espera o pixel_x_app ficar pronto

/* --- Elementos --- */
const form = document.getElementById("lead-form");
const telefoneInput = document.getElementById("telefone");

/* =========================================================
   Utilitários
   ========================================================= */
const Store = {
  get(k)    { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); }    catch (e) {} }
};

/* Deliberadamente SEM chamadas no fluxo de conversão — ver enviarLead().
   Só o exit-popup.js emite eventos próprios (exit_popup_*), e esses nunca
   podem ser mapeados como Lead no GTM. Se um dia voltar a usar esta função
   para funil, confirme antes que o nome do evento NÃO está ligado a nenhuma
   tag de conversão. */
function track(event, data) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(Object.assign({ event: event }, data || {}));
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : "";
}

/* Identificador estável do visitante. O checkout usa o mesmo valor em
   `sck` e `external_id`, o que permite casar a venda com o clique do
   anúncio mesmo quando o Meta perde o cookie. */
function visitorId() {
  const KEY = "cppem_visitor_id";
  let id = Store.get(KEY);

  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "v-" + Date.now().toString(36) + "-" + performance.now().toString(36).replace(".", "");
    Store.set(KEY, id);
  }

  return id;
}

/* =========================================================
   Origem do tráfego

   Gravada na primeira visita e reusada depois. Sem isso, quem
   volta pelo histórico chega ao checkout sem UTM e a venda fica
   órfã — atribuída a "direto" em vez do anúncio que a gerou.
   ========================================================= */
const Origem = {
  KEY: "cppem_origem_apostila",

  capturar() {
    const url = new URLSearchParams(window.location.search);
    const atual = {};

    PASSTHROUGH.forEach((k) => {
      const v = url.get(k);
      if (v) atual[k] = v;
    });

    // chegou com parâmetro: esta visita é a origem, sobrescreve
    if (Object.keys(atual).length) {
      Store.set(this.KEY, JSON.stringify(atual));
      return atual;
    }

    // sem parâmetro: recupera o que já foi gravado
    try {
      const salvo = JSON.parse(Store.get(this.KEY) || "{}");
      if (Object.keys(salvo).length) return salvo;
    } catch (e) {}

    return Object.assign({}, UTM_FALLBACK);
  }
};

/* =========================================================
   Monta a URL do checkout

   Pré-preenche nome, e-mail e telefone para o comprador não
   digitar tudo de novo — cada campo repetido derruba conversão.
   ========================================================= */
function checkoutURL({ nome, email, telefone }) {
  const url = new URL(CHECKOUT_BASE);
  const origem = Origem.capturar();
  const id = visitorId();

  Object.keys(origem).forEach((k) => url.searchParams.set(k, origem[k]));

  // sck / external_id: identificam esta pessoa no relatório de vendas
  if (!url.searchParams.get("sck")) url.searchParams.set("sck", id);
  url.searchParams.set("external_id", id);

  // cookies do Meta — melhoram o match da conversão do lado do servidor
  const fbp = getCookie("_fbp");
  const fbc = getCookie("_fbc");
  if (fbp) url.searchParams.set("fbp", fbp);
  if (fbc) url.searchParams.set("fbc", fbc);

  // dados do comprador
  if (nome)  url.searchParams.set("name", nome);
  if (email) url.searchParams.set("email", email.trim().toLowerCase());
  if (telefone) url.searchParams.set("phone", toE164(telefone).replace("+", ""));

  return url.toString();
}

/* =========================================================
   Validação
   ========================================================= */
function setError(id, msg) {
  const input = document.getElementById(id);
  const errorEl = document.querySelector(`[data-error-for="${id}"]`);

  if (input) input.classList.add("is-invalid");
  if (errorEl) errorEl.textContent = msg;
}

function clearError(id) {
  const input = document.getElementById(id);
  const errorEl = document.querySelector(`[data-error-for="${id}"]`);

  if (input) input.classList.remove("is-invalid");
  if (errorEl) errorEl.textContent = "";
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/* §7.7 — conta DÍGITOS, não caracteres, e remove o "+55" da máscara pelo "+"
   literal. Remover pelos dígitos seria ambíguo: o DDD 55 existe (Santa Maria/RS). */
const isPhone = (v) => {
  const d = v.trim().replace(/^\+\s*55\s*/, "").replace(/\D/g, "");

  if (PHONE_MODE === "celular_ou_fixo_br") return d.length === 10 || d.length === 11;
  if (PHONE_MODE === "internacional")      return d.length >= 8 && d.length <= 15;

  return d.length === 11 && d[2] === "9";   // celular_br (padrão)
};

/* Normaliza para E.164 brasileiro. Meta e Google casam telefone por E.164:
   sem o código do país, "81999967415" vira "+81999967415" — que é Japão. */
function toE164(v) {
  let d = String(v || "").trim().replace(/^\+\s*55\s*/, "").replace(/\D/g, "");

  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

  return d ? `+55${d}` : "";
}

function validate() {
  let ok = true;

  const nome  = document.getElementById("nome")?.value.trim() || "";
  const email = document.getElementById("email")?.value.trim() || "";
  const tel   = telefoneInput?.value.trim() || "";

  ["nome", "email", "telefone"].forEach(clearError);

  if (nome.length < 2) {
    setError("nome", "Informe seu nome completo.");
    ok = false;
  }

  if (!isEmail(email)) {
    setError("email", "Informe um e-mail válido — é para ele que o material vai.");
    ok = false;
  }

  if (!isPhone(tel)) {
    setError("telefone", "Informe seu WhatsApp com DDD.");
    ok = false;
  }

  return ok;
}

/* =========================================================
   Emissor ÚNICO de Lead (§9)
   ========================================================= */

/* §8.5 — pixel_x_app é criado pelo GTM e o start() dela é async. Em conexão
   lenta o objeto pode não existir na hora do envio; sem esta espera o Lead
   some sem erro nenhum. */
function waitForPixel(timeoutMs = PIXEL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const pronto = () => typeof window.pixel_x_app?.send_event === "function";

    if (pronto()) return resolve(true);

    const inicio = Date.now();
    const t = setInterval(() => {
      if (pronto()) {
        clearInterval(t);
        resolve(true);
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(t);
        console.warn("[tracking] pixel_x_app não ficou pronto a tempo; Lead não enviado.");
        resolve(false);
      }
    }, 100);
  });
}

/* A guarda cobre duplo clique, listener duplicado e script incluído duas vezes. */
let leadEnviado = false;

async function trackLead({ nome, email, telefone }) {
  if (LEAD_MODE !== "site") return false;

  if (leadEnviado) {
    console.warn("[tracking] Lead já enviado nesta página; ignorando.");
    return false;
  }
  leadEnviado = true;

  if (!(await waitForPixel())) return false;

  try {
    await window.pixel_x_app.send_event({
      event_name: "Lead",
      lead_name:  nome || "",
      lead_email: (email || "").trim().toLowerCase(),
      lead_phone: toE164(telefone)
    });

    console.log("[tracking] Lead enviado.");
    return true;
  } catch (err) {
    console.error("[tracking] send_event falhou:", err);
    leadEnviado = false;          // libera para nova tentativa
    return false;
  }
}

window.trackLead = trackLead;

/* =========================================================
   Envio: Lead → planilha → checkout
   ========================================================= */
const BTN_LABEL = `Ir para o pagamento<span class="cta__sub">Pix, cartão ou boleto</span>`;

/* Guarda de idempotência no NÍVEL DO ENVIO, não só do Lead.
   O trackLead() já era guardado, mas enviarLead() não: cada submit extra
   empurrava outro "iniciar_checkout" no dataLayer, gravava outra linha na
   planilha e agendava outro redirect. Se houver tag de conversão em
   iniciar_checkout, isso vira Lead duplicado/triplicado. */
let envioEmAndamento = false;

async function enviarLead() {
  if (envioEmAndamento) {
    console.warn("[Form] Envio já em andamento; ignorando.");
    return;
  }
  envioEmAndamento = true;

  const btn = form.querySelector("button[type='submit']");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "ABRINDO CHECKOUT...";
  }

  const dados = {
    nome: document.getElementById("nome").value.trim(),
    email: document.getElementById("email").value.trim(),
    telefone: telefoneInput.value.trim()
  };

  // Montada antes de qualquer await: se a rede falhar no meio, ainda
  // conseguimos levar a pessoa ao checkout.
  const destino = checkoutURL(dados);

  try {
    // 1. Lead primeiro — depois do redirecionamento a página morre (§7.6).
    await trackLead(dados);

    /* NÃO empurrar evento próprio aqui. Um único send_event já gera DOIS
       eventos no dataLayer pela PixelX — "generate_lead" e "conversion"
       (este último com send_to do Google Ads). Um terceiro evento nosso, com
       tags de Meta e Ads apontadas para ele, virava 3 conversões por venda.
       A landing PMPE não empurra nada no envio, e é o padrão aqui também. */

    // 2. Planilha em fire-and-forget. Com mode:"no-cors" não dá para ler a
    //    resposta, então esperar não garante nada — e um Apps Script lento
    //    travaria o comprador numa tela de "ABRINDO CHECKOUT..." sem nunca
    //    chegar ao pagamento.
    fetch(SHEET_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({}, dados, {
        origem: "lp_apostila_pmpe",
        produto: "Resumo Bizurado Digital PMPE",
        valor: "59,90",
        pagina: window.location.href,
        data_envio: new Date().toISOString()
      }))
    }).catch((err) => {
      console.error("[Form] Falha ao salvar na planilha (segue o checkout):", err);
    });
  } catch (err) {
    console.error("[Form] Falha ao registrar o lead:", err);
  }

  // Quem chegou ao checkout não deve mais ver o popup de saída. A chave é a
  // mesma que o exit-popup.js lê (CONFIG.prefix + "_lead_converted").
  Store.set("cppem_apostila_lead_converted", "1");

  // 3. Sucesso + redirecionamento.
  //    §7.6 — NÃO chamar form.reset(): a PixelX lê os campos no blur e o
  //    reset pode fazê-la gravar valores vazios.
  const successEl = document.getElementById("form-success");
  if (successEl) successEl.hidden = false;

  setTimeout(() => {
    window.location.href = destino;
  }, REDIRECT_DELAY_MS);

  // Rede lenta ou pixel travado não podem deixar o botão morto para sempre.
  setTimeout(() => {
    if (btn && btn.disabled) {
      btn.disabled = false;
      btn.innerHTML = BTN_LABEL;
      envioEmAndamento = false;   // o redirect falhou: permite tentar de novo
    }
  }, REDIRECT_DELAY_MS + 6000);
}

/* =========================================================
   Barreira única de submit (§7.8)

   Captura no DOCUMENT, em fase de captura: roda SEMPRE antes de
   qualquer listener registrado no <form>, independente de quem
   registrou primeiro (a PixelX registra o dela de dentro de um
   start() async).

   · inválido            → o evento morre aqui, a PixelX não vê nada
   · válido, modo "site" → morre aqui também; quem dispara o Lead somos nós
   · válido, modo painel → propaga, e só a regra do painel dispara
   ========================================================= */
document.addEventListener("submit", (e) => {
  if (!form || e.target !== form) return;

  e.preventDefault();                 // nunca recarregar a página

  if (!validate()) {
    e.stopImmediatePropagation();     // inválido → nenhum Lead
    return;
  }

  if (LEAD_MODE === "site") e.stopImmediatePropagation();

  enviarLead();
}, true);

/* =========================================================
   Modal
   ========================================================= */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const Modal = {
  el: null,
  lastFocused: null,

  open(id, origem) {
    const el = document.getElementById(id);
    if (!el || this.el === el) return;

    this.lastFocused = document.activeElement;
    this.el = el;

    el.hidden = false;
    document.body.style.overflow = "hidden";

    /* Idem: nenhum evento custom. Ver comentário em enviarLead(). */

    const first = el.querySelector("input");
    if (first) setTimeout(() => first.focus(), 60);
  },

  close() {
    if (!this.el) return;

    this.el.hidden = true;
    this.el = null;
    document.body.style.overflow = "";

    if (this.lastFocused && typeof this.lastFocused.focus === "function") {
      this.lastFocused.focus();
    }
    this.lastFocused = null;
  },

  // Mantém o Tab preso dentro do modal aberto
  trapFocus(e) {
    if (!this.el || e.key !== "Tab") return;

    const box = this.el.querySelector(".modal__box");
    if (!box) return;

    const items = Array.from(box.querySelectorAll(FOCUSABLE))
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;

    const first = items[0];
    const last  = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
};

document.querySelectorAll("[data-open-modal]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    Modal.open("lead-modal", el.dataset.cta);
  });
});

document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", () => Modal.close());
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && Modal.el) {
    Modal.close();
    return;
  }
  Modal.trapFocus(e);
});

/* Grava a origem já na chegada, antes que o visitante navegue e perca a query. */
Origem.capturar();
