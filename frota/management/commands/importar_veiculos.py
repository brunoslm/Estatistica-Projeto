import csv
import re
import statistics
from collections import defaultdict
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from frota.models import Importacao, Veiculo
from mapa.models import Cidade

ARQUIVO_PADRAO = Path(settings.BASE_DIR) / "dados" / "Electric_Vehicle_Population_Data.csv"
TAMANHO_LOTE = 5000
CIDADES_NO_MAPA = 15

TIPOS = {
    "Battery Electric Vehicle (BEV)": Veiculo.Tipo.BEV,
    "Plug-in Hybrid Electric Vehicle (PHEV)": Veiculo.Tipo.PHEV,
}
ELEGIBILIDADES = {
    "Clean Alternative Fuel Vehicle Eligible": Veiculo.Elegibilidade.ELEGIVEL,
    "Not eligible due to low battery range": Veiculo.Elegibilidade.NAO_ELEGIVEL,
    "Eligibility unknown as battery range has not been researched": Veiculo.Elegibilidade.DESCONHECIDA,
}
PADRAO_PONTO = re.compile(r"POINT \((-?[\d.]+) (-?[\d.]+)\)")


def inteiro_ou_nulo(valor):
    try:
        return int(float(valor))
    except (TypeError, ValueError):
        return None


def ler_ponto(valor):
    """'POINT (-122.37 47.74)' -> (longitude, latitude)."""
    encontrado = PADRAO_PONTO.match(valor or "")
    if not encontrado:
        return None, None
    return float(encontrado.group(1)), float(encontrado.group(2))


def converter_linha(linha):
    """Transforma uma linha do CSV num Veiculo (sem salvar). Devolve None se a linha for inválida."""
    tipo = TIPOS.get(linha["Electric Vehicle Type"])
    id_dol = inteiro_ou_nulo(linha["DOL Vehicle ID"])
    ano = inteiro_ou_nulo(linha["Model Year"])
    if not tipo or id_dol is None or ano is None or not linha["County"]:
        return None
    autonomia = inteiro_ou_nulo(linha["Electric Range"])
    longitude, latitude = ler_ponto(linha["Vehicle Location"])
    return Veiculo(
        id_dol=id_dol,
        vin_parcial=linha["VIN (1-10)"][:10],
        condado=linha["County"].strip(),
        cidade=linha["City"].strip().title(),
        cep=(linha["Postal Code"] or "").split(".")[0],
        ano_modelo=ano,
        montadora=linha["Make"].strip(),
        modelo=linha["Model"].strip(),
        tipo=tipo,
        elegibilidade=ELEGIBILIDADES.get(
            linha["Clean Alternative Fuel Vehicle (CAFV) Eligibility"], Veiculo.Elegibilidade.DESCONHECIDA
        ),
        autonomia=autonomia or None,  # 0 no CSV = não pesquisada
        distrito_legislativo=inteiro_ou_nulo(linha["Legislative District"]),
        # O CSV separa as distribuidoras da área com "|" ou "||"; normaliza para "A|B".
        distribuidoras="|".join(parte.strip() for parte in (linha["Electric Utility"] or "").split("|") if parte.strip()),
        longitude=longitude,
        latitude=latitude,
    )


class Command(BaseCommand):
    help = "Importa o CSV de veículos elétricos do estado de Washington (data.wa.gov) e recalcula as cidades do mapa."

    def add_arguments(self, parser):
        parser.add_argument("arquivo", nargs="?", default=str(ARQUIVO_PADRAO), help="Caminho do CSV.")

    def handle(self, *args, **opcoes):
        caminho = Path(opcoes["arquivo"])
        if not caminho.exists():
            raise CommandError(f"Arquivo não encontrado: {caminho}")

        lidas = importadas = fora_do_estado = invalidas = 0
        lote = []
        with transaction.atomic():
            Veiculo.objects.all().delete()
            with caminho.open(newline="", encoding="utf-8-sig") as arquivo:
                for linha in csv.DictReader(arquivo):
                    lidas += 1
                    if linha["State"] != "WA":
                        fora_do_estado += 1
                        continue
                    veiculo = converter_linha(linha)
                    if veiculo is None:
                        invalidas += 1
                        continue
                    lote.append(veiculo)
                    if len(lote) >= TAMANHO_LOTE:
                        Veiculo.objects.bulk_create(lote)
                        importadas += len(lote)
                        lote.clear()
                        self.stdout.write(f"\r  {importadas:,} veículos importados".replace(",", "."), ending="")
            if lote:
                Veiculo.objects.bulk_create(lote)
                importadas += len(lote)

            self.recalcular_cidades()
            Importacao.objects.create(
                arquivo=caminho.name,
                linhas_lidas=lidas,
                linhas_importadas=importadas,
                linhas_fora_do_estado=fora_do_estado,
            )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"Pronto: {importadas} veículos de WA importados de {lidas} linhas "
                f"({fora_do_estado} de outros estados e {invalidas} inválidas ignoradas)."
            )
        )

    def recalcular_cidades(self):
        """As cidades do mapa passam a ser as que mais têm veículos, no ponto mediano da frota de cada uma."""
        pontos = defaultdict(list)
        condados = {}
        for cidade, condado, longitude, latitude in Veiculo.objects.filter(latitude__isnull=False).values_list(
            "cidade", "condado", "longitude", "latitude"
        ):
            pontos[cidade].append((longitude, latitude))
            condados.setdefault(cidade, condado)

        maiores = sorted(pontos, key=lambda nome: len(pontos[nome]), reverse=True)[:CIDADES_NO_MAPA]
        Cidade.objects.all().delete()
        Cidade.objects.bulk_create(
            [
                Cidade(
                    nome=nome,
                    slug=slugify(nome),
                    condado=condados[nome],
                    longitude=round(statistics.median(p[0] for p in pontos[nome]), 4),
                    latitude=round(statistics.median(p[1] for p in pontos[nome]), 4),
                    total_veiculos=len(pontos[nome]),
                )
                for nome in maiores
            ]
        )
