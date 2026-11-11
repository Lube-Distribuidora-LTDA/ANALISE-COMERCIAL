-- =============================================================================
-- Análise Comercial — SUPERVISOR DO PEDIDO (2026-11-11)
--
-- Júlio ("Sim, trocar"): o mês por supervisor não batia com o Relatório 146. A análise punha todo o histórico de um
-- RCA no supervisor que ele tem HOJE (PCUSUARI); o 146 guarda o supervisor DO PEDIDO (PCPEDC.CODSUPERVISOR). Ex.:
-- Central Sul em nov/2025 tinha uma RCA hoje inativa, cujos clientes iam para "INATIVO" aqui. A planilha do gestor
-- também é pelo supervisor do pedido (Central Sul de 2025 bate com ele e não com o de hoje).
--
-- Daqui para a frente:
--   venda e pedido guardam o supervisor do pedido (codsupervisor, do WinThor; 0 quando vem vazio);
--   a devolução não tem supervisor no WinThor (PCMOV e PCNFENT não guardam): fica com o supervisor do último pedido
--     do RCA até aquela data (sup_na_data; sem pedido antes, o primeiro depois; sem pedido nenhum, o do cadastro);
--   o ajuste_rca continua valendo por cima (RCA 41 em Televendas, decisão do Júlio).
-- Os resumos e as consultas passam a somar por (RCA × supervisor): db/06.
-- =============================================================================

-- ----------------------------------------------------------------------------- venda: o supervisor entra na chave
alter table analise_comercial.venda add column if not exists codsupervisor integer not null default 0;
alter table analise_comercial.venda drop constraint if exists venda_pkey;
alter table analise_comercial.venda add constraint venda_pkey primary key (data, codusur, codsupervisor, codcli, codprod);
comment on column analise_comercial.venda.codsupervisor is 'Supervisor do pedido (PCPEDC.CODSUPERVISOR; 0 = vazio no WinThor).';

-- ----------------------------------------------------------------------------- pedido (positivação)
alter table analise_comercial.pedido add column if not exists codsupervisor integer not null default 0;
comment on column analise_comercial.pedido.codsupervisor is 'Supervisor do pedido (PCPEDC.CODSUPERVISOR; 0 = vazio no WinThor).';
create index if not exists pedido_rca_sup on analise_comercial.pedido (codusur, data desc) include (codsupervisor);

-- ----------------------------------------------------------------------------- devolução: o supervisor da data
create or replace function analise_comercial.sup_na_data(p_codusur integer, p_data date) returns integer
language sql stable as $$
  select coalesce(
    (select p.codsupervisor from analise_comercial.pedido p
      where p.codusur = p_codusur and p.data <= p_data order by p.data desc, p.numped desc limit 1),
    (select p.codsupervisor from analise_comercial.pedido p
      where p.codusur = p_codusur and p.data > p_data order by p.data, p.numped limit 1),
    (select r.codsupervisor from analise_comercial.rca r where r.codusur = p_codusur),
    0)
$$;
comment on function analise_comercial.sup_na_data(integer, date) is
  'Supervisor de um RCA numa data: o do último pedido dele até ali (sem pedido antes, o primeiro depois; sem nenhum, o do cadastro). Para a devolução, que não tem supervisor no WinThor.';

alter table analise_comercial.devolucao add column if not exists codsupervisor integer;
comment on column analise_comercial.devolucao.codsupervisor is 'Supervisor do RCA na data da devolução (sup_na_data), gravado pelo gatilho devolucao_sup.';

create or replace function analise_comercial.devolucao_sup() returns trigger
language plpgsql as $$
begin
  if new.codsupervisor is null then
    new.codsupervisor := analise_comercial.sup_na_data(new.codusur, new.data);
  end if;
  return new;
end $$;
drop trigger if exists devolucao_sup on analise_comercial.devolucao;
create trigger devolucao_sup before insert or update on analise_comercial.devolucao
  for each row execute function analise_comercial.devolucao_sup();

-- ----------------------------------------------------------------------------- resumos por RCA: (RCA × supervisor)
alter table analise_comercial.r_rca add column if not exists codsupervisor integer not null default 0;
alter table analise_comercial.r_rca drop constraint if exists r_rca_pkey;
alter table analise_comercial.r_rca add constraint r_rca_pkey primary key (mes, codusur, codsupervisor);
alter table analise_comercial.c_rca add column if not exists codsupervisor integer not null default 0;
alter table analise_comercial.c_rca drop constraint if exists c_rca_pkey;
alter table analise_comercial.c_rca add constraint c_rca_pkey primary key (mes, codusur, codsupervisor);
comment on table analise_comercial.r_rca is 'Resumo por mês comercial × RCA × supervisor do pedido (com o ajuste_rca). Feito por analise_comercial.atualizar().';

revoke all on function analise_comercial.sup_na_data(integer, date) from public, anon, authenticated;
revoke all on function analise_comercial.devolucao_sup() from public, anon, authenticated;
