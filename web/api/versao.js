/**
 * /api/versao — o que há de novo, numa consulta pequena e sem cache:
 *   pacotes   as versões dos pacotes prontos (dim, base_hist, base_rec, forn_hist, forn_rec); o navegador
 *             só baixa (/api/pacote) o que mudou
 *   agente    o AGENTE LUBE está ligado? (batimento com menos de 3 minutos) e quando ele leu a venda de
 *             hoje pela última vez
 *   pedido    com ?pedido=<id>: como está o pedido do botão Atualizar
 * O navegador pergunta isto de 15 em 15 segundos com a aba aberta.
 */
"use strict";
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

const SQL =
  `SELECT (SELECT json_agg(json_build_object('nome', nome, 'versao', versao, 'gerado_em', gerado_em, 'linhas', linhas,
                                            'bytes', bytes_json, 'meta', meta) ORDER BY nome)
             FROM analise_comercial.pacote) AS pacotes,
          b.visto AS agente_visto, coalesce(b.ligado, false) AS agente_ligado,
          e.lido_em AS lido_em, e.mudou_em AS gravou_em, e.status AS fluxo_status,
          coalesce(e.lido_em > now() - interval '3 minutes', false) AS fluxo_vivo,
          p.id AS pedido_id, p.status AS pedido_status, p.mensagem AS pedido_mensagem, p.detalhe AS pedido_detalhe,
          p.segundos AS pedido_segundos, p.atendido_em AS pedido_atendido_em
     FROM (SELECT 1) x
     LEFT JOIN (SELECT max(visto_em) AS visto, bool_or(ligado) AS ligado FROM agente.batimento
                 WHERE visto_em > now() - interval '3 minutes') b ON true
     LEFT JOIN agente.estado e ON e.fluxo = 'analise_comercial.venda'
     LEFT JOIN agente.pedido p ON p.id = $1 AND p.sistema = 'analise_comercial'`;

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const bruto = new URL(req.url, "http://x").searchParams.get("pedido");
    const pedido = /^\d{1,15}$/.test(bruto || "") ? bruto : null;
    const l = (await consultar(SQL, [pedido])).rows[0] || {};
    const out = {
      pacotes: l.pacotes || [],
      // "ao vivo" só quando o agente está ligado E leu a venda desta análise há pouco (não basta o agente estar no ar)
      agente: { vivo: !!(l.agente_visto && l.agente_ligado && l.fluxo_vivo), ligado: !!(l.agente_visto && l.agente_ligado), visto_em: l.agente_visto || null, lido_em: l.lido_em || null,
                gravou_em: l.gravou_em || null, status: l.fluxo_status || null },
    };
    if (pedido) {
      out.pedido = l.pedido_id ? { id: Number(l.pedido_id), status: l.pedido_status, mensagem: l.pedido_mensagem,
        detalhe: l.pedido_detalhe, segundos: l.pedido_segundos == null ? null : Number(l.pedido_segundos), atendido_em: l.pedido_atendido_em } : null;
    }
    json(res, 200, out);
  } catch (e) {
    erroBanco(res, e);
  }
};
