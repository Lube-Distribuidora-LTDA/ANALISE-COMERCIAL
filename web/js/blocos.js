/* =============================================================================
 * blocos.js — o bloco no formato da planilha do gestor (ACOMP INDICADORES ANO):
 *
 *   INDICADORES   | Jan | Fev | … | Dez | ANO 2026 | Média/Ano
 *   Sell Out 2025 | …                                  (um por ano escolhido)
 *   Sell Out 2026 | …                    (melhor mês em destaque, como o amarelo da planilha)
 *   META 2026     | …                    (só faturamento: a meta do WinThor)
 *   2025 Vs 2026  | %                    (vermelho quando cai)
 *   Meta Vs 2026  | %
 *   Meta x 2025   | %
 *
 * O mês comercial em andamento entra com o valor de hoje (marcado com *), mas a comparação dele é
 * com o MESMO trecho do mês nos outros anos (até ontem): as semanas começam todas no sábado, então
 * o dia N cai no mesmo dia da semana. O ANO, quando o ano atual está na tela, é o acumulado até o
 * mesmo ponto em todos os anos (como a planilha, que soma 2025 só até o mês que 2026 já tem).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ as contas de um bloco ------------------------------ */
/* a: acumulador (dados.js); ind: fat|posit|mix|margem|qt; anos: [2025, 2026] (crescente) */
L.contasBloco = function (a, ind, anos, opc) {
  opc = opc || {};
  var I = L.IND[ind], atual = L.ANO_ATUAL, moa = L.MOA;
  var temAtual = anos.indexOf(atual) >= 0;
  var ult = anos[anos.length - 1];
  var lim = temAtual ? moa : 12;                       // meses que entram no ANO
  function idx(ano, mo) { return L.im(ano * 100 + mo); }
  function futuro(ano, mo) { return ano > atual || (ano === atual && mo > moa); }
  function parcial(ano, mo) { return ano === atual && mo === moa; }
  // valor mostrado na célula
  function cel(ano, mo) {
    if (futuro(ano, mo)) return null;
    var m = idx(ano, mo); if (m < 0 || m >= L.NM) return null;
    if (!I.tem(a, m) && ind !== "margem") return 0;
    return I.mes(a, m);
  }
  // valor que entra numa comparação: no mês atual (quando o ano atual está na tela), o trecho até ontem
  function cmpVal(ano, mo) {
    if (temAtual && mo === moa) { var y = L.ya(ano); return y >= 0 && y < L.NA ? I.corte(a, y) : null; }
    return cel(ano, mo);
  }
  // acumulado (ANO) e média
  function soma(ano, campo, ateMes, comCorte) {
    var t = 0, y = L.ya(ano);
    for (var mo = 1; mo <= ateMes; mo++) {
      if (comCorte && mo === moa && temAtual) { t += campo === "liq" ? a.cv[y] - a.cd[y] : a["c" + campo][y]; continue; }
      if (futuro(ano, mo)) continue;
      var m = idx(ano, mo); if (m < 0 || m >= L.NM) continue;
      t += campo === "liq" ? a.v[m] - a.d[m] : a[campo][m];
    }
    return t;
  }
  function anoVal(ano, paraComparar) {
    // o ano atual mostra até hoje; os outros (e a comparação) param no mesmo ponto
    var comCorte = temAtual && (paraComparar || ano !== atual);
    if (ind === "fat") return soma(ano, "liq", lim, comCorte);
    if (ind === "qt") return soma(ano, "q", lim, comCorte);
    if (ind === "margem") { var v = soma(ano, "v", lim, comCorte), c = soma(ano, "c", lim, comCorte); return v ? (v - c) / v * 100 : null; }
    // positivação e mix: média dos meses fechados (no mês atual não há mês fechado ainda: o trecho)
    var n = 0, t = 0, ate = temAtual ? moa - 1 : 12;
    for (var mo = 1; mo <= ate; mo++) { var x = cel(ano, mo); if (x != null && x > 0) { t += x; n++; } }
    if (!n && temAtual) { var y = L.ya(ano); return I.corte(a, y); }
    return n ? t / n : null;
  }
  function media(ano) {
    var n = 0, t = 0, ate = temAtual ? moa - 1 : 12;
    for (var mo = 1; mo <= ate; mo++) { var x = cel(ano, mo); if (x != null && (x !== 0 || ind === "fat")) { t += x; n++; } }
    return n ? t / n : null;
  }
  function cresc(alvo, base) {
    if (alvo == null || base == null) return null;
    if (ind === "margem") return { pp: alvo - base };
    return base > 0 ? { pct: alvo / base - 1 } : null;
  }

  var linhas = [];
  // valores por ano
  var melhor = {};
  anos.forEach(function (ano) {
    var vals = [], best = -Infinity, bestMo = null;
    for (var mo = 1; mo <= 12; mo++) {
      var v = cel(ano, mo); vals.push(v);
      if (v != null && !parcial(ano, mo) && v > best && v !== 0) { best = v; bestMo = mo; }
    }
    melhor[ano] = bestMo;
    linhas.push({ tipo: "valor", ano: ano, rot: I.linha + " " + ano, vals: vals, ano_val: anoVal(ano, false), media: (ind === "fat" || ind === "qt") ? media(ano) : null,
                  melhor: ano === ult ? bestMo : null });
  });
  // meta (faturamento, ano mais recente)
  var temMeta = ind === "fat" && a.temMeta && ult >= L.ANO0;
  var metaVals = null, metaAno = null;
  if (temMeta) {
    metaVals = []; var tm = 0, n = 0, algum = false;
    for (var mo = 1; mo <= 12; mo++) {
      var m = idx(ult, mo), t = m >= 0 && m < L.NM ? a.t[m] : 0;
      metaVals.push(t || null); if (t) algum = true;
      if (mo <= lim && t) { tm += t; n++; }
    }
    if (!algum) temMeta = false;
    else { metaAno = tm; linhas.push({ tipo: "meta", rot: "META " + ult, vals: metaVals, ano_val: metaAno, media: n ? tm / n : null }); }
  }
  // comparações: o ano mais recente contra cada um dos outros
  anos.slice(0, -1).reverse().forEach(function (base) {
    var vals = [];
    for (var mo = 1; mo <= 12; mo++) vals.push(futuro(ult, mo) ? null : cresc(cmpVal(ult, mo), cmpVal(base, mo)));
    linhas.push({ tipo: "pct", rot: base + " Vs " + ult, vals: vals, ano_val: cresc(anoVal(ult, true), anoVal(base, true)),
                  media: (ind === "fat" || ind === "qt") ? cresc(media(ult), media(base)) : null, base: base, alvo: ult });
  });
  if (temMeta) {
    var vm = [], vb = [];
    for (var mo2 = 1; mo2 <= 12; mo2++) {
      var real = cel(ult, mo2), meta = metaVals[mo2 - 1];
      vm.push(real == null || !meta ? null : { pct: real / meta - 1, parcial: parcial(ult, mo2) });
      var b = anos.length > 1 ? cel(anos[anos.length - 2], mo2) : null;
      vb.push(!meta || !b ? null : { pct: meta / b - 1 });
    }
    linhas.push({ tipo: "pct", sub: "meta", rot: "Meta Vs " + ult, vals: vm, ano_val: metaAno ? { pct: anoVal(ult, false) / metaAno - 1 } : null, media: null });
    if (anos.length > 1) {
      var base2 = anos[anos.length - 2], bAno = anoVal(base2, true);
      linhas.push({ tipo: "pct", sub: "meta", rot: "Meta x " + base2, vals: vb, ano_val: metaAno && bAno ? { pct: metaAno / bAno - 1 } : null, media: null });
    }
  }
  if (opc.mesAMes) {
    var mm = [];
    for (var mo3 = 1; mo3 <= 12; mo3++) {
      var atualV = parcial(ult, mo3) ? null : cel(ult, mo3);
      var antV = mo3 === 1 ? cel(ult - 1, 12) : cel(ult, mo3 - 1);
      mm.push(atualV == null || antV == null ? null : cresc(atualV, antV));
    }
    linhas.push({ tipo: "pct", sub: "mm", rot: "Cresc. mês a mês", vals: mm, ano_val: null, media: null });
  }
  return { linhas: linhas, ind: ind, anos: anos, ult: ult, temAtual: temAtual, lim: lim, aprox: a.aprox && !I.soma,
           anoVal: anoVal, cel: cel, cmpVal: cmpVal, meta: metaVals, metaAno: metaAno };
};

