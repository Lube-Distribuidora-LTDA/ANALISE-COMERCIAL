"""
Carga (e reconciliacao) do historico da Analise Comercial no schema analise_comercial.

O dia a dia e do AGENTE LUBE (venda de ontem e hoje de minuto em minuto, 45 dias de 10 em 10 min,
devolucao e meta). Este script cobre o que a janela do agente nao alcanca: a primeira carga (desde
30/12/2023, o comeco do mes comercial de jan/2024) e, quando preciso, conferir de novo um periodo
antigo. Le o WinThor com o MESMO SQL do agente (Desktop\\BI\\22. AGENTE LUBE\\2 - AGENTE\\fluxos\\
analise_comercial.toml), mes a mes, numa transacao so de leitura; troca o periodo no banco (DELETE do
periodo + COPY), uma transacao por mes.

Sem --gravar, so conta o que leria.

Uso:
  python -X utf8 carga_historico.py                                  (ensaio)
  python -X utf8 carga_historico.py --gravar
  python -X utf8 carga_historico.py --desde 2025-01-01 --ate 2025-12-31 --gravar
  python -X utf8 carga_historico.py --so-cadastros --gravar           (RCA, supervisor, produto, fornecedor)
"""
import argparse
import io
import os
import sys
import time
import tomllib
from datetime import date, timedelta
from decimal import Decimal

import oracledb
import psycopg2
from dotenv import load_dotenv

ENV = os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV"
TOML = r"C:\Users\gti.julio.alves\Desktop\BI\22. AGENTE LUBE\2 - AGENTE\fluxos\analise_comercial.toml"
REF = "ivcnotrynogaljrvvyes"
load_dotenv(ENV, override=True)
oracledb.defaults.fetch_decimals = True

# fluxo -> (tabela, coluna de data no Oracle que ganha o "< :ate")
PERIODICOS = {
    "analise_comercial.venda_45d": ("analise_comercial.venda", "c.data >= :desde"),
    "analise_comercial.devolucao": ("analise_comercial.devolucao", "m.dtmov >= :desde"),
    "analise_comercial.meta": ("analise_comercial.meta", "m.data >= :desde"),
}
CADASTROS = ["analise_comercial.rca", "analise_comercial.supervisor", "analise_comercial.produto",
             "analise_comercial.fornecedor"]


def fluxos():
    with open(TOML, "rb") as f:
        return {x["nome"]: x for x in tomllib.load(f)["fluxo"]}


def texto(v):
    """Igual ao agente: texto sem espaco nas pontas, vazio = nulo; data sem hora; numero exato."""
    if v is None:
        return r"\N"
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return r"\N"
        return v.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")
    if hasattr(v, "date") and callable(v.date):
        return v.date().isoformat()
    if isinstance(v, Decimal):
        t = format(v, "f")
        if "." in t:
            t = t.rstrip("0").rstrip(".")
        return t or "0"
    return str(v)


def conectar_oracle():
    c = oracledb.connect(user=os.environ["ORACLE_USER"], password=os.environ["ORACLE_PASSWORD"],
                         dsn=f'{os.environ["ORACLE_HOST"]}:{os.environ.get("ORACLE_PORT", "1521")}/{os.environ["ORACLE_SERVICE_NAME"]}')
    c.cursor().execute("SET TRANSACTION READ ONLY")
    return c


def conectar_pg():
    usuario = os.environ["SUPABASE_DB_USER"]
    if not usuario.endswith(REF):
        sys.exit(f"SUPABASE_DB_USER nao e do DATA WAREHOUSE ({REF})")
    return psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"], port=int(os.environ.get("SUPABASE_DB_PORT", 5432)),
                            dbname=os.environ.get("SUPABASE_DB_NAME", "postgres"), user=usuario,
                            password=os.environ["SUPABASE_DB_PASSWORD"], connect_timeout=20,
                            application_name="analise-comercial-historico")


