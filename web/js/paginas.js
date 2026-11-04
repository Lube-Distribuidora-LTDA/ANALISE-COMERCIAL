/* =============================================================================
 * paginas.js — as telas:
 *   Indicadores (como a planilha): Faturamento · Positivação · Mix (SKUs) · Margem
 *       o recorte da tela num bloco grande com o gráfico, e embaixo um bloco por "filho"
 *       (equipe → supervisores; supervisor → RCAs). Clicar no nome desce um nível; clicar num
 *       mês abre o mês pelos filhos.
 *   Abertura: Por RCA · Por fornecedor · Produtos do fornecedor
 *   Crescimento: o ranking (quem mais cresceu e quem mais caiu)
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ comum ------------------------------ */
function anos() {
  var a = (L.estado.anos || []).filter(function (x) { return L.ANOS.indexOf(x) >= 0; });
  if (!a.length) a = [L.ANO_ATUAL - 1, L.ANO_ATUAL].filter(function (x) { return L.ANOS.indexOf(x) >= 0; });
  return a.sort();
}
L.anosTela = anos;
function fornSel() { var f = L.estado.filtros.forn || []; return f.length ? new Set(f) : null; }
function ultAno() { var a = anos(); return a[a.length - 1]; }

/* acumulador de um escopo, com o filtro de fornecedor quando houver (Promise) */
function accDe(esc) {
  var fs = fornSel();
  if (!fs) return Promise.resolve(L.somarEscopo(esc));
  if (!esc.porRca) {
    var mapa = L.somarFornecedores(esc, fs), lista = Array.from(mapa.values());
    var a = lista.length === 1 ? lista[0] : L.somarAcumuladores(lista);
    if (!lista.length) { a = L.acumulador(); a.temMeta = false; }
    return Promise.resolve(a);
  }
  return L.consultar({ tipo: "rcas", forns: Array.from(fs), rcas: esc.rcas }).then(function (j) {
    var a = L.somarAcumuladores(Array.from(L.acumularConsulta(j, "u").values()));
    a.temMeta = false; a.aprox = esc.rcas.length > 1;
    return a;
  });
}
L.accDe = accDe;

/* a soma do ano mais recente (para ordenar e para "tem dado") */
function totalAno(a, ind) {
  var R = L.contasBloco(a, ind, anos());
  var v = R.anoVal(R.ult, false);
  return v == null ? 0 : v;
}
function temDado(a) {
  var an = anos();
  for (var j = 0; j < an.length; j++) for (var mo = 1; mo <= 12; mo++) {
    var m = L.im(an[j] * 100 + mo); if (m >= 0 && m < L.NM && (a.v[m] || a.d[m])) return true;
  }
  return false;
}

