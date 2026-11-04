# ANÁLISE COMERCIAL — Lube Distribuidora

A planilha **"ACOMP INDICADORES ANO"** do gestor comercial (faturamento, positivação, mix e margem, mês a mês,
ano contra ano, por supervisor) virou sistema, **com a mesma cara** — e abre por **equipe, supervisor, RCA,
fornecedor e produto do fornecedor**, comparando o ano atual com o anterior ou com outros anos juntos.

Pedido do Júlio em 2026-11-04. Decisões dele no mesmo dia: **mês comercial** (como a planilha), o **RCA 41 em
Televendas** (como a planilha; no WinThor é de Grandes Contas), **meta do WinThor** e **todas as equipes
abrindo no ES**.

## O caminho do dado

```
WinThor (Oracle) ──AGENTE LUBE (SRV-IA, de minuto em minuto)──▶ DATA WAREHOUSE, schema analise_comercial
                                                                  │ analise_comercial.atualizar() (depois de gravar)
                                                                  ▼
                                    resumos por mês comercial + pacotes prontos ──▶ painel (Vercel / servidor local)
```

- **Fluxos do agente** (`Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\analise_comercial.toml`, publicados em
  `agente.fluxo`): venda de ontem e hoje (60 s), venda dos últimos 45 dias (10 min: pedido faturado ou cancelado
  depois), devolução (45 dias, 5 min), meta (PCMETARCA, 10 min), RCA, supervisor, produto e fornecedor (1 h).
- **Histórico** (desde 30/12/2023, o começo do mês comercial de jan/2024): `conferencia/carga_historico.py`
  (mesmo SQL do agente, mês a mês; sem `--gravar` só conta).
- **Banco** (`db/`): `01-schema.sql` (tabelas, calendário, equipes, ajuste do RCA 41) e `02-resumos-e-pacotes.sql`
  (resumos `r_*`, o trecho do mês atual `c_*`, pacotes e as consultas na hora). Migrações no DATA WAREHOUSE:
  `analise_comercial_01_schema`, `analise_comercial_02_resumos_e_pacotes`, `analise_comercial_03_consulta_rcas`.

## A regra (descoberta contra a planilha)

| Indicador | Conta |
|---|---|
| **Sell out** | venda do Relatório 146 (pedido **faturado**, pela **data do pedido**, sem ST, fora bonificação e as condições 5, 6, 11, 12) **− devolução sem ST** (PCMOV ED: `QT × (PUNITCONT − ST)`, pela data do movimento). Por item: `QT × (PVENDA − ST)`, que soma exatamente a venda do pedido (8.464 pedidos de fev/2026, diferença zero) |
| **Supervisor** | o **atual** do RCA (PCUSUARI), como a planilha. RCA 41 em Televendas (`analise_comercial.ajuste_rca`) |
| **Mês** | **comercial**: semanas fechadas de sábado a sexta, 4-4-4-5-4-5-4-4-5-4-4-5 em 2025 e 2026 (`analise_comercial.calendario`) |
| **Positivação** | clientes distintos com venda (sem contar duas vezes o cliente de dois RCAs: `r_grupo`) |
| **Mix** | SKUs distintos vendidos |
| **Margem** | `(venda − custo) ÷ venda`, custo = `QT × (VLCUSTOFIN − ST)` de todos os itens (o lucro do 146) |
| **Meta** | PCMETARCA (somada pelo supervisor atual dá exatamente a PCMETASUP), no mês do calendário da data |

**Mês em andamento:** entra com o valor de hoje (marcado com `*`), mas a comparação é com o **mesmo trecho** do mês
nos outros anos (até ontem; as semanas começam todas no sábado, então o dia N cai no mesmo dia da semana). O **ANO**
é o acumulado até o mesmo ponto em todos os anos (como a planilha, que soma 2025 só até o mês que 2026 já tem).

## Conferência contra a planilha (2026-11-04, `conferencia/conferir_planilha.py`)

- **2026, total LUBE ES:** de −0,06% a +0,06% em jan a set; **fev/2026 ao real** em todos os blocos.
  Quase todos os supervisores ficam a menos de R$ 2 por mês. A sobra é pedido faturado ou cancelado depois do dia em
  que o gestor copiou o número.
- **2025:** −1,9% a +1,2% no total. Vitória Norte (+5% a +10%) e Vitória Sul (−4% a −11%) até out/2025: um RCA mudou
  de supervisor depois, e o sistema usa o supervisor atual (como a planilha faz no mês corrente).
- **2024:** calendário **deduzido** (melhor encaixe com cortes na sexta), de −3,6% a +2,4%: a conferir com o comercial.
- **Positivação, mix e margem:** positivação 2026 a menos de 0,5%; mix perto; margem ~0,5 a
  0,8 ponto acima da aba MARGEM (parada em jan/2025): a fonte da margem da planilha ainda não foi achada.

## As telas

- **Indicadores (como a planilha):** Faturamento, Positivação, Mix (SKUs) e Margem. O recorte da tela num bloco
  grande com o gráfico, e embaixo um bloco por filho (equipe → supervisores → RCAs). Clicar no nome desce um nível;
  clicar num mês abre o mês pelos filhos (painel lateral).
- **Abertura:** Por RCA, Por fornecedor e Produtos do fornecedor (consulta na hora, ~1 s no maior fornecedor).
- **Crescimento:** o ranking de equipes, supervisores, RCAs ou fornecedores (quem mais cresceu e quem mais caiu).
- Filtros: equipe (chips, abre no ES), anos (2024, 2025, 2026), supervisor, RCA e fornecedor. **Excel no formato da
  planilha do gestor** (mesmas cores). Busca (`/`), modo apresentação (`F`), tema claro/escuro, link da visão.
- **Ao vivo:** o painel pergunta de 15 em 15 s se algum pacote mudou; o botão Atualizar pede ao agente uma leitura
  do WinThor na hora.

## Rodar na máquina

`INICIAR.bat` (ou `cd web` · `node servidor_local.js`) → http://localhost:3112. Lê o DATA WAREHOUSE com o `ENV` do
agente ou do Inventário (a senha nunca é impressa). Só escuta a própria máquina: aqui não tem o login do Painel Lube.

## Segurança

Tabelas com RLS ligado e sem políticas (a chave pública não lê nada); funções sem permissão para `anon`. O painel
nunca fala com o banco direto: só as funções `api/*`, com a senha nas variáveis da Vercel (cadastradas pelo Júlio).
Na Vercel, o guarda da Sentinela (`middleware.ts`) só deixa entrar quem vem pelo Painel Lube. Senha, IP do Oracle,
a planilha do gestor e os números de conferência nunca entram neste repositório.
