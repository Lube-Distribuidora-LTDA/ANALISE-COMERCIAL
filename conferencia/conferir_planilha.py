"""
Confere o banco (analise_comercial.r_rca / r_grupo) contra a planilha do gestor "ACOMP INDICADORES ANO",
bloco a bloco e mes a mes. So le; nao grava nada.

  python -X utf8 conferir_planilha.py ["C:\\caminho\\ACOMP INDICADORES ANO.xlsx"]

O que se espera (2026-11-04, primeira conferencia):
  - 2026, meses fechados: total LUBE ES entre 0,00% e 0,06% da planilha; fev/2026 ao real em todos os blocos.
    A sobra e pedido faturado ou cancelado depois do dia em que o gestor copiou o numero.
  - 2025: diferencas maiores por supervisor quando um RCA mudou de supervisor depois (a planilha usa o
    supervisor da epoca em que foi preenchida; o sistema usa o atual, como a planilha faz no mes corrente).
  - 2024: calendario deduzido (origem 'deduzido'), a conferir com o comercial.
"""
import os
import sys
import unicodedata
import warnings
from collections import defaultdict

import openpyxl
import psycopg2
from dotenv import load_dotenv

warnings.filterwarnings("ignore")
PLANILHA = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\gti.julio.alves\Downloads\ACOMP INDICADORES ANO.xlsx"
load_dotenv(os.environ.get("AGENTE_ENV") or r"C:\Users\gti.julio.alves\Desktop\BI\16. INVENTARIO\etl\ENV", override=True)

BLOCOS = {"CENTRAL SUL": 1, "LITORAL SUL": 17, "NORDESTE": 16, "NOROESTE": 13, "NORTE": 4, "VIT NORTE": 7,
          "VIT SUL": 12, "TETELEVENDAS": 8, "TELEVENDAS": 8, "GRDS CONTAS": 6, "FARMA": 14}
RCA_41 = 41          # na planilha tem bloco próprio (pelo primeiro nome) e conta em Televendas


def norm(s):
    return " ".join(unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().upper().split())


def ler_banco():
    u = os.environ["SUPABASE_DB_USER"]
    assert u.endswith("ivcnotrynogaljrvvyes")
    c = psycopg2.connect(host=os.environ["SUPABASE_DB_HOST"], port=int(os.environ.get("SUPABASE_DB_PORT", 5432)),
                         dbname="postgres", user=u, password=os.environ["SUPABASE_DB_PASSWORD"],
                         application_name="analise-comercial-conferencia")
    c.set_session(readonly=True)
    cur = c.cursor()
    cur.execute("""select r.mes, r.codusur, coalesce(m.codsupervisor, 0), coalesce(m.equipe, 'OUTROS'), coalesce(m.televendas, false),
                          r.venda, r.dev, r.custo
                     from analise_comercial.r_rca r left join analise_comercial.mapa_rca m using (codusur)""")
    rca = cur.fetchall()
    cur.execute("select mes, grupo, posit, mix from analise_comercial.r_grupo")
    grupo = {(m, g): (p, x) for m, g, p, x in cur.fetchall()}
    cur.execute("select ano, mes, origem from analise_comercial.calendario")
    origem = {(a, m): o for a, m, o in cur.fetchall()}
    c.close()
    return rca, grupo, origem


def blocos(ws):
    """[(rotulo, ano, linha_da_planilha, [12 valores])] das linhas 'Sell Out AAAA'."""
    out, nome = [], "LUBE ES"
    for r in range(1, ws.max_row + 1):
        a, b = ws.cell(r, 1).value, ws.cell(r, 2).value
        if isinstance(a, str) and a.strip() and not norm(a).startswith(("SELL OUT", "INDICADORES", "META", "20", "TELE 2", "CRESC")):
            nome = norm(a) + (" SEM SOLANGE" if isinstance(b, str) and "SOLANGE" in norm(b) else "")
        if isinstance(a, str) and norm(a).startswith("SELL OUT"):
            out.append((nome, int(a.split()[-1]), r, [ws.cell(r, col).value for col in range(2, 14)]))
    return out


