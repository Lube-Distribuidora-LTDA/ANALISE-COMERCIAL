/**
 * /api/pacote?nome=dim|base_hist|base_rec|forn_hist|forn_rec&v=<versão> — um dos pacotes prontos, comprimido.
 *
 * Quem monta é o AGENTE LUBE: depois de gravar, ele roda analise_comercial.atualizar(), que refaz os
 * resumos dos meses que mudaram e só troca a versão do pacote cujo conteúdo mudou. O banco guarda texto
 * (o TOAST comprime no disco): a compressão é aqui (~5 MB do forn_hist viram ~1 MB).
 * Bytes crus (application/octet-stream + X-Pacote: gzip): o que trafega é sempre o comprimido. Venda por
 * RCA é dado da empresa: cache só no navegador de quem entrou.
 */
"use strict";
const zlib = require("zlib");
const { consultar, json, semConfiguracao, erroBanco } = require("./_db");

module.exports = async function handler(req, res) {
  if (semConfiguracao(res)) return;
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const nome = q.get("nome"), v = q.get("v");
    if (!/^(dim|base_hist|base_rec|forn_hist|forn_rec)$/.test(nome || "")) return json(res, 400, { erro: "nome", mensagem: "Pacote desconhecido." });
    const l = (await consultar("SELECT versao, payload FROM analise_comercial.pacote WHERE nome = $1", [nome])).rows[0];
    if (!l) return json(res, 404, { erro: "sem_pacote", mensagem: "O pacote '" + nome + "' ainda não foi montado." });
    const corpo = zlib.gzipSync(Buffer.from(l.payload, "utf8"), { level: 6 });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Pacote", "gzip");
    res.setHeader("X-Versao", l.versao);
    res.setHeader("Content-Length", corpo.length);
    // a URL leva a versão: se bater, o navegador pode reaproveitar sem perguntar de novo
    res.setHeader("Cache-Control", v && v === l.versao ? "private, max-age=31536000, immutable" : "private, no-cache");
    res.end(corpo);
  } catch (e) {
    erroBanco(res, e);
  }
};
