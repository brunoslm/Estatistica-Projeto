from django.urls import path

from . import views

app_name = "mapa"

urlpatterns = [
    path("", views.pagina_inicial, name="inicio"),
    path("cidades/<slug:slug>/", views.detalhe_cidade, name="detalhe_cidade"),
]
