-- =============================================================================
-- Análise Comercial — POSITIVAÇÃO = a do Relatório 146 (2026-11-10)
--
-- Júlio: "os BI's do painel precisam bater entre eles, precisam sempre ser o mesmo número". O ES do mês em
-- andamento não batia com o 146: aqui contava só cliente com pedido FATURADO (e venda > 0); o 146 conta cliente
-- com PEDIDO DIGITADO (posição L, M, B, P, F ou C sem data de cancelamento, fora as condições 4, 8, 10, 13, 20,
-- 98 e 99). Com a regra do 146 os dois painéis dão o mesmo número com as mesmas datas, e a planilha do gestor
-- também bate melhor (era a regra dela).
--
-- A tabela é desta análise (o relatorio146.pedido só tem desde 2025 e é de outro sistema): o agente lê o mesmo
-- SQL do 146, só o cabeçalho (fluxos analise_comercial.pedido e pedido_60d); o histórico desde 30/12/2023 entra
-- pela conferencia/carga_historico.py. Os resumos (r_ e c_) e a consulta_distintos contam a positivação daqui;
-- o mix e tudo o que tem fornecedor seguem pelos itens faturados (analise_comercial.venda).
-- =============================================================================
create table if not exists analise_comercial.pedido (
  numped  bigint primary key,
  data    date not null,
  codusur integer not null,
  codcli  bigint not null
);
create index if not exists pedido_data on analise_comercial.pedido (data);
create index if not exists pedido_rca on analise_comercial.pedido (codusur, data);
comment on table analise_comercial.pedido is
  'Pedidos digitados (a regra do Relatório 146: posição L, M, B, P, F ou C sem cancelamento; fora as condições 4, 8, 10, 13, 20, 98, 99), só cabeçalho: a POSITIVAÇÃO. Gravado pelo AGENTE LUBE.';
alter table analise_comercial.pedido enable row level security;
revoke all on analise_comercial.pedido from anon, authenticated;

drop trigger if exists pedido_sujo_i on analise_comercial.pedido;
drop trigger if exists pedido_sujo_u on analise_comercial.pedido;
drop trigger if exists pedido_sujo_d on analise_comercial.pedido;
create trigger pedido_sujo_i after insert on analise_comercial.pedido referencing new table as novas
  for each statement execute function analise_comercial.marcar_sujo();
create trigger pedido_sujo_u after update on analise_comercial.pedido referencing old table as velhas new table as novas
  for each statement execute function analise_comercial.marcar_sujo();
create trigger pedido_sujo_d after delete on analise_comercial.pedido referencing old table as velhas
  for each statement execute function analise_comercial.marcar_sujo();
