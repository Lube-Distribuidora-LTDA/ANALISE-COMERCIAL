/**
 * /api/consulta (POST) — o que não cabe nos pacotes e se calcula na hora, no recorte de RCAs da tela:
 *   { tipo: "produtos", forn: <codfornec>, rcas: [codusur...] | null }
 *       os produtos do fornecedor por mês: venda, custo, quantidade, devolução, positivação exata
 *       (analise_comercial.consulta_produtos)
 *   { tipo: "rcas", forns: [codfornec...], rcas: [codusur...] | null }
 *       os RCAs só na venda dos fornecedores escolhidos (analise_comercial.consulta_rcas)
 *   { tipo: "fornecedores", rcas: [codusur...] }
 *       os fornecedores de um grupo de RCAs, com positivação e mix exatos
 *       (analise_comercial.consulta_fornecedores)
 *   { tipo: "distintos", rcas: [codusur...], forns: [codfornec...] | null }
 *       positivação e mix recontados para um grupo de RCAs (quando se tira RCA da comparação)
 *       (analise_comercial.consulta_distintos)
 * Os dois trazem também o trecho do mês atual que já fechou, para a comparação com o mesmo número de dias.
 * POST porque a lista de RCAs de uma equipe inteira passa de 300 códigos.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((ok, falha) => {
    let s = "";
    req.on("data", (c) => { s += c; if (s.length > 200000) { falha(new Error("pedido grande demais")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { falha(e); } });
    req.on("error", falha);
  });
}
function codigos(a) {
  if (a == null) return null;
  if (!Array.isArray(a) || a.length > 5000) throw new Error("rcas");
  return a.map((x) => { const n = Number(x); if (!Number.isInteger(n) || n < 0 || n > 99999999) throw new Error("rcas"); return n; });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { erro: "metodo", mensagem: "Use POST." }, { Allow: "POST" });
  if (semConfiguracao(res)) return;
  let corpo, rcas;
  try { corpo = await lerCorpo(req); rcas = codigos(corpo.rcas); }
  catch (e) { return json(res, 400, { erro: "pedido", mensagem: "Pedido inválido." }); }
  try {
    let r;
    if (corpo.tipo === "produtos") {
      const forn = Number(corpo.forn);
      if (!Number.isInteger(forn) || forn < 0) return json(res, 400, { erro: "forn", mensagem: "Fornecedor inválido." });
      r = await consultar("SELECT analise_comercial.consulta_produtos($1, $2) AS j", [forn, rcas]);
    } else if (corpo.tipo === "rcas") {
      const forns = codigos(corpo.forns);
      if (!forns || !forns.length) return json(res, 400, { erro: "forns", mensagem: "Escolha ao menos um fornecedor." });
      r = await consultar("SELECT analise_comercial.consulta_rcas($1, $2) AS j", [forns, rcas]);
    } else if (corpo.tipo === "fornecedores") {
      if (!rcas || !rcas.length) return json(res, 400, { erro: "rcas", mensagem: "Escolha ao menos um RCA." });
      r = await consultar("SELECT analise_comercial.consulta_fornecedores($1) AS j", [rcas]);
    } else if (corpo.tipo === "distintos") {
      if (!rcas || !rcas.length) return json(res, 400, { erro: "rcas", mensagem: "Escolha ao menos um RCA." });
      r = await consultar("SELECT analise_comercial.consulta_distintos($1, $2) AS j", [rcas, codigos(corpo.forns)]);
    } else {
      return json(res, 400, { erro: "tipo", mensagem: "Consulta desconhecida." });
    }
    json(res, 200, r.rows[0].j || {});
  } catch (e) {
    erroBanco(res, e);
  }
};