/* ------------------------------ o bloco na tela ------------------------------ */
function textoPct(o) {
  if (!o) return "";
  if (o.pp != null) return (o.pp > 0 ? "+" : o.pp < 0 ? "−" : "") + L.fNum(Math.abs(o.pp), 1) + " p.p.";
  return (o.pct < 0 ? "−" : "") + L.fNum(Math.abs(o.pct) * 100, 1) + "%";
}
L.textoPct = textoPct;
function negativo(o) { return o && ((o.pct != null && o.pct < -0.0005) || (o.pp != null && o.pp < -0.05)); }

/* cfg: { titulo, sub, tag, acc, ind, anos, aoClicarTitulo, aoClicarMes(mo, ano), mesAMes, compacto, aviso } */
L.bloco = function (cfg) {
  var R = L.contasBloco(cfg.acc, cfg.ind, cfg.anos, { mesAMes: cfg.mesAMes });
  var I = L.IND[cfg.ind], ult = R.ult;
  var el = L.h("section", { class: "bloco" + (cfg.compacto ? " compacto" : "") + (cfg.principal ? " principal" : "") });
  // cabeçalho
  var tag = L.h(cfg.aoClicarTitulo ? "button" : "div", { class: "bloco-tag" + (cfg.aoClicarTitulo ? " click" : ""), type: cfg.aoClicarTitulo ? "button" : null,
    title: cfg.aoClicarTitulo ? (cfg.dicaTitulo || "Abrir o detalhe") : null, onclick: cfg.aoClicarTitulo || null },
    L.h("span", { text: cfg.titulo }), cfg.aoClicarTitulo ? L.icEl("dir") : null);
  var info = L.h("div", { class: "bloco-info" }, cfg.sub ? L.h("span", { class: "bloco-sub", text: cfg.sub }) : null,
    cfg.aviso ? L.h("span", { class: "bloco-aviso", html: L.ic("info") + L.esc(cfg.aviso) }) : null);
  // resumo à direita: acumulado do ano mais recente, crescimento e meta
  var resumo = L.h("div", { class: "bloco-resumo" });
  var vAno = R.anoVal(ult, false);
  resumo.appendChild(L.h("div", { class: "br-item" }, L.h("small", { text: (R.temAtual ? "Acumulado " : "Ano ") + ult + (I.soma ? "" : " (média)") }),
    L.h("b", { class: "num", text: I.tipo === "moeda" ? L.fAbrev(vAno, true) : L.fmtInd(cfg.ind, vAno) })));
  var cmp = R.linhas.filter(function (l) { return l.tipo === "pct" && !l.sub; })[0];
  if (cmp && cmp.ano_val) resumo.appendChild(L.h("div", { class: "br-item" }, L.h("small", { text: "vs " + cmp.base + (R.temAtual ? " (mesmo ponto)" : "") }),
    L.h("b", { class: "num " + (negativo(cmp.ano_val) ? "neg" : "pos"), text: textoPct(cmp.ano_val) })));
  if (R.metaAno) resumo.appendChild(L.h("div", { class: "br-item" }, L.h("small", { text: "da meta " + ult }),
    L.h("b", { class: "num", text: L.fNum(vAno / R.metaAno * 100, 1) + "%" })));
  el.appendChild(L.h("div", { class: "bloco-cab" }, tag, info, resumo));

  // a tabela
  var tb = L.h("table", { class: "planilha" }), thead = L.h("thead"), trh = L.h("tr");
  trh.appendChild(L.h("th", { class: "pl-ind", text: "INDICADORES" }));
  for (var mo = 1; mo <= 12; mo++) {
    var k = ult * 100 + mo, c = L.CALK.get(k);
    var th = L.h("th", { class: "pl-mes" + (ult === L.ANO_ATUAL && mo === L.MOA ? " atual" : ""), text: L.MES_CURTO[mo - 1] });
    if (c) th.title = L.rotuloPeriodo(k) + (c.origem === "deduzido" ? " · calendário deduzido, a conferir com o comercial" : c.origem === "padrao" ? " · calendário no desenho padrão" : "");
    trh.appendChild(th);
  }
  trh.appendChild(L.h("th", { class: "pl-ano", text: (I.soma || cfg.ind === "margem" ? "ANO " : "MÉDIA ") + ult,
    title: R.temAtual ? "Acumulado do ano até hoje; nos outros anos, até o mesmo ponto (os meses fechados + o mesmo trecho do mês atual)" : "O ano inteiro" }));
  if (I.soma) trh.appendChild(L.h("th", { class: "pl-ano", text: "Média/Ano", title: "Média dos meses fechados" + (R.temAtual ? " (sem o mês em andamento)" : "") }));
  thead.appendChild(trh); tb.appendChild(thead);
  var tbody = L.h("tbody");
  R.linhas.forEach(function (l) {
    var tr = L.h("tr", { class: "pl-" + l.tipo + (l.sub ? " pl-" + l.sub : "") });
    tr.appendChild(L.h("td", { class: "pl-rot", text: l.rot }));
    for (var mo = 1; mo <= 12; mo++) {
      var v = l.vals[mo - 1], td;
      if (l.tipo === "pct") {
        td = L.h("td", { class: "pl-v" + (negativo(v) ? " neg" : ""), text: textoPct(v) });
        if (v) dicaPct(td, l, mo, v, R, cfg);
      } else {
        var parcial = l.tipo === "valor" && l.ano === L.ANO_ATUAL && mo === L.MOA && v != null;
        td = L.h("td", { class: "pl-v" + (l.melhor === mo ? " melhor" : "") + (parcial ? " parcial" : "") + (v === 0 ? " zero" : ""),
          text: v == null ? "" : v === 0 ? "–" : L.fmtInd(cfg.ind, v) + (parcial ? "*" : "") });
        if (v != null) dicaValor(td, l, mo, v, R, cfg);
      }
      if (cfg.aoClicarMes && v != null && (l.tipo === "valor" || l.tipo === "pct")) {
        td.classList.add("click");
        (function (mo, ano) { td.addEventListener("click", function () { cfg.aoClicarMes(mo, ano); }); })(mo, l.ano || ult);
      }
      tr.appendChild(td);
    }
    var tdA;
    if (l.tipo === "pct") tdA = L.h("td", { class: "pl-a" + (negativo(l.ano_val) ? " neg" : ""), text: textoPct(l.ano_val) });
    else tdA = L.h("td", { class: "pl-a", text: L.fmtInd(cfg.ind, l.ano_val) });
    tr.appendChild(tdA);
    if (I.soma) tr.appendChild(L.h("td", { class: "pl-a" + (l.tipo === "pct" && negativo(l.media) ? " neg" : ""),
      text: l.tipo === "pct" ? textoPct(l.media) : L.fmtInd(cfg.ind, l.media) }));
    tbody.appendChild(tr);
  });
  tb.appendChild(tbody);
  el.appendChild(L.h("div", { class: "pl-wrap" }, tb));
  if (R.aprox) el.appendChild(L.h("div", { class: "bloco-rodape", html: L.ic("info") + "Vários grupos juntos: a " + I.rot.toLowerCase() + " é a soma deles (um cliente atendido por dois pode contar duas vezes)." }));
  el.contas = R;
  return el;
};

