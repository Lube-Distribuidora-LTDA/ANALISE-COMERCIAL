/* =============================================================================
 * app.js — inicialização, menu, rotas, link da visão, busca, tema, modo apresentação,
 * o painel ao vivo (AGENTE LUBE) e o botão Atualizar. Veio do Relatório 146.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var tokRender = 0;
L.estado.ind = "fat";
L.estado.mesAMes = false;

/* ------------------------------ hash (link da visão) ------------------------------ */
function estadoHash() {
  var e = { f: L.estado.filtros, a: L.estado.anos, i: L.estado.ind, ip: L.estado.indProd, mm: L.estado.mesAMes ? 1 : 0, dc: L.estado.dimCresc };
  return "#/" + L.estado.pagina + "?e=" + encodeURIComponent(JSON.stringify(e));
}
L.sincronizarHash = L.debounce(function () { try { history.replaceState(null, "", estadoHash()); } catch (e) {} }, 150);
function lerHash() {
  var m = /^#\/([\w-]+)(?:\?e=(.*))?$/.exec(location.hash || ""), out = { pagina: null, e: null };
  if (!m) return out;
  out.pagina = m[1];
  try { if (m[2]) out.e = JSON.parse(decodeURIComponent(m[2])); } catch (e) {}
  return out;
}

