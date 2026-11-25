"""
Deixa o projeto pronto depois de um git clone, sem baixar nada da internet.

Os dados ficam no repositório comprimidos (dados/*.xz). Este comando descompacta o que faltar,
aplica as migrações e importa veículos e fontes complementares.
"""

import lzma
import shutil
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand

PASTA = Path(settings.BASE_DIR) / "dados"


class Command(BaseCommand):
    help = "Descompacta dados/*.xz, roda as migrações e importa tudo (não precisa de internet)."

    def handle(self, *args, **opcoes):
        for comprimido in sorted(PASTA.glob("*.xz")):
            destino = comprimido.with_suffix("")
            if destino.exists() and destino.stat().st_mtime >= comprimido.stat().st_mtime:
                continue
            with lzma.open(comprimido) as origem, destino.open("wb") as saida:
                shutil.copyfileobj(origem, saida)
            self.stdout.write(f"  descompactado: {destino.name}")

        call_command("migrate", verbosity=0)
        self.stdout.write("  migrações aplicadas")
        call_command("importar_veiculos")
        call_command("importar_fontes")
        self.stdout.write(self.style.SUCCESS("Pronto. Rode: python manage.py runserver"))
