/* =============================================================================
 * filtros.js — faixa de filtros: equipe (chips), anos (chips), supervisor, RCA e fornecedor
 * (múltipla escolha com busca), pílulas dos filtros ativos. Veio do Relatório 146.
 * Regra da casa: a partir de "Todos", o clique seleciona só aquela opção; depois cada clique
 * soma ou tira; esvaziar volta para "Todos" (conjunto vazio = tudo).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var aberto = null;

/* ------------------------------ mudança de filtro ------------------------------ */
var avisar = L.debounce(function () { L.emitir("filtros"); }, 90);
function mudou() { L.sincronizarHash && L.sincronizarHash(); L.atualizarFaixa(); avisar(); }

L.setFiltro = function (chave, ids) {
  if (ids && ids.length) L.estado.filtros[chave] = ids.map(function (x) { return +x; }); else delete L.estado.filtros[chave];
  // descer na hierarquia limpa o que ficou de fora: trocar a equipe tira supervisor e RCA de outra equipe
  if (chave === "eq") limparForaDaEquipe();
  if (chave === "sup") limparRcaForaDoSup();
  mudou();
};
function limparForaDaEquipe() {
  var eqs = L.equipesFiltro(); if (!eqs) return;
  var sup = (L.estado.filtros.sup || []).filter(function (s) { return eqs.indexOf(L.equipeDoSup(s)) >= 0; });
  if (sup.length) L.estado.filtros.sup = sup; else delete L.estado.filtros.sup;
  limparRcaForaDoSup();
}
function limparRcaForaDoSup() {
  var sups = L.supsFiltro(); if (!sups) return;
  var rca = (L.estado.filtros.rca || []).filter(function (u) { var r = L.RCA.get(u); return sups.has(r ? r.sup : 0); });
  if (rca.length) L.estado.filtros.rca = rca; else delete L.estado.filtros.rca;
}
L.alternarFiltro = function (chave, id) {
  var a = (L.estado.filtros[chave] || []).slice(), i = a.indexOf(+id);
  if (i >= 0) a.splice(i, 1); else a.push(+id);
  L.setFiltro(chave, a);
};
L.limparFiltros = function () { L.estado.filtros = {}; mudou(); };
L.setAnos = function (anos) { L.estado.anos = anos.slice().sort(); mudou(); };