/* ------------------------------ menu ------------------------------ */
function construirMenu() {
  var nav = L.limpar(L.$("menu-itens")), grupos = [], vistos = {};
  L.ordemPaginas.forEach(function (id) { var g = L.paginas[id].grupo; if (!vistos[g]) { vistos[g] = 1; grupos.push(g); } });
  grupos.forEach(function (g) {
    nav.appendChild(L.h("div", { class: "grupo-menu", text: g }));
    L.ordemPaginas.filter(function (id) { return L.paginas[id].grupo === g; }).forEach(function (id) {
      var p = L.paginas[id];
      nav.appendChild(L.h("button", { class: "item-menu", type: "button", "data-p": id, html: L.ic(p.icone) + "<span>" + L.esc(p.menu || p.titulo) + "</span>",
        onclick: function () { L.irPara(id); document.body.classList.remove("menu-aberto"); } }));
    });
  });
  rodape();
}
function hhmm(iso) { return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"; }
function hhmmss(iso) { return iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"; }
function rodape() {
  var c = L.CALK.get(L.MES_ATUAL), dias = c ? Math.round((Date.parse(c.fim) - Date.parse(c.inicio)) / 864e5) + 1 : 0;
  var a = (L.ULTIMA_VERSAO || {}).agente || {};
  L.$("menu-rodape").innerHTML =
    '<div><span class="vivo"></span><b>Mês comercial: ' + L.esc(L.MESES[L.MOA - 1] + "/" + L.ANO_ATUAL) + "</b></div>" +
    "<div>" + L.esc(c ? L.fDiaMes(c.inicio) + " a " + L.fDiaMes(c.fim) + " · dia " + (L.ORDEM_CORTE + 2) + " de " + dias : "") + "</div>" +
    "<div>Venda do WinThor pelo agente" + (a.lido_em ? " · lida às " + L.esc(hhmm(a.lido_em)) : "") + (L.ORIGEM === "offline" ? " · <b>sem conexão</b>" : "") + "</div>" +
    "<div>Desde " + L.esc(L.fData(L.CAL[0].inicio)) + " · " + L.fInt(L.SR.size) + " RCAs · " + L.fInt(L.FORN.size) + " fornecedores</div>" +
    '<div class="versao">versão ' + L.esc(window.VERSAO || "") + "</div>";
}
function marcarMenu() { document.querySelectorAll(".item-menu").forEach(function (b) { b.classList.toggle("ativo", b.dataset.p === L.estado.pagina); }); }

/* ------------------------------ rotas e renderização ------------------------------ */
L.irPara = function (id, params) {
  if (!L.paginas[id]) return;
  var mudou = L.estado.pagina !== id;
  L.estado.pagina = id; L.estado.params = params || {};
  if (mudou) { L.construirFiltros(); marcarMenu(); }
  L.sincronizarHash();
  renderizar();
  window.scrollTo({ top: 0 });
};
function renderizar() {
  if (!L.SR) return;
  var pag = L.paginaAtual(), tok = ++tokRender, cont = L.$("conteudo");
  L.$("titulo").textContent = pag.titulo; L.$("olho").textContent = pag.olho || "";
  document.title = pag.titulo + " — Análise Comercial · Lube";
  L.fila.length = 0;
  var raiz = L.h("div", { class: "pagina" });
  // o clique responde na hora: a espera entra antes de a tela ser montada (a de RCAs tem 200 blocos);
  // no redesenho ao vivo, não (a tela troca no lugar)
  if (!L.semAnimar) { L.limpar(cont).appendChild(L.espera("Montando " + pag.titulo.toLowerCase() + "…")); }
  setTimeout(function () {
    if (tok !== tokRender) return;
    try {
      pag.render(raiz, L.estado.params || {});
      L.limpar(cont); cont.appendChild(raiz);
      L.executarFila();
    } catch (e) {
      console.error(e);
      L.limpar(cont); cont.appendChild(L.erroTela("Não foi possível montar esta tela", (e && e.message) || String(e)));
    }
  }, L.semAnimar ? 0 : 40);
}
L.renderizar = renderizar;
L.ouvir("filtros", function () { L.atualizarFaixa(); renderizar(); });

/* ------------------------------ busca: RCA, supervisor ou fornecedor vira filtro ------------------------------ */
function iniciarBusca() {
  var inp = L.$("busca-global"), box = L.$("busca-box"), pop = null;
  var tipos = [["sup", "Supervisores"], ["rca", "RCAs"], ["forn", "Fornecedores"]];
  function fechar() { if (pop) { pop.remove(); pop = null; } }
  function buscar() {
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean);
    fechar();
    if (!q.length) return;
    var grupos = [];
    var guardaEq = L.estado.filtros.eq; L.estado.filtros.eq = [];      // a busca acha em todas as equipes
    tipos.forEach(function (t) {
      var itens = L.DIM[t[0]].itens(), achou = [];
      for (var i = 0; i < itens.length && achou.length < 8; i++) { var n = itens[i].n; if (q.every(function (x) { return n.indexOf(x) >= 0; })) achou.push(itens[i]); }
      if (achou.length) grupos.push([t, achou]);
    });
    if (guardaEq) L.estado.filtros.eq = guardaEq; else delete L.estado.filtros.eq;
    pop = L.h("div", { class: "pop", style: { width: "440px", maxHeight: "72vh" } });
    var lista = L.h("div", { class: "pop-lista" }), primeiro = null;
    if (!grupos.length) lista.appendChild(L.h("div", { class: "pop-vazio", text: "Nada encontrado para “" + inp.value + "”" }));
    grupos.forEach(function (g) {
      lista.appendChild(L.h("div", { class: "grupo-menu", style: { padding: "10px 10px 4px" }, text: g[0][1] }));
      g[1].forEach(function (x) {
        var tx = L.h("span", { class: "tx", title: x.t }); tx.innerHTML = L.destacar(x.t, q);
        var b = L.h("button", { class: "pop-item", type: "button", onclick: function () {
          fechar(); inp.value = ""; inp.blur();
          var k = g[0][0];
          if (k === "sup") { L.estado.filtros.eq = [L.equipeDeCod(L.equipeDoSup(x.id)).id]; delete L.estado.filtros.rca; }
          if (k === "rca") { var r = L.RCA.get(x.id) || {}; L.estado.filtros.eq = [L.equipeDeCod(L.equipeDoSup(r.sup)).id]; delete L.estado.filtros.sup; }
          L.setFiltro(k, [x.id]);
          if (k === "forn" && L.estado.pagina !== "prod") L.irPara("forn");
          L.toast("Filtro: " + L.DIM[k].rot + " " + x.t, "ok");
        } }, tx, x.s ? L.h("span", { class: "cn", text: x.s }) : null);
        if (!primeiro) primeiro = b;
        lista.appendChild(b);
      });
    });
    pop.appendChild(lista); pop._primeiro = primeiro;
    var r = box.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - 448, r.left)) + "px"; pop.style.top = (r.bottom + 6) + "px";
    document.body.appendChild(pop);
  }
  inp.addEventListener("input", L.debounce(buscar, 120));
  inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && pop && pop._primeiro) pop._primeiro.click(); if (ev.key === "Escape") { fechar(); inp.value = ""; inp.blur(); } });
  document.addEventListener("mousedown", function (ev) { if (pop && !pop.contains(ev.target) && !box.contains(ev.target)) fechar(); });
  document.addEventListener("keydown", function (ev) { if (ev.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { ev.preventDefault(); inp.focus(); } });
}

