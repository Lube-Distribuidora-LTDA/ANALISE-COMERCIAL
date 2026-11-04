-- =============================================================================
-- ANÁLISE COMERCIAL — schema `analise_comercial` no DATA WAREHOUSE (migração analise_comercial_01_schema)
-- 2026-11-04. A planilha "ACOMP INDICADORES ANO" do gestor comercial (faturamento, positivação, mix e
-- margem, mês a mês, ano contra ano, por supervisor) virando sistema, com a mesma cara, e aberta por
-- equipe, supervisor, RCA, fornecedor e produto do fornecedor.
--
-- A regra, descoberta contra a planilha (conferencia/conferir_planilha.py):
--   SELL OUT    = venda do Relatório 146 (pedido FATURADO, pela data do pedido, sem ST, fora bonificação e
--                 as condições 5, 6, 11 e 12) − devolução sem ST (PCMOV ED: QT × (PUNITCONT − ST), pela
--                 data do movimento). Por item: QT × (PVENDA − ST), que soma exatamente a venda do pedido.
--   SUPERVISOR  = o ATUAL do RCA (PCUSUARI), como a planilha. O RCA 41 conta em Televendas
--                 (ajuste_rca), decisão do Júlio em 2026-11-04.
--   MÊS         = mês COMERCIAL, de semanas fechadas sábado → sexta (tabela calendario). Fev/2026 bateu
--                 ao real e jan a set/2026 ficaram entre 0,00% e 0,06% da planilha.
--   POSITIVAÇÃO = clientes distintos com venda; MIX = SKUs distintos vendidos; MARGEM = (venda − custo) ÷
--                 venda, com custo = QT × (VLCUSTOFIN − ST) de todos os itens (o lucro do 146).
--   META        = a do WinThor (PCMETARCA, que soma exatamente a PCMETASUP), decisão do Júlio.
--
-- Quem grava: o AGENTE LUBE (Desktop\BI\22. AGENTE LUBE, fluxos/analise_comercial.toml) mantém os últimos
-- 45 dias ao vivo; o histórico desde 30/12/2023 entra por conferencia/carga_historico.py. Depois de gravar,
-- o agente roda analise_comercial.atualizar() (02-resumos-e-pacotes.sql), que refaz os resumos e os
-- pacotes que o painel lê. O painel não lê as tabelas ao abrir.
-- =============================================================================

create schema if not exists analise_comercial;
comment on schema analise_comercial is
  'ANÁLISE COMERCIAL (planilha ACOMP INDICADORES do gestor: sell out, positivação, mix e margem por mês comercial, ano contra ano). Gravado pelo AGENTE LUBE; painel em Desktop\BI\26. ANALISE COMERCIAL.';

-- ----------------------------------------------------------------------------- 1. o que vem do WinThor
create table if not exists analise_comercial.venda (
  data     date    not null,            -- data do PEDIDO (PCPEDC.DATA), como o Relatório 146
  codusur  integer not null,
  codcli   integer not null,
  codprod  integer not null,
  venda    numeric not null default 0,  -- Σ QT × (PVENDA − ST), zero na bonificação e nas condições 5, 6, 11, 12
  qt       numeric not null default 0,  -- quantidade vendida (fora bonificação)
  custo    numeric not null default 0,  -- Σ QT × (VLCUSTOFIN − ST) de todos os itens (o custo do lucro do 146)
  primary key (data, codusur, codcli, codprod)
);
comment on table analise_comercial.venda is
  'Pedidos FATURADOS (posição F) por dia do pedido × RCA × cliente × produto. Regra do Relatório 146. Gravado pelo AGENTE LUBE (45 dias) e pela carga histórica.';
comment on column analise_comercial.venda.venda is 'Σ QT × (PVENDA − ST), zero na bonificação e nas condições 5, 6, 11, 12';
comment on column analise_comercial.venda.custo is 'Σ QT × (VLCUSTOFIN − ST) de todos os itens (o custo do lucro do 146)';
create index if not exists venda_prod on analise_comercial.venda (codprod, data);

create table if not exists analise_comercial.devolucao (
  data     date    not null,            -- PCMOV.DTMOV
  codusur  integer not null,
  codcli   integer not null,
  codprod  integer not null,
  dev      numeric not null default 0,  -- Σ QT × (PUNITCONT − ST)
  qt       numeric not null default 0,
  primary key (data, codusur, codcli, codprod)
);
comment on table analise_comercial.devolucao is
  'Devolução de cliente (PCMOV ED, sem cancelados) sem ST, por dia × RCA × cliente × produto. Sai do sell out.';