/* ------------------------------ popover de opções ------------------------------ */
function fechar() { if (aberto) { aberto.el.remove(); document.removeEventListener("mousedown", aberto.fora, true); document.removeEventListener("keydown", aberto.tecla, true); aberto = null; } }
L.fecharPopover = fechar;
function fecharMenus(ev) {
  var pops = document.querySelectorAll(".pop");
  if (!pops.length || [].some.call(pops, function (p) { return p.contains(ev.target); })) return;
  pops.forEach(function (p) { if (aberto && aberto.el === p) fechar(); else p.remove(); });
}
window.addEventListener("wheel", fecharMenus, { capture: true, passive: true });
window.addEventListener("touchmove", fecharMenus, { capture: true, passive: true });
function posicionar(el, ancora, w) {
  document.body.appendChild(el);
  var r = ancora.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + "px";
  el.style.top = Math.min(r.bottom + 6, innerHeight - 120) + "px";
}
function prender(el, ancora, chave) {
  var fora = function (ev) { if (!el.contains(ev.target) && !ancora.contains(ev.target)) fechar(); };
  var tecla = function (ev) { if (ev.key === "Escape") fechar(); };
  document.addEventListener("mousedown", fora, true); document.addEventListener("keydown", tecla, true);
  aberto = { el: el, chave: chave, fora: fora, tecla: tecla };
}
function abrir(chave, ancora) {
  if (aberto && aberto.chave === chave) return fechar();
  fechar();
  var dim = L.DIM[chave], itens = dim.itens();
  var el = L.h("div", { class: "pop" });
  var inp = L.h("input", { type: "search", placeholder: "Buscar " + dim.rot.toLowerCase() + " por código ou nome…", autocomplete: "off", spellcheck: "false" });
  var lista = L.h("div", { class: "pop-lista" }), rod = L.h("div", { class: "pop-rodape" });
  el.appendChild(L.h("div", { class: "pop-topo" }, inp)); el.appendChild(lista); el.appendChild(rod);
  if (itens.length <= 10) inp.parentNode.style.display = "none";
  function sel() { return L.estado.filtros[chave] || []; }
  function desenhar() {
    itens = dim.itens();
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean), s = sel(), conj = {}; s.forEach(function (x) { conj[x] = 1; });
    var res = q.length ? itens.filter(function (x) { return q.every(function (t) { return x.n.indexOf(t) >= 0; }); }) : itens;
    var marc = [], resto = [];
    res.forEach(function (x) { (conj[x.id] ? marc : resto).push(x); });
    var ordenado = marc.concat(resto), limite = 200, mostrar = ordenado.slice(0, limite);
    L.limpar(lista);
    if (!mostrar.length) lista.appendChild(L.h("div", { class: "pop-vazio", text: "Nada encontrado" }));
    mostrar.forEach(function (x) {
      var tx = L.h("span", { class: "tx", title: x.t });
      tx.innerHTML = destacar(x.t, q);
      lista.appendChild(L.h("button", { class: "pop-item" + (conj[x.id] ? " on" : ""), type: "button", onclick: function () { L.alternarFiltro(chave, x.id); desenhar(); } },
        L.h("span", { class: "cx" }), tx, x.s ? L.h("span", { class: "cn", text: x.s.length > 24 ? x.s.slice(0, 23) + "…" : x.s }) : null));
    });
    if (ordenado.length > limite) lista.appendChild(L.h("div", { class: "pop-vazio", text: "+ " + L.fInt(ordenado.length - limite) + " resultados — refine a busca" }));
    L.limpar(rod);
    rod.appendChild(L.h("span", { text: s.length ? s.length + " selecionado" + (s.length > 1 ? "s" : "") : "Todos" }));
    var acoes = L.h("span", { style: { display: "flex", gap: "6px" } });
    if (q.length && res.length > 1 && res.length <= 300) acoes.appendChild(L.h("button", { class: "mini-btn", type: "button", text: "Marcar os " + res.length, onclick: function () { var a = sel().slice(); res.forEach(function (x) { if (a.indexOf(x.id) < 0) a.push(x.id); }); L.setFiltro(chave, a); desenhar(); } }));
    acoes.appendChild(L.h("button", { class: "mini-btn", type: "button", text: "Limpar", onclick: function () { L.setFiltro(chave, []); desenhar(); } }));
    rod.appendChild(acoes);
  }
  inp.addEventListener("input", desenhar);
  posicionar(el, ancora, 360);
  desenhar();
  setTimeout(function () { inp.focus(); }, 30);
  prender(el, ancora, chave);
}
function destacar(texto, termos) {
  var s = L.esc(texto);
  if (!termos.length) return s;
  var n = L.norm(texto), marcas = [];
  termos.forEach(function (t) { var i = n.indexOf(t); if (i >= 0) marcas.push([i, i + t.length]); });
  if (!marcas.length) return s;
  marcas.sort(function (a, b) { return a[0] - b[0]; });
  var out = "", pos = 0;
  marcas.forEach(function (m) { if (m[0] < pos) return; out += L.esc(texto.slice(pos, m[0])) + "<mark>" + L.esc(texto.slice(m[0], m[1])) + "</mark>"; pos = m[1]; });
  return out + L.esc(texto.slice(pos));
}
L.destacar = destacar;

/* ------------------------------ chips (equipe e anos) ------------------------------ */
/* a partir de "Todas", o clique fica só nela; depois soma ou tira; esvaziar volta para "Todas" */
function clicarChip(lista, id) {
  var a = (lista || []).slice(), i = a.indexOf(id);
  if (!a.length) return [id];
  if (i >= 0) a.splice(i, 1); else a.push(id);
  return a;
}

