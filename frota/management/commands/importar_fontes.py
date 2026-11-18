"""
Importa as fontes complementares baixadas por baixar_fontes: população, renda, carregadores e vendas mensais.
Rode depois de importar_veiculos (os carregadores são ligados ao condado pelo ZIP dos veículos).
"""

import csv
import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from frota.models import Condado, Importacao, VendaMensal, Veiculo

PASTA = Path(settings.BASE_DIR) / "dados"
FIPS_WASHINGTON = "53"
TIPOS = {
    "Battery Electric Vehicle (BEV)": Veiculo.Tipo.BEV,
    "Plug-in Hybrid Electric Vehicle (PHEV)": Veiculo.Tipo.PHEV,
}


def ler_populacao():
    """co-est2025-alldata.csv -> {fips do condado: (nome, população 2025)}."""
    condados = {}
    with (PASTA / "populacao_condados_2025.csv").open(newline="", encoding="latin-1") as arquivo:
        for linha in csv.DictReader(arquivo):
            if linha["STATE"] == FIPS_WASHINGTON and linha["SUMLEV"] == "050":
                nome = linha["CTYNAME"].removesuffix(" County")
                condados[linha["STATE"] + linha["COUNTY"]] = (nome, int(linha["POPESTIMATE2025"]))
    return condados


def ler_renda():
    """est24all.txt (SAIPE, colunas separadas por espaço) -> {fips: renda mediana domiciliar}."""
    rendas = {}
    with (PASTA / "renda_condados_2024.txt").open(encoding="latin-1") as arquivo:
        for linha in arquivo:
            partes = linha.split()
            if len(partes) > 20 and partes[0] == FIPS_WASHINGTON and partes[1] != "0":
                fips = FIPS_WASHINGTON + partes[1].zfill(3)
                rendas[fips] = int(partes[20]) if partes[20].isdigit() else None
    return rendas


def mapa_cep_para_condado():
    """ZIP -> condado mais comum entre os veículos com aquele ZIP (e cidade -> condado, de reserva)."""
    por_cep = defaultdict(Counter)
    por_cidade = defaultdict(Counter)
    for cep, cidade, condado in Veiculo.objects.values_list("cep", "cidade", "condado"):
        por_cep[cep][condado] += 1
        por_cidade[cidade.lower()][condado] += 1
    return (
        {cep: contagem.most_common(1)[0][0] for cep, contagem in por_cep.items()},
        {cidade: contagem.most_common(1)[0][0] for cidade, contagem in por_cidade.items()},
    )


class Command(BaseCommand):
    help = "Importa população, renda, carregadores públicos e vendas mensais (arquivos em dados/)."

    def handle(self, *args, **opcoes):
        faltando = [
            nome
            for nome in (
                "populacao_condados_2025.csv",
                "renda_condados_2024.txt",
                "carregadores_wa.json",
                "vendas_novos_por_mes.json",
            )
            if not (PASTA / nome).exists()
        ]
        if faltando:
            raise CommandError(f"Faltam arquivos em dados/: {', '.join(faltando)}. Rode: python manage.py baixar_fontes")
        if not Veiculo.objects.exists():
            raise CommandError("Importe os veículos antes: python manage.py importar_veiculos")

        with transaction.atomic():
            self.importar_condados()
            self.importar_carregadores()
            self.importar_vendas()
            # Nova versão dos dados: invalida o cache das estatísticas.
            ultima = Importacao.objects.order_by("-id").first()
            Importacao.objects.create(
                arquivo="fontes complementares",
                linhas_lidas=ultima.linhas_lidas if ultima else 0,
                linhas_importadas=ultima.linhas_importadas if ultima else 0,
                linhas_fora_do_estado=ultima.linhas_fora_do_estado if ultima else 0,
            )
        self.stdout.write(self.style.SUCCESS("Fontes complementares importadas."))

    def importar_condados(self):
        populacao = ler_populacao()
        renda = ler_renda()
        Condado.objects.all().delete()
        Condado.objects.bulk_create(
            [
                Condado(nome=nome, fips=fips, populacao=habitantes, renda_mediana=renda.get(fips))
                for fips, (nome, habitantes) in populacao.items()
            ]
        )
        sem_renda = [nome for fips, (nome, _) in populacao.items() if not renda.get(fips)]
        self.stdout.write(f"  {len(populacao)} condados (sem renda: {', '.join(sem_renda) or 'nenhum'})")

    def importar_carregadores(self):
        estacoes = json.loads((PASTA / "carregadores_wa.json").read_text())["fuel_stations"]
        por_cep, por_cidade = mapa_cep_para_condado()
        condados = {condado.nome: condado for condado in Condado.objects.all()}
        sem_condado = 0
        for estacao in estacoes:
            nome = por_cep.get((estacao.get("zip") or "")[:5]) or por_cidade.get((estacao.get("city") or "").lower())
            condado = condados.get(nome)
            if not condado:
                sem_condado += 1
                continue
            condado.estacoes_recarga += 1
            condado.pontos_nivel_1 += estacao.get("ev_level1_evse_num") or 0
            condado.pontos_nivel_2 += estacao.get("ev_level2_evse_num") or 0
            condado.pontos_rapidos += estacao.get("ev_dc_fast_num") or 0
        Condado.objects.bulk_update(
            condados.values(), ["estacoes_recarga", "pontos_nivel_1", "pontos_nivel_2", "pontos_rapidos"]
        )
        self.stdout.write(f"  {len(estacoes) - sem_condado} estações ligadas a um condado ({sem_condado} sem condado)")

    def importar_vendas(self):
        linhas = json.loads((PASTA / "vendas_novos_por_mes.json").read_text())
        totais = Counter()
        for linha in linhas:
            tipo = TIPOS.get(linha["electric_vehicle_type"])
            if not tipo or not linha.get("county"):
                continue  # ignora hidrogênio e vendas sem condado
            ano, mes = linha["mes"][:7].split("-")
            totais[(date(int(ano), int(mes), 1), linha["county"], tipo)] += int(linha["quantidade"])
        VendaMensal.objects.all().delete()
        VendaMensal.objects.bulk_create(
            [
                VendaMensal(mes=mes, condado=condado, tipo=tipo, quantidade=quantidade)
                for (mes, condado, tipo), quantidade in totais.items()
            ]
        )
        self.stdout.write(f"  {sum(totais.values())} vendas de carros novos em {len(totais)} linhas mensais")
