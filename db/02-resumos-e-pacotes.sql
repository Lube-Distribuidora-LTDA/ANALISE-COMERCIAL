-- =============================================================================
-- ANÁLISE COMERCIAL — resumos e pacotes do painel (migração analise_comercial_02_resumos_e_pacotes)
-- 2026-11-04. Roda depois do 01-schema.sql.
--
-- O painel não lê as tabelas de venda ao abrir: lê pacotes prontos (analise_comercial.pacote), feitos
-- a partir de resumos por mês comercial:
--   r_rca         mês × RCA: venda, custo, quantidade, devolução, positivação, mix e meta
--   r_grupo       mês × grupo: positivação e mix SEM CONTAR DUAS VEZES (cliente que comprou de dois RCAs
--                 do mesmo supervisor conta uma vez). Grupos: 'P:<supervisor>', 'E:<equipe>',
--                 'S:<equipe>' (a equipe sem televendas, como o bloco "S/TELEVENDAS" da planilha) e 'T'.
--   r_sup_forn    mês × supervisor × fornecedor: o mesmo, por fornecedor
--   r_grupo_forn  mês × grupo × fornecedor: positivação e mix do fornecedor sem contar duas vezes
--   c_*           o mesmo, só no TRECHO do mês comercial atual que já fechou (até ontem), em todos os
--                 anos: a comparação do mês em andamento é com o mesmo número de dias (as semanas do
--                 mês comercial começam todas no sábado, então o dia N cai no mesmo dia da semana).
--
-- Quem chama: o AGENTE LUBE depois de gravar (agente.sistema.apos_gravar = analise_comercial.atualizar()).
-- O gatilho das tabelas venda, devolução e meta marca a menor data que mudou (analise_comercial.sujo); o
-- atualizar() refaz só os meses dali para a frente. Mudou o supervisor de um RCA ou o fornecedor de um
-- produto (o "mapa"), refaz tudo.
-- =============================================================================

-- ----------------------------------------------------------------------------- equipe de cada supervisor e mapa do RCA
create or replace view analise_comercial.v_supervisor as
select s.codsupervisor, s.nome,
       coalesce(g.equipe, case when s.nome ~* '^\s*ES\s*-' then 'ES' when s.nome ~* '^\s*RJ\s*-' then 'RJ'
                               when s.nome ~* '^\s*BA\s*-' then 'BA' else 'OUTROS' end) as equipe,
       coalesce(g.rotulo, upper(trim(regexp_replace(s.nome, '^\s*(ES|RJ|BA)\s*-\s*', '', 'i')))) as rotulo,
       coalesce(g.ordem, 900 + s.codsupervisor) as ordem,
       coalesce(g.televendas, false) as televendas
  from analise_comercial.supervisor s
  left join analise_comercial.supervisor_grupo g using (codsupervisor);

create table if not exists analise_comercial.mapa_rca (
  codusur       integer primary key,
  codsupervisor integer not null,       -- o atual do WinThor, ou o do ajuste_rca
  equipe        text    not null,
  televendas    boolean not null
);

create or replace function analise_comercial.refazer_mapa() returns text
language plpgsql as $$
declare h text;
begin
  delete from analise_comercial.mapa_rca;
  insert into analise_comercial.mapa_rca (codusur, codsupervisor, equipe, televendas)
  select r.codusur, coalesce(a.codsupervisor, r.codsupervisor, 0), coalesce(s.equipe, 'OUTROS'), coalesce(s.televendas, false)
    from analise_comercial.rca r
    left join analise_comercial.ajuste_rca a using (codusur)
    left join analise_comercial.v_supervisor s on s.codsupervisor = coalesce(a.codsupervisor, r.codsupervisor);
  select md5(coalesce((select string_agg(codusur || ':' || codsupervisor || ':' || equipe || ':' || televendas, ',' order by codusur)
                         from analise_comercial.mapa_rca), '')
          || '|' || coalesce((select string_agg(codprod || ':' || coalesce(codfornec, 0), ',' order by codprod)
                                from analise_comercial.produto), ''))
    into h;
  return h;
end $$;

-- ----------------------------------------------------------------------------- o que mudou (gatilho)
create table if not exists analise_comercial.sujo (
  id    integer primary key default 1 check (id = 1),
  desde date
);
insert into analise_comercial.sujo (id, desde) values (1, null) on conflict (id) do nothing;

