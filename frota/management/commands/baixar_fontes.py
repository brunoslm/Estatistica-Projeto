"""
Baixa as fontes complementares para dados/ (o site lê só arquivos locais).

- Census PEP 2025: população estimada por condado.
- Census SAIPE 2024: renda mediana domiciliar por condado.
- NREL/AFDC: estações públicas de recarga em funcionamento em WA (chave pública DEMO_KEY).
- data.wa.gov (rpr4-cgyd): vendas de carro elétrico novo ("Original Title" + "New"),
  já agregadas pela API por mês, condado e tipo, em vez do arquivo bruto de ~1 GB.
"""

import json
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

PASTA = Path(settings.BASE_DIR) / "dados"
AGENTE = "us-estatistica/1.0 (projeto academico)"

POPULACAO = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv"
RENDA = "https://www2.census.gov/programs-surveys/saipe/datasets/2024/2024-state-and-county/est24all.txt"
CARREGADORES = "https://developer.nlr.gov/api/alt-fuel-stations/v1.json?" + urllib.parse.urlencode(
    {"api_key": "DEMO_KEY", "fuel_type": "ELEC", "state": "WA", "status": "E", "access": "public", "limit": "all"}
)
VENDAS = "https://data.wa.gov/resource/rpr4-cgyd.json?" + urllib.parse.urlencode(
    {
        "$select": "date_trunc_ym(date_of_vehicle_sale) as mes, county, electric_vehicle_type, count(*) as quantidade",
        "$where": "transaction_type = 'Original Title' AND new_or_used_vehicle = 'New' "
        "AND state_of_residence = 'WA' AND date_of_vehicle_sale IS NOT NULL",
        "$group": "mes, county, electric_vehicle_type",
        "$order": "mes",
        "$limit": "50000",
    }
)

ARQUIVOS = {
    "populacao_condados_2025.csv": POPULACAO,
    "renda_condados_2024.txt": RENDA,
    "carregadores_wa.json": CARREGADORES,
    "vendas_novos_por_mes.json": VENDAS,
}


def baixar(url, destino):
    """Usa o curl quando existe (o urllib fica preso minutos em algumas redes IPv6); senão, urllib."""
    if shutil.which("curl"):
        subprocess.run(
            ["curl", "-sS", "--fail", "--max-time", "600", "-A", AGENTE, "-o", str(destino), url], check=True
        )
        return destino.stat().st_size
    pedido = urllib.request.Request(url, headers={"User-Agent": AGENTE})
    with urllib.request.urlopen(pedido, timeout=300) as resposta:
        conteudo = resposta.read()
    destino.write_bytes(conteudo)
    return len(conteudo)


class Command(BaseCommand):
    help = "Baixa população, renda, carregadores e vendas mensais para a pasta dados/."

    def handle(self, *args, **opcoes):
        PASTA.mkdir(exist_ok=True)
        for nome, url in ARQUIVOS.items():
            tamanho = baixar(url, PASTA / nome)
            self.stdout.write(f"  {nome}: {tamanho / 1024:,.0f} KB".replace(",", "."))
        vendas = json.loads((PASTA / "vendas_novos_por_mes.json").read_text())
        if len(vendas) >= 50000:
            self.stderr.write(self.style.WARNING("As vendas bateram no limite de 50.000 linhas: aumente o $limit."))
        self.stdout.write(self.style.SUCCESS("Fontes baixadas. Agora rode: python manage.py importar_fontes"))
