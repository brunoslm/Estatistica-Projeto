from django.db import migrations

# nome, slug, condado, latitude, longitude, posição do rótulo
CIDADES = [
    ("Seattle", "seattle", "King", "47.6062", "-122.3321", "esquerda"),
    ("Bellevue", "bellevue", "King", "47.6101", "-122.2015", "direita"),
    ("Tacoma", "tacoma", "Pierce", "47.2529", "-122.4443", "esquerda"),
    ("Everett", "everett", "Snohomish", "47.9790", "-122.2021", "direita"),
    ("Bellingham", "bellingham", "Whatcom", "48.7519", "-122.4787", "direita"),
    ("Olympia", "olympia", "Thurston", "47.0379", "-122.9007", "esquerda"),
    ("Vancouver", "vancouver", "Clark", "45.6387", "-122.6615", "direita"),
    ("Yakima", "yakima", "Yakima", "46.6021", "-120.5059", "direita"),
    ("Wenatchee", "wenatchee", "Chelan", "47.4235", "-120.3103", "direita"),
    ("Kennewick", "kennewick", "Benton", "46.2112", "-119.1372", "direita"),
    ("Spokane", "spokane", "Spokane", "47.6588", "-117.4260", "esquerda"),
]


def criar_cidades(apps, schema_editor):
    Cidade = apps.get_model("mapa", "Cidade")
    for nome, slug, condado, latitude, longitude, rotulo in CIDADES:
        Cidade.objects.update_or_create(
            slug=slug,
            defaults={
                "nome": nome,
                "condado": condado,
                "latitude": latitude,
                "longitude": longitude,
                "posicao_rotulo": rotulo,
            },
        )


def apagar_cidades(apps, schema_editor):
    Cidade = apps.get_model("mapa", "Cidade")
    Cidade.objects.filter(slug__in=[c[1] for c in CIDADES]).delete()


class Migration(migrations.Migration):
    dependencies = [("mapa", "0001_initial")]

    operations = [migrations.RunPython(criar_cidades, apagar_cidades)]