def main():
    rca, grupo, origem = ler_banco()
    fat = defaultdict(float)       # (mes, chave) -> sell out
    venda = defaultdict(float)
    custo = defaultdict(float)
    for mes, u, sup, eq, tv, v, d, c in rca:
        liq = float(v) - float(d)
        chaves = []
        if eq == "ES":
            chaves += ["LUBE ES"] + ([] if tv else ["S/TELEVENDAS"])
            venda[mes] += float(v)
            custo[mes] += float(c)
        for nome, cod in BLOCOS.items():
            if cod == sup:
                chaves.append(nome)
                if cod == 8 and u != RCA_41:
                    chaves.append(nome + " SEM SOLANGE")
        if u == RCA_41:
            chaves.append("SOLANGE")
        for k in chaves:
            fat[(mes, k)] += liq

    wb = openpyxl.load_workbook(PLANILHA, data_only=True)
    resumo = []
    print(f"{'bloco':28} {'ano':>4}  " + "  ".join(f"{m:>9}" for m in ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]))
    for aba in ("FAT 24X25", "FAT 25X26"):
        print(f"--- {aba}: diferença do sistema para a planilha, em % (ok = menos de R$ 2)")
        for nome, ano, _, vals in blocos(wb[aba]):
            if aba == "FAT 24X25" and ano == 2025:
                continue          # 2025 se confere na aba 25X26 (mesmos números)
            cel = []
            for i, pv in enumerate(vals):
                mes = ano * 100 + i + 1
                if not isinstance(pv, (int, float)) or pv == 0:
                    cel.append(f"{'':>9}")
                    continue
                nosso = fat.get((mes, nome), 0.0)
                dif = nosso - pv
                cel.append(f"{'ok':>9}" if abs(dif) < 2 else f"{dif / pv * 100:>+8.2f}%")
                resumo.append((nome, ano, i + 1, pv, nosso))
            print(f"{nome[:28]:28} {ano:>4}  " + "  ".join(cel))

    print("--- POSIT 25X26 e 24X25 (LUBE ES, clientes distintos): sistema × planilha")
    for aba, linhas in (("POSIT 24X25", {2024: 23}), ("POSIT 25X26", {2025: 23, 2026: 24})):
        ws = wb[aba]
        for ano, r in linhas.items():
            cel = []
            for i in range(12):
                pv = ws.cell(r, 2 + i).value
                if not isinstance(pv, (int, float)) or not pv:
                    continue
                p, _ = grupo.get((ano * 100 + i + 1, "E:ES"), (0, 0))
                cel.append(f"{i + 1:02d}: {p}×{pv:.0f}")
            print(f"  {ano}  " + "  ".join(cel))
    print("--- MIX (SKUs distintos, LUBE ES) e MARGEM (%): sistema × planilha")
    ws, wm = wb["MIX"], wb["MARGEM"]
    for ano, r in ((2024, 23), (2025, 24)):
        cel = []
        for i in range(12):
            pv, pm = ws.cell(r, 2 + i).value, wm.cell(r, 2 + i).value
            if not isinstance(pv, (int, float)) or not pv:
                continue
            mes = ano * 100 + i + 1
            _, x = grupo.get((mes, "E:ES"), (0, 0))
            mg = (venda[mes] - custo[mes]) / venda[mes] * 100 if venda[mes] else 0
            cel.append(f"{i + 1:02d}: {x}×{pv:.0f} {mg:.1f}%×{pm}")
        print(f"  {ano}  " + "  ".join(cel))

    print("--- LUBE ES por mês (total): sistema × planilha")
    for nome, ano, m, pv, nosso in resumo:
        if nome == "LUBE ES":
            print(f"  {ano}-{m:02d}  calendário {origem.get((ano, m), '?'):9}  planilha {pv:>16,.2f}  sistema {nosso:>16,.2f}  dif {nosso - pv:>+12,.2f} ({(nosso - pv) / pv * 100:+.2f}%)")


if __name__ == "__main__":
    main()