create index if not exists devolucao_prod on analise_comercial.devolucao (codprod, data);

create table if not exists analise_comercial.meta (
  data      date    not null,
  codfilial text    not null,
  codusur   integer not null,
  valor     numeric not null,           -- PCMETARCA.VLVENDAPREV (por dia útil)
  primary key (data, codfilial, codusur)
);
comment on table analise_comercial.meta is
  'Meta de venda do RCA por dia (PCMETARCA). Somada pelo supervisor atual do RCA, dá a PCMETASUP. Vai para o mês do calendário da data.';

create table if not exists analise_comercial.rca (
  codusur       integer primary key,
  nome          text,
  codsupervisor integer,
  codfilial     text,
  bloqueio      text,
  dttermino     date
);
create table if not exists analise_comercial.supervisor (
  codsupervisor integer primary key,
  nome          text,
  codgerente    integer,
  posicao       text
);
create table if not exists analise_comercial.produto (
  codprod    integer primary key,
  descricao  text,
  codfornec  integer,
  embalagem  text,
  unidade    text,
  codepto    integer,
  codsec     integer,
  obs2       text,
  dtexclusao date
);
create table if not exists analise_comercial.fornecedor (
  codfornec      integer primary key,
  fornecedor     text,
  codfornecprinc integer
);

-- ----------------------------------------------------------------------------- 2. o que é escolha da Lube (muda por UPDATE)
create table if not exists analise_comercial.calendario (
  ano    smallint not null,
  mes    smallint not null check (mes between 1 and 12),
  inicio date     not null,
  fim    date     not null check (fim >= inicio),
  origem text     not null default 'padrao' check (origem in ('planilha', 'deduzido', 'padrao', 'comercial')),
  obs    text,
  primary key (ano, mes)
);
comment on table analise_comercial.calendario is
  'Mês comercial: semanas fechadas de sábado a sexta (4-4-4-5-4-5-4-4-5-4-4-5 em 2025 e 2026). origem: planilha = bateu com a planilha do gestor; deduzido = melhor encaixe em 2024 (a conferir com o comercial); padrao = o mesmo desenho, ainda sem conferência; comercial = confirmado pelo comercial. Trocou? Rode analise_comercial.gerar_dias() e analise_comercial.reconstruir().';

create table if not exists analise_comercial.dia (
  data       date     primary key,
  mes        integer  not null,          -- AAAAMM do mês comercial
  ano        smallint not null,
  mes_do_ano smallint not null,
  ordem      integer  not null           -- dias desde o começo do mês comercial (0 = o primeiro sábado)
);
create index if not exists dia_mes on analise_comercial.dia (mes);

create table if not exists analise_comercial.supervisor_grupo (
  codsupervisor integer primary key,
  equipe        text    not null check (equipe in ('ES', 'RJ', 'BA', 'OUTROS')),
  rotulo        text,                    -- o nome curto da planilha (CENTRAL SUL, LITORAL SUL...)
  ordem         integer,
  televendas    boolean not null default false   -- fica fora do bloco "sem televendas" da equipe
);
comment on table analise_comercial.supervisor_grupo is
  'Equipe e ordem de cada supervisor, como na planilha do gestor. Supervisor que não está aqui vai pela sigla do nome (ES -, RJ -, BA -) ou para OUTROS.';

create table if not exists analise_comercial.ajuste_rca (
  codusur       integer primary key,
  codsupervisor integer not null,
  motivo        text    not null,
  criado_em     timestamptz not null default now(),
  criado_por    text
);
comment on table analise_comercial.ajuste_rca is
  'RCA que o comercial conta noutro supervisor que não o do WinThor. Aparece na tela com aviso.';

create table if not exists analise_comercial.config (
  chave text primary key,
  valor jsonb not null,
  obs   text
);