function dicaValor(td, l, mo, v, R, cfg) {
  var I = L.IND[cfg.ind], ano = l.ano || R.ult, k = ano * 100 + mo;
  td.addEventListener("mousemove", function (ev) {
    var linhas = [];
    var m = L.im(k), a = cfg.acc;
    if (l.tipo === "meta") linhas.push({ rot: "Meta do WinThor (PCMETARCA)", val: L.fBRL(v) });
    else if (cfg.ind === "fat") {
      linhas.push({ rot: "Venda (pedido faturado, sem ST)", val: L.fBRL(a.v[m]) });
      linhas.push({ rot: "Devolução (sem ST)", val: "−" + L.fBRL(a.d[m]).replace("−", "") });
      linhas.push({ rot: "Sell out", val: L.fBRL(v) });
    } else if (cfg.ind === "margem") {
      linhas.push({ rot: "Venda", val: L.fBRL(a.v[m]) }); linhas.push({ rot: "Custo", val: L.fBRL(a.c[m]) });
      linhas.push({ rot: "Margem", val: L.fNum(v, 2) + "%" });
    } else linhas.push({ rot: I.rot, val: L.fmtIndLongo(cfg.ind, v) });
    var extra = "";
    if (l.tipo === "valor" && ano === L.ANO_ATUAL && mo === L.MOA) extra = '<div class="dica-nota">* Mês em andamento: até hoje (' + L.esc(L.fData(L.HOJE)) + "). A comparação usa só os dias fechados, até " + L.esc(L.fData(L.ateOntem())) + ".</div>";
    if (R.aprox && !I.soma) extra += '<div class="dica-nota">Soma de vários grupos: um cliente pode contar duas vezes.</div>';
    L.dica.mostrar(ev, { titulo: L.rotuloPeriodo(k), linhas: linhas, extra: extra, clique: cfg.aoClicarMes ? "Clique para abrir este mês por " + (cfg.filhosRot || "detalhe") : null });
  });
  td.addEventListener("mouseleave", L.dica.esconder);
}
function dicaPct(td, l, mo, v, R, cfg) {
  td.addEventListener("mousemove", function (ev) {
    var linhas = [], extra = "", I = L.IND[cfg.ind];
    if (l.sub === "meta" && l.rot.indexOf("Meta Vs") === 0) {
      var real = R.cel(R.ult, mo), meta = R.meta[mo - 1];
      linhas.push({ rot: "Realizado " + R.ult, val: L.fmtIndLongo(cfg.ind, real) }, { rot: "Meta", val: L.fmtIndLongo(cfg.ind, meta) }, { rot: "Diferença", val: L.fmtIndLongo(cfg.ind, real - meta) });
      if (v.parcial) extra = '<div class="dica-nota">Mês em andamento: o realizado vai até hoje, a meta é do mês inteiro.</div>';
    } else if (l.sub === "meta") {
      linhas.push({ rot: "Meta " + R.ult, val: L.fmtIndLongo(cfg.ind, R.meta[mo - 1]) }, { rot: "Realizado " + R.anos[R.anos.length - 2], val: L.fmtIndLongo(cfg.ind, R.cel(R.anos[R.anos.length - 2], mo)) });
    } else if (l.sub === "mm") {
      linhas.push({ rot: L.MESES[mo - 1] + "/" + R.ult + " contra o mês anterior", val: textoPct(v) });
    } else {
      var a1 = R.cmpVal(l.alvo, mo), a0 = R.cmpVal(l.base, mo);
      linhas.push({ rot: L.MESES[mo - 1] + "/" + l.alvo, val: L.fmtIndLongo(cfg.ind, a1) }, { rot: L.MESES[mo - 1] + "/" + l.base, val: L.fmtIndLongo(cfg.ind, a0) });
      if (I.soma) linhas.push({ rot: "Diferença", val: L.fmtIndLongo(cfg.ind, a1 - a0) });
      if (R.temAtual && mo === L.MOA) extra = '<div class="dica-nota">Mês em andamento: os dois anos comparados nos mesmos ' + (L.ORDEM_CORTE + 1) + " dias (até " + L.esc(L.fDiaMes(L.ateOntem())) + " em " + L.ANO_ATUAL + ").</div>";
    }
    L.dica.mostrar(ev, { titulo: l.rot + " · " + L.MESES[mo - 1], linhas: linhas, extra: extra });
  });
  td.addEventListener("mouseleave", L.dica.esconder);
}

