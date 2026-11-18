from django.db import models
from django.urls import reverse


class Cidade(models.Model):
    """Cidade marcada no mapa. Recalculada pelo comando importar_veiculos (as que mais têm veículos)."""

    nome = models.CharField("nome", max_length=80)
    slug = models.SlugField("slug", unique=True)
    condado = models.CharField("condado", max_length=80)
    latitude = models.DecimalField("latitude", max_digits=8, decimal_places=4)
    longitude = models.DecimalField("longitude", max_digits=8, decimal_places=4)
    total_veiculos = models.PositiveIntegerField("veículos registrados", default=0)

    class Meta:
        verbose_name = "cidade"
        verbose_name_plural = "cidades"
        ordering = ["-total_veiculos", "nome"]

    def __str__(self):
        return self.nome

    def get_absolute_url(self):
        return reverse("mapa:detalhe_cidade", args=[self.slug])

    def para_mapa(self):
        """Dados que o mapa (static/js/mapa.js) precisa para desenhar o marcador."""
        return {
            "nome": self.nome,
            "slug": self.slug,
            "condado": self.condado,
            "latitude": float(self.latitude),
            "longitude": float(self.longitude),
            "total": self.total_veiculos,
            "url": self.get_absolute_url(),
        }