/* os filhos de um escopo: o próximo nível da hierarquia */
function filhosDe(esc) {
  var out = [];
  if (esc.tipo === "total") {
    L.EQUIPES.forEach(function (e) { out.push({ esc: L.escopoEquipe(e.cod), tipo: "equipe", eq: e }); });
  } else if (esc.tipo === "equipes") {
    L.equipesFiltro().forEach(function (c) { out.push({ esc: L.escopoEquipe(c), tipo: "equipe", eq: L.equipeDeCod(c) }); });
  } else if (esc.tipo === "equipe") {
    var temTele = L.supsOrdenados().some(function (s) { return s.eq === esc.eq && s.tele; });
    if (temTele) out.push({ esc: L.escopoEquipe(esc.eq, true), tipo: "semtele" });
    L.supsOrdenados().forEach(function (s) { if (esc.sups.has(s.cod)) out.push({ esc: L.escopoSup(s.cod), tipo: "sup", sup: s }); });
  } else if (esc.tipo === "sup") {
    var ss = L.estado.filtros.sup || [];
    if (ss.length > 1) ss.forEach(function (c) { out.push({ esc: L.escopoSup(c), tipo: "sup", sup: L.SUP.get(c) }); });
    else rcasOrdenados(esc.rcas).forEach(function (u) { out.push({ esc: L.escopoRca(u), tipo: "rca", u: u }); });
  } else if (esc.tipo === "rcas") {
    rcasOrdenados(esc.rcas).forEach(function (u) { out.push({ esc: L.escopoRca(u), tipo: "rca", u: u }); });
  }
  return out;
}
function rcasOrdenados(rcas) {
  var tot = new Map();
  rcas.forEach(function (u) { tot.set(u, totalAno(L.somarEscopo(L.escopoRca(u)), "fat")); });
  return rcas.slice().sort(function (a, b) { return tot.get(b) - tot.get(a) || a - b; });
}
function rotFilhos(esc) {
  return esc.tipo === "total" || esc.tipo === "equipes" ? "equipe" : esc.tipo === "equipe" ? "supervisor"
    : esc.tipo === "sup" && (L.estado.filtros.sup || []).length > 1 ? "supervisor" : esc.tipo === "rca" ? "fornecedor" : "RCA";
}
function subDoFilho(f) {
  if (f.tipo === "sup") { var n = f.esc.rcas.length; return f.sup.nome + " · " + n + " RCA" + (n === 1 ? "" : "s"); }
  if (f.tipo === "rca") {
    var r = L.RCA.get(f.u) || {};
    return "RCA " + f.u + " · " + L.nomeSup(r.sup) + (r.termino ? " · desligado em " + L.fData(r.termino) : "") + (r.ajuste ? " · contado em Televendas" : "");
  }
  if (f.tipo === "semtele") return "a equipe sem Televendas, como na planilha";
  if (f.tipo === "equipe") return f.eq.cod === "OUTROS" ? "operação interna, Televendas sem equipe e supervisores inativos" : "";
  return "";
}
function abrirFilho(f) {
  if (f.tipo === "equipe") { L.estado.filtros.sup = []; L.estado.filtros.rca = []; L.setFiltro("eq", [f.eq.id]); }
  else if (f.tipo === "sup") { delete L.estado.filtros.rca; L.setFiltro("sup", [f.sup.cod]); }
  else if (f.tipo === "rca") L.setFiltro("rca", [f.u]);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* o mês aberto pelos filhos de um escopo (painel lateral) */
function abrirMesDe(esc, ind, mo) {
  var tipoF = rotFilhos(esc);
  if (esc.tipo === "rca") {
    // RCA: o mês pelos fornecedores dele (consulta na hora)
    return L.abrirMes({ ind: ind, anos: anos(), mo: mo, escopoNome: esc.nome, filhosRot: "fornecedor", filhosRotSing: "Fornecedor",
      filhos: function () {
        return L.consultar({ tipo: "fornecedores", rcas: esc.rcas }).then(function (j) {
          var m = L.acumularConsulta(j, "f"), fs = fornSel(), out = [];
          m.forEach(function (a, f) { if (fs && !fs.has(f)) return; out.push({ nome: L.titulo(L.nomeForn(f)), sub: "Fornecedor " + f, acc: a,
            aoAbrir: function () { L.setFiltro("forn", [f]); L.irPara("prod"); } }); });
          return out;
        });
      } });
  }
  // o "sem televendas" é uma soma de supervisores: no mês aberto ficam só os supervisores
  var filhos = filhosDe(esc).filter(function (f) { return f.tipo !== "semtele"; });
  return L.abrirMes({ ind: ind, anos: anos(), mo: mo, escopoNome: esc.nome, filhosRot: tipoF, filhosRotSing: tipoF.charAt(0).toUpperCase() + tipoF.slice(1),
    filhos: function () {
      return Promise.all(filhos.map(function (f) { return accDe(f.esc); })).then(function (accs) {
        return filhos.map(function (f, i) { return { nome: f.esc.nome, sub: subDoFilho(f), acc: accs[i], aoAbrir: f.tipo === "semtele" ? null : function () { abrirFilho(f); } }; });
      });
    } });
}

/* barra da tela: indicador, mês a mês, Excel */
function barra(cfg) {
  var b = L.h("div", { class: "barra-tela" });
  if (cfg.inds) {
    var seg = L.h("div", { class: "seg seg-ind" });
    cfg.inds.forEach(function (k) {
      seg.appendChild(L.h("button", { type: "button", class: L.estado.ind === k ? "on" : "", html: L.ic(L.IND[k].icone) + "<span>" + L.esc(L.IND[k].rot) + "</span>",
        onclick: function () { L.estado.ind = k; L.sincronizarHash(); L.emitir("filtros"); } }));
    });
    b.appendChild(seg);
  }
  if (cfg.busca) b.appendChild(cfg.busca);
  b.appendChild(L.h("span", { class: "barra-esp" }));
  if (cfg.mesAMes !== false) {
    b.appendChild(L.h("label", { class: "chk", title: "Linha \"Cresc. mês a mês\" em cada bloco (como na aba FAT 25X26 (2) da planilha)" },
      L.h("input", { type: "checkbox", checked: L.estado.mesAMes ? true : null, onchange: function (ev) { L.estado.mesAMes = ev.target.checked; L.sincronizarHash(); L.emitir("filtros"); } }),
      L.h("span", { text: "Mês a mês" })));
  }
  if (cfg.excel) b.appendChild(L.btnPainel("baixar", "Excel", cfg.excel, "Baixar esta tela em Excel, no formato da planilha"));
  return b;
}
function avisoFiltroForn() {
  var fs = L.estado.filtros.forn || [];
  if (!fs.length) return null;
  return L.h("div", { class: "aviso-faixa", html: L.ic("filtro") + "<span>Só a venda de <b>" + L.esc(fs.map(function (f) { return L.titulo(L.nomeForn(f)); }).join(", ")) + "</b> (filtro de fornecedor). Sem meta: a meta do WinThor é por RCA, não por fornecedor.</span>" });
}
function avisoCalendario() {
  var an = anos(), ded = L.CAL.filter(function (c) { return an.indexOf(c.ano) >= 0 && c.origem === "deduzido"; });
  if (!ded.length) return null;
  return L.nota("Os meses comerciais de " + ded[0].ano + " foram deduzidos do dado (semanas de sábado a sexta que mais batem com a planilha): a conferir com o comercial.");
}
function esperaEm(box, texto) { L.limpar(box).appendChild(L.espera(texto)); }

/* ------------------------------ telas de indicador (como a planilha) ------------------------------ */
function telaIndicador(ind) {
  return function (raiz) {
    var esc = L.escopoDaTela(), I = L.IND[ind], an = anos();
    var blocos = [];
    raiz.appendChild(barra({ excel: function () { L.exportarBlocos(I.rot + " — " + esc.nome, blocos, ind); } }));
    var av = avisoFiltroForn(); if (av) raiz.appendChild(av);
    var topo = L.h("div"), lista = L.h("div");
    raiz.appendChild(topo); raiz.appendChild(lista);
    esperaEm(topo, "Somando " + esc.nome + "…");
    var filhos = filhosDe(esc);
    Promise.all([accDe(esc)].concat(filhos.map(function (f) { return accDe(f.esc); }))).then(function (accs) {
      var a = accs[0];
      L.limpar(topo);
      var titG = (ind === "fat" ? "FATURAMENTO " : I.rot.toUpperCase() + " ") + esc.nome;
      topo.appendChild(L.painel({ titulo: titG, sub: an.join(" × ") + (ind === "fat" ? " · com a meta do WinThor" : "") + " · mês comercial",
        corpo: L.graficoMensal({ acc: a, ind: ind, anos: an, aoClicarMes: function (mo) { abrirMesDe(esc, ind, mo); } }) }));
      var b0 = L.bloco({ titulo: esc.nome, sub: descricaoEscopo(esc), acc: a, ind: ind, anos: an, principal: true, mesAMes: L.estado.mesAMes,
        aoClicarMes: function (mo) { abrirMesDe(esc, ind, mo); }, filhosRot: rotFilhos(esc) });
      topo.appendChild(b0); blocos.push({ titulo: esc.nome, el: b0 });
      var vistos = 0;
      filhos.forEach(function (f, i) {
        var af = accs[i + 1];
        if (!temDado(af)) return;
        vistos++;
        var b = L.bloco({ titulo: f.esc.nome, sub: subDoFilho(f), acc: af, ind: ind, anos: an, mesAMes: L.estado.mesAMes, compacto: f.tipo === "rca",
          aoClicarTitulo: f.tipo === "semtele" ? null : function () { abrirFilho(f); },
          dicaTitulo: f.tipo === "equipe" ? "Abrir a equipe pelos supervisores" : f.tipo === "sup" ? "Abrir o supervisor pelos RCAs" : "Abrir só este RCA",
          aviso: f.tipo === "rca" && L.RCA.get(f.u) && L.RCA.get(f.u).ajuste ? "No WinThor é de " + L.nomeSup(L.RCA.get(f.u).supW) + "; contado em Televendas como na planilha" : null,
          aoClicarMes: function (mo) { abrirMesDe(f.esc, ind, mo); }, filhosRot: rotFilhos(f.esc) });
        lista.appendChild(b); blocos.push({ titulo: f.esc.nome, el: b });
      });
      if (filhos.length && !vistos) lista.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nenhum " + rotFilhos(esc) + " com venda nos anos escolhidos." }));
      if (filhos.length) lista.insertBefore(L.secao(filhos[0].tipo === "rca" ? "Por RCA" : filhos.some(function (f) { return f.tipo === "sup"; }) ? "Por supervisor" : "Por equipe"), lista.firstChild);
      var nc = avisoCalendario(); if (nc) lista.appendChild(nc);
      L.executarFila();
    }).catch(function (e) { console.error(e); L.limpar(topo).appendChild(L.erroTela("Não foi possível somar", e.message || String(e))); });
  };
}
function descricaoEscopo(esc) {
  if (esc.tipo === "equipe") { var n = esc.sups ? esc.sups.size : 0; return "Equipe " + esc.eq + " · " + n + " supervisores"; }
  if (esc.tipo === "total") return "ES + RJ + BA + outros";
  if (esc.tipo === "sup") return (L.estado.filtros.sup || []).length > 1 ? "supervisores escolhidos no filtro" : (L.SUP.get(+esc.grupo.slice(2)) || {}).nome + " · " + esc.rcas.length + " RCAs";
  if (esc.tipo === "rca") { var r = L.RCA.get(esc.rcaUnico) || {}; return "RCA " + esc.rcaUnico + " · " + L.nomeSup(r.sup); }
  return "";
}

[["fat", "Faturamento", "Faturamento (Sell Out)", "dinheiro"], ["posit", "Positivação", "Positivação (clientes)", "pessoas"],
 ["mix", "Mix (SKUs)", "Mix (SKUs vendidos)", "caixa"], ["margem", "Margem", "Margem", "percent"]].forEach(function (p) {
  L.registrarPagina({ id: p[0], grupo: "Indicadores (planilha)", menu: p[1], titulo: p[2], olho: "Mês comercial · ano contra ano", icone: p[3], render: telaIndicador(p[0]) });
});

/* ------------------------------ Por RCA ------------------------------ */
L.registrarPagina({ id: "rca", grupo: "Abertura", menu: "Por RCA", titulo: "Por RCA", olho: "Cada vendedor, ano contra ano", icone: "pessoas",
  render: function (raiz) {
    var ind = L.estado.ind || "fat", esc = L.escopoDaTela(), an = anos(), blocos = [];
    var busca = campoBusca("Buscar RCA por nome ou código…");
    raiz.appendChild(barra({ inds: ["fat", "posit", "mix", "margem"], busca: busca.el, excel: function () { L.exportarBlocos("Por RCA — " + esc.nome, blocos, ind); } }));
    var av = avisoFiltroForn(); if (av) raiz.appendChild(av);
    var lista = L.h("div"); raiz.appendChild(lista);
    esperaEm(lista, "Somando os RCAs…");
    var fs = fornSel();
    var prom = fs ? L.consultar({ tipo: "rcas", forns: Array.from(fs), rcas: esc.rcas }).then(function (j) { return L.acumularConsulta(j, "u"); })
                  : Promise.resolve(null);
    prom.then(function (mapaForn) {
      var itens = esc.rcas.map(function (u) {
        var a = mapaForn ? mapaForn.get(u) : L.somarEscopo(L.escopoRca(u));
        return a && temDado(a) ? { u: u, a: a, total: totalAno(a, "fat"), r: L.RCA.get(u) || {} } : null;
      }).filter(Boolean);
      L.limpar(lista);
      if (!itens.length) { lista.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nenhum RCA com venda nos anos escolhidos." })); return; }
      // agrupados por supervisor, na ordem da planilha; dentro, do que mais vendeu no ano
      var porSup = new Map();
      itens.forEach(function (x) { var s = x.r.sup || 0; if (!porSup.has(s)) porSup.set(s, []); porSup.get(s).push(x); });
      var sups = Array.from(porSup.keys()).sort(function (a, b) { var A = L.SUP.get(a) || { ordem: 999 }, B = L.SUP.get(b) || { ordem: 999 }; return A.ordem - B.ordem || a - b; });
      sups.forEach(function (s) {
        var grupo = porSup.get(s).sort(function (a, b) { return b.total - a.total; });
        var sec = L.h("div", { class: "grupo-rca" }, L.secao(L.nomeSup(s) + " · " + grupo.length + " RCA" + (grupo.length === 1 ? "" : "s")));
        grupo.forEach(function (x) {
          var b = L.bloco({ titulo: L.nomeRca(x.u), sub: "RCA " + x.u + (x.r.termino ? " · desligado em " + L.fData(x.r.termino) : "") + (x.r.bloqueio === "S" ? " · bloqueado" : ""),
            acc: x.a, ind: ind, anos: an, compacto: true, mesAMes: L.estado.mesAMes,
            aviso: x.r.ajuste ? "No WinThor é de " + L.nomeSup(x.r.supW) + "; contado em Televendas como na planilha" : null,
            aoClicarTitulo: function () { L.setFiltro("rca", [x.u]); L.irPara("forn"); }, dicaTitulo: "Abrir os fornecedores deste RCA",
            aoClicarMes: function (mo) { abrirMesDe(L.escopoRca(x.u), ind, mo); }, filhosRot: "fornecedor" });
          b.dataset.busca = L.norm(x.u + " " + (x.r.nome || ""));
          sec.appendChild(b); blocos.push({ titulo: L.nomeRca(x.u) + " (" + x.u + ")", el: b });
        });
        lista.appendChild(sec);
      });
      busca.ligar(lista);
    }).catch(function (e) { L.limpar(lista).appendChild(L.erroTela("Não foi possível somar os RCAs", e.message || String(e))); });
  } });

/* ------------------------------ Por fornecedor ------------------------------ */
L.registrarPagina({ id: "forn", grupo: "Abertura", menu: "Por fornecedor", titulo: "Por fornecedor", olho: "Quem cresce e quem cai, ano contra ano", icone: "caixa",
  render: function (raiz) {
    var ind = L.estado.ind || "fat", esc = L.escopoDaTela(), an = anos(), blocos = [];
    var busca = campoBusca("Buscar fornecedor por nome ou código…");
    raiz.appendChild(barra({ inds: ["fat", "posit", "mix", "margem"], busca: busca.el, excel: function () { L.exportarBlocos("Por fornecedor — " + esc.nome, blocos, ind); } }));
    var lista = L.h("div"); raiz.appendChild(lista);
    esperaEm(lista, "Somando os fornecedores…");
    var fs = fornSel();
    var prom = esc.porRca ? L.consultar({ tipo: "fornecedores", rcas: esc.rcas }).then(function (j) { return L.acumularConsulta(j, "f"); })
                          : Promise.resolve(L.somarFornecedores(esc, fs));
    prom.then(function (mapa) {
      var itens = [];
      mapa.forEach(function (a, f) { if (fs && !fs.has(f)) return; if (temDado(a)) itens.push({ f: f, a: a, total: totalAno(a, "fat") }); });
      itens.sort(function (a, b) { return b.total - a.total; });
      L.limpar(lista);
      if (!itens.length) { lista.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nenhum fornecedor com venda neste recorte." })); return; }
      var totalGeral = itens.reduce(function (s, x) { return s + Math.max(0, x.total); }, 0);
      lista.appendChild(L.secao(itens.length + " fornecedores · " + esc.nome + (esc.porRca ? "" : "") ));
      var cont = L.h("div"); lista.appendChild(cont);
      var mostrados = 0, PASSO = 25, mais = L.h("button", { class: "btn mostrar-mais", type: "button" });
      function mostrar(n) {
        itens.slice(mostrados, mostrados + n).forEach(function (x, i) {
          var pos = mostrados + i + 1;
          var b = L.bloco({ titulo: L.titulo(L.nomeForn(x.f)), sub: "#" + pos + " · fornecedor " + x.f + (totalGeral ? " · " + L.fNum(Math.max(0, x.total) / totalGeral * 100, 1) + "% do sell out " + ultAno() : ""),
            acc: x.a, ind: ind, anos: an, compacto: true, mesAMes: L.estado.mesAMes,
            aoClicarTitulo: function () { L.setFiltro("forn", [x.f]); L.irPara("prod"); }, dicaTitulo: "Abrir os produtos deste fornecedor" });
          b.dataset.busca = L.norm(x.f + " " + L.nomeForn(x.f));
          cont.appendChild(b); blocos.push({ titulo: L.nomeForn(x.f) + " (" + x.f + ")", el: b });
        });
        mostrados = Math.min(itens.length, mostrados + n);
        mais.textContent = mostrados < itens.length ? "Mostrar mais " + Math.min(PASSO, itens.length - mostrados) + " (de " + (itens.length - mostrados) + " que faltam)" : "";
        mais.style.display = mostrados < itens.length ? "" : "none";
        busca.aplicar();
      }
      mais.onclick = function () { mostrar(PASSO); };
      lista.appendChild(mais);
      busca.ligar(cont, function () { if (mostrados < itens.length) mostrar(itens.length); });
      mostrar(PASSO);
      if (esc.porRca && !fs) lista.appendChild(L.nota("Fornecedores dos RCAs escolhidos, lidos na hora (positivação e mix exatos do grupo de RCAs)."));
    }).catch(function (e) { L.limpar(lista).appendChild(L.erroTela("Não foi possível somar os fornecedores", e.message || String(e))); });
  } });

/* ------------------------------ Produtos do fornecedor ------------------------------ */
L.registrarPagina({ id: "prod", grupo: "Abertura", menu: "Produtos do fornecedor", titulo: "Produtos do fornecedor", olho: "Cada produto, ano contra ano", icone: "etiqueta",
  render: function (raiz) {
    var fsel = L.estado.filtros.forn || [], esc = L.escopoDaTela(), an = anos();
    var ind = L.estado.indProd || "fat";
    if (fsel.length !== 1) {
      raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Escolha um fornecedor</b>" + (fsel.length > 1 ? "O filtro tem " + fsel.length + " fornecedores: deixe um só para ver os produtos dele." : "Use o filtro Fornecedor, lá em cima, ou clique num fornecedor na tela Por fornecedor.") },
        L.h("div", { style: { marginTop: "14px" } }, L.h("button", { class: "btn pri", type: "button", text: "Ir para Por fornecedor", onclick: function () { L.irPara("forn"); } }))));
      return;
    }
    var forn = fsel[0], blocos = [];
    var busca = campoBusca("Buscar produto por nome ou código…");
    var b = barra({ busca: busca.el, excel: function () { L.exportarBlocos("Produtos de " + L.nomeForn(forn), blocos, ind); } });
    var seg = L.h("div", { class: "seg seg-ind" });
    ["fat", "qt", "posit", "margem"].forEach(function (k) {
      seg.appendChild(L.h("button", { type: "button", class: ind === k ? "on" : "", html: L.ic(L.IND[k].icone) + "<span>" + L.esc(L.IND[k].rot) + "</span>",
        onclick: function () { L.estado.indProd = k; L.sincronizarHash(); L.emitir("filtros"); } }));
    });
    b.insertBefore(seg, b.firstChild);
    raiz.appendChild(b);
    var lista = L.h("div"); raiz.appendChild(lista);
    esperaEm(lista, "Lendo os produtos de " + L.titulo(L.nomeForn(forn)) + "…");
    var rcas = esc.tipo === "total" ? null : esc.rcas;
    L.consultar({ tipo: "produtos", forn: forn, rcas: rcas }).then(function (j) {
      var mapa = L.acumularConsulta(j, "p"), nomes = new Map();
      (j.prod || []).forEach(function (p) { nomes.set(p[0], { nome: p[1], emb: p[2], un: p[3], obs2: p[4], exc: p[5] }); });
      var itens = [];
      mapa.forEach(function (a, p) { if (temDado(a)) itens.push({ p: p, a: a, total: totalAno(a, "fat"), info: nomes.get(p) || {} }); });
      itens.sort(function (a, b) { return b.total - a.total; });
      L.limpar(lista);
      // o fornecedor inteiro no recorte, em cima
      var tot = L.somarAcumuladores(itens.map(function (x) { return x.a; }));
      tot.aprox = false;
      var indTot = ind === "posit" ? "fat" : ind;
      lista.appendChild(L.painel({ titulo: L.titulo(L.nomeForn(forn)) + " · " + esc.nome, sub: "fornecedor " + forn + " · " + itens.length + " produtos com venda · " + an.join(" × "),
        corpo: L.graficoMensal({ acc: tot, ind: indTot, anos: an }) }));
      var b0 = L.bloco({ titulo: L.titulo(L.nomeForn(forn)), sub: "todos os produtos" + (ind === "posit" ? " (faturamento: a positivação do fornecedor está na tela Por fornecedor)" : ""), acc: tot, ind: indTot, anos: an, principal: true, mesAMes: L.estado.mesAMes });
      lista.appendChild(b0); blocos.push({ titulo: L.nomeForn(forn), el: b0 });
      if (!itens.length) { lista.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nenhum produto deste fornecedor vendido no recorte." })); L.executarFila(); return; }
      lista.appendChild(L.secao("Por produto"));
      var cont = L.h("div"); lista.appendChild(cont);
      var mostrados = 0, PASSO = 30, mais = L.h("button", { class: "btn mostrar-mais", type: "button" });
      function mostrar(n) {
        itens.slice(mostrados, mostrados + n).forEach(function (x, i) {
          var inf = x.info, pos = mostrados + i + 1;
          var bl = L.bloco({ titulo: (inf.nome || "PRODUTO " + x.p), sub: "#" + pos + " · código " + x.p + (inf.emb ? " · " + inf.emb : "") + (inf.obs2 === "FL" ? " · fora de linha" : "") + (inf.exc ? " · excluído" : ""),
            acc: x.a, ind: ind, anos: an, compacto: true, mesAMes: L.estado.mesAMes });
          bl.dataset.busca = L.norm(x.p + " " + (inf.nome || ""));
          cont.appendChild(bl); blocos.push({ titulo: (inf.nome || x.p) + " (" + x.p + ")", el: bl });
        });
        mostrados = Math.min(itens.length, mostrados + n);
        mais.textContent = mostrados < itens.length ? "Mostrar mais " + Math.min(PASSO, itens.length - mostrados) + " (de " + (itens.length - mostrados) + " que faltam)" : "";
        mais.style.display = mostrados < itens.length ? "" : "none";
        busca.aplicar();
      }
      mais.onclick = function () { mostrar(PASSO); };
      lista.appendChild(mais);
      busca.ligar(cont, function () { if (mostrados < itens.length) mostrar(itens.length); });
      mostrar(PASSO);
      L.executarFila();
    }).catch(function (e) { L.limpar(lista).appendChild(L.erroTela("Não foi possível ler os produtos", e.message || String(e))); });
  } });

/* ------------------------------ Crescimento (ranking) ------------------------------ */
L.registrarPagina({ id: "cresc", grupo: "Visão ampla", menu: "Crescimento", titulo: "Crescimento", olho: "Quem mais cresceu e quem mais caiu", icone: "tendencia",
  render: function (raiz) {
    var ind = L.estado.ind || "fat", dimR = L.estado.dimCresc || "sup", esc = L.escopoDaTela(), an = anos(), ult = an[an.length - 1];
    var base = an.length > 1 ? an[an.length - 2] : null;
    var b = barra({ inds: ["fat", "posit", "mix", "margem"], mesAMes: false });
    var seg = L.h("div", { class: "seg" });
    [["eq", "Equipes"], ["sup", "Supervisores"], ["rca", "RCAs"], ["forn", "Fornecedores"]].forEach(function (d) {
      seg.appendChild(L.h("button", { type: "button", class: dimR === d[0] ? "on" : "", text: d[1], onclick: function () { L.estado.dimCresc = d[0]; L.sincronizarHash(); L.emitir("filtros"); } }));
    });
    b.insertBefore(seg, b.firstChild);
    raiz.appendChild(b);
    if (!base) { raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Escolha dois anos</b>O crescimento compara o ano mais recente com o anterior: marque dois anos no filtro Anos." })); return; }
    var box = L.h("div"); raiz.appendChild(box);
    esperaEm(box, "Comparando…");
    var I = L.IND[ind];
    var fontes;
    if (dimR === "forn") {
      fontes = (esc.porRca ? L.consultar({ tipo: "fornecedores", rcas: esc.rcas }).then(function (j) { return L.acumularConsulta(j, "f"); }) : Promise.resolve(L.somarFornecedores(esc, fornSel())))
        .then(function (m) { var out = []; m.forEach(function (a, f) { out.push({ cod: f, nome: L.titulo(L.nomeForn(f)), sub: "Fornecedor " + f, acc: a, abrir: function () { L.setFiltro("forn", [f]); L.irPara("prod"); } }); }); return out; });
    } else {
      var lista = [];
      if (dimR === "eq") L.EQUIPES.forEach(function (e) { lista.push({ cod: e.id, nome: e.nome, sub: "", esc: L.escopoEquipe(e.cod), abrir: function () { L.estado.filtros = {}; L.setFiltro("eq", [e.id]); L.irPara(ind); } }); });
      else if (dimR === "sup") L.supsOrdenados().forEach(function (s) { if (!esc.sups || esc.sups.has(s.cod)) lista.push({ cod: s.cod, nome: s.rot, sub: s.nome, esc: L.escopoSup(s.cod), abrir: function () { delete L.estado.filtros.rca; L.setFiltro("sup", [s.cod]); L.irPara(ind); } }); });
      else esc.rcas.forEach(function (u) { var r = L.RCA.get(u) || {}; lista.push({ cod: u, nome: L.nomeRca(u), sub: u + " · " + L.nomeSup(r.sup), esc: L.escopoRca(u), abrir: function () { L.setFiltro("rca", [u]); L.irPara(ind); } }); });
      fontes = Promise.all(lista.map(function (x) { return accDe(x.esc); })).then(function (accs) { lista.forEach(function (x, i) { x.acc = accs[i]; }); return lista; });
    }
    fontes.then(function (lista) {
      var linhas = lista.map(function (x) {
        var R = L.contasBloco(x.acc, ind, an);
        var vU = R.anoVal(ult, true), vB = R.anoVal(base, true), vMostra = R.anoVal(ult, false);
        var cr = ind === "margem" ? (vU != null && vB != null ? vU - vB : null) : (vB > 0 && vU != null ? vU / vB - 1 : null);
        return { nome: x.nome, sub: x.sub, cod: x.cod, vB: vB, vU: vU, dif: vU != null && vB != null ? vU - vB : null, cr: cr,
                 meta: R.metaAno ? vMostra / R.metaAno : null, abrir: x.abrir };
      }).filter(function (l) { return (l.vU || 0) !== 0 || (l.vB || 0) !== 0; });
      L.limpar(box);
      var rotAno = R0rot(ult, base);
      var colunas = [
        { id: "nome", titulo: { eq: "Equipe", sup: "Supervisor", rca: "RCA", forn: "Fornecedor" }[dimR], tipo: "texto", valor: function (r) { return r.nome; }, titleTd: function (r) { return r.nome + " · " + r.sub; } },
        { id: "vB", titulo: rotAno.base, tipo: I.tipo === "moeda" ? "moeda" : "num", somar: I.soma, valor: function (r) { return r.vB; }, fmt: function (v) { return L.fmtIndLongo(ind, v); } },
        { id: "vU", titulo: rotAno.ult, tipo: I.tipo === "moeda" ? "moeda" : "num", somar: I.soma, barra: true, valor: function (r) { return r.vU; }, fmt: function (v) { return L.fmtIndLongo(ind, v); } },
        { id: "dif", titulo: ind === "margem" ? "Diferença (p.p.)" : "Diferença", tipo: I.tipo === "moeda" ? "moeda" : "num", somar: I.soma, valor: function (r) { return r.dif; },
          fmt: function (v) { return v == null ? "—" : ind === "margem" ? (v > 0 ? "+" : "") + L.fNum(v, 1) : (v > 0 ? "+" : "") + L.fmtIndLongo(ind, v); }, classe: function (v) { return v != null && v < 0 ? "neg" : ""; } },
        { id: "cr", titulo: ind === "margem" ? "Variação" : "Crescimento", tipo: "pct", somar: false, valor: function (r) { return ind === "margem" ? (r.cr == null ? null : r.cr / 100) : r.cr; },
          fmt: function (v) { return v == null ? "—" : ind === "margem" ? (v > 0 ? "+" : "") + L.fNum(v * 100, 1) + " p.p." : L.fDelta(v, 1); }, classe: function (v) { return v != null && v < 0 ? "neg" : "pos"; } },
      ];
      if (ind === "fat" && dimR !== "forn") colunas.push({ id: "meta", titulo: "% da meta " + ult, tipo: "pct", somar: false, valor: function (r) { return r.meta; }, fmt: function (v) { return v == null ? "—" : L.fPct(v, 1); } });
      box.appendChild(L.painel({ titulo: "Crescimento · " + { eq: "equipes", sup: "supervisores", rca: "RCAs", forn: "fornecedores" }[dimR] + " · " + esc.nome,
        sub: I.rot + ": " + rotAno.explica, semPad: true,
        corpo: L.tabela({ titulo: "Crescimento " + I.rot + " " + base + " × " + ult, arquivo: "analise-comercial-crescimento", aba: "Crescimento",
          linhas: linhas, rank: true, ordem: { id: "cr", desc: true }, porPagina: 50,
          buscaTexto: function (r) { return r.nome + " " + r.sub; }, buscaDica: "Buscar…",
          colunas: colunas, aoClicar: function (r) { if (r.abrir) r.abrir(); },
          vazio: "Nada para comparar neste recorte." }) }));
      box.appendChild(L.nota("Clique numa linha para abrir. Ordenado por crescimento; clique no cabeçalho para ordenar por outra coluna."));
    }).catch(function (e) { L.limpar(box).appendChild(L.erroTela("Não foi possível comparar", e.message || String(e))); });
  } });
function R0rot(ult, base) {
  var temAtual = ult === L.ANO_ATUAL;
  if (!temAtual) return { base: "Ano " + base, ult: "Ano " + ult, explica: "o ano inteiro de " + ult + " contra o de " + base };
  // os dois anos no mesmo ponto: os meses fechados + o mesmo trecho do mês atual (até ontem)
  var ate = L.ateOntem(), cb = L.CALK.get(base * 100 + L.MOA);
  var ateBase = cb ? new Date(Date.parse(cb.inicio) + Math.max(0, L.ORDEM_CORTE) * 864e5).toISOString().slice(0, 10) : null;
  return { base: base + " até " + L.fDiaMes(ateBase), ult: ult + " até " + L.fDiaMes(ate),
           explica: "de janeiro até ontem (" + L.fData(ate) + ") em " + ult + " contra o mesmo ponto de " + base + " (até " + L.fData(ateBase) + "): os meses comerciais fechados e o mesmo número de dias do mês atual" };
}

/* ------------------------------ busca dentro da lista de blocos ------------------------------ */
function campoBusca(dica) {
  var inp = L.h("input", { type: "search", placeholder: dica, autocomplete: "off", spellcheck: "false" });
  var el = L.h("label", { class: "tb-busca busca-blocos" }, L.icEl("busca"), inp);
  var alvo = null, aoBuscar = null;
  function aplicar() {
    if (!alvo) return;
    var q = L.norm(inp.value).split(/\s+/).filter(Boolean);
    alvo.querySelectorAll(".bloco").forEach(function (b) { var n = b.dataset.busca || ""; b.style.display = !q.length || q.every(function (t) { return n.indexOf(t) >= 0; }) ? "" : "none"; });
    alvo.querySelectorAll(".grupo-rca").forEach(function (g) { g.style.display = [].some.call(g.querySelectorAll(".bloco"), function (b) { return b.style.display !== "none"; }) ? "" : "none"; });
  }
  inp.addEventListener("input", L.debounce(function () { if (inp.value && aoBuscar) aoBuscar(); aplicar(); }, 120));
  return { el: el, ligar: function (box, fn) { alvo = box; aoBuscar = fn || null; aplicar(); }, aplicar: aplicar };
}

})();
