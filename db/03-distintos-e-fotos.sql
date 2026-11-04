-- =============================================================================
-- ANÁLISE COMERCIAL — positivação e mix de um grupo de RCAs, contados na hora (migração analise_comercial_04_distintos)
-- 2026-11-04. Pedido do Júlio: o filtro de RCA começa com todos marcados e ele tira quem não entra na comparação.
-- Tirar um RCA não muda só a soma: o cliente e o SKU contam UMA vez no grupo, então a positivação e o mix do grupo sem
-- aquele RCA têm de ser recontados (somar os RCAs contaria duas vezes o cliente de dois RCAs, e o mix viraria milhares
-- de SKUs repetidos). O painel chama esta função só para os grupos que perderam algum RCA.
-- =============================================================================
drop function if exists analise_comercial.consulta_distintos(integer[]);
/* p_forns: só a venda desses fornecedores (nulo = todos) */
create or replace function analise_comercial.consulta_distintos(p_rcas integer[], p_forns integer[] default null) returns json
language plpgsql stable as $$
declare v_moa integer; v_k integer; v_inicio date; j json;
begin
  select c.mes, c.inicio into v_moa, v_inicio from analise_comercial.calendario c where current_date between c.inicio and c.fim;
  v_k := (current_date - 1) - v_inicio;
  with t as (
    select d.mes,
           count(distinct v.codcli) as p,
           count(distinct v.codprod) as x,
           count(distinct v.codcli) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as pc,
           count(distinct v.codprod) filter (where d.mes_do_ano = v_moa and d.ordem <= v_k) as xc
      from analise_comercial.venda v join analise_comercial.dia d on d.data = v.data
     where v.codusur = any (p_rcas) and v.venda > 0
       and (p_forns is null or v.codprod in (select codprod from analise_comercial.produto where coalesce(codfornec, 0) = any (p_forns)))
     group by d.mes)
  select json_build_object(
    'm', coalesce(array_agg(mes order by mes), '{}'),
    'p', coalesce(array_agg(p order by mes), '{}'),
    'x', coalesce(array_agg(x order by mes), '{}'),
    'pc', coalesce(array_agg(pc order by mes), '{}'),
    'xc', coalesce(array_agg(xc order by mes), '{}'))
    into j from t;
  return j;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function analise_comercial.consulta_distintos(integer[], integer[]) from public, anon, authenticated;
  end if;
end $$;

-- ----------------------------------------------------------------------------- a foto do produto
-- consulta_produtos passa a dizer quais produtos têm foto: a miniatura que o Gestão Comercial (Trade) guarda em
-- trade.produto_miniatura a partir da pasta FOTOS_ION (só leitura: cruzar schemas na leitura é permitido). O painel
-- busca a imagem por /api/img, como o Relatório 146 e o Inventário.

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