/* ------------------------------ tema, apresentação ------------------------------ */
function aplicarTema(t) {
  document.documentElement.setAttribute("data-tema", t);
  try { localStorage.setItem("ac-tema", t); } catch (e) {}
  L.estado.tema = t;
  L.$("btn-tema").innerHTML = L.ic(t === "escuro" ? "sol" : "lua");
  setTimeout(function () { if (L.SR) renderizar(); }, 30);
}
function apresentar(on) {
  L.estado.apresentando = on;
  document.body.classList.toggle("apresentando", on);
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () {});
  setTimeout(L.redesenharTudo, 120);
}
function navegarPaginas(d) { var i = L.ordemPaginas.indexOf(L.estado.pagina) + d; if (i >= 0 && i < L.ordemPaginas.length) L.irPara(L.ordemPaginas[i]); }

/* ------------------------------ ao vivo (AGENTE LUBE) ------------------------------ */
/* De 15 em 15 s, com a aba à vista, o painel pergunta se algum pacote mudou (/api/versao). Se o agente
   remontou um pacote, baixa só ele e redesenha a tela no mesmo filtro. Com uma lista aberta, espera. */
var AO_VIVO_MS = 15000, vivoOcupado = false;
function mostrarVivo() {
  var el = L.$("ao-vivo"); if (!el) return;
  var a = (L.ULTIMA_VERSAO || {}).agente || {}, vivo = !!a.vivo;
  var dim = (L.ULTIMA_VERSAO && (L.ULTIMA_VERSAO.pacotes || []).filter(function (p) { return p.nome === "base_rec"; })[0]) || {};
  el.classList.toggle("on", vivo);
  el.querySelector("b").textContent = vivo ? "Ao vivo · " + hhmmss(L.CONFERIDO_EM) : "Agente parado · dado de " + hhmm(dim.gerado_em);
  el.title = vivo
    ? "O AGENTE LUBE lê a venda no WinThor de minuto em minuto (e os últimos 45 dias de 10 em 10 min) e a tela muda sozinha. Última leitura: " + hhmmss(a.lido_em) + "."
    : "O agente do WinThor não está ligado (ou estes fluxos ainda não estão nele): o painel mostra a última montagem (" + L.fDataHora(dim.gerado_em) + ").";
}
function podeAplicar() { return !document.querySelector(".pop") && !L.$("dossie").classList.contains("on"); }
function redesenharAoVivo() {
  L.semAnimar = true; document.body.classList.add("sem-animar");
  rodape(); mostrarVivo();
  renderizar();
  clearTimeout(redesenharAoVivo.t);
  redesenharAoVivo.t = setTimeout(function () { L.semAnimar = false; document.body.classList.remove("sem-animar"); }, 1500);
}
function cicloAoVivo() {
  if (vivoOcupado || document.hidden || !L.SR || L.$("btn-atualizar").classList.contains("girando")) return;
  vivoOcupado = true;
  L.versaoNoBanco().then(function (v) {
    if (!podeAplicar()) { L.ULTIMA_VERSAO = v; L.CONFERIDO_EM = new Date(); mostrarVivo(); return; }
    return L.atualizarAoVivo(v).then(function (mudou) { if (mudou) redesenharAoVivo(); else { mostrarVivo(); rodape(); } });
  }).catch(function (e) {
    console.warn("Ao vivo: não consegui perguntar a versão", e);
    var el = L.$("ao-vivo"); if (el) { el.classList.remove("on"); el.querySelector("b").textContent = "Sem conexão"; }
  }).then(function () { vivoOcupado = false; });
}

/* ------------------------------ botão Atualizar: pede ao agente uma leitura agora ------------------------------ */
function textoPedido(p) {
  p = p || {};
  if (p.status === "demorou") return "O agente ainda está lendo o WinThor; a tela muda sozinha assim que terminar.";
  if (p.status !== "atendido") return "O agente não conseguiu ler o WinThor agora" + (p.mensagem ? ": " + p.mensagem : ".");
  var d = p.detalhe || {}, novas = 0, mudaram = 0, sairam = 0, seg = p.segundos != null ? " (" + L.fNum(p.segundos, 1) + " s)" : "";
  Object.keys(d).forEach(function (k) { if (k.indexOf("analise_comercial.") !== 0) return; var x = d[k] || {}; novas += x.novas || 0; mudaram += x.alteradas || 0; sairam += x.apagadas || 0; });
  var partes = [];
  if (novas) partes.push(L.fInt(novas) + (novas === 1 ? " item novo" : " itens novos"));
  if (mudaram) partes.push(L.fInt(mudaram) + (mudaram === 1 ? " item mudou" : " itens mudaram"));
  if (sairam) partes.push(L.fInt(sairam) + (sairam === 1 ? " item saiu (cancelado)" : " itens saíram (cancelados)"));
  return "WinThor lido agora" + seg + ": " + (partes.length ? partes.join(", ") + "." : "nada mudou, o painel já estava em dia.");
}
function atualizarDados() {
  var b = L.$("btn-atualizar");
  if (b.classList.contains("girando")) return;
  b.classList.add("girando");
  var fim = function () { b.classList.remove("girando"); };
  L.pedirAtualizacao().then(function (r) {
    if (!r || !r.agente) {
      return L.versaoNoBanco().then(function (v) { return L.atualizarAoVivo(v); }).then(function (mudou) {
        if (mudou) redesenharAoVivo(); else mostrarVivo();
        fim(); L.toast((r && r.mensagem ? r.mensagem + " " : "") + "O painel mostra a última montagem do banco.", "erro");
      });
    }
    L.toast("Lendo o WinThor agora…", "ok");
    return L.esperarPedido(r.pedido, 45000).then(function (v) {
      return L.atualizarAoVivo(v).then(function (mudou) {
        if (mudou) redesenharAoVivo(); else mostrarVivo();
        fim();
        L.toast(textoPedido(v.pedido), v.pedido && v.pedido.status === "atendido" ? "ok" : "erro");
      });
    });
  }).catch(function (e) { fim(); L.toast("Não foi possível atualizar: " + (e.message || e), "erro"); });
}