-- ----------------------------------------------------------------------------- 3. os dados de partida
insert into analise_comercial.calendario (ano, mes, inicio, fim, origem, obs) values
  (2024,  1, '2023-12-30', '2024-02-02', 'deduzido', '5 semanas'),
  (2024,  2, '2024-02-03', '2024-03-01', 'deduzido', null),
  (2024,  3, '2024-03-02', '2024-03-29', 'deduzido', null),
  (2024,  4, '2024-03-30', '2024-05-03', 'deduzido', '5 semanas'),
  (2024,  5, '2024-05-04', '2024-05-31', 'deduzido', null),
  (2024,  6, '2024-06-01', '2024-06-28', 'deduzido', null),
  (2024,  7, '2024-06-29', '2024-08-02', 'deduzido', '5 semanas'),
  (2024,  8, '2024-08-03', '2024-08-30', 'deduzido', null),
  (2024,  9, '2024-08-31', '2024-10-04', 'deduzido', '5 semanas'),
  (2024, 10, '2024-10-05', '2024-11-01', 'deduzido', null),
  (2024, 11, '2024-11-02', '2024-11-29', 'deduzido', null),
  (2024, 12, '2024-11-30', '2025-01-03', 'deduzido', '5 semanas'),
  (2025,  1, '2025-01-04', '2025-01-31', 'planilha', null),
  (2025,  2, '2025-02-01', '2025-02-28', 'planilha', null),
  (2025,  3, '2025-03-01', '2025-03-28', 'planilha', null),
  (2025,  4, '2025-03-29', '2025-05-02', 'planilha', '5 semanas'),
  (2025,  5, '2025-05-03', '2025-05-30', 'planilha', null),
  (2025,  6, '2025-05-31', '2025-07-04', 'planilha', '5 semanas'),
  (2025,  7, '2025-07-05', '2025-08-01', 'planilha', null),
  (2025,  8, '2025-08-02', '2025-08-29', 'planilha', null),
  (2025,  9, '2025-08-30', '2025-10-03', 'planilha', '5 semanas'),
  (2025, 10, '2025-10-04', '2025-10-31', 'planilha', null),
  (2025, 11, '2025-11-01', '2025-11-28', 'planilha', null),
  (2025, 12, '2025-11-29', '2026-01-02', 'planilha', '5 semanas'),
  (2026,  1, '2026-01-03', '2026-01-30', 'planilha', null),
  (2026,  2, '2026-01-31', '2026-02-27', 'planilha', 'bateu ao real'),
  (2026,  3, '2026-02-28', '2026-03-27', 'planilha', null),
  (2026,  4, '2026-03-28', '2026-05-01', 'planilha', '5 semanas'),
  (2026,  5, '2026-05-02', '2026-05-29', 'planilha', null),
  (2026,  6, '2026-05-30', '2026-07-03', 'planilha', '5 semanas'),
  (2026,  7, '2026-07-04', '2026-07-31', 'planilha', null),
  (2026,  8, '2026-08-01', '2026-08-28', 'planilha', null),
  (2026,  9, '2026-08-29', '2026-10-02', 'planilha', '5 semanas'),
  (2026, 10, '2026-10-03', '2026-10-30', 'padrao',   null),
  (2026, 11, '2026-10-31', '2026-11-27', 'padrao',   null),
  (2026, 12, '2026-11-28', '2027-01-01', 'padrao',   '5 semanas'),
  (2027,  1, '2027-01-02', '2027-01-29', 'padrao',   null),
  (2027,  2, '2027-01-30', '2027-02-26', 'padrao',   null),
  (2027,  3, '2027-02-27', '2027-03-26', 'padrao',   null),
  (2027,  4, '2027-03-27', '2027-04-30', 'padrao',   '5 semanas'),
  (2027,  5, '2027-05-01', '2027-05-28', 'padrao',   null),
  (2027,  6, '2027-05-29', '2027-07-02', 'padrao',   '5 semanas'),
  (2027,  7, '2027-07-03', '2027-07-30', 'padrao',   null),
  (2027,  8, '2027-07-31', '2027-08-27', 'padrao',   null),
  (2027,  9, '2027-08-28', '2027-10-01', 'padrao',   '5 semanas'),
  (2027, 10, '2027-10-02', '2027-10-29', 'padrao',   null),
  (2027, 11, '2027-10-30', '2027-11-26', 'padrao',   null),
  (2027, 12, '2027-11-27', '2027-12-31', 'padrao',   '5 semanas')
on conflict (ano, mes) do nothing;

