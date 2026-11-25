import json

from django.http import HttpResponse
from django.shortcuts import get_object_or_404, render
from django.template.loader import render_to_string

from frota import estatisticas

from .models import Cidade


def eh_htmx(request):
    """Requisição htmx que espera só o fragmento (não boost nem restauração de histórico)."""
    cabecalhos = request.headers
    return (
        cabecalhos.get("HX-Request") == "true"
        and not cabecalhos.get("HX-Boosted")
        and not cabecalhos.get("HX-History-Restore-Request")
    )


RESUMO_TOP = 5


def montar_resumo_mapa(condado, dados, tabela, adocao_atual):
    """Resumo embaixo do mapa: posição do condado e os 5 maiores (cidades do condado ou condados do estado)."""
    if condado:
        posicao = next((i for i, linha in enumerate(tabela, start=1) if linha["condado"] == condado), None)
        lugares = dados["cidades"][:RESUMO_TOP]
    else:
        posicao = None
        lugares = [
            {"nome": linha["condado"], "total": linha["total"], "pct": linha["pct_estado"]}
            for linha in tabela[:RESUMO_TOP]
        ]
    return {
        "posicao": posicao,
        "n_condados": len(tabela),
        "populacao": (adocao_atual or {}).get("populacao"),
        "lugares": lugares,
        "modelos": dados["modelos"][:RESUMO_TOP],
    }


def montar_contexto_painel(condado):
    """Contexto do painel (cards, rankings, tabela e os dados dos gráficos desenhados pelo painel.js)."""
    dados = estatisticas.painel(condado)
    vendas = estatisticas.vendas_mensais(condado)
    efeito = estatisticas.efeito_fim_do_credito(vendas)
    adocao = estatisticas.adocao_e_renda()
    recarga = estatisticas.recarga()
    recarga_atual = recarga["condados"].get(condado) if condado else recarga["estado"]
    por_condado = {linha["condado"]: linha for linha in adocao["pontos"]}

    tabela = [
        {
            **linha,
            "por_mil": por_condado.get(linha["condado"], {}).get("por_mil"),
            "por_ponto": recarga["condados"].get(linha["condado"], {}).get("por_ponto"),
        }
        for linha in estatisticas.tabela_condados()
    ]
    return {
        "painel": dados,
        "condado": condado,
        "condados": estatisticas.lista_de_condados(),
        "leitura": estatisticas.leitura_operacional(dados, efeito, recarga_atual, recarga),
        "tabela_condados": tabela,
        "vendas": vendas,
        "efeito": efeito,
        "adocao": adocao,
        "adocao_atual": por_condado.get(condado),
        "resumo_mapa": montar_resumo_mapa(condado, dados, tabela, por_condado.get(condado)),
        "recarga": recarga,
        "recarga_atual": recarga_atual,
        "piores_recarga": [
            {"nome": linha["condado"], "total": linha["por_ponto"], "detalhe": f"{linha['pontos']:,} pontos".replace(",", ".")}
            for linha in recarga["piores"]
        ],
        # Vai num atributo data-graficos: o htmx (allowScriptTags:false) remove <script> dos fragmentos.
        "graficos_json": json.dumps(
            {
                "condado": condado,
                "anos": dados["anos"],
                "autonomia": dados["autonomia"],
                "cobertura": dados["cobertura"],
                "elegibilidade": dados["elegibilidade"],
                "vendas": vendas,
                "fimCredito": f"{estatisticas.FIM_CREDITO_FEDERAL:%Y-%m}",
                "normalidade": (
                    {
                        "pontos": efeito["calculo"]["qq"],
                        "media": efeito["calculo"]["media"],
                        "desvio": efeito["calculo"]["desvio"],
                    }
                    if efeito and efeito.get("calculo")
                    else None
                ),
                "adocao": {
                    "pontos": adocao["pontos"],
                    "inclinacao": adocao.get("inclinacao"),
                    "intercepto": adocao.get("intercepto"),
                },
            },
            ensure_ascii=False,
        ),
    }


def pagina_inicial(request):
    """Mapa dos EUA com Washington em destaque e, abaixo, o painel da frota (filtrável por condado)."""
    condado = request.GET.get("condado") or None
    if condado not in estatisticas.lista_de_condados():
        condado = None

    contexto = montar_contexto_painel(condado)
    if eh_htmx(request):
        # O painel troca no lugar (#painel) e o resumo embaixo do mapa vem junto, fora de banda (hx-swap-oob).
        html = render_to_string("mapa/_painel.html", contexto, request) + render_to_string(
            "mapa/_resumo_mapa.html", {**contexto, "oob": True}, request
        )
        return HttpResponse(html)

    cidades = list(Cidade.objects.all())
    contexto.update(
        {
            "cidades": cidades,
            "cidades_mapa": [cidade.para_mapa() for cidade in cidades],
            "metricas_condados": {
                linha["condado"]: {"total": linha["veiculos"], "porMil": linha["por_mil"]}
                for linha in estatisticas.adocao_e_renda()["pontos"]
            },
            "importacao": estatisticas.ultima_importacao(),
        }
    )
    return render(request, "mapa/inicio.html", contexto)


def detalhe_cidade(request, slug):
    """Painel da cidade: fragmento para o htmx, página completa para o resto."""
    cidade = get_object_or_404(Cidade, slug=slug)
    contexto = {"cidade": cidade, "dados": estatisticas.estatisticas_cidade(cidade.nome)}
    template = "mapa/_cidade.html" if eh_htmx(request) else "mapa/cidade.html"
    return render(request, template, contexto)