/* ------------------------------ início ------------------------------ */
function iniciar() {
  L.$("ic-busca").innerHTML = L.ic("busca");
  L.$("btn-menu").innerHTML = L.ic("menu");
  L.$("btn-apresentar").innerHTML = L.ic("maximizar");
  L.$("btn-link").innerHTML = L.ic("link");
  L.$("btn-atualizar").innerHTML = L.ic("relogio");
  aplicarTema(document.documentElement.getAttribute("data-tema") || "escuro");
  L.$("btn-tema").addEventListener("click", function () { aplicarTema(L.estado.tema === "escuro" ? "claro" : "escuro"); });
  L.$("btn-menu").addEventListener("click", function () { document.body.classList.toggle("menu-aberto"); });
  L.$("btn-apresentar").addEventListener("click", function () { apresentar(!L.estado.apresentando); });
  L.$("btn-link").addEventListener("click", function () {
    var url = location.href.split("#")[0] + estadoHash();
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { L.toast("Link desta visão copiado (filtros e anos juntos)", "ok"); }, function () { L.toast("Não foi possível copiar o link", "erro"); });
  });
  L.$("btn-atualizar").addEventListener("click", atualizarDados);
  document.addEventListener("keydown", function (ev) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if ((ev.key === "f" || ev.key === "F") && !ev.ctrlKey && !ev.metaKey) apresentar(!L.estado.apresentando);
    if (L.estado.apresentando) { if (ev.key === "ArrowRight") navegarPaginas(1); if (ev.key === "ArrowLeft") navegarPaginas(-1); }
  });
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && L.estado.apresentando) { L.estado.apresentando = false; document.body.classList.remove("apresentando"); setTimeout(L.redesenharTudo, 120); } });

  var cont = L.$("conteudo"), espera = L.espera("Abrindo a Análise Comercial…");
  L.limpar(cont).appendChild(espera);
  var aviso = function (t) { var x = espera.querySelector(".espera-txt div"); if (x) x.textContent = t; };
  if (!window.DecompressionStream) { L.limpar(cont).appendChild(L.erroTela("Navegador antigo", "Este painel precisa do Chrome ou do Edge atualizados.")); return; }
  L.carregarTudo(aviso).then(function () {
    construirMenu(); iniciarBusca();
    var h = lerHash();
    L.estado.pagina = h.pagina && L.paginas[h.pagina] ? h.pagina : L.ordemPaginas[0];
    if (h.e) {
      L.estado.filtros = h.e.f || {}; L.estado.anos = h.e.a; L.estado.ind = h.e.i || "fat"; L.estado.indProd = h.e.ip; L.estado.mesAMes = !!h.e.mm; L.estado.dimCresc = h.e.dc;
    } else {
      var eqPadrao = L.equipeDeCod((L.PAC.dim.j.equipe_padrao || "ES"));
      L.estado.filtros = { eq: [eqPadrao.id] };
    }
    if (!L.estado.anos || !L.estado.anos.length) L.estado.anos = [L.ANO_ATUAL - 1, L.ANO_ATUAL].filter(function (a) { return L.ANOS.indexOf(a) >= 0; });
    L.construirFiltros(); marcarMenu();
    renderizar();
    mostrarVivo();
    setInterval(cicloAoVivo, AO_VIVO_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) cicloAoVivo(); });
  }).catch(function (e) {
    console.error(e);
    L.limpar(cont).appendChild(L.erroTela("Não foi possível carregar os dados", (e && e.message) || String(e)));
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