insert into analise_comercial.supervisor_grupo (codsupervisor, equipe, rotulo, ordem, televendas) values
  ( 1, 'ES', 'CENTRAL SUL',       1, false),
  (17, 'ES', 'LITORAL SUL',       2, false),
  (16, 'ES', 'NORDESTE',          3, false),
  (13, 'ES', 'NOROESTE',          4, false),
  ( 4, 'ES', 'NORTE',             5, false),
  ( 7, 'ES', 'VITÓRIA NORTE',     6, false),
  (12, 'ES', 'VITÓRIA SUL',       7, false),
  ( 8, 'ES', 'TELEVENDAS',        8, true),
  ( 6, 'ES', 'GRANDES CONTAS',    9, false),
  (14, 'ES', 'FARMA',            10, false),
  (21, 'RJ', 'NORTE E NOROESTE', 21, false),
  (22, 'RJ', 'REGIÃO DOS LAGOS', 22, false),
  (23, 'RJ', 'SERRANA',          23, false),
  (24, 'RJ', 'FARMA',            24, false),
  (30, 'BA', 'EXTREMO SUL',      30, false),
  (31, 'BA', 'SUL',              31, false),
  (32, 'BA', 'SUDOESTE',         32, false),
  (33, 'BA', 'RECÔNCAVO',        33, false),
  (34, 'BA', 'METROPOLITANA',    34, false),
  ( 3, 'OUTROS', 'LUBE DISTRIBUIDORA (OPERAÇÃO INTERNA)', 90, false),
  (15, 'OUTROS', 'TELEVENDAS',   91, true),
  ( 5, 'OUTROS', 'SUPERVISOR TRIGO', 92, false),
  (100, 'OUTROS', 'INATIVO',     98, false)
on conflict (codsupervisor) do nothing;

insert into analise_comercial.ajuste_rca (codusur, codsupervisor, motivo, criado_por) values
  (41, 8, 'Na planilha do gestor (ACOMP INDICADORES ANO) o RCA 41 conta em Televendas; no WinThor é de Grandes Contas. Decisão do Júlio em 2026-11-04.', 'Claude')
on conflict (codusur) do nothing;

insert into analise_comercial.config (chave, valor, obs) values
  ('equipe_padrao', '"ES"', 'equipe que o painel abre (decisão do Júlio em 2026-11-04)'),
  ('janela_dias', '46', 'meses comerciais que tocam os últimos N dias são refeitos a cada atualizar() (a janela do agente é de 45)')
on conflict (chave) do nothing;

-- calendário sem buraco nem sobreposição: cada mês começa no dia seguinte ao fim do anterior
do $$
declare r record;
begin
  for r in select ano, mes, inicio, lag(fim) over (order by ano, mes) as fim_ant from analise_comercial.calendario loop
    if r.fim_ant is not null and r.inicio <> r.fim_ant + 1 then
      raise exception 'calendario: %/% começa em % mas o mês anterior termina em %', r.mes, r.ano, r.inicio, r.fim_ant;
    end if;
  end loop;
end $$;

create or replace function analise_comercial.gerar_dias() returns integer
language plpgsql as $$
declare n integer;
begin
  delete from analise_comercial.dia;
  insert into analise_comercial.dia (data, mes, ano, mes_do_ano, ordem)
  select d::date, c.ano * 100 + c.mes, c.ano, c.mes, (d::date - c.inicio)
    from analise_comercial.calendario c
    cross join lateral generate_series(c.inicio, c.fim, interval '1 day') d;
  get diagnostics n = row_count;
  return n;
end $$;
select analise_comercial.gerar_dias();

-- ----------------------------------------------------------------------------- 4. segurança: só o servidor lê
alter table analise_comercial.venda            enable row level security;
alter table analise_comercial.devolucao        enable row level security;
alter table analise_comercial.meta             enable row level security;
alter table analise_comercial.rca              enable row level security;
alter table analise_comercial.supervisor       enable row level security;
alter table analise_comercial.produto          enable row level security;
alter table analise_comercial.fornecedor       enable row level security;
alter table analise_comercial.calendario       enable row level security;
alter table analise_comercial.dia              enable row level security;
alter table analise_comercial.supervisor_grupo enable row level security;
alter table analise_comercial.ajuste_rca       enable row level security;
alter table analise_comercial.config           enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema analise_comercial from anon, authenticated;
    revoke all on all tables in schema analise_comercial from anon, authenticated;
    revoke all on function analise_comercial.gerar_dias() from anon, authenticated;
  end if;
end $$;