create or replace function analise_comercial.marcar_sujo() returns trigger
language plpgsql as $$
declare d date;
begin
  if TG_OP = 'INSERT' then select min(data) into d from novas;
  elsif TG_OP = 'DELETE' then select min(data) into d from velhas;
  else select least((select min(data) from novas), (select min(data) from velhas)) into d;
  end if;
  if d is not null then
    update analise_comercial.sujo set desde = least(coalesce(desde, d), d) where id = 1;
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['venda', 'devolucao', 'meta'] loop   -- o pedido (positivação) ganha o mesmo gatilho no db/04
    execute format('drop trigger if exists %1$s_sujo_i on analise_comercial.%1$s', t);
    execute format('drop trigger if exists %1$s_sujo_u on analise_comercial.%1$s', t);
    execute format('drop trigger if exists %1$s_sujo_d on analise_comercial.%1$s', t);
    execute format('create trigger %1$s_sujo_i after insert on analise_comercial.%1$s referencing new table as novas for each statement execute function analise_comercial.marcar_sujo()', t);
    execute format('create trigger %1$s_sujo_u after update on analise_comercial.%1$s referencing old table as velhas new table as novas for each statement execute function analise_comercial.marcar_sujo()', t);
    execute format('create trigger %1$s_sujo_d after delete on analise_comercial.%1$s referencing old table as velhas for each statement execute function analise_comercial.marcar_sujo()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------- resumos
do $$
declare p text;
begin
  foreach p in array array['r', 'c'] loop
    execute format($f$
      create table if not exists analise_comercial.%1$s_rca (
        mes integer not null, codusur integer not null,
        venda numeric not null default 0, custo numeric not null default 0, qt numeric not null default 0,
        dev numeric not null default 0, posit integer not null default 0, mix integer not null default 0,
        meta numeric not null default 0,
        primary key (mes, codusur));
      create table if not exists analise_comercial.%1$s_grupo (
        mes integer not null, grupo text not null, posit integer not null default 0, mix integer not null default 0,
        primary key (mes, grupo));
      create table if not exists analise_comercial.%1$s_sup_forn (
        mes integer not null, codsupervisor integer not null, codfornec integer not null,
        venda numeric not null default 0, custo numeric not null default 0, qt numeric not null default 0,
        dev numeric not null default 0, posit integer not null default 0, mix integer not null default 0,
        primary key (mes, codsupervisor, codfornec));
      create table if not exists analise_comercial.%1$s_grupo_forn (
        mes integer not null, grupo text not null, codfornec integer not null,
        posit integer not null default 0, mix integer not null default 0,
        primary key (mes, grupo, codfornec));
    $f$, p);
  end loop;
end $$;
comment on table analise_comercial.r_rca is 'Resumo por mês comercial × RCA (supervisor atual + ajuste_rca). Feito por analise_comercial.atualizar().';
comment on table analise_comercial.c_rca is 'O mesmo do r_rca, só nos dias do mês comercial atual que já fecharam (até ontem), em todos os anos: a comparação do mês em andamento.';

/* Monta os resumos do prefixo p_t ('r' = meses inteiros; 'c' = o trecho do mês atual) para os dias
   escolhidos. Os meses tocados são apagados e refeitos. */
create or replace function analise_comercial.montar_resumos(p_t text, p_de date, p_ate date,
                                                           p_mes_do_ano integer default null, p_ordem_max integer default null)
returns integer
language plpgsql as $$
declare n integer;
begin
  if p_t not in ('r', 'c') then raise exception 'montar_resumos: p_t tem que ser r ou c'; end if;
  drop table if exists _dias, _sf, _sfd;
  create temp table _dias on commit drop as
    select data, mes from analise_comercial.dia
     where data between p_de and p_ate
       and (p_mes_do_ano is null or mes_do_ano = p_mes_do_ano)
       and (p_ordem_max is null or ordem <= p_ordem_max);
  get diagnostics n = row_count;
  analyze _dias;
  execute format('delete from analise_comercial.%1$s_rca where mes in (select mes from _dias)', p_t);
  execute format('delete from analise_comercial.%1$s_grupo where mes in (select mes from _dias)', p_t);
  execute format('delete from analise_comercial.%1$s_sup_forn where mes in (select mes from _dias)', p_t);
  execute format('delete from analise_comercial.%1$s_grupo_forn where mes in (select mes from _dias)', p_t);
  if n = 0 then return 0; end if;

  -- por RCA
  execute format($q$
    insert into analise_comercial.%1$s_rca (mes, codusur, venda, custo, qt, posit, mix, dev, meta)
    with v as (
      select d.mes, v.codusur, sum(v.venda) as venda, sum(v.custo) as custo, sum(v.qt) as qt,
             count(distinct v.codprod) filter (where v.venda > 0) as mix
        from analise_comercial.venda v join _dias d on d.data = v.data
       group by 1, 2),
    -- positivação = a do Relatório 146: cliente com pedido digitado (analise_comercial.pedido)
    pp as (
      select d.mes, p.codusur, count(distinct p.codcli) as posit
        from analise_comercial.pedido p join _dias d on d.data = p.data
       group by 1, 2),
    x as (
      select d.mes, x.codusur, sum(x.dev) as dev
        from analise_comercial.devolucao x join _dias d on d.data = x.data
       group by 1, 2),
    mt as (
      select (extract(year from m.data) * 100 + extract(month from m.data))::integer as mes, m.codusur, sum(m.valor) as meta
        from analise_comercial.meta m
       where %2$L = 'r'
         and (extract(year from m.data) * 100 + extract(month from m.data))::integer in (select distinct mes from _dias)
       group by 1, 2),
    k as (select mes, codusur from v union select mes, codusur from pp union select mes, codusur from x
          union select mes, codusur from mt)
    select k.mes, k.codusur, coalesce(v.venda, 0), coalesce(v.custo, 0), coalesce(v.qt, 0), coalesce(pp.posit, 0),
           coalesce(v.mix, 0), coalesce(x.dev, 0), coalesce(mt.meta, 0)
      from k left join v using (mes, codusur) left join pp using (mes, codusur) left join x using (mes, codusur)
      left join mt using (mes, codusur)
  $q$, p_t, p_t);

  -- positivação e mix sem contar duas vezes: supervisor, equipe, equipe sem televendas, total.
  -- Positivação pelos pedidos digitados (a regra do Relatório 146); mix pelos itens faturados.
  execute format($q$
    insert into analise_comercial.%1$s_grupo (mes, grupo, posit, mix)
    with gp as (
      select mes,
             case when grouping(sup) = 0 then 'P:' || sup
                  when grouping(tv) = 0 then case when tv then null else 'S:' || eq end
                  when grouping(eq) = 0 then 'E:' || eq
                  else 'T' end as grupo,
             count(distinct codcli) as posit
        from (select d.mes, p.codcli,
                     coalesce(m.codsupervisor, 0) as sup, coalesce(m.equipe, 'OUTROS') as eq, coalesce(m.televendas, false) as tv
                from analise_comercial.pedido p join _dias d on d.data = p.data
                left join analise_comercial.mapa_rca m on m.codusur = p.codusur) z
       group by grouping sets ((mes, sup), (mes, eq), (mes, eq, tv), (mes))),
    gm as (
      select mes,
             case when grouping(sup) = 0 then 'P:' || sup
                  when grouping(tv) = 0 then case when tv then null else 'S:' || eq end
                  when grouping(eq) = 0 then 'E:' || eq
                  else 'T' end as grupo,
             count(distinct codprod) filter (where venda > 0) as mix
        from (select d.mes, v.codprod, v.venda,
                     coalesce(m.codsupervisor, 0) as sup, coalesce(m.equipe, 'OUTROS') as eq, coalesce(m.televendas, false) as tv
                from analise_comercial.venda v join _dias d on d.data = v.data
                left join analise_comercial.mapa_rca m on m.codusur = v.codusur) z
       group by grouping sets ((mes, sup), (mes, eq), (mes, eq, tv), (mes)))
    select coalesce(gp.mes, gm.mes), coalesce(gp.grupo, gm.grupo), coalesce(gp.posit, 0), coalesce(gm.mix, 0)
      from (select * from gp where grupo is not null) gp
      full join (select * from gm where grupo is not null) gm on gm.mes = gp.mes and gm.grupo = gp.grupo
  $q$, p_t);

  -- por fornecedor (supervisor × fornecedor com as somas; grupos só com positivação e mix)
  create temp table _sf on commit drop as
  select mes, sup, eq, tv, forn, grouping(sup) as gs, grouping(tv) as gt, grouping(eq) as ge,
         sum(venda) as venda, sum(custo) as custo, sum(qt) as qt,
         count(distinct codcli) filter (where venda > 0) as posit,
         count(distinct codprod) filter (where venda > 0) as mix
    from (select d.mes, v.codcli, v.codprod, v.venda, v.custo, v.qt,
                 coalesce(m.codsupervisor, 0) as sup, coalesce(m.equipe, 'OUTROS') as eq, coalesce(m.televendas, false) as tv,
                 coalesce(p.codfornec, 0) as forn
            from analise_comercial.venda v join _dias d on d.data = v.data
            left join analise_comercial.mapa_rca m on m.codusur = v.codusur
            left join analise_comercial.produto p on p.codprod = v.codprod) z
   group by grouping sets ((mes, sup, forn), (mes, eq, forn), (mes, eq, tv, forn), (mes, forn));
  create temp table _sfd on commit drop as
  select d.mes, coalesce(m.codsupervisor, 0) as sup, coalesce(p.codfornec, 0) as forn, sum(x.dev) as dev
    from analise_comercial.devolucao x join _dias d on d.data = x.data
    left join analise_comercial.mapa_rca m on m.codusur = x.codusur
    left join analise_comercial.produto p on p.codprod = x.codprod
   group by 1, 2, 3;
  execute format($q$
    insert into analise_comercial.%1$s_sup_forn (mes, codsupervisor, codfornec, venda, custo, qt, dev, posit, mix)
    select coalesce(a.mes, b.mes), coalesce(a.sup, b.sup), coalesce(a.forn, b.forn), coalesce(a.venda, 0), coalesce(a.custo, 0),
           coalesce(a.qt, 0), coalesce(b.dev, 0), coalesce(a.posit, 0), coalesce(a.mix, 0)
      from (select * from _sf where gs = 0) a
      full join _sfd b on b.mes = a.mes and b.sup = a.sup and b.forn = a.forn
  $q$, p_t);
  execute format($q$
    insert into analise_comercial.%1$s_grupo_forn (mes, grupo, codfornec, posit, mix)
    select mes, case when gt = 0 then 'S:' || eq when ge = 0 then 'E:' || eq else 'T' end, forn, posit, mix
      from _sf where gs = 1 and not (gt = 0 and tv)
  $q$, p_t);
  return n;
end $$;

-- ----------------------------------------------------------------------------- pacotes do painel
create table if not exists analise_comercial.pacote (
  nome       text primary key,
  versao     text not null,
  payload    text not null,
  gerado_em  timestamptz not null default now(),
  linhas     integer,
  bytes_json integer,
  meta       jsonb
);
comment on table analise_comercial.pacote is
  'O que o painel baixa (JSON em colunas; a API comprime): dim (cadastros, calendário e o trecho do mês atual), base_hist/base_rec (RCA e grupos) e forn_hist/forn_rec (fornecedor). _rec = meses que o agente ainda mexe; _hist = os mais velhos, só refeitos quando eles mudam.';

create or replace function analise_comercial.gravar_pacote(p_nome text, p_payload text, p_linhas integer, p_meta jsonb default null)
returns boolean
language plpgsql as $$
declare v text := md5(p_payload);
begin
  if exists (select 1 from analise_comercial.pacote where nome = p_nome and versao = v) then
    update analise_comercial.pacote set meta = coalesce(p_meta, meta) where nome = p_nome;
    return false;
  end if;
  insert into analise_comercial.pacote (nome, versao, payload, gerado_em, linhas, bytes_json, meta)
  values (p_nome, v, p_payload, now(), p_linhas, octet_length(p_payload), p_meta)
  on conflict (nome) do update set versao = excluded.versao, payload = excluded.payload, gerado_em = excluded.gerado_em,
                                   linhas = excluded.linhas, bytes_json = excluded.bytes_json, meta = excluded.meta;
  return true;
end $$;

/* Pacote de RCA e grupos (r_ ou c_) entre os meses p_de e p_ate, em colunas. */
create or replace function analise_comercial.json_base(p_t text, p_de integer, p_ate integer) returns json
language plpgsql stable as $$
declare j json;
begin
  execute format($q$
    select json_build_object(
      'rca', (select json_build_object(
                'm', coalesce(array_agg(mes order by mes, codusur), '{}'),
                'u', coalesce(array_agg(codusur order by mes, codusur), '{}'),
                'v', coalesce(array_agg(round(venda, 6)::float8 order by mes, codusur), '{}'),
                'c', coalesce(array_agg(round(custo, 6)::float8 order by mes, codusur), '{}'),
                'q', coalesce(array_agg(round(qt, 3)::float8 order by mes, codusur), '{}'),
                'd', coalesce(array_agg(round(dev, 6)::float8 order by mes, codusur), '{}'),
                'p', coalesce(array_agg(posit order by mes, codusur), '{}'),
                'x', coalesce(array_agg(mix order by mes, codusur), '{}'),
                't', coalesce(array_agg(round(meta, 2)::float8 order by mes, codusur), '{}'))
                from analise_comercial.%1$s_rca where mes between $1 and $2),
      'grupo', (select json_build_object(
                'm', coalesce(array_agg(mes order by mes, grupo), '{}'),
                'g', coalesce(array_agg(grupo order by mes, grupo), '{}'),
                'p', coalesce(array_agg(posit order by mes, grupo), '{}'),
                'x', coalesce(array_agg(mix order by mes, grupo), '{}'))
                from analise_comercial.%1$s_grupo where mes between $1 and $2))
  $q$, p_t) into j using p_de, p_ate;
  return j;
end $$;

/* Pacote de fornecedor (r_ ou c_) entre os meses p_de e p_ate, em colunas. */
create or replace function analise_comercial.json_forn(p_t text, p_de integer, p_ate integer) returns json
language plpgsql stable as $$
declare j json;
begin
  execute format($q$
    select json_build_object(
      'sf', (select json_build_object(
               'm', coalesce(array_agg(mes order by mes, codsupervisor, codfornec), '{}'),
               's', coalesce(array_agg(codsupervisor order by mes, codsupervisor, codfornec), '{}'),
               'f', coalesce(array_agg(codfornec order by mes, codsupervisor, codfornec), '{}'),
               'v', coalesce(array_agg(round(venda, 6)::float8 order by mes, codsupervisor, codfornec), '{}'),
               'c', coalesce(array_agg(round(custo, 6)::float8 order by mes, codsupervisor, codfornec), '{}'),
               'q', coalesce(array_agg(round(qt, 3)::float8 order by mes, codsupervisor, codfornec), '{}'),
               'd', coalesce(array_agg(round(dev, 6)::float8 order by mes, codsupervisor, codfornec), '{}'),
               'p', coalesce(array_agg(posit order by mes, codsupervisor, codfornec), '{}'),
               'x', coalesce(array_agg(mix order by mes, codsupervisor, codfornec), '{}'))
               from analise_comercial.%1$s_sup_forn where mes between $1 and $2),
      'gf', (select json_build_object(
               'm', coalesce(array_agg(mes order by mes, grupo, codfornec), '{}'),
               'g', coalesce(array_agg(grupo order by mes, grupo, codfornec), '{}'),
               'f', coalesce(array_agg(codfornec order by mes, grupo, codfornec), '{}'),
               'p', coalesce(array_agg(posit order by mes, grupo, codfornec), '{}'),
               'x', coalesce(array_agg(mix order by mes, grupo, codfornec), '{}'))
               from analise_comercial.%1$s_grupo_forn where mes between $1 and $2))
  $q$, p_t) into j using p_de, p_ate;
  return j;
end $$;

/* Cadastros, calendário e o trecho do mês atual (c_*): pequeno, refeito a cada atualizar(). */
create or replace function analise_comercial.json_dim(p_mes_atual integer, p_inicio date, p_ordem_corte integer) returns json
language sql stable as $$
  -- sem a hora de agora: o pacote só troca de versão quando o conteúdo muda (a hora vem de pacote.gerado_em)
  select json_build_object(
    'hoje', current_date,
    'mes_atual', p_mes_atual,
    'inicio_atual', p_inicio,
    'ordem_corte', p_ordem_corte,
    'equipe_padrao', (select valor #>> '{}' from analise_comercial.config where chave = 'equipe_padrao'),
    'cal', (select json_agg(json_build_array(ano, mes, inicio, fim, origem) order by ano, mes)
              from analise_comercial.calendario where inicio <= current_date + 400),
    'sup', (select json_agg(json_build_array(codsupervisor, nome, rotulo, equipe, ordem, televendas) order by ordem, codsupervisor)
              from (select codsupervisor, nome, rotulo, equipe, ordem, televendas from analise_comercial.v_supervisor
                    union all select 0, 'SEM SUPERVISOR', 'SEM SUPERVISOR', 'OUTROS', 999, false) s),
    'rca', (select json_agg(json_build_array(x.codusur, coalesce(r.nome, 'RCA ' || x.codusur), coalesce(m.codsupervisor, 0),
                                             r.codsupervisor, a.motivo, r.dttermino, r.bloqueio) order by x.codusur)
              from (select distinct codusur from analise_comercial.r_rca) x
              left join analise_comercial.rca r using (codusur)
              left join analise_comercial.mapa_rca m using (codusur)
              left join analise_comercial.ajuste_rca a using (codusur)),
    'forn', (select json_agg(json_build_array(x.codfornec, coalesce(f.fornecedor, case when x.codfornec = 0 then 'SEM FORNECEDOR' else 'FORNECEDOR ' || x.codfornec end))
                             order by x.codfornec)
               from (select distinct codfornec from analise_comercial.r_sup_forn) x
               left join analise_comercial.fornecedor f using (codfornec)),
    'corte', json_build_object('base', analise_comercial.json_base('c', 0, 999999), 'forn', analise_comercial.json_forn('c', 0, 999999)))
$$;

-- ----------------------------------------------------------------------------- o que o agente chama
create or replace function analise_comercial.atualizar(p_forcar boolean default false) returns jsonb
language plpgsql as $$
declare
  t0 timestamptz := clock_timestamp();
  v_hash text; v_hash_ant text; v_desde date; v_min date;
  v_mes_hoje integer; v_mes_de integer; v_mes_rec integer; v_mes_rec_ant integer;
  v_inicio date; v_moa integer; v_k integer;
  v_hist boolean := false; v_meses integer := 0; r record; v_trocou text[] := '{}';
begin
  -- uma de cada vez (o agente e uma carga manual podem chamar ao mesmo tempo)
  if not pg_try_advisory_xact_lock(hashtext('analise_comercial.atualizar')) then
    return jsonb_build_object('ocupado', true);
  end if;
  select min(data) into v_min from analise_comercial.dia;
  select mes, mes_do_ano into v_mes_hoje, v_moa from analise_comercial.dia where data = current_date;
  if v_mes_hoje is null then raise exception 'analise_comercial.calendario não cobre hoje (%): cadastre os meses comerciais', current_date; end if;
  select mes into v_mes_rec from analise_comercial.dia
   where data = current_date - coalesce((select (valor #>> '{}')::integer from analise_comercial.config where chave = 'janela_dias'), 46);

  -- o que mudou: datas marcadas pelo gatilho; o mapa (RCA → supervisor, produto → fornecedor) refaz tudo
  select desde into v_desde from analise_comercial.sujo where id = 1 for update;
  update analise_comercial.sujo set desde = null where id = 1;
  v_hash := analise_comercial.refazer_mapa();
  select valor #>> '{}' into v_hash_ant from analise_comercial.config where chave = 'hash_mapa';
  if p_forcar or v_hash_ant is distinct from v_hash then v_desde := v_min; end if;

  if v_desde is not null then
    select mes into v_mes_de from analise_comercial.dia where data = greatest(v_desde, v_min);
    for r in select mes, min(data) as de, max(data) as ate from analise_comercial.dia
              where mes between coalesce(v_mes_de, v_mes_hoje) and v_mes_hoje group by mes order by mes loop
      perform analise_comercial.montar_resumos('r', r.de, r.ate);
      v_meses := v_meses + 1;
    end loop;
    if v_mes_de < v_mes_rec then v_hist := true; end if;
    insert into analise_comercial.config (chave, valor, obs) values ('hash_mapa', to_jsonb(v_hash), 'mapa RCA → supervisor e produto → fornecedor da última montagem')
    on conflict (chave) do update set valor = excluded.valor;
  end if;

  -- o trecho do mês atual que já fechou (até ontem), em todos os anos
  select c.inicio into v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  perform analise_comercial.montar_resumos('c', v_min, current_date - 1, v_moa, v_k);
  if v_k < 0 then
    delete from analise_comercial.c_rca; delete from analise_comercial.c_grupo;
    delete from analise_comercial.c_sup_forn; delete from analise_comercial.c_grupo_forn;
  end if;

  -- pacotes: os recentes sempre (só trocam de versão se mudaram); os antigos quando mexeram nos meses deles
  select (meta ->> 'mes_rec')::integer into v_mes_rec_ant from analise_comercial.pacote where nome = 'base_hist';
  if v_mes_rec_ant is distinct from v_mes_rec then v_hist := true; end if;
  if analise_comercial.gravar_pacote('base_rec', analise_comercial.json_base('r', v_mes_rec, v_mes_hoje)::text,
       (select count(*)::integer from analise_comercial.r_rca where mes between v_mes_rec and v_mes_hoje),
       jsonb_build_object('de', v_mes_rec, 'ate', v_mes_hoje)) then v_trocou := array_append(v_trocou, 'base_rec'); end if;
  if analise_comercial.gravar_pacote('forn_rec', analise_comercial.json_forn('r', v_mes_rec, v_mes_hoje)::text,
       (select count(*)::integer from analise_comercial.r_sup_forn where mes between v_mes_rec and v_mes_hoje),
       jsonb_build_object('de', v_mes_rec, 'ate', v_mes_hoje)) then v_trocou := array_append(v_trocou, 'forn_rec'); end if;
  if v_hist then
    if analise_comercial.gravar_pacote('base_hist', analise_comercial.json_base('r', 0, v_mes_rec - 1)::text,
         (select count(*)::integer from analise_comercial.r_rca where mes < v_mes_rec),
         jsonb_build_object('de', 0, 'ate', v_mes_rec - 1, 'mes_rec', v_mes_rec)) then v_trocou := array_append(v_trocou, 'base_hist'); end if;
    if analise_comercial.gravar_pacote('forn_hist', analise_comercial.json_forn('r', 0, v_mes_rec - 1)::text,
         (select count(*)::integer from analise_comercial.r_sup_forn where mes < v_mes_rec),
         jsonb_build_object('de', 0, 'ate', v_mes_rec - 1, 'mes_rec', v_mes_rec)) then v_trocou := array_append(v_trocou, 'forn_hist'); end if;
  end if;
  if analise_comercial.gravar_pacote('dim', analise_comercial.json_dim(v_mes_hoje, v_inicio, v_k)::text, null,
       jsonb_build_object('mes_atual', v_mes_hoje, 'ordem_corte', v_k)) then v_trocou := array_append(v_trocou, 'dim'); end if;

  return jsonb_build_object('meses_refeitos', v_meses, 'desde', v_desde, 'hist', v_hist, 'pacotes_novos', v_trocou,
                            'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end $$;

/* Refaz tudo (calendário trocado, carga histórica). */
create or replace function analise_comercial.reconstruir() returns jsonb
language sql as $$ select analise_comercial.atualizar(true) $$;

-- ----------------------------------------------------------------------------- consultas na hora (o painel chama)
/* Produtos de um fornecedor, por mês, no recorte de RCAs (nulo = todos): venda, custo, quantidade,
   devolução e positivação exata; e o mesmo no trecho do mês atual. */
create or replace function analise_comercial.consulta_produtos(p_forn integer, p_rcas integer[] default null) returns json
language plpgsql stable as $$
declare v_moa integer; v_k integer; v_inicio date; j json;
begin
  select c.mes, c.inicio into v_moa, v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  with prods as (select codprod from analise_comercial.produto where coalesce(codfornec, 0) = p_forn),
  v as (select d.mes, v.codprod, sum(v.venda) as venda, sum(v.custo) as custo, sum(v.qt) as qt,
               count(distinct v.codcli) filter (where v.venda > 0) as posit,
               sum(v.venda) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as venda_c,
               sum(v.custo) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as custo_c,
               sum(v.qt) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as qt_c,
               count(distinct v.codcli) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as posit_c
          from analise_comercial.venda v join analise_comercial.dia d on d.data = v.data
         where v.codprod in (select codprod from prods) and (p_rcas is null or v.codusur = any (p_rcas))
         group by 1, 2),
  x as (select d.mes, x.codprod, sum(x.dev) as dev,
               sum(x.dev) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as dev_c
          from analise_comercial.devolucao x join analise_comercial.dia d on d.data = x.data
         where x.codprod in (select codprod from prods) and (p_rcas is null or x.codusur = any (p_rcas))
         group by 1, 2),
  k as (select mes, codprod from v union select mes, codprod from x),
  t as (select k.mes, k.codprod, v.venda, v.custo, v.qt, v.posit, x.dev, v.venda_c, v.custo_c, v.qt_c, v.posit_c, x.dev_c
          from k left join v using (mes, codprod) left join x using (mes, codprod))
  select json_build_object(
    'm', coalesce(array_agg(mes order by mes, codprod), '{}'),
    'p', coalesce(array_agg(codprod order by mes, codprod), '{}'),
    'v', coalesce(array_agg(round(coalesce(venda, 0), 6)::float8 order by mes, codprod), '{}'),
    'c', coalesce(array_agg(round(coalesce(custo, 0), 6)::float8 order by mes, codprod), '{}'),
    'q', coalesce(array_agg(round(coalesce(qt, 0), 3)::float8 order by mes, codprod), '{}'),
    'd', coalesce(array_agg(round(coalesce(dev, 0), 6)::float8 order by mes, codprod), '{}'),
    'n', coalesce(array_agg(coalesce(posit, 0) order by mes, codprod), '{}'),
    'vc', coalesce(array_agg(round(coalesce(venda_c, 0), 6)::float8 order by mes, codprod), '{}'),
    'cc', coalesce(array_agg(round(coalesce(custo_c, 0), 6)::float8 order by mes, codprod), '{}'),
    'qc', coalesce(array_agg(round(coalesce(qt_c, 0), 3)::float8 order by mes, codprod), '{}'),
    'dc', coalesce(array_agg(round(coalesce(dev_c, 0), 6)::float8 order by mes, codprod), '{}'),
    'nc', coalesce(array_agg(coalesce(posit_c, 0) order by mes, codprod), '{}'),
    'prod', (select json_agg(json_build_array(p.codprod, p.descricao, p.embalagem, p.unidade, p.obs2, p.dtexclusao,
                                              exists (select 1 from trade.produto_miniatura f where f.codprod = p.codprod)) order by p.codprod)
               from analise_comercial.produto p where p.codprod in (select distinct codprod from t)))
    into j from t;
  return j;
end $$;

/* Fornecedores no recorte de RCAs (quando o filtro desce até RCA): por mês, com positivação e mix exatos. */
create or replace function analise_comercial.consulta_fornecedores(p_rcas integer[]) returns json
language plpgsql stable as $$
declare v_moa integer; v_k integer; v_inicio date; j json;
begin
  select c.mes, c.inicio into v_moa, v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  with v as (select d.mes, coalesce(p.codfornec, 0) as forn, sum(v.venda) as venda, sum(v.custo) as custo, sum(v.qt) as qt,
                    count(distinct v.codcli) filter (where v.venda > 0) as posit,
                    count(distinct v.codprod) filter (where v.venda > 0) as mix,
                    sum(v.venda) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as venda_c,
                    sum(v.custo) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as custo_c,
                    sum(v.qt) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as qt_c,
                    count(distinct v.codcli) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as posit_c,
                    count(distinct v.codprod) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as mix_c
               from analise_comercial.venda v join analise_comercial.dia d on d.data = v.data
               left join analise_comercial.produto p on p.codprod = v.codprod
              where v.codusur = any (p_rcas)
              group by 1, 2),
  x as (select d.mes, coalesce(p.codfornec, 0) as forn, sum(x.dev) as dev,
               sum(x.dev) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as dev_c
          from analise_comercial.devolucao x join analise_comercial.dia d on d.data = x.data
          left join analise_comercial.produto p on p.codprod = x.codprod
         where x.codusur = any (p_rcas)
         group by 1, 2),
  k as (select mes, forn from v union select mes, forn from x),
  t as (select k.mes, k.forn, v.venda, v.custo, v.qt, v.posit, v.mix, x.dev, v.venda_c, v.custo_c, v.qt_c, v.posit_c, v.mix_c, x.dev_c
          from k left join v using (mes, forn) left join x using (mes, forn))
  select json_build_object(
    'm', coalesce(array_agg(mes order by mes, forn), '{}'),
    'f', coalesce(array_agg(forn order by mes, forn), '{}'),
    'v', coalesce(array_agg(round(coalesce(venda, 0), 6)::float8 order by mes, forn), '{}'),
    'c', coalesce(array_agg(round(coalesce(custo, 0), 6)::float8 order by mes, forn), '{}'),
    'q', coalesce(array_agg(round(coalesce(qt, 0), 3)::float8 order by mes, forn), '{}'),
    'd', coalesce(array_agg(round(coalesce(dev, 0), 6)::float8 order by mes, forn), '{}'),
    'p', coalesce(array_agg(coalesce(posit, 0) order by mes, forn), '{}'),
    'x', coalesce(array_agg(coalesce(mix, 0) order by mes, forn), '{}'),
    'vc', coalesce(array_agg(round(coalesce(venda_c, 0), 6)::float8 order by mes, forn), '{}'),
    'cc', coalesce(array_agg(round(coalesce(custo_c, 0), 6)::float8 order by mes, forn), '{}'),
    'qc', coalesce(array_agg(round(coalesce(qt_c, 0), 3)::float8 order by mes, forn), '{}'),
    'dc', coalesce(array_agg(round(coalesce(dev_c, 0), 6)::float8 order by mes, forn), '{}'),
    'pc', coalesce(array_agg(coalesce(posit_c, 0) order by mes, forn), '{}'),
    'xc', coalesce(array_agg(coalesce(mix_c, 0) order by mes, forn), '{}'))
    into j from t;
  return j;
end $$;

create index if not exists venda_rca on analise_comercial.venda (codusur, data);
create index if not exists devolucao_rca on analise_comercial.devolucao (codusur, data);

-- ----------------------------------------------------------------------------- segurança
alter table analise_comercial.mapa_rca       enable row level security;
alter table analise_comercial.sujo           enable row level security;
alter table analise_comercial.pacote         enable row level security;
alter table analise_comercial.r_rca          enable row level security;
alter table analise_comercial.r_grupo        enable row level security;
alter table analise_comercial.r_sup_forn     enable row level security;
alter table analise_comercial.r_grupo_forn   enable row level security;
alter table analise_comercial.c_rca          enable row level security;
alter table analise_comercial.c_grupo        enable row level security;
alter table analise_comercial.c_sup_forn     enable row level security;
alter table analise_comercial.c_grupo_forn   enable row level security;
do $$
declare f record;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema analise_comercial from anon, authenticated;
    for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'analise_comercial' loop
      execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    end loop;
  end if;
end $$;

-- ----------------------------------------------------------------------------- (acrescentado no mesmo dia)
/* RCAs no recorte de fornecedores (o filtro de fornecedor na tela "Por RCA"): por mês e RCA, com positivação
   e mix exatos dentro dos fornecedores escolhidos, e o trecho do mês atual. */
create or replace function analise_comercial.consulta_rcas(p_forns integer[], p_rcas integer[]) returns json
language plpgsql stable as $$
declare v_moa integer; v_k integer; v_inicio date; j json;
begin
  select c.mes, c.inicio into v_moa, v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  with prods as (select codprod from analise_comercial.produto where coalesce(codfornec, 0) = any (p_forns)),
  v as (select d.mes, v.codusur as u, sum(v.venda) as venda, sum(v.custo) as custo, sum(v.qt) as qt,
               count(distinct v.codcli) filter (where v.venda > 0) as posit,
               count(distinct v.codprod) filter (where v.venda > 0) as mix,
               sum(v.venda) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as venda_c,
               sum(v.custo) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as custo_c,
               sum(v.qt) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as qt_c,
               count(distinct v.codcli) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as posit_c,
               count(distinct v.codprod) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as mix_c
          from analise_comercial.venda v join analise_comercial.dia d on d.data = v.data
         where v.codprod in (select codprod from prods) and (p_rcas is null or v.codusur = any (p_rcas))
         group by 1, 2),
  x as (select d.mes, x.codusur as u, sum(x.dev) as dev,
               sum(x.dev) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as dev_c
          from analise_comercial.devolucao x join analise_comercial.dia d on d.data = x.data
         where x.codprod in (select codprod from prods) and (p_rcas is null or x.codusur = any (p_rcas))
         group by 1, 2),
  k as (select mes, u from v union select mes, u from x),
  t as (select k.mes, k.u, v.venda, v.custo, v.qt, v.posit, v.mix, x.dev, v.venda_c, v.custo_c, v.qt_c, v.posit_c, v.mix_c, x.dev_c
          from k left join v using (mes, u) left join x using (mes, u))
  select json_build_object(
    'm', coalesce(array_agg(mes order by mes, u), '{}'),
    'u', coalesce(array_agg(u order by mes, u), '{}'),
    'v', coalesce(array_agg(round(coalesce(venda, 0), 6)::float8 order by mes, u), '{}'),
    'c', coalesce(array_agg(round(coalesce(custo, 0), 6)::float8 order by mes, u), '{}'),
    'q', coalesce(array_agg(round(coalesce(qt, 0), 3)::float8 order by mes, u), '{}'),
    'd', coalesce(array_agg(round(coalesce(dev, 0), 6)::float8 order by mes, u), '{}'),
    'p', coalesce(array_agg(coalesce(posit, 0) order by mes, u), '{}'),
    'x', coalesce(array_agg(coalesce(mix, 0) order by mes, u), '{}'),
    'vc', coalesce(array_agg(round(coalesce(venda_c, 0), 6)::float8 order by mes, u), '{}'),
    'cc', coalesce(array_agg(round(coalesce(custo_c, 0), 6)::float8 order by mes, u), '{}'),
    'qc', coalesce(array_agg(round(coalesce(qt_c, 0), 3)::float8 order by mes, u), '{}'),
    'dc', coalesce(array_agg(round(coalesce(dev_c, 0), 6)::float8 order by mes, u), '{}'),
    'pc', coalesce(array_agg(coalesce(posit_c, 0) order by mes, u), '{}'),
    'xc', coalesce(array_agg(coalesce(mix_c, 0) order by mes, u), '{}'))
    into j from t;
  return j;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function analise_comercial.consulta_rcas(integer[], integer[]) from public, anon, authenticated;
  end if;
end $$;