/* ------------------------------ o gráfico do topo (como os da planilha) ------------------------------ */
function quandoNaTela(box, fn) {
  var tentativas = 0;
  (function olhar() {
    if (box.isConnected && box.clientWidth > 0) { try { fn(); } catch (e) { console.error(e); } return; }
    if (++tentativas < 120) requestAnimationFrame(olhar);
  })();
}
L.graficoMensal = function (cfg) {
  var R = L.contasBloco(cfg.acc, cfg.ind, cfg.anos), I = L.IND[cfg.ind];
  // cor pela posição, como na planilha: o ano mais recente em azul, o anterior em cinza, a meta à parte
  var valores = R.linhas.filter(function (l) { return l.tipo === "valor"; });
  var corPos = ["--serie-atual", "--serie-ant", "--serie-ant2", "--serie-ant3"];
  var series = valores.map(function (l, i) {
    return { nome: I.linha + " " + l.ano, cor: L.cssVar(corPos[Math.min(valores.length - 1 - i, 3)]), valores: l.vals.map(function (v) { return v == null ? null : v; }) };
  });
  if (R.meta) series.push({ nome: "META " + R.ult, cor: L.cssVar("--meta"), valores: R.meta.map(function (v) { return v || null; }) });
  var box = L.h("div", { class: "graf-box" });
  var fmt = I.tipo === "pct" ? function (v) { return L.fNum(v, 1) + "%"; } : I.tipo === "moeda" ? function (v) { return L.fAbrev(v, false); } : function (v) { return L.fNum(v, 0); };
  // desenha quando a caixa entrar na tela (a tela é montada por partes, em promessas)
  quandoNaTela(box, function () {
    L.graf.colunas(box, {
      categorias: L.MES_CURTO.slice(), series: series, altura: cfg.altura || 300, fmt: fmt, tipo: I.tipo === "moeda" ? "moeda" : null,
      dica: function (i, s) {
        var se = series[s], v = se.valores[i], k = R.ult * 100 + i + 1;
        if (v == null) return null;
        return { titulo: L.MESES[i] + (s < series.length ? "" : ""), linhas: series.map(function (x) { return { rot: x.nome, val: x.valores[i] == null ? "—" : L.fmtIndLongo(cfg.ind, x.valores[i]), cor: x.cor }; }),
                 extra: i + 1 === L.MOA && R.temAtual ? '<div class="dica-nota">* ' + L.esc(L.rotuloPeriodo(k)) + ": até hoje</div>" : "" };
      },
      aoClicar: cfg.aoClicarMes ? function (i) { cfg.aoClicarMes(i + 1, R.ult); } : null,
    });
  });
  var leg = L.h("div", { class: "legenda" }, series.map(function (s) { return L.h("span", { class: "leg-item" }, L.h("i", { style: { background: s.cor } }), s.nome); }));
  return L.h("div", null, leg, box);
};

