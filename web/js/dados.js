/* =============================================================================
 * dados.js — os pacotes do banco (analise_comercial.pacote) viram séries por mês comercial,
 * e cada tela pede o recorte que precisa (equipe, supervisor, RCA, fornecedor).
 *
 *   dim        calendário comercial, supervisores (equipe, rótulo da planilha), RCAs, fornecedores e o
 *              TRECHO do mês atual que já fechou (até ontem) em todos os anos (comparação justa)
 *   base_*     mês × RCA (venda, custo, qtd, devolução, positivação, mix, meta) e mês × grupo
 *              (positivação e mix sem contar duas vezes)
 *   forn_*     mês × supervisor × fornecedor, e mês × grupo × fornecedor
 *
 * Sell out = venda − devolução (a regra da planilha do gestor). Os pacotes trazem venda e devolução
 * separadas para a dica mostrar as duas.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ cópia no navegador ------------------------------ */
var IDB = "analise-comercial-lube", LOJA = "pacotes";
var NOMES = ["dim", "base_hist", "base_rec", "forn_hist", "forn_rec"];
function idbAbrir() {
  return new Promise(function (ok, erro) {
    if (!window.indexedDB) return erro(new Error("sem IndexedDB"));
    var r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = function () { r.result.createObjectStore(LOJA); };
    r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
  });
}
function idbLer(nome) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var q = db.transaction(LOJA, "readonly").objectStore(LOJA).get(nome);
    q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { ok(null); };
  }); }).catch(function () { return null; });
}
function idbGravar(nome, obj) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var tx = db.transaction(LOJA, "readwrite"); tx.objectStore(LOJA).put(obj, nome);
    tx.oncomplete = function () { ok(true); }; tx.onerror = function () { ok(false); };
  }); }).catch(function () { return false; });
}
function erroHttp(r, oque) {
  return r.json().catch(function () { return {}; }).then(function (j) {
    if (r.status === 401) throw new Error("Sua sessão do Painel Lube expirou. Entre de novo pelo portal.");
    throw new Error("Não foi possível ler " + oque + " (" + r.status + (j && j.mensagem ? ": " + j.mensagem : j && j.erro ? ": " + j.erro : "") + ").");
  });
}
L.erroHttp = erroHttp;
function baixarPacote(nome, versao) {
  return fetch("api/pacote?nome=" + encodeURIComponent(nome) + "&v=" + encodeURIComponent(versao || "x"), { cache: "no-store" }).then(function (r) {
    if (!r.ok) return erroHttp(r, "o pacote de dados (" + nome + ")");
    var corpo = r.body;
    if (r.headers.get("X-Pacote") === "gzip" && window.DecompressionStream) corpo = corpo.pipeThrough(new DecompressionStream("gzip"));
    return new Response(corpo).text();
  }).then(function (txt) { return JSON.parse(txt); });
}
L.versaoNoBanco = function () { return fetch("api/versao?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : erroHttp(r, "a versão dos dados"); }); };

/* ------------------------------ carga: versão → pacotes que mudaram → montar ------------------------------ */
L.PAC = {};
L.carregarTudo = function (aviso) {
  aviso = aviso || function () {};
  return L.versaoNoBanco().then(function (ver) {
    L.ULTIMA_VERSAO = ver; L.CONFERIDO_EM = new Date();
    var nomes = (ver.pacotes || []).map(function (p) { return p.nome; });
    if (NOMES.some(function (n) { return nomes.indexOf(n) < 0; })) throw new Error("Os pacotes da análise ainda não foram montados no banco.");
    var baixou = false;
    return Promise.all(ver.pacotes.map(function (p) {
      return idbLer(p.nome).then(function (c) {
        if (c && c.versao === p.versao) { L.PAC[p.nome] = c; return; }
        baixou = true;
        aviso("Baixando os dados" + (c ? " novos" : " (só na primeira vez)") + "…");
        return baixarPacote(p.nome, p.versao).then(function (j) { L.PAC[p.nome] = { versao: p.versao, gerado_em: p.gerado_em, j: j }; idbGravar(p.nome, L.PAC[p.nome]); });
      });
    })).then(function () { L.ORIGEM = baixou ? "banco" : "copia"; montar(); });
  }, function (e) {
    // sem o servidor: abre com as cópias guardadas, avisando
    return Promise.all(NOMES.map(function (n) { return idbLer(n).then(function (c) { if (c) L.PAC[n] = c; }); })).then(function () {
      if (NOMES.some(function (n) { return !L.PAC[n]; })) throw e;
      L.ORIGEM = "offline"; L.toast("Sem conexão com o servidor: mostrando os dados guardados neste computador", "erro");
      montar();
    });
  });
};
/* Ao vivo: baixa só os pacotes cuja versão mudou e remonta. Devolve true se remontou. */
L.atualizarAoVivo = function (ver) {
  L.ULTIMA_VERSAO = ver; L.CONFERIDO_EM = new Date();
  var mudaram = (ver.pacotes || []).filter(function (p) { return NOMES.indexOf(p.nome) >= 0 && (!L.PAC[p.nome] || L.PAC[p.nome].versao !== p.versao); });
  if (!mudaram.length) return Promise.resolve(false);
  return Promise.all(mudaram.map(function (p) {
    return baixarPacote(p.nome, p.versao).then(function (j) { L.PAC[p.nome] = { versao: p.versao, gerado_em: p.gerado_em, j: j }; idbGravar(p.nome, L.PAC[p.nome]); });
  })).then(function () { L.ORIGEM = "banco"; L.CACHE_API = {}; montar(); return true; });
};

/* ------------------------------ botão Atualizar: a ponte até o agente ------------------------------ */
L.pedirAtualizacao = function () {
  return fetch("api/atualizar", { method: "POST", cache: "no-store" }).then(function (r) {
    if (r.status === 404) return { agente: false, mensagem: "Este painel ainda não tem a ponte com o agente." };
    return r.ok ? r.json() : erroHttp(r, "o pedido de atualização");
  });
};
L.esperarPedido = function (id, limiteMs) {
  var fim = Date.now() + (limiteMs || 45000);
  return new Promise(function (ok, falha) {
    (function olhar() {
      fetch("api/versao?pedido=" + encodeURIComponent(id) + "&_=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : erroHttp(r, "o pedido de atualização"); })
        .then(function (v) {
          var p = v.pedido;
          if (p && /^(atendido|erro|expirado)$/.test(p.status)) return ok(v);
          if (Date.now() > fim) { v.pedido = Object.assign({}, p || {}, { status: "demorou" }); return ok(v); }
          setTimeout(olhar, 700);
        }, falha);
    })();
  });
};

/* ------------------------------ consultas na hora (produtos, fornecedores de RCAs) ------------------------------ */
L.CACHE_API = {};
L.consultar = function (corpo) {
  var chave = JSON.stringify(corpo);
  if (L.CACHE_API[chave]) return L.CACHE_API[chave];
  var p = fetch("api/consulta", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: chave })
    .then(function (r) { return r.ok ? r.json() : erroHttp(r, corpo.tipo === "produtos" ? "os produtos do fornecedor" : "os fornecedores dos RCAs"); });
  L.CACHE_API[chave] = p;
  p.catch(function () { delete L.CACHE_API[chave]; });
  return p;
};

/* ------------------------------ calendário e índices ------------------------------ */
L.EQUIPES = [
  { id: 1, cod: "ES", nome: "LUBE ES" },
  { id: 2, cod: "RJ", nome: "LUBE RJ" },
  { id: 3, cod: "BA", nome: "LUBE BA" },
  { id: 4, cod: "OUTROS", nome: "OUTROS" },
];
var EQ_POR_COD = {}; L.EQUIPES.forEach(function (e) { EQ_POR_COD[e.cod] = e; });
L.equipeDeCod = function (cod) { return EQ_POR_COD[cod] || EQ_POR_COD.OUTROS; };
L.equipeDeId = function (id) { return L.EQUIPES.filter(function (e) { return e.id === id; })[0]; };

var nM = 0, nA = 0;
L.im = function (k) { return (Math.floor(k / 100) - L.ANO0) * 12 + (k % 100) - 1; };   // 202611 → índice do mês
L.km = function (i) { return (L.ANO0 + Math.floor(i / 12)) * 100 + (i % 12) + 1; };
L.ya = function (ano) { return ano - L.ANO0; };
L.MES_CURTO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
L.periodoDoMes = function (k) { return L.CALK.get(k); };
L.semanas = function (c) { return c ? Math.round((Date.parse(c.fim) - Date.parse(c.inicio)) / 864e5 + 1) / 7 : 0; };
L.fDiaMes = function (iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : ""; };
/* "Novembro/2026 · 31/10 a 27/11 (4 semanas)" */
L.rotuloPeriodo = function (k) {
  var c = L.CALK.get(k); if (!c) return L.MESES[k % 100 - 1] + "/" + Math.floor(k / 100);
  return L.MESES[c.mes - 1] + "/" + c.ano + " · " + L.fDiaMes(c.inicio) + " a " + L.fDiaMes(c.fim) + " (" + L.semanas(c) + " semanas)";
};
/* o mês comercial atual: até que dia já fechou */
L.ateOntem = function () { var c = L.CALK.get(L.MES_ATUAL); return c ? new Date(Date.parse(c.inicio) + L.ORDEM_CORTE * 864e5).toISOString().slice(0, 10) : null; };

function zeros(n, inteiro) { return inteiro ? new Int32Array(n) : new Float64Array(n); }
function serieVazia() { return { v: zeros(nM), c: zeros(nM), q: zeros(nM), d: zeros(nM), t: zeros(nM), p: zeros(nM, 1), x: zeros(nM, 1) }; }
function corteVazio() { return { v: zeros(nA), c: zeros(nA), q: zeros(nA), d: zeros(nA), p: zeros(nA), x: zeros(nA) }; }

/* ------------------------------ montar os pacotes ------------------------------ */
function montar() {
  var dim = L.PAC.dim.j;
  L.CAL = dim.cal.map(function (c) { return { ano: c[0], mes: c[1], k: c[0] * 100 + c[1], inicio: c[2], fim: c[3], origem: c[4] }; });
  L.CALK = new Map(); L.CAL.forEach(function (c) { L.CALK.set(c.k, c); });
  L.MES_ATUAL = dim.mes_atual; L.ANO_ATUAL = Math.floor(dim.mes_atual / 100); L.MOA = dim.mes_atual % 100;
  L.HOJE = dim.hoje; L.ORDEM_CORTE = dim.ordem_corte; L.INICIO_ATUAL = dim.inicio_atual;
  L.ANO0 = L.CAL[0].ano;
  L.ANOS = []; for (var a = L.ANO0; a <= L.ANO_ATUAL; a++) L.ANOS.push(a);
  nA = L.ANOS.length; nM = nA * 12; L.NM = nM; L.NA = nA;

  L.SUP = new Map();
  dim.sup.forEach(function (s) { L.SUP.set(s[0], { cod: s[0], nome: s[1], rot: s[2], eq: s[3], ordem: s[4], tele: !!s[5] }); });
  L.RCA = new Map();
  dim.rca.forEach(function (r) { L.RCA.set(r[0], { cod: r[0], nome: r[1], sup: r[2], supW: r[3], ajuste: r[4], termino: r[5], bloqueio: r[6] }); });
  L.FORN = new Map();
  dim.forn.forEach(function (f) { L.FORN.set(f[0], f[1]); });

  // por RCA
  L.SR = new Map(); L.GR = new Map();
  ["base_hist", "base_rec"].forEach(function (nome) {
    var j = L.PAC[nome].j, r = j.rca, g = j.grupo, i, s, m;
    for (i = 0; i < r.m.length; i++) {
      s = L.SR.get(r.u[i]); if (!s) { s = serieVazia(); L.SR.set(r.u[i], s); }
      m = L.im(r.m[i]); if (m < 0 || m >= nM) continue;
      s.v[m] = r.v[i]; s.c[m] = r.c[i]; s.q[m] = r.q[i]; s.d[m] = r.d[i]; s.p[m] = r.p[i]; s.x[m] = r.x[i]; s.t[m] = r.t[i];
    }
    for (i = 0; i < g.m.length; i++) {
      s = L.GR.get(g.g[i]); if (!s) { s = { p: zeros(nM, 1), x: zeros(nM, 1) }; L.GR.set(g.g[i], s); }
      m = L.im(g.m[i]); if (m < 0 || m >= nM) continue;
      s.p[m] = g.p[i]; s.x[m] = g.x[i];
    }
  });
  // o trecho do mês atual (uma linha por ano)
  L.CR = new Map(); L.CG = new Map();
  var cb = dim.corte.base, i2, s2, y;
  for (i2 = 0; i2 < cb.rca.m.length; i2++) {
    s2 = L.CR.get(cb.rca.u[i2]); if (!s2) { s2 = corteVazio(); L.CR.set(cb.rca.u[i2], s2); }
    y = L.ya(Math.floor(cb.rca.m[i2] / 100)); if (y < 0 || y >= nA) continue;
    s2.v[y] = cb.rca.v[i2]; s2.c[y] = cb.rca.c[i2]; s2.q[y] = cb.rca.q[i2]; s2.d[y] = cb.rca.d[i2]; s2.p[y] = cb.rca.p[i2]; s2.x[y] = cb.rca.x[i2];
  }
  for (i2 = 0; i2 < cb.grupo.m.length; i2++) {
    s2 = L.CG.get(cb.grupo.g[i2]); if (!s2) { s2 = { p: zeros(nA), x: zeros(nA) }; L.CG.set(cb.grupo.g[i2], s2); }
    y = L.ya(Math.floor(cb.grupo.m[i2] / 100)); if (y < 0 || y >= nA) continue;
    s2.p[y] = cb.grupo.p[i2]; s2.x[y] = cb.grupo.x[i2];
  }

  // fornecedor: linhas em colunas (mês já como índice), juntando os dois pacotes
  L.SF = juntarColunas([L.PAC.forn_hist.j.sf, L.PAC.forn_rec.j.sf], ["s", "f", "v", "c", "q", "d", "p", "x"], function (k) { return L.im(k); });
  L.GF = juntarColunas([L.PAC.forn_hist.j.gf, L.PAC.forn_rec.j.gf], ["g", "f", "p", "x"], function (k) { return L.im(k); });
  L.CSF = juntarColunas([dim.corte.forn.sf], ["s", "f", "v", "c", "q", "d", "p", "x"], function (k) { return L.ya(Math.floor(k / 100)); });
  L.CGF = juntarColunas([dim.corte.forn.gf], ["g", "f", "p", "x"], function (k) { return L.ya(Math.floor(k / 100)); });

  // o que cada RCA vendeu no ano (para ordenar e para "com venda")
  L.META_INFO = { gerado_em: L.PAC.dim.gerado_em, mes_atual: L.MES_ATUAL };
  definirDimensoes();
  L.emitir("dados");
}
function juntarColunas(partes, campos, mesParaIndice) {
  var out = { n: 0, m: [] };
  campos.forEach(function (c) { out[c] = []; });
  partes.forEach(function (p) {
    if (!p || !p.m) return;
    for (var i = 0; i < p.m.length; i++) {
      out.m.push(mesParaIndice(p.m[i]));
      for (var j = 0; j < campos.length; j++) out[campos[j]].push(p[campos[j]][i]);
    }
  });
  out.n = out.m.length;
  return out;
}

/* ------------------------------ nomes ------------------------------ */
function titulo(s) {
  return String(s || "").toLowerCase().replace(/(^|[\s\-\/(])([a-zà-ú])/g, function (m, a, b) { return a + b.toUpperCase(); })
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, function (m) { return m.toLowerCase(); }).replace(/\bLtda\b/g, "LTDA");
}
L.titulo = titulo;
L.nomeSup = function (cod) { var s = L.SUP.get(cod); return s ? s.rot : "SUPERVISOR " + cod; };
L.nomeRca = function (cod) { var r = L.RCA.get(cod); return r ? titulo(r.nome) : "RCA " + cod; };
L.nomeForn = function (cod) { return L.FORN.get(cod) || (cod === 0 ? "SEM FORNECEDOR" : "FORNECEDOR " + cod); };
L.equipeDoSup = function (cod) { var s = L.SUP.get(cod); return s ? s.eq : "OUTROS"; };

/* ------------------------------ filtros: as dimensões ------------------------------ */
function supsOrdenados() { return Array.from(L.SUP.values()).sort(function (a, b) { return a.ordem - b.ordem || a.cod - b.cod; }); }
L.supsOrdenados = supsOrdenados;
function definirDimensoes() {
  var comVenda = new Set();
  L.SR.forEach(function (s, u) { for (var i = 0; i < nM; i++) if (s.v[i] || s.d[i]) { comVenda.add(u); break; } });
  var supComVenda = new Set();
  comVenda.forEach(function (u) { var r = L.RCA.get(u); supComVenda.add(r ? r.sup : 0); });
  L.DIM = {
    eq: { rot: "Equipe", nome: function (id) { var e = L.equipeDeId(id); return e ? e.nome : String(id); },
          itens: function () { return L.EQUIPES.map(function (e) { return { id: e.id, t: e.nome, n: L.norm(e.nome + " " + e.cod), s: e.cod }; }); } },
    sup: { rot: "Supervisor", nome: function (id) { return L.nomeSup(id); },
           itens: function () {
             var eqs = L.equipesFiltro();
             return supsOrdenados().filter(function (s) { return supComVenda.has(s.cod) && (!eqs || eqs.indexOf(s.eq) >= 0); })
               .map(function (s) { return { id: s.cod, t: s.rot, n: L.norm(s.cod + " " + s.rot + " " + s.nome), s: s.eq + " · " + s.cod }; });
           } },
    rca: { rot: "RCA", nome: function (id) { return id + " · " + L.nomeRca(id); },
           itens: function () {
             var sups = L.supsFiltro();
             return Array.from(comVenda).filter(function (u) { var r = L.RCA.get(u); return !sups || sups.has(r ? r.sup : 0); })
               .sort(function (a, b) { return L.nomeRca(a).localeCompare(L.nomeRca(b), "pt-BR"); })
               .map(function (u) { var r = L.RCA.get(u) || {}; return { id: u, t: u + " · " + L.nomeRca(u) + (r.termino ? " (desligado)" : ""), n: L.norm(u + " " + (r.nome || "")), s: L.nomeSup(r.sup) }; });
           } },
    forn: { rot: "Fornecedor", nome: function (id) { return id + " · " + L.titulo(L.nomeForn(id)); },
            itens: function () {
              return Array.from(L.FORN.keys()).sort(function (a, b) { return L.nomeForn(a).localeCompare(L.nomeForn(b), "pt-BR"); })
                .map(function (f) { return { id: f, t: f + " · " + L.titulo(L.nomeForn(f)), n: L.norm(f + " " + L.nomeForn(f)), s: null }; });
            } },
  };
}
L.nomeDe = function (dim, id) { var d = L.DIM && L.DIM[dim]; return d ? d.nome(id) : String(id); };

/* ------------------------------ o recorte (escopo) da tela ------------------------------ */
/* equipes do filtro (códigos) ou null = todas */
L.equipesFiltro = function () {
  var f = L.estado.filtros.eq || [];
  return f.length ? f.map(function (id) { var e = L.equipeDeId(id); return e ? e.cod : null; }).filter(Boolean) : null;
};
/* supervisores do filtro (Set) ou null = todos das equipes escolhidas */
L.supsFiltro = function () {
  var f = L.estado.filtros.sup || [], eqs = L.equipesFiltro();
  if (f.length) return new Set(f);
  if (!eqs) return null;
  return new Set(supsOrdenados().filter(function (s) { return eqs.indexOf(s.eq) >= 0; }).map(function (s) { return s.cod; }));
};
/* RCAs de um conjunto de supervisores (ou de todos) */
L.rcasDe = function (sups) {
  var out = [];
  L.SR.forEach(function (s, u) { var r = L.RCA.get(u); var sup = r ? r.sup : 0; if (!sups || sups.has(sup)) out.push(u); });
  return out;
};
/* Escopo = o que um bloco soma. tipo: total | equipe | semtele | sup | rca | rcas
   grupo: a chave do r_grupo que dá positivação/mix sem contar duas vezes (ou null = soma, aproximada) */
L.escopoDaTela = function () {
  var f = L.estado.filtros, eqs = L.equipesFiltro(), sups = L.supsFiltro();
  if ((f.rca || []).length) {
    var rcas = f.rca.slice();
    return { tipo: rcas.length === 1 ? "rca" : "rcas", rcas: rcas, sups: new Set(rcas.map(function (u) { var r = L.RCA.get(u); return r ? r.sup : 0; })),
             grupo: null, rcaUnico: rcas.length === 1 ? rcas[0] : null, porRca: true,
             nome: rcas.length === 1 ? L.nomeRca(rcas[0]) : rcas.length + " RCAs" };
  }
  if ((f.sup || []).length) {
    var ss = f.sup.slice();
    return { tipo: "sup", rcas: L.rcasDe(sups), sups: sups, grupo: ss.length === 1 ? "P:" + ss[0] : null,
             grupos: ss.map(function (s) { return "P:" + s; }), nome: ss.length === 1 ? L.nomeSup(ss[0]) : ss.length + " supervisores" };
  }
  if (eqs && eqs.length === 1) {
    var e = L.equipeDeCod(eqs[0]);
    return { tipo: "equipe", eq: e.cod, rcas: L.rcasDe(sups), sups: sups, grupo: "E:" + e.cod, nome: e.nome };
  }
  if (eqs) return { tipo: "equipes", rcas: L.rcasDe(sups), sups: sups, grupo: null, grupos: eqs.map(function (c) { return "E:" + c; }),
                    nome: eqs.map(function (c) { return L.equipeDeCod(c).nome; }).join(" + ") };
  return { tipo: "total", rcas: L.rcasDe(null), sups: null, grupo: "T", nome: "LUBE (todas as equipes)" };
};
L.escopoSup = function (cod, rcasFiltro) {
  var sups = new Set([cod]);
  var rcas = L.rcasDe(sups).filter(function (u) { return !rcasFiltro || rcasFiltro.indexOf(u) >= 0; });
  return { tipo: "sup", rcas: rcas, sups: sups, grupo: "P:" + cod, nome: L.nomeSup(cod) };
};
L.escopoEquipe = function (cod, semTele) {
  var sups = new Set(supsOrdenados().filter(function (s) { return s.eq === cod && (!semTele || !s.tele); }).map(function (s) { return s.cod; }));
  return { tipo: semTele ? "semtele" : "equipe", eq: cod, rcas: L.rcasDe(sups), sups: sups, grupo: (semTele ? "S:" : "E:") + cod,
           nome: semTele ? "S/TELEVENDAS" : L.equipeDeCod(cod).nome };
};
L.escopoRca = function (u) {
  var r = L.RCA.get(u);
  return { tipo: "rca", rcas: [u], sups: new Set([r ? r.sup : 0]), grupo: null, rcaUnico: u, porRca: true, nome: L.nomeRca(u) };
};

/* ------------------------------ somar um escopo ------------------------------ */
/* Devolve as séries por mês (índice L.im) e o trecho do mês atual por ano (índice L.ya):
   { v, c, q, d, t, p, x, cv, cc, cq, cd, cp, cx, aprox } — aprox: positivação/mix somados (pode contar duas vezes). */
function acumulador() {
  return { v: zeros(nM), c: zeros(nM), q: zeros(nM), d: zeros(nM), t: zeros(nM), p: zeros(nM), x: zeros(nM),
           cv: zeros(nA), cc: zeros(nA), cq: zeros(nA), cd: zeros(nA), cp: zeros(nA), cx: zeros(nA), aprox: false, temMeta: true };
}
L.acumulador = acumulador;
function somarArr(a, b) { for (var i = 0; i < a.length; i++) a[i] += b[i]; }
L.somarEscopo = function (esc) {
  var a = acumulador();
  esc.rcas.forEach(function (u) {
    var s = L.SR.get(u); if (s) { somarArr(a.v, s.v); somarArr(a.c, s.c); somarArr(a.q, s.q); somarArr(a.d, s.d); somarArr(a.t, s.t); }
    var c = L.CR.get(u); if (c) { somarArr(a.cv, c.v); somarArr(a.cc, c.c); somarArr(a.cq, c.q); somarArr(a.cd, c.d); }
  });
  if (esc.grupo || (esc.grupos && esc.grupos.length)) {
    (esc.grupo ? [esc.grupo] : esc.grupos).forEach(function (g) {
      var gr = L.GR.get(g); if (gr) { somarArr(a.p, gr.p); somarArr(a.x, gr.x); }
      var cg = L.CG.get(g); if (cg) { somarArr(a.cp, cg.p); somarArr(a.cx, cg.x); }
    });
    a.aprox = !esc.grupo;
  } else {
    esc.rcas.forEach(function (u) {
      var s = L.SR.get(u); if (s) { somarArr(a.p, s.p); somarArr(a.x, s.x); }
      var c = L.CR.get(u); if (c) { somarArr(a.cp, c.p); somarArr(a.cx, c.x); }
    });
    a.aprox = esc.rcas.length > 1;
  }
  return a;
};

/* Por fornecedor, dentro de um escopo de supervisores: Map codfornec → acumulador.
   Positivação e mix: do grupo (E:/S:/T) quando o escopo é uma equipe inteira ou tudo; do próprio
   supervisor quando é um só; senão somados (aproximados). Sem meta (a meta é por RCA). */
L.somarFornecedores = function (esc, soForn) {
  var out = new Map(), sups = esc.sups, SF = L.SF, CSF = L.CSF, i, a, f;
  function acc(f) { var x = out.get(f); if (!x) { x = acumulador(); x.temMeta = false; out.set(f, x); } return x; }
  var grupoDistinto = esc.grupo && !/^P:/.test(esc.grupo) ? esc.grupo : null;
  var supUnico = esc.grupo && /^P:/.test(esc.grupo) ? +esc.grupo.slice(2) : null;
  for (i = 0; i < SF.n; i++) {
    if (sups && !sups.has(SF.s[i])) continue;
    f = SF.f[i]; if (soForn && !soForn.has(f)) continue;
    a = acc(f); var m = SF.m[i];
    a.v[m] += SF.v[i]; a.c[m] += SF.c[i]; a.q[m] += SF.q[i]; a.d[m] += SF.d[i];
    if (!grupoDistinto) { a.p[m] += SF.p[i]; a.x[m] += SF.x[i]; if (supUnico == null) a.aprox = true; }
  }
  for (i = 0; i < CSF.n; i++) {
    if (sups && !sups.has(CSF.s[i])) continue;
    f = CSF.f[i]; if (soForn && !soForn.has(f)) continue;
    a = acc(f); var y = CSF.m[i];
    a.cv[y] += CSF.v[i]; a.cc[y] += CSF.c[i]; a.cq[y] += CSF.q[i]; a.cd[y] += CSF.d[i];
    if (!grupoDistinto) { a.cp[y] += CSF.p[i]; a.cx[y] += CSF.x[i]; }
  }
  if (grupoDistinto) {
    var GF = L.GF, CGF = L.CGF;
    for (i = 0; i < GF.n; i++) {
      if (GF.g[i] !== grupoDistinto) continue;
      f = GF.f[i]; if (soForn && !soForn.has(f)) continue;
      a = out.get(f); if (!a) continue;
      a.p[GF.m[i]] = GF.p[i]; a.x[GF.m[i]] = GF.x[i];
    }
    for (i = 0; i < CGF.n; i++) {
      if (CGF.g[i] !== grupoDistinto) continue;
      f = CGF.f[i]; if (soForn && !soForn.has(f)) continue;
      a = out.get(f); if (!a) continue;
      a.cp[CGF.m[i]] = CGF.p[i]; a.cx[CGF.m[i]] = CGF.x[i];
    }
  }
  return out;
};
/* Resposta da /api/consulta (produtos ou fornecedores) → Map código → acumulador */
L.acumularConsulta = function (j, campoCod) {
  var out = new Map();
  if (!j || !j.m) return out;
  for (var i = 0; i < j.m.length; i++) {
    var cod = j[campoCod][i], a = out.get(cod);
    if (!a) { a = acumulador(); a.temMeta = false; out.set(cod, a); }
    var m = L.im(j.m[i]); if (m < 0 || m >= nM) continue;
    a.v[m] = j.v[i]; a.c[m] = j.c[i]; a.q[m] = j.q[i]; a.d[m] = j.d[i];
    a.p[m] = j.n ? j.n[i] : j.p[i]; a.x[m] = j.x ? j.x[i] : (j.v[i] > 0 ? 1 : 0);
    if (j.m[i] % 100 === L.MOA) {
      var y = L.ya(Math.floor(j.m[i] / 100));
      a.cv[y] = j.vc[i]; a.cc[y] = j.cc[i]; a.cq[y] = j.qc[i]; a.cd[y] = j.dc[i];
      a.cp[y] = j.nc ? j.nc[i] : j.pc[i]; a.cx[y] = j.xc ? j.xc[i] : (j.vc[i] > 0 ? 1 : 0);
    }
  }
  return out;
};
/* soma vários acumuladores (ex.: os fornecedores escolhidos no filtro) */
L.somarAcumuladores = function (lista) {
  var a = acumulador(); a.temMeta = false;
  lista.forEach(function (b) {
    ["v", "c", "q", "d", "p", "x", "cv", "cc", "cq", "cd", "cp", "cx"].forEach(function (k) { somarArr(a[k], b[k]); });
    if (b.aprox) a.aprox = true;
  });
  if (lista.length > 1) a.aprox = true;
  return a;
};

/* ------------------------------ indicadores ------------------------------ */
/* valor de um indicador num mês (índice) ou no trecho (ano) de um acumulador */
L.IND = {
  fat:    { rot: "Faturamento", linha: "Sell Out", icone: "dinheiro", tipo: "moeda", soma: true,
            mes: function (a, m) { return a.v[m] - a.d[m]; }, corte: function (a, y) { return a.cv[y] - a.cd[y]; },
            tem: function (a, m) { return a.v[m] !== 0 || a.d[m] !== 0; } },
  posit:  { rot: "Positivação", linha: "Positivação", icone: "pessoas", tipo: "inteiro", soma: false,
            mes: function (a, m) { return a.p[m]; }, corte: function (a, y) { return a.cp[y]; }, tem: function (a, m) { return a.p[m] > 0; } },
  mix:    { rot: "Mix (SKUs)", linha: "SKUs", icone: "caixa", tipo: "inteiro", soma: false,
            mes: function (a, m) { return a.x[m]; }, corte: function (a, y) { return a.cx[y]; }, tem: function (a, m) { return a.x[m] > 0; } },
  margem: { rot: "Margem", linha: "Margem", icone: "percent", tipo: "pct", soma: false,
            mes: function (a, m) { return a.v[m] ? (a.v[m] - a.c[m]) / a.v[m] * 100 : null; },
            corte: function (a, y) { return a.cv[y] ? (a.cv[y] - a.cc[y]) / a.cv[y] * 100 : null; }, tem: function (a, m) { return a.v[m] !== 0; } },
  qt:     { rot: "Quantidade", linha: "Quantidade", icone: "caixa", tipo: "inteiro", soma: true,
            mes: function (a, m) { return a.q[m]; }, corte: function (a, y) { return a.cq[y]; }, tem: function (a, m) { return a.q[m] !== 0; } },
};
L.fmtInd = function (ind, v) {
  if (v == null || !isFinite(v)) return "";
  var t = L.IND[ind].tipo;
  if (t === "pct") return L.fNum(v, 1) + "%";
  return L.fNum(v, 0);
};
L.fmtIndLongo = function (ind, v) {
  if (v == null || !isFinite(v)) return "—";
  var t = L.IND[ind].tipo;
  if (t === "moeda") return L.fBRL(v);
  if (t === "pct") return L.fNum(v, 2) + "%";
  return L.fNum(v, 0);
};

})();
