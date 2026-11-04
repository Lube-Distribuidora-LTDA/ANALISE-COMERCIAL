/* =============================================================================
 * planilha-blocos.js — o Excel da tela, no formato da planilha do gestor (ACOMP INDICADORES ANO):
 * um bloco por equipe/supervisor/RCA/fornecedor, com as MESMAS cores da planilha dele —
 * nome do bloco em verde, INDICADORES/ANO/Média em roxo, meses em azul, rótulos lilás, valores
 * azul-claro, melhor mês em amarelo e as comparações em verde (cresceu) e vermelho (caiu), como a
 * formatação condicional do Excel — e, em cima, a faixa da Lube
 * com os filtros escritos por extenso. Usa o zip do planilha.js (sem biblioteca).
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* cores medidas na planilha do gestor (tema do Office com os tons que ele usa) */
var COR = {
  bloco: "FF92D050", roxo: "FF7030A0", mes: "FF7992B1", rot: "FFCCC1DA", val: "FFDCE6F2",
  sobe: "FFC6EFCE", sobeT: "FF006100", cai: "FFFFC7CE", caiT: "FF9C0006",
  melhor: "FFFFFF00", borda: "FF8EA9C8", marinho: "FF0D1830", ouro: "FFE9C877", branco: "FFFFFFFF", preto: "FF000000", verm: "FFFF0000", cinza: "FF6B7A99",
};
var FMT = { int: "#,##0", pct: "0.0%", ppInd: '0.0"%"', pp: '+0.0" p.p.";-0.0" p.p.";0.0" p.p."' };