/* ------------------------------ painel lateral: um mês aberto pelos filhos ------------------------------ */
/* filhos: [{ nome, sub, acc, aoAbrir }], mo: mês do ano, anos */
L.abrirMes = function (cfg) {
  var fundo = L.$("dossie-fundo"), dos = L.$("dossie");
  var I = L.IND[cfg.ind], anos = cfg.anos, ult = anos[anos.length - 1], base = anos.length > 1 ? anos[anos.length - 2] : null;
  function fechar() { fundo.classList.remove("on"); dos.classList.remove("on"); document.removeEventListener("keydown", esc); }
  function esc(ev) { if (ev.key === "Escape") fechar(); }
  document.addEventListener("keydown", esc);
  fundo.onclick = fechar;
  L.limpar(dos);
  var k = ult * 100 + cfg.mo;
  dos.appendChild(L.h("div", { class: "dos-cab" },
    L.h("div", { class: "olho", text: I.rot + " · " + cfg.escopoNome }),
    L.h("h2", { text: L.MESES[cfg.mo - 1] + " por " + cfg.filhosRot }),
    L.h("div", { class: "sub" }, L.h("span", { text: L.rotuloPeriodo(k) })),
    L.h("button", { class: "btn-ic dos-fechar", type: "button", title: "Fechar (Esc)", html: L.ic("x"), onclick: fechar })));
  var corpo = L.h("div", { class: "dos-corpo" });
  dos.appendChild(corpo);
  fundo.classList.add("on"); dos.classList.add("on");
  function desenhar(filhos) {
    L.limpar(corpo);
    var linhas = filhos.map(function (f) {
      var R = L.contasBloco(f.acc, cfg.ind, anos);
      var vU = R.cel(ult, cfg.mo), vB = base ? R.cel(base, cfg.mo) : null;
      var cU = R.cmpVal(ult, cfg.mo), cB = base ? R.cmpVal(base, cfg.mo) : null;
      var cr = cfg.ind === "margem" ? (cU != null && cB != null ? { pp: cU - cB } : null) : (cB > 0 && cU != null ? { pct: cU / cB - 1 } : null);
      return { f: f, vU: vU, vB: vB, cr: cr, dif: cU != null && cB != null ? cU - cB : null };
    }).filter(function (x) { return x.vU || x.vB; });
    linhas.sort(function (a, b) { return (b.vU || 0) - (a.vU || 0); });
    if (!linhas.length) { corpo.appendChild(L.h("div", { class: "vazio", html: "<b>Sem venda</b>Nada neste mês." })); return; }
    var tb = L.h("table", { class: "tabela mes-filhos" });
    tb.appendChild(L.h("thead", null, L.h("tr", null, L.h("th", { text: cfg.filhosRotSing || "Nome" }),
      base ? L.h("th", { class: "d", text: L.MES3[cfg.mo - 1] + "/" + String(base).slice(2) }) : null,
      L.h("th", { class: "d", text: L.MES3[cfg.mo - 1] + "/" + String(ult).slice(2) }),
      base ? L.h("th", { class: "d", text: cfg.ind === "margem" ? "Dif." : "Cresc." }) : null)));
    var tbody = L.h("tbody");
    linhas.forEach(function (x) {
      var tr = L.h("tr", { class: x.f.aoAbrir ? "click" : "" },
        L.h("td", null, L.h("div", { class: "mf-nome", text: x.f.nome }), x.f.sub ? L.h("small", { text: x.f.sub }) : null),
        base ? L.h("td", { class: "d num", text: L.fmtInd(cfg.ind, x.vB) }) : null,
        L.h("td", { class: "d num", text: L.fmtInd(cfg.ind, x.vU) + (ult === L.ANO_ATUAL && cfg.mo === L.MOA ? "*" : "") }),
        base ? L.h("td", { class: "d num" + (negativo(x.cr) ? " neg" : " pos"), text: textoPct(x.cr) }) : null);
      if (x.f.aoAbrir) tr.addEventListener("click", function () { fechar(); x.f.aoAbrir(); });
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    corpo.appendChild(tb);
    if (ult === L.ANO_ATUAL && cfg.mo === L.MOA) corpo.appendChild(L.nota("* Mês em andamento: valor até hoje; o crescimento compara só os dias fechados (até " + L.fData(L.ateOntem()) + ") com o mesmo trecho de " + base + "."));
    if (cfg.notaFilhos) corpo.appendChild(L.nota(cfg.notaFilhos));
  }
  if (typeof cfg.filhos === "function") {
    corpo.appendChild(L.espera("Lendo " + cfg.filhosRot + "…"));
    cfg.filhos().then(desenhar, function (e) { L.limpar(corpo).appendChild(L.erroTela("Não foi possível abrir", e.message || String(e))); });
  } else desenhar(cfg.filhos);
};

})();