def copiar(cur, tabela, colunas, linhas):
    buf = io.StringIO("".join("\t".join(texto(v) for v in l) + "\n" for l in linhas))
    cur.copy_expert(f"COPY {tabela} ({', '.join(colunas)}) FROM STDIN", buf)


def meses(de: date, ate: date):
    """Fatias de no maximo um mes do calendario: [ini, fim)."""
    ini = de
    while ini <= ate:
        prox = date(ini.year + (ini.month == 12), ini.month % 12 + 1, 1)
        fim = min(prox, ate + timedelta(days=1))
        yield ini, fim
        ini = fim


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", default="2023-12-30")
    ap.add_argument("--ate", default=None, help="ultimo dia (padrao: hoje)")
    ap.add_argument("--gravar", action="store_true")
    ap.add_argument("--so-cadastros", action="store_true")
    a = ap.parse_args()
    de = date.fromisoformat(a.desde)
    ate = date.fromisoformat(a.ate) if a.ate else date.today()
    cat = fluxos()
    ora = conectar_oracle()
    pg = conectar_pg() if a.gravar else None
    t0 = time.time()

    # cadastros: inteiros, troca tudo
    for nome in CADASTROS:
        f = cat[nome]
        cur = ora.cursor()
        cur.execute(f["sql"])
        linhas = cur.fetchall()
        print(f"{nome:32} {len(linhas):>9,} linhas")
        if pg:
            with pg.cursor() as c:
                c.execute(f"DELETE FROM {f['destino']}")
                copiar(c, f["destino"], f["colunas"], linhas)
            pg.commit()
    if a.so_cadastros:
        return

    # meta: um pedaco so (pequena), do comeco ao fim do que existe
    f = cat["analise_comercial.meta"]
    sql = f["sql"].replace(PERIODICOS[f["nome"]][1], PERIODICOS[f["nome"]][1] + " AND m.data < :ate")
    cur = ora.cursor()
    cur.execute(sql, desde=de, ate=date(2100, 1, 1))
    linhas = cur.fetchall()
    print(f"{f['nome']:32} {len(linhas):>9,} linhas (desde {de:%d/%m/%Y})")
    if pg:
        with pg.cursor() as c:
            c.execute("DELETE FROM analise_comercial.meta WHERE data >= %s", (de,))
            copiar(c, f["destino"], f["colunas"], linhas)
        pg.commit()

    # venda e devolucao: mes a mes
    for nome in ("analise_comercial.venda_45d", "analise_comercial.devolucao"):
        f = cat[nome]
        tabela, pred = PERIODICOS[nome]
        col_ora = pred.split(" >= ")[0]
        sql = f["sql"].replace(pred, pred + f" AND {col_ora} < :ate")
        total = 0
        for ini, fim in meses(de, ate):
            t = time.time()
            cur = ora.cursor()
            cur.arraysize = 5000
            cur.execute(sql, desde=ini, ate=fim)
            linhas = cur.fetchall()
            total += len(linhas)
            ms_ora = time.time() - t
            if pg:
                t = time.time()
                with pg.cursor() as c:
                    c.execute(f"DELETE FROM {tabela} WHERE data >= %s AND data < %s", (ini, fim))
                    apagadas = c.rowcount
                    copiar(c, tabela, f["colunas"], linhas)
                pg.commit()
                print(f"{tabela:32} {ini:%Y-%m}  {len(linhas):>8,} linhas  WinThor {ms_ora:5.1f}s  banco {time.time() - t:5.1f}s  (saiu {apagadas:,})")
            else:
                print(f"{tabela:32} {ini:%Y-%m}  {len(linhas):>8,} linhas  WinThor {ms_ora:5.1f}s")
        print(f"{tabela:32} total {total:,}")
    ora.rollback()
    print(f"Pronto em {time.time() - t0:.0f}s" + ("" if a.gravar else " (ensaio: nada gravado)"))


if __name__ == "__main__":
    main()