function Estilos() {
  var fontes = [], fills = [{ none: true }, { gray: true }], bordas = [null, { fina: true }], fmts = {}, xfs = [], chaves = {};
  function idx(lista, obj) { var k = JSON.stringify(obj); for (var i = 0; i < lista.length; i++) if (JSON.stringify(lista[i]) === k) return i; lista.push(obj); return lista.length - 1; }
  var nFmt = 170;
  this.de = function (o) {
    var k = JSON.stringify(o);
    if (chaves[k] != null) return chaves[k];
    var f = idx(fontes, { sz: o.sz || 9, cor: o.cor || COR.preto, b: !!o.b });
    var fi = o.fill ? idx(fills, { cor: o.fill }) : 0;
    var bo = o.borda ? 1 : 0;
    var nf = 0;
    if (o.fmt) { if (fmts[o.fmt] == null) fmts[o.fmt] = nFmt++; nf = fmts[o.fmt]; }
    xfs.push({ f: f, fi: fi, bo: bo, nf: nf, al: o.al || "centro" });
    chaves[k] = xfs.length - 1;
    return chaves[k];
  };
  this.xml = function () {
    var esc = Planilha._esc;
    var nf = Object.keys(fmts).map(function (c) { return '<numFmt numFmtId="' + fmts[c] + '" formatCode="' + esc(c) + '"/>'; }).join("");
    var fo = fontes.map(function (f) { return '<font><sz val="' + f.sz + '"/><color rgb="' + f.cor + '"/><name val="Calibri"/>' + (f.b ? "<b/>" : "") + "</font>"; }).join("");
    var fi = fills.map(function (x) {
      if (x.none) return '<fill><patternFill patternType="none"/></fill>';
      if (x.gray) return '<fill><patternFill patternType="gray125"/></fill>';
      return '<fill><patternFill patternType="solid"><fgColor rgb="' + x.cor + '"/><bgColor indexed="64"/></patternFill></fill>';
    }).join("");
    var lado = function (t) { return "<" + t + ' style="thin"><color rgb="' + COR.borda + '"/></' + t + ">"; };
    var bo = bordas.map(function (b) { return b ? "<border>" + lado("left") + lado("right") + lado("top") + lado("bottom") + "<diagonal/></border>" : "<border><left/><right/><top/><bottom/><diagonal/></border>"; }).join("");
    var xf = xfs.map(function (x) {
      var al = x.al === "esquerda" ? '<alignment horizontal="left" vertical="center"/>' : '<alignment horizontal="center" vertical="center"/>';
      return '<xf numFmtId="' + x.nf + '" fontId="' + x.f + '" fillId="' + x.fi + '" borderId="' + x.bo + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">' + al + "</xf>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="' + Object.keys(fmts).length + '">' + nf + "</numFmts>" +
      '<fonts count="' + fontes.length + '">' + fo + "</fonts><fills count=\"" + fills.length + "\">" + fi + "</fills>" +
      '<borders count="' + bordas.length + '">' + bo + "</borders>" +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + xfs.length + '">' + xf + "</cellXfs>" +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  };
}

function cel(ref, s, v, num) {
  var esc = Planilha._esc;
  // arredonda ao gravar: sem isso a barra de fórmulas mostra 880000,0000000001 (ruído de ponto flutuante)
  if (num && typeof v === "number" && isFinite(v)) v = Math.abs(v) < 10 ? Math.round(v * 1e6) / 1e6 : Math.round(v * 100) / 100;
  if (v == null || v === "" || (num && !isFinite(v))) return '<c r="' + ref + '" s="' + s + '"/>';
  if (num) return '<c r="' + ref + '" s="' + s + '"><v>' + v + "</v></c>";
  return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + "</t></is></c>";
}

/* blocos: [{ titulo, sub, R (L.contasBloco) }]; ind: fat|posit|mix|margem|qt */
function gerar(cfg) {
  var E = new Estilos(), letra = Planilha._letra, linhasXml = [], mesclas = [], r = 1;
  var ind = cfg.ind, I = L.IND[ind], fmtVal = I.tipo === "pct" ? FMT.ppInd : FMT.int;
  // os blocos podem ter indicadores diferentes (no Mix com fornecedor, os produtos vão em quantidade)
  var temMedia = cfg.blocos.some(function (b) { return (L.IND[b.R.ind] || I).soma; }), nCols = 1 + 12 + 1 + (temMedia ? 1 : 0), ult = letra(nCols);
  var S = {
    tit: E.de({ sz: 16, b: true, cor: COR.ouro, fill: COR.marinho, al: "esquerda" }),
    sub: E.de({ sz: 11, b: true, cor: COR.branco, fill: COR.marinho, al: "esquerda" }),
    frot: E.de({ sz: 9, b: true, cor: COR.cinza, al: "esquerda" }),
    fval: E.de({ sz: 9, al: "esquerda" }),
    bloco: E.de({ sz: 10, b: true, fill: COR.bloco, al: "esquerda" }),
    blocoSub: E.de({ sz: 9, cor: COR.cinza, al: "esquerda" }),
    hInd: E.de({ b: true, cor: COR.branco, fill: COR.roxo, borda: true }),
    hMes: E.de({ b: true, cor: COR.branco, fill: COR.mes, borda: true }),
    rot: E.de({ b: true, fill: COR.rot, borda: true }),
    rod: E.de({ sz: 8, cor: COR.cinza, al: "esquerda" }),
  };
  function linha(cels, altura) { linhasXml.push('<row r="' + r + '"' + (altura ? ' ht="' + altura + '" customHeight="1"' : "") + ">" + cels.join("") + "</row>"); r++; }
  function estiloValor(tipoLinha, col, extra) {
    var base = { borda: true, fmt: fmtVal };   // fmtVal é o do bloco da vez (ver o laço dos blocos)
    if (col === "ano") { base.fill = COR.rot; base.b = true; }
    else base.fill = extra === "melhor" ? COR.melhor : COR.val;
    return E.de(base);
  }
  // x: o crescimento (fração ou p.p.); verde quando cresce, vermelho quando cai, como na tela
  function estiloPct(sub, col, x, pp) {
    var lim = pp ? 0.05 : 0.0005, s = x == null ? 0 : x > lim ? 1 : x < -lim ? -1 : 0;
    return E.de({ borda: true, fmt: pp ? FMT.pp : FMT.pct, fill: s > 0 ? COR.sobe : s < 0 ? COR.cai : col === "ano" ? COR.rot : COR.val,
                  cor: s > 0 ? COR.sobeT : s < 0 ? COR.caiT : COR.preto, b: col === "ano" || s !== 0 });
  }
  // faixa da Lube
  linha([cel("A" + r, S.tit, "LUBE DISTRIBUIDORA LTDA")].concat(range(2, nCols).map(function (c) { return cel(letra(c) + r, S.tit, ""); })), 28);
  mesclas.push("A" + (r - 1) + ":" + ult + (r - 1));
  linha([cel("A" + r, S.sub, "Análise Comercial · " + cfg.titulo)].concat(range(2, nCols).map(function (c) { return cel(letra(c) + r, S.sub, ""); })), 20);
  mesclas.push("A" + (r - 1) + ":" + ult + (r - 1));
  r++;
  (cfg.filtros || []).forEach(function (f) { linha([cel("A" + r, S.frot, f[0]), cel("B" + r, S.fval, f[1])]); mesclas.push("B" + (r - 1) + ":" + ult + (r - 1)); });
  r++;
  cfg.blocos.forEach(function (b) {
    var R = b.R, ultAno = R.ult, Ib = L.IND[R.ind] || I;
    fmtVal = Ib.tipo === "pct" ? FMT.ppInd : FMT.int;
    linha([cel("A" + r, S.bloco, b.titulo), cel("B" + r, S.blocoSub, b.sub || "")]);
    mesclas.push("B" + (r - 1) + ":" + ult + (r - 1));
    var hdr = [cel("A" + r, S.hInd, "INDICADORES")];
    for (var mo = 1; mo <= 12; mo++) hdr.push(cel(letra(mo + 1) + r, S.hMes, L.MES_CURTO[mo - 1]));
    hdr.push(cel(letra(14) + r, S.hInd, (Ib.soma || R.ind === "margem" ? "ANO " : "MÉDIA ") + ultAno));
    if (temMedia) hdr.push(cel(letra(15) + r, S.hInd, Ib.soma ? "Média/Ano" : ""));
    linha(hdr, 16);
    R.linhas.forEach(function (l) {
      var cs = [cel("A" + r, S.rot, l.rot)];
      for (var mo = 1; mo <= 12; mo++) {
        var v = l.vals[mo - 1], ref = letra(mo + 1) + r;
        if (l.tipo === "pct") {
          var pp = v && v.pp != null, x = v ? (pp ? v.pp : v.pct) : null;
          cs.push(cel(ref, estiloPct(l.sub, "mes", x, pp), x, true));
        } else cs.push(cel(ref, estiloValor(l.tipo, "mes", l.melhor === mo ? "melhor" : null), v, true));
      }
      var colA = letra(14) + r, colM = letra(15) + r;
      if (l.tipo === "pct") {
        var a = l.ano_val, ppA = a && a.pp != null, xa = a ? (ppA ? a.pp : a.pct) : null;
        cs.push(cel(colA, estiloPct(l.sub, "ano", xa, ppA), xa, true));
        if (temMedia) { var m = l.media, ppM = m && m.pp != null, xm = m ? (ppM ? m.pp : m.pct) : null; cs.push(cel(colM, estiloPct(l.sub, "ano", xm, ppM), xm, true)); }
      } else {
        cs.push(cel(colA, estiloValor(l.tipo, "ano"), l.ano_val, true));
        if (temMedia) cs.push(cel(colM, estiloValor(l.tipo, "ano"), l.media, true));
      }
      linha(cs, 15);
    });
    r++;
  });
  linha([cel("A" + r, S.rod, "Mês comercial: semanas de sábado a sexta. Sell out = venda do pedido faturado (sem ST) − devolução (sem ST). " +
    (R0temAtual(cfg) ? "Mês em andamento até " + L.fData(L.HOJE) + "; as comparações usam o mesmo número de dias. " : "") +
    "Gerado pela Análise Comercial · dado do WinThor pelo DATA WAREHOUSE · " + new Date().toLocaleString("pt-BR"))]);
  var cols = '<col min="1" max="1" width="17" customWidth="1"/><col min="2" max="13" width="11.5" customWidth="1"/><col min="14" max="' + nCols + '" width="13" customWidth="1"/>';
  var planilha = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + ult + r + '"/><sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/><cols>' + cols + "</cols><sheetData>" + linhasXml.join("") + "</sheetData>" +
    '<mergeCells count="' + mesclas.length + '">' + mesclas.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join("") + "</mergeCells>" +
    '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  var aba = (cfg.aba || "Análise").slice(0, 28).replace(/[\\\/\?\*\[\]:]/g, " ");
  var esc = Planilha._esc;
  return Planilha._zip([
    { nome: "[Content_Types].xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { nome: "_rels/.rels", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nome: "xl/workbook.xml", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc(aba) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { nome: "xl/_rels/workbook.xml.rels", conteudo: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { nome: "xl/styles.xml", conteudo: E.xml() },
    { nome: "xl/worksheets/sheet1.xml", conteudo: planilha },
  ]);
}
function R0temAtual(cfg) { return cfg.blocos.some(function (b) { return b.R.temAtual; }); }
function range(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }

/* blocos da tela: [{ titulo, el }] (el.contas = o que o bloco mostrou) */
L._gerarBlocos = gerar;   // para o teste do arquivo (conferencia)
L.exportarBlocos = function (titulo, blocos, ind) {
  var visiveis = blocos.filter(function (b) { return b.el && b.el.contas && b.el.style.display !== "none"; });
  if (!visiveis.length) { L.toast("Nada para exportar nesta tela", "erro"); return; }
  try {
    var ind2 = visiveis[0].el.contas.ind || ind;
    var bytes = gerar({ titulo: titulo + " · " + L.IND[ind2].rot, ind: ind2, filtros: L.descricaoFiltros(), aba: L.IND[ind2].rot,
      blocos: visiveis.map(function (b) { var sub = b.el.querySelector(".bloco-sub"); return { titulo: b.titulo, sub: sub ? sub.textContent : "", R: b.el.contas }; }) });
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analise-comercial-" + L.norm(titulo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) + "-" + new Date().toISOString().slice(0, 10) + ".xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    L.toast("Planilha gerada: " + visiveis.length + " bloco" + (visiveis.length > 1 ? "s" : ""), "ok");
  } catch (e) { console.error(e); L.toast("Não foi possível gerar a planilha: " + (e.message || e), "erro"); }
};

})();
