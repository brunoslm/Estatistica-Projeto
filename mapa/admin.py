from django.contrib import admin

from .models import Cidade


@admin.register(Cidade)
class CidadeAdmin(admin.ModelAdmin):
    list_display = ["nome", "condado", "latitude", "longitude", "total_veiculos"]
    search_fields = ["nome", "condado"]
    prepopulated_fields = {"slug": ["nome"]}
