/* =========================================================
   EXIT POPUP — kit portátil. Zero dependências.
   Para adaptar a outro site, altere SOMENTE o bloco CONFIG.
   ========================================================= */
(function () {
  "use strict";

  var CONFIG = {
    enabled:       true,      // kill switch — false desliga tudo
    backTrap:      false,     // intercepta o botão "voltar" no mobile
    armDelay:      8000,      // ms mínimos na página antes de armar
    idleDelay:     25000,     // ms de inatividade no mobile
    snoozeDays:    3,         // dias de silêncio após fechar/enviar

    // Gatilho mobile: "push" bruto de volta ao topo. Só dispara no gesto
    // inteiro — arremesso longo, sem pausa, terminando no início da página.
    scrollUpMinPx: 1200,      // subida mínima acumulada, em px
    scrollUpMinVh: 2,         // ...ou N telas cheias, o que for maior
    scrollUpSpeed: 1.2,       // px/ms médios (~1200 px/s) — separa arremesso de rolagem
    scrollUpGap:   400,       // ms de pausa que quebram o gesto
    scrollUpJitter: 60,       // px de descida tolerados sem zerar o gesto
    scrollUpTop:   200,       // precisa terminar a até N px do topo

    prefix:        "cppem_apostila",   // prefixo do storage — troque por site
    endpoint:      "https://script.google.com/macros/s/AKfycbxdFplWVSfhTjvyIA7HIWb645xRjGNhBVhTdTf5UMjo0lSpW_A_jCuys0qB4uImKXPQ/exec?aba=APOSTILA_COMUNIDADE",
    redirect:      "https://chat.whatsapp.com/BxOuisctuqV3UWT9ldASe4",
    redirectDelay: 1500,      // ms antes de sair da página; abaixo de ~1s perde evento
    origem:        "exit_popup_apostila",  // identifica a origem no seu banco
    eventName:     "exit_popup",  // prefixo dos eventos de dataLayer

    // Impede que regras externas de "conversão ao enviar formulário"
    // (PixelX, GTM, Meta) contem este cadastro como Lead de venda.
    // Só desligue se você QUISER que o popup gere Lead.
    stopSubmitPropagation: true,

    // Trava extra: retorne true para impedir o popup.
    // Aqui: o modal de compra já está aberto. Sem isto, quem move o mouse
    // para fora enquanto preenche o formulário leva o popup por cima da
    // compra — o pior momento possível para interromper.
    blockWhen: function () {
      return document.querySelector("#lead-modal:not([hidden])") !== null;
    }
  };

  /* ---------------------------------------------------------
     Daqui para baixo não é preciso mexer.
     --------------------------------------------------------- */
  var modal = document.getElementById("xp-modal");
  if (!modal || !CONFIG.enabled) return;

  var box     = modal.querySelector(".xp__box");
  var formEl  = modal.querySelector("form");
  var okEl    = modal.querySelector(".xp__success");
  var FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  var KEY_SEEN      = CONFIG.prefix + "_exit_seen";
  var KEY_SNOOZE    = CONFIG.prefix + "_exit_snooze";
  var KEY_CONVERTED = CONFIG.prefix + "_lead_converted";

  var Store = {
    get:  function (k)    { try { return localStorage.getItem(k); }   catch (e) { return null; } },
    set:  function (k, v) { try { localStorage.setItem(k, v); }       catch (e) {} },
    sGet: function (k)    { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sSet: function (k, v) { try { sessionStorage.setItem(k, v); }     catch (e) {} }
  };

  function track(suffix, data) {
    window.dataLayer = window.dataLayer || [];
    var payload = { event: CONFIG.eventName + "_" + suffix };
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
    window.dataLayer.push(payload);
  }

  function snooze() {
    Store.set(KEY_SNOOZE, String(Date.now() + CONFIG.snoozeDays * 86400000));
  }

  /* ===================== estado do popup ===================== */
  var open = false, fired = false, submitted = false, armed = false;
  var trigger = null, lastFocused = null, cleanup = [];

  function isBlocked() {
    if (Store.get(KEY_CONVERTED)) return true;
    if (Store.sGet(KEY_SEEN)) return true;
    var until = parseInt(Store.get(KEY_SNOOZE) || "0", 10);
    if (until && Date.now() < until) return true;
    return CONFIG.blockWhen() === true;
  }

  function canFire() {
    return armed && !fired && !open && !isBlocked();
  }

  // force=true ignora as travas — usado só pelo ExitPopup.show() do console
  function show(why, force) {
    if (!force && !canFire()) return;
    if (open) return;

    fired = true;
    trigger = why;
    open = true;
    Store.sSet(KEY_SEEN, "1");

    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";

    var first = modal.querySelector("input");
    if (first) setTimeout(function () { first.focus(); }, 60);

    track("view", { trigger: why });
    teardown();
  }

  function hide(method) {
    if (!open) return;

    if (!submitted) {
      track("close", { trigger: trigger, method: method || "x" });
      snooze();
    }

    open = false;
    modal.hidden = true;
    document.body.style.overflow = "";

    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    lastFocused = null;
  }

  /* ===================== acessibilidade ===================== */
  modal.querySelectorAll("[data-xp-close]").forEach(function (el) {
    el.addEventListener("click", function () {
      hide(el.hasAttribute("data-xp-decline") ? "recusa"
         : el.classList.contains("xp__overlay") ? "overlay"
         : "x");
    });
  });

  document.addEventListener("keydown", function (e) {
    if (!open) return;

    if (e.key === "Escape") { hide("esc"); return; }
    if (e.key !== "Tab" || !box) return;

    var items = Array.prototype.slice.call(box.querySelectorAll(FOCUSABLE))
      .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    if (!items.length) return;

    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ===================== gatilhos ===================== */
  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanup.push(function () { target.removeEventListener(type, handler, opts); });
  }

  function teardown() {
    cleanup.forEach(function (fn) { fn(); });
    cleanup = [];
  }

  function watchPointer() {
    on(document, "mouseout", function (e) {
      if (!e.relatedTarget && e.clientY <= 0) show("desktop");
    });
  }

  function watchMobile() {
    var idleTimer = null;
    var lastY = window.scrollY, lastT = Date.now();
    var burstPx = 0, burstT = 0, burstN = 0;

    function resetIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { show("inatividade"); }, CONFIG.idleDelay);
    }

    on(window, "scroll", function () {
      var y = window.scrollY, t = Date.now();
      var subiu = lastY - y;

      // Voltou a descer de verdade, ou parou no meio do caminho:
      // não é mais um gesto único — zera e recomeça a contar deste ponto.
      // Oscilações pequenas (layout shift de imagem carregando) são ignoradas,
      // senão um único evento espúrio mataria o arremesso inteiro.
      if (subiu <= -CONFIG.scrollUpJitter) {
        burstPx = 0;                          // voltou a descer: anula o gesto
        burstT = t;
        burstN = 0;
      } else if (t - lastT > CONFIG.scrollUpGap) {
        burstPx = Math.max(0, subiu);         // gesto novo começa aqui
        burstT = t;
        burstN = 1;
      } else if (subiu > 0) {
        burstPx += subiu;                     // mesmo gesto, continua somando
        burstN++;
      }

      lastY = y;
      lastT = t;

      var duracao = t - burstT;
      var distancia = Math.max(CONFIG.scrollUpMinPx, window.innerHeight * CONFIG.scrollUpMinVh);

      // burstN >= 2 é obrigatório: com um único evento a duração é ~0 e a
      // velocidade daria infinito, deixando passar rolagem lenta que o browser
      // entregou coalescida. Sem intervalo real medido, não dá para afirmar
      // que foi um arremesso — e aqui o falso negativo é preferível.
      if (burstN >= 2 && duracao > 0 &&
          burstPx >= distancia &&
          burstPx / duracao >= CONFIG.scrollUpSpeed &&
          y <= CONFIG.scrollUpTop) {
        show("scroll_up"); return;
      }

      resetIdle();
    }, { passive: true });

    on(document, "touchstart", resetIdle, { passive: true });
    on(document, "click", resetIdle);
    cleanup.push(function () { clearTimeout(idleTimer); });

    resetIdle();
  }

  function watchBack() {
    try { history.pushState(null, "", location.href); } catch (e) { return; }
    on(window, "popstate", function () {
      if (canFire()) {
        try { history.pushState(null, "", location.href); } catch (e) {}
        show("back");
      }
    });
  }

  /* ===================== validação ===================== */
  var RULES = {
    text:  { test: function (v) { return v.trim().length >= 2; },
             msg: "Preencha este campo." },
    email: { test: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); },
             msg: "Informe um e-mail válido." },
    phone: { test: function (v) { return v.replace(/\D/g, "").length >= 10; },
             msg: "Informe seu WhatsApp com DDD." }
  };

  function fields() {
    return Array.prototype.slice.call(formEl.querySelectorAll("input[name]"));
  }

  function setFieldError(input, msg) {
    var wrap = input.closest(".xp__field");
    var el = wrap && wrap.querySelector(".xp__error");
    input.classList.toggle("is-invalid", !!msg);
    if (el) el.textContent = msg || "";
  }

  function validate() {
    var ok = true;
    fields().forEach(function (input) {
      var rule = RULES[input.getAttribute("data-xp-rule")] || RULES.text;
      var valid = !input.required || rule.test(input.value);
      // data-xp-msg permite personalizar a mensagem por campo
      setFieldError(input, valid ? "" : (input.getAttribute("data-xp-msg") || rule.msg));
      if (!valid) ok = false;
    });
    return ok;
  }

  /* ===================== envio =====================
     Barreira em fase de CAPTURA no document: roda antes de qualquer listener
     registrado no <form>, inclusive os que ferramentas de tracking (PixelX,
     GTM, Meta) instalam sozinhas.

     Por que isso importa: este popup capta para uma COMUNIDADE, não é lead de
     venda. Se o submit propagar, uma regra de "conversão ao enviar formulário"
     conta o cadastro como Lead e contamina a otimização das campanhas.
     Com stopImmediatePropagation, nenhuma regra externa alcança este form. */
  document.addEventListener("submit", function (e) {
    if (e.target !== formEl) return;

    e.preventDefault();

    if (CONFIG.stopSubmitPropagation) e.stopImmediatePropagation();

    if (!validate()) return;

    var btn = formEl.querySelector("button[type='submit']");
    var label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "ENVIANDO..."; }

    var payload = {
      origem: CONFIG.origem,
      gatilho: trigger || "",
      pagina: window.location.href,
      data_envio: new Date().toISOString()
    };
    fields().forEach(function (i) { payload[i.name] = i.value.trim(); });

    var request = CONFIG.endpoint
      ? fetch(CONFIG.endpoint, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        })
      : Promise.resolve();

    request.then(function () {
      submitted = true;
      Store.set(KEY_CONVERTED, "1");
      snooze();
      track("submit", { trigger: trigger });

      // Não chamar formEl.reset() aqui: ferramentas de tracking leem os
      // campos no blur e o reset pode fazê-las gravar valores vazios.
      if (okEl) okEl.hidden = false;

      if (CONFIG.redirect) {
        setTimeout(function () { window.location.href = CONFIG.redirect; }, CONFIG.redirectDelay);
      }
    }).catch(function (err) {
      console.error("[ExitPopup] Erro ao enviar:", err);
      var last = fields()[fields().length - 1];
      if (last) setFieldError(last, "Erro ao enviar. Tente novamente.");
      if (btn) { btn.disabled = false; btn.textContent = label; }
    });
  }, true);   // <- fase de CAPTURA: sem isto o listener roda depois do <form>

  /* ===================== start ===================== */

  // API de teste no console. Exposta ANTES das travas, para continuar
  // acessível mesmo quando o popup está bloqueado.
  //   ExitPopup.show()   → abre agora, ignorando as travas
  //   ExitPopup.reset()  → limpa o storage e rearma
  //   ExitPopup.state()  → mostra por que não está abrindo
  window.ExitPopup = {
    show: function (why) { show(why || "manual", true); },
    hide: hide,
    reset: function () {
      try {
        sessionStorage.removeItem(KEY_SEEN);
        localStorage.removeItem(KEY_SNOOZE);
        localStorage.removeItem(KEY_CONVERTED);
      } catch (e) {}
      fired = false; submitted = false; armed = true;
    },
    state: function () {
      return { armed: armed, fired: fired, open: open, blocked: isBlocked(), trigger: trigger };
    }
  };

  if (isBlocked()) return;

  setTimeout(function () { armed = true; }, CONFIG.armDelay);

  if (window.matchMedia("(pointer: fine)").matches) watchPointer();
  else watchMobile();

  if (CONFIG.backTrap) watchBack();
})();
