/**
 * /api/atualizar (POST) — o botão Atualizar pede ao AGENTE LUBE uma leitura do WinThor agora.
 *
 * A ponte é o próprio banco: agente.pedir_atualizacao() grava o pedido e avisa por NOTIFY; o agente, na
 * SRV-IA, escuta na conexão que já mantém aberta para fora, lê a venda no WinThor na hora, roda o
 * analise_comercial.atualizar() e responde no pedido (agente.pedido). Nenhuma porta aberta na rede da
 * Lube, e o painel nunca chega no Oracle. O navegador acompanha por /api/versao?pedido=<id>.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { erro: "metodo", mensagem: "Use POST." }, { Allow: "POST" });
  if (semConfiguracao(res)) return;
  try {
    const r = await consultar(
      `WITH a AS (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento WHERE visto_em > now() - interval '3 minutes'),
            f AS (SELECT count(*) AS n FROM agente.fluxo WHERE sistema = 'analise_comercial' AND ativo)
       SELECT a.visto, coalesce(a.ligado, false) AS ligado, f.n AS fluxos,
              CASE WHEN a.visto IS NOT NULL AND a.ligado AND f.n > 0 THEN agente.pedir_atualizacao('analise_comercial', 'painel analise-comercial') END AS pedido
         FROM a, f`, []);
    const l = r.rows[0] || {};
    if (!l.pedido) {
      return json(res, 200, { agente: false, visto_em: l.visto || null,
        mensagem: !Number(l.fluxos) ? "Os fluxos desta análise ainda não estão no agente."
          : l.visto ? "O agente do WinThor está em pausa." : "O agente do WinThor não está ligado agora." });
    }
    json(res, 200, { agente: true, pedido: Number(l.pedido) });
  } catch (e) {
    erroBanco(res, e);
  }
};