/* ------------------------------ faixa ------------------------------ */
L.construirFiltros = function () {
  var pag = L.paginaAtual(), box = L.$("faixa-filtros");
  L.limpar(box);
  box.dataset.pagina = pag.id;
  box.appendChild(L.h("span", { class: "fx-rot", html: L.ic("filtro") + " Filtros" }));
  // equipe
  var segEq = L.h("div", { class: "seg", id: "fx-eq", title: "Equipe (a partir de Todas, o clique fica só nela; depois soma ou tira)" });
  segEq.appendChild(L.h("button", { type: "button", "data-id": "0", text: "Todas", onclick: function () { L.setFiltro("eq", []); } }));
  L.EQUIPES.forEach(function (e) {
    segEq.appendChild(L.h("button", { type: "button", "data-id": String(e.id), text: e.cod, onclick: function () { L.setFiltro("eq", clicarChip(L.estado.filtros.eq, e.id)); } }));
  });
  box.appendChild(segEq);
  // anos
  var segAno = L.h("div", { class: "seg", id: "fx-anos", title: "Anos na comparação (clique soma ou tira; fica ao menos um)" });
  L.ANOS.forEach(function (a) {
    segAno.appendChild(L.h("button", { type: "button", "data-a": String(a), text: String(a), onclick: function () {
      var x = (L.estado.anos || []).slice(), i = x.indexOf(a);
      if (i >= 0) { if (x.length > 1) x.splice(i, 1); } else x.push(a);
      L.setAnos(x);
    } }));
  });
  box.appendChild(L.h("span", { class: "fx-sep", text: "Anos" }));
  box.appendChild(segAno);
  (pag.filtros || ["sup", "rca", "forn"]).forEach(function (chave) {
    box.appendChild(L.h("button", { class: "fx-btn", type: "button", "data-k": chave, onclick: function (ev) { abrir(chave, ev.currentTarget); } },
      L.h("span", { text: L.DIM[chave].rot }), L.h("span", { class: "n", hidden: true }), L.icEl("baixo")));
  });
  box.appendChild(L.h("button", { class: "fx-limpar", type: "button", text: "Limpar filtros", onclick: function () { L.limparFiltros(); L.toast("Filtros limpos (os anos continuam)"); } }));
  box.appendChild(L.h("div", { class: "fx-pilulas", id: "fx-pilulas" }));
  L.atualizarFaixa();
};

L.atualizarFaixa = function () {
  var box = L.$("faixa-filtros"); if (!box || !box.dataset.pagina) return;
  var f = L.estado.filtros;
  box.querySelectorAll(".fx-btn[data-k]").forEach(function (b) {
    var a = f[b.dataset.k] || [], n = b.querySelector(".n");
    b.classList.toggle("on", a.length > 0); n.hidden = !a.length; n.textContent = a.length;
  });
  var eqs = f.eq || [];
  box.querySelectorAll("#fx-eq button").forEach(function (b) { var id = +b.dataset.id; b.classList.toggle("on", id === 0 ? !eqs.length : eqs.indexOf(id) >= 0); });
  box.querySelectorAll("#fx-anos button").forEach(function (b) { b.classList.toggle("on", (L.estado.anos || []).indexOf(+b.dataset.a) >= 0); });
  var pil = L.$("fx-pilulas"); if (!pil) return;
  L.limpar(pil);
  var qtd = 0;
  ["sup", "rca", "forn"].forEach(function (k) {
    (f[k] || []).forEach(function (id) { qtd++; pil.appendChild(pilula(L.DIM[k].rot, L.nomeDe(k, id), function () { L.alternarFiltro(k, id); })); });
  });
  pil.style.display = qtd ? "" : "none";
  var nl = box.querySelector(".fx-limpar"); if (nl) nl.style.display = Object.keys(f).length ? "" : "none";
};
function pilula(rot, texto, aoRemover) {
  return L.h("span", { class: "pilula" }, L.h("b", { text: rot }), L.h("span", { text: texto, title: texto }),
    L.h("button", { type: "button", title: "Remover", html: L.ic("x"), onclick: aoRemover }));
}

/* descrição dos filtros, para o Excel e para os títulos */
L.descricaoFiltros = function () {
  var f = L.estado.filtros, out = [];
  out.push(["Equipe", L.equipesFiltro() ? L.equipesFiltro().map(function (c) { return L.equipeDeCod(c).nome; }).join(", ") : "Todas"]);
  if ((f.sup || []).length) out.push(["Supervisor", f.sup.map(function (s) { return L.nomeSup(s); }).join(", ")]);
  if ((f.rca || []).length) out.push(["RCA", f.rca.map(function (u) { return u + " " + L.nomeRca(u); }).join(", ")]);
  if ((f.forn || []).length) out.push(["Fornecedor", f.forn.map(function (x) { return x + " " + L.nomeForn(x); }).join(", ")]);
  out.push(["Anos", (L.estado.anos || []).join(", ")]);
  out.push(["Mês", "comercial (semanas de sábado a sexta)"]);
  return out;
};

})();
