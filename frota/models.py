from django.db import models


class Importacao(models.Model):
    """Registro de cada carga do CSV: dá rastreabilidade e invalida o cache das estatísticas."""

    arquivo = models.CharField("arquivo", max_length=255)
    linhas_lidas = models.PositiveIntegerField("linhas lidas", default=0)
    linhas_importadas = models.PositiveIntegerField("linhas importadas", default=0)
    linhas_fora_do_estado = models.PositiveIntegerField("linhas de outros estados", default=0)
    criada_em = models.DateTimeField("criada em", auto_now_add=True)

    class Meta:
        verbose_name = "importação"
        verbose_name_plural = "importações"
        ordering = ["-criada_em"]

    def __str__(self):
        return f"{self.arquivo} ({self.criada_em:%d/%m/%Y %H:%M})"


class Veiculo(models.Model):
    """Um veículo elétrico registrado no estado de Washington (uma linha do CSV do DOL)."""

    class Tipo(models.TextChoices):
        BEV = "BEV", "100% elétrico (BEV)"
        PHEV = "PHEV", "Híbrido plug-in (PHEV)"

    class Elegibilidade(models.TextChoices):
        ELEGIVEL = "elegivel", "Elegível"
        NAO_ELEGIVEL = "nao_elegivel", "Não elegível (autonomia baixa)"
        DESCONHECIDA = "desconhecida", "Desconhecida (autonomia não pesquisada)"

    id_dol = models.BigIntegerField("ID no DOL", unique=True)
    vin_parcial = models.CharField("VIN (1-10)", max_length=10)
    condado = models.CharField("condado", max_length=60, db_index=True)
    cidade = models.CharField("cidade", max_length=80, db_index=True)
    cep = models.CharField("CEP (ZIP)", max_length=10, blank=True)
    ano_modelo = models.PositiveSmallIntegerField("ano-modelo", db_index=True)
    montadora = models.CharField("montadora", max_length=40, db_index=True)
    modelo = models.CharField("modelo", max_length=60)
    tipo = models.CharField("tipo", max_length=4, choices=Tipo.choices, db_index=True)
    elegibilidade = models.CharField("elegibilidade CAFV", max_length=12, choices=Elegibilidade.choices)
    # No CSV, 0 significa "autonomia não pesquisada"; aqui vira nulo para não puxar médias para baixo.
    autonomia = models.PositiveSmallIntegerField("autonomia (milhas)", null=True, blank=True)
    distrito_legislativo = models.PositiveSmallIntegerField("distrito legislativo", null=True, blank=True)
    # Distribuidoras que atendem a área do veículo, separadas por "|" (uma área pode ter mais de uma).
    distribuidoras = models.CharField("distribuidoras de energia da área", max_length=255, blank=True)
    longitude = models.FloatField("longitude", null=True, blank=True)
    latitude = models.FloatField("latitude", null=True, blank=True)

    class Meta:
        verbose_name = "veículo"
        verbose_name_plural = "veículos"
        indexes = [
            models.Index(fields=["condado", "montadora", "modelo"], name="veiculo_condado_modelo"),
            models.Index(fields=["cidade", "montadora", "modelo"], name="veiculo_cidade_modelo"),
        ]

    def __str__(self):
        return f"{self.montadora} {self.modelo} {self.ano_modelo} ({self.cidade})"


class Condado(models.Model):
    """Dados do condado vindos de fora da base do DOL: população (Census), renda (SAIPE) e recarga (NREL/AFDC)."""

    nome = models.CharField("nome", max_length=60, unique=True)
    fips = models.CharField("código FIPS", max_length=5, unique=True)
    populacao = models.PositiveIntegerField("população estimada (2025)")
    renda_mediana = models.PositiveIntegerField("renda mediana domiciliar (US$, 2024)", null=True, blank=True)
    estacoes_recarga = models.PositiveIntegerField("estações públicas de recarga", default=0)
    pontos_nivel_1 = models.PositiveIntegerField("pontos nível 1", default=0)
    pontos_nivel_2 = models.PositiveIntegerField("pontos nível 2", default=0)
    pontos_rapidos = models.PositiveIntegerField("pontos de recarga rápida (DC)", default=0)

    class Meta:
        verbose_name = "condado"
        verbose_name_plural = "condados"
        ordering = ["nome"]

    def __str__(self):
        return self.nome

    @property
    def pontos_recarga(self):
        return self.pontos_nivel_1 + self.pontos_nivel_2 + self.pontos_rapidos


class VendaMensal(models.Model):
    """Carros elétricos novos vendidos por mês (primeiro título de veículo novo no DOL), já agregados."""

    mes = models.DateField("mês")
    condado = models.CharField("condado", max_length=60, db_index=True)
    tipo = models.CharField("tipo", max_length=4, choices=Veiculo.Tipo.choices)
    quantidade = models.PositiveIntegerField("quantidade")

    class Meta:
        verbose_name = "venda mensal"
        verbose_name_plural = "vendas mensais"
        ordering = ["mes"]
        constraints = [models.UniqueConstraint(fields=["mes", "condado", "tipo"], name="venda_mensal_unica")]

    def __str__(self):
        return f"{self.mes:%m/%Y} {self.condado} {self.tipo}: {self.quantidade}"
