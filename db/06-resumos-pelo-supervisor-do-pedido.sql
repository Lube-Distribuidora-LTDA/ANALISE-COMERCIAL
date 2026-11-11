-- =============================================================================
-- Análise Comercial — resumos, pacotes e consultas pelo SUPERVISOR DO PEDIDO (2026-11-11)
--
-- Substitui, do db/02 e do db/03: montar_resumos, json_base, consulta_produtos, consulta_fornecedores, consulta_rcas
-- e consulta_distintos. A unidade passa a ser (RCA × supervisor): o supervisor de cada linha é o do pedido (venda e
-- pedido) ou o da data (devolução, db/05), com o ajuste_rca por cima (RCA 41 em Televendas). A equipe vem do
-- supervisor (v_supervisor), então o histórico de um RCA que mudou de equipe fica na equipe de cada época.
-- O RCA que mudou de supervisor aparece nos dois, cada um com os meses em que esteve nele.
-- As consultas ganham p_sups (nulo = todos): com ele, só as linhas desses supervisores.
-- A meta (não aparece na tela desde 2026-11-04) fica no supervisor de hoje do RCA.
-- =============================================================================

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

  -- por RCA × supervisor do pedido (com o ajuste_rca); positivação pelos pedidos digitados (a regra do 146)
  execute format($q$
    insert into analise_comercial.%1$s_rca (mes, codusur, codsupervisor, venda, custo, qt, posit, mix, dev, meta)
    with v as (
      select d.mes, v.codusur, coalesce(aj.codsupervisor, v.codsupervisor) as sup,
             sum(v.venda) as venda, sum(v.custo) as custo, sum(v.qt) as qt,
             count(distinct v.codprod) filter (where v.venda > 0) as mix
        from analise_comercial.venda v join _dias d on d.data = v.data
        left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
       group by 1, 2, 3),
    pp as (
      select d.mes, p.codusur, coalesce(aj.codsupervisor, p.codsupervisor) as sup, count(distinct p.codcli) as posit
        from analise_comercial.pedido p join _dias d on d.data = p.data
        left join analise_comercial.ajuste_rca aj on aj.codusur = p.codusur
       group by 1, 2, 3),
    x as (
      select d.mes, x.codusur, coalesce(aj.codsupervisor, x.codsupervisor, 0) as sup, sum(x.dev) as dev
        from analise_comercial.devolucao x join _dias d on d.data = x.data
        left join analise_comercial.ajuste_rca aj on aj.codusur = x.codusur
       group by 1, 2, 3),
    mt as (
      select (extract(year from m.data) * 100 + extract(month from m.data))::integer as mes, m.codusur,
             coalesce(r.codsupervisor, 0) as sup, sum(m.valor) as meta
        from analise_comercial.meta m
        left join analise_comercial.mapa_rca r on r.codusur = m.codusur
       where %2$L = 'r'
         and (extract(year from m.data) * 100 + extract(month from m.data))::integer in (select distinct mes from _dias)
       group by 1, 2, 3),
    k as (select mes, codusur, sup from v union select mes, codusur, sup from pp union select mes, codusur, sup from x
          union select mes, codusur, sup from mt)
    select k.mes, k.codusur, k.sup, coalesce(v.venda, 0), coalesce(v.custo, 0), coalesce(v.qt, 0), coalesce(pp.posit, 0),
           coalesce(v.mix, 0), coalesce(x.dev, 0), coalesce(mt.meta, 0)
      from k left join v using (mes, codusur, sup) left join pp using (mes, codusur, sup)
      left join x using (mes, codusur, sup) left join mt using (mes, codusur, sup)
  $q$, p_t, p_t);

  -- positivação e mix sem contar duas vezes: supervisor, equipe, equipe sem televendas, total (pela época)
  execute format($q$
    insert into analise_comercial.%1$s_grupo (mes, grupo, posit, mix)
    with gp as (
      select mes,
             case when grouping(sup) = 0 then 'P:' || sup
                  when grouping(tv) = 0 then case when tv then null else 'S:' || eq end
                  when grouping(eq) = 0 then 'E:' || eq
                  else 'T' end as grupo,
             count(distinct codcli) as posit
        from (select d.mes, p.codcli, z.sup, coalesce(s.equipe, 'OUTROS') as eq, coalesce(s.televendas, false) as tv
                from analise_comercial.pedido p join _dias d on d.data = p.data
                left join analise_comercial.ajuste_rca aj on aj.codusur = p.codusur
                cross join lateral (select coalesce(aj.codsupervisor, p.codsupervisor) as sup) z
                left join analise_comercial.v_supervisor s on s.codsupervisor = z.sup) q
       group by grouping sets ((mes, sup), (mes, eq), (mes, eq, tv), (mes))),
    gm as (
      select mes,
             case when grouping(sup) = 0 then 'P:' || sup
                  when grouping(tv) = 0 then case when tv then null else 'S:' || eq end
                  when grouping(eq) = 0 then 'E:' || eq
                  else 'T' end as grupo,
             count(distinct codprod) filter (where venda > 0) as mix
        from (select d.mes, v.codprod, v.venda, z.sup, coalesce(s.equipe, 'OUTROS') as eq, coalesce(s.televendas, false) as tv
                from analise_comercial.venda v join _dias d on d.data = v.data
                left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
                cross join lateral (select coalesce(aj.codsupervisor, v.codsupervisor) as sup) z
                left join analise_comercial.v_supervisor s on s.codsupervisor = z.sup) q
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
    from (select d.mes, v.codcli, v.codprod, v.venda, v.custo, v.qt, z.sup,
                 coalesce(s.equipe, 'OUTROS') as eq, coalesce(s.televendas, false) as tv, coalesce(p.codfornec, 0) as forn
            from analise_comercial.venda v join _dias d on d.data = v.data
            left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
            cross join lateral (select coalesce(aj.codsupervisor, v.codsupervisor) as sup) z
            left join analise_comercial.v_supervisor s on s.codsupervisor = z.sup
            left join analise_comercial.produto p on p.codprod = v.codprod) q
   group by grouping sets ((mes, sup, forn), (mes, eq, forn), (mes, eq, tv, forn), (mes, forn));
  create temp table _sfd on commit drop as
  select d.mes, coalesce(aj.codsupervisor, x.codsupervisor, 0) as sup, coalesce(p.codfornec, 0) as forn, sum(x.dev) as dev
    from analise_comercial.devolucao x join _dias d on d.data = x.data
    left join analise_comercial.ajuste_rca aj on aj.codusur = x.codusur
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

-- o pacote por RCA ganha o supervisor ('s'): uma linha por mês × RCA × supervisor
create or replace function analise_comercial.json_base(p_t text, p_de integer, p_ate integer) returns json
language plpgsql stable as $$
declare j json;
begin
  execute format($q$
    select json_build_object(
      'rca', (select json_build_object(
                'm', coalesce(array_agg(mes order by mes, codusur, codsupervisor), '{}'),
                'u', coalesce(array_agg(codusur order by mes, codusur, codsupervisor), '{}'),
                's', coalesce(array_agg(codsupervisor order by mes, codusur, codsupervisor), '{}'),
                'v', coalesce(array_agg(round(venda, 6)::float8 order by mes, codusur, codsupervisor), '{}'),
                'c', coalesce(array_agg(round(custo, 6)::float8 order by mes, codusur, codsupervisor), '{}'),
                'q', coalesce(array_agg(round(qt, 3)::float8 order by mes, codusur, codsupervisor), '{}'),
                'd', coalesce(array_agg(round(dev, 6)::float8 order by mes, codusur, codsupervisor), '{}'),
                'p', coalesce(array_agg(posit order by mes, codusur, codsupervisor), '{}'),
                'x', coalesce(array_agg(mix order by mes, codusur, codsupervisor), '{}'),
                't', coalesce(array_agg(round(meta, 2)::float8 order by mes, codusur, codsupervisor), '{}'))
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

-- ----------------------------------------------------------------------------- consultas: + p_sups
drop function if exists analise_comercial.consulta_produtos(integer, integer[]);
drop function if exists analise_comercial.consulta_fornecedores(integer[]);
drop function if exists analise_comercial.consulta_rcas(integer[], integer[]);
drop function if exists analise_comercial.consulta_distintos(integer[], integer[]);

create or replace function analise_comercial.consulta_produtos(p_forn integer, p_rcas integer[] default null, p_sups integer[] default null)
returns json
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
          left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
         where v.codprod in (select codprod from prods) and (p_rcas is null or v.codusur = any (p_rcas))
           and (p_sups is null or coalesce(aj.codsupervisor, v.codsupervisor) = any (p_sups))
         group by 1, 2),
  x as (select d.mes, x.codprod, sum(x.dev) as dev,
               sum(x.dev) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as dev_c
          from analise_comercial.devolucao x join analise_comercial.dia d on d.data = x.data
          left join analise_comercial.ajuste_rca aj on aj.codusur = x.codusur
         where x.codprod in (select codprod from prods) and (p_rcas is null or x.codusur = any (p_rcas))
           and (p_sups is null or coalesce(aj.codsupervisor, x.codsupervisor, 0) = any (p_sups))
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

create or replace function analise_comercial.consulta_fornecedores(p_rcas integer[], p_sups integer[] default null) returns json
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
               left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
               left join analise_comercial.produto p on p.codprod = v.codprod
              where v.codusur = any (p_rcas) and (p_sups is null or coalesce(aj.codsupervisor, v.codsupervisor) = any (p_sups))
              group by 1, 2),
  x as (select d.mes, coalesce(p.codfornec, 0) as forn, sum(x.dev) as dev,
               sum(x.dev) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as dev_c
          from analise_comercial.devolucao x join analise_comercial.dia d on d.data = x.data
          left join analise_comercial.ajuste_rca aj on aj.codusur = x.codusur
          left join analise_comercial.produto p on p.codprod = x.codprod
         where x.codusur = any (p_rcas) and (p_sups is null or coalesce(aj.codsupervisor, x.codsupervisor, 0) = any (p_sups))
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

-- os RCAs só na venda dos fornecedores escolhidos, agora por RCA × supervisor ('s')
create or replace function analise_comercial.consulta_rcas(p_forns integer[], p_rcas integer[], p_sups integer[] default null) returns json
language plpgsql stable as $$
declare v_moa integer; v_k integer; v_inicio date; j json;
begin
  select c.mes, c.inicio into v_moa, v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  with prods as (select codprod from analise_comercial.produto where coalesce(codfornec, 0) = any (p_forns)),
  v as (select d.mes, v.codusur as u, coalesce(aj.codsupervisor, v.codsupervisor) as s,
               sum(v.venda) as venda, sum(v.custo) as custo, sum(v.qt) as qt,
               count(distinct v.codcli) filter (where v.venda > 0) as posit,
               count(distinct v.codprod) filter (where v.venda > 0) as mix,
               sum(v.venda) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as venda_c,
               sum(v.custo) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as custo_c,
               sum(v.qt) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as qt_c,
               count(distinct v.codcli) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as posit_c,
               count(distinct v.codprod) filter (where v.venda > 0 and d.mes_do_ano = v_moa and d.ordem <= v_k) as mix_c
          from analise_comercial.venda v join analise_comercial.dia d on d.data = v.data
          left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
         where v.codprod in (select codprod from prods) and (p_rcas is null or v.codusur = any (p_rcas))
           and (p_sups is null or coalesce(aj.codsupervisor, v.codsupervisor) = any (p_sups))
         group by 1, 2, 3),
  x as (select d.mes, x.codusur as u, coalesce(aj.codsupervisor, x.codsupervisor, 0) as s, sum(x.dev) as dev,
               sum(x.dev) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as dev_c
          from analise_comercial.devolucao x join analise_comercial.dia d on d.data = x.data
          left join analise_comercial.ajuste_rca aj on aj.codusur = x.codusur
         where x.codprod in (select codprod from prods) and (p_rcas is null or x.codusur = any (p_rcas))
           and (p_sups is null or coalesce(aj.codsupervisor, x.codsupervisor, 0) = any (p_sups))
         group by 1, 2, 3),
  k as (select mes, u, s from v union select mes, u, s from x),
  t as (select k.mes, k.u, k.s, v.venda, v.custo, v.qt, v.posit, v.mix, x.dev, v.venda_c, v.custo_c, v.qt_c, v.posit_c, v.mix_c, x.dev_c
          from k left join v using (mes, u, s) left join x using (mes, u, s))
  select json_build_object(
    'm', coalesce(array_agg(mes order by mes, u, s), '{}'),
    'u', coalesce(array_agg(u order by mes, u, s), '{}'),
    's', coalesce(array_agg(s order by mes, u, s), '{}'),
    'v', coalesce(array_agg(round(coalesce(venda, 0), 6)::float8 order by mes, u, s), '{}'),
    'c', coalesce(array_agg(round(coalesce(custo, 0), 6)::float8 order by mes, u, s), '{}'),
    'q', coalesce(array_agg(round(coalesce(qt, 0), 3)::float8 order by mes, u, s), '{}'),
    'd', coalesce(array_agg(round(coalesce(dev, 0), 6)::float8 order by mes, u, s), '{}'),
    'p', coalesce(array_agg(coalesce(posit, 0) order by mes, u, s), '{}'),
    'x', coalesce(array_agg(coalesce(mix, 0) order by mes, u, s), '{}'),
    'vc', coalesce(array_agg(round(coalesce(venda_c, 0), 6)::float8 order by mes, u, s), '{}'),
    'cc', coalesce(array_agg(round(coalesce(custo_c, 0), 6)::float8 order by mes, u, s), '{}'),
    'qc', coalesce(array_agg(round(coalesce(qt_c, 0), 3)::float8 order by mes, u, s), '{}'),
    'dc', coalesce(array_agg(round(coalesce(dev_c, 0), 6)::float8 order by mes, u, s), '{}'),
    'pc', coalesce(array_agg(coalesce(posit_c, 0) order by mes, u, s), '{}'),
    'xc', coalesce(array_agg(coalesce(mix_c, 0) order by mes, u, s), '{}'))
    into j from t;
  return j;
end $$;

/* Positivação e mix recontados para um grupo de RCAs (RCA tirado da comparação, vários RCAs). p_forns: só a venda
   desses fornecedores; p_sups: só as linhas desses supervisores (nulo = todos). Sem fornecedor, a positivação é a do
   Relatório 146 (pedido digitado); com fornecedor, os clientes dos itens faturados. */
create or replace function analise_comercial.consulta_distintos(p_rcas integer[], p_forns integer[] default null, p_sups integer[] default null)
returns json
language plpgsql stable as $$
declare v_moa integer; v_k integer; v_inicio date; j json;
begin
  select c.mes, c.inicio into v_moa, v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  with it as (
    select d.mes,
           count(distinct v.codcli) as p,
           count(distinct v.codprod) as x,
           count(distinct v.codcli) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as pc,
           count(distinct v.codprod) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as xc
      from analise_comercial.venda v join analise_comercial.dia d on d.data = v.data
      left join analise_comercial.ajuste_rca aj on aj.codusur = v.codusur
     where v.codusur = any (p_rcas) and v.venda > 0
       and (p_sups is null or coalesce(aj.codsupervisor, v.codsupervisor) = any (p_sups))
       and (p_forns is null or v.codprod in (select codprod from analise_comercial.produto where coalesce(codfornec, 0) = any (p_forns)))
     group by d.mes),
  pe as (
    select d.mes,
           count(distinct p.codcli) as p,
           count(distinct p.codcli) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as pc
      from analise_comercial.pedido p join analise_comercial.dia d on d.data = p.data
      left join analise_comercial.ajuste_rca aj on aj.codusur = p.codusur
     where p_forns is null and p.codusur = any (p_rcas)
       and (p_sups is null or coalesce(aj.codsupervisor, p.codsupervisor) = any (p_sups))
     group by d.mes),
  t as (
    select coalesce(it.mes, pe.mes) as mes,
           case when p_forns is null then coalesce(pe.p, 0) else coalesce(it.p, 0) end as p,
           coalesce(it.x, 0) as x,
           case when p_forns is null then coalesce(pe.pc, 0) else coalesce(it.pc, 0) end as pc,
           coalesce(it.xc, 0) as xc
      from it full join pe on pe.mes = it.mes)
  select json_build_object(
    'm', coalesce(array_agg(mes order by mes), '{}'),
    'p', coalesce(array_agg(p order by mes), '{}'),
    'x', coalesce(array_agg(x order by mes), '{}'),
    'pc', coalesce(array_agg(pc order by mes), '{}'),
    'xc', coalesce(array_agg(xc order by mes), '{}'))
    into j from t;
  return j;
end $$;

revoke all on function analise_comercial.consulta_produtos(integer, integer[], integer[]) from public, anon, authenticated;
revoke all on function analise_comercial.consulta_fornecedores(integer[], integer[]) from public, anon, authenticated;
revoke all on function analise_comercial.consulta_rcas(integer[], integer[], integer[]) from public, anon, authenticated;
revoke all on function analise_comercial.consulta_distintos(integer[], integer[], integer[]) from public, anon, authenticated;
