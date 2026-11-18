from django.contrib import admin

from .models import Condado, Importacao, VendaMensal, Veiculo


@admin.register(Veiculo)
class VeiculoAdmin(admin.ModelAdmin):
    list_display = ["montadora", "modelo", "ano_modelo", "tipo", "cidade", "condado", "autonomia"]
    list_filter = ["tipo", "elegibilidade", "condado"]
    search_fields = ["montadora", "modelo", "cidade", "vin_parcial"]
    show_full_result_count = False


@admin.register(Importacao)
class ImportacaoAdmin(admin.ModelAdmin):
    list_display = ["arquivo", "linhas_lidas", "linhas_importadas", "linhas_fora_do_estado", "criada_em"]


@admin.register(Condado)
class CondadoAdmin(admin.ModelAdmin):
    list_display = ["nome", "populacao", "renda_mediana", "estacoes_recarga", "pontos_nivel_2", "pontos_rapidos"]
    search_fields = ["nome"]


@admin.register(VendaMensal)
class VendaMensalAdmin(admin.ModelAdmin):
    list_display = ["mes", "condado", "tipo", "quantidade"]
    list_filter = ["tipo", "condado"]
    date_hierarchy = "mes"
