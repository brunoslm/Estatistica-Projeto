"""
Estatísticas da frota de veículos elétricos de Washington.

Toda a agregação fica aqui (views e templates só exibem). Os resultados vão para o cache
com a versão da última importação na chave: importar de novo invalida tudo sozinho.
"""

from collections import defaultdict
from datetime import date

from django.core.cache import cache
from django.db.models import Count, Q, Sum
from scipy import stats

from .models import Condado, Importacao, VendaMensal, Veiculo

TOP_N = 10
ANO_DE_CORTE = 2010  # anos-modelo até aqui viram uma coluna só ("até 2010"): são poucas dezenas de carros

SIGLAS = {"BMW", "GMC", "EV", "AMG", "RAM", "SUV", "PHEV", "BEV", "PUD", "XC", "UX", "RZ", "NX", "RX", "TX"}
MINUSCULAS = {"OF": "of", "AND": "and", "NO": "No"}
MINIMO_AMOSTRA = 30  # anos com menos veículos que isso (com autonomia) ficam fora da mediana
# O crédito federal de US$ 7.500 para carro elétrico novo acabou para compras feitas depois de 30/09/2025.
FIM_CREDITO_FEDERAL = date(2025, 10, 1)
INICIO_SERIE_VENDAS = date(2014, 1, 1)
MINIMO_VEICULOS_RECARGA = 500  # condados menores que isso ficam fora do ranking de veículos por ponto
COBERTURA_MINIMA = 50  # % dos BEV do ano com autonomia pesquisada para a mediana daquele ano valer


def formatar_nome(texto):
    """'TESLA MODEL Y' -> 'Tesla Model Y'; mantém siglas e códigos com número ('EV6', 'ID.4', 'BMW')."""
    palavras = []
    for palavra in texto.split():
        nucleo = palavra.strip("()")
        if nucleo in SIGLAS:
            palavras.append(palavra.upper())
        elif palavra in MINUSCULAS:
            palavras.append(MINUSCULAS[palavra])
        elif palavra in SIGLAS or any(caractere.isdigit() for caractere in palavra) or len(palavra) <= 2:
            palavras.append(palavra)
        else:
            palavras.append("-".join(parte.capitalize() for parte in palavra.split("-")))
    return " ".join(palavras)


def em_portugues(valor, casas=1):
    """12.5 -> '12,5' (vírgula decimal, para os textos gerados aqui)."""
    return f"{valor:.{casas}f}".replace(".", ",")


def percentual(parte, todo):
    return round(100 * parte / todo, 1) if todo else 0.0


def versao_dos_dados():
    ultima = Importacao.objects.order_by("-id").values_list("id", flat=True).first()
    return ultima or 0


def ultima_importacao():
    return Importacao.objects.order_by("-id").first()


def em_cache(nome, calcular, *partes):
    chave = ":".join(["frota", str(versao_dos_dados()), nome, *[str(parte) for parte in partes]])
    valor = cache.get(chave)
    if valor is None:
        valor = calcular()
        cache.set(chave, valor, timeout=None)
    return valor


def lista_de_condados():
    return em_cache(
        "condados",
        lambda: list(Veiculo.objects.order_by("condado").values_list("condado", flat=True).distinct()),
    )


def mediana_autonomia(consulta):
    """Mediana da autonomia declarada, só entre os veículos que têm o dado."""
    com_dado = consulta.filter(autonomia__isnull=False).order_by("autonomia")
    quantidade = com_dado.count()
    if not quantidade:
        return None
    return com_dado.values_list("autonomia", flat=True)[quantidade // 2]


def ranking(consulta, campos, total, limite=TOP_N):
    linhas = consulta.values(*campos).annotate(total=Count("id")).order_by("-total")[:limite]
    return [
        {
            "nome": formatar_nome(" ".join(linha[campo] for campo in campos)),
            "total": linha["total"],
            "pct": percentual(linha["total"], total),
        }
        for linha in linhas
    ]


def cobertura_por_ano(consulta):
    """Por ano-modelo: quantos BEV existem e quantos têm a autonomia pesquisada pelo DOL."""
    anos = defaultdict(lambda: {"bev": 0, "com_dado": 0})
    for linha in (
        consulta.filter(tipo=Veiculo.Tipo.BEV)
        .values("ano_modelo")
        .annotate(total=Count("id"), com_dado=Count("id", filter=Q(autonomia__isnull=False)))
    ):
        ano = max(linha["ano_modelo"], ANO_DE_CORTE)
        anos[ano]["bev"] += linha["total"]
        anos[ano]["com_dado"] += linha["com_dado"]
    return [
        {
            "ano": f"Até {ano}" if ano == ANO_DE_CORTE else str(ano),
            "bev": valores["bev"],
            "com_dado": valores["com_dado"],
            "pct": percentual(valores["com_dado"], valores["bev"]),
        }
        for ano, valores in sorted(anos.items())
    ]


def autonomia_por_ano(consulta, cobertura):
    """
    Mediana da autonomia dos BEV por ano-modelo. Só entram os anos em que o dado é representativo:
    pelo menos COBERTURA_MINIMA% dos BEV do ano pesquisados e MINIMO_AMOSTRA veículos com o dado.
    """
    anos_validos = {
        int(linha["ano"])
        for linha in cobertura
        if not linha["ano"].startswith("Até")
        and linha["pct"] >= COBERTURA_MINIMA
        and linha["com_dado"] >= MINIMO_AMOSTRA
    }
    valores = defaultdict(list)
    for ano, autonomia in consulta.filter(
        tipo=Veiculo.Tipo.BEV, autonomia__isnull=False, ano_modelo__in=anos_validos
    ).values_list("ano_modelo", "autonomia"):
        valores[ano].append(autonomia)
    serie = []
    for ano in sorted(valores):
        amostra = sorted(valores[ano])
        serie.append({"ano": str(ano), "mediana": amostra[len(amostra) // 2], "amostra": len(amostra)})
    return serie


def resumo_da_lacuna(cobertura, autonomia):
    """Depois do último ano com dado representativo: quantos BEV existem e que % tem autonomia."""
    if not autonomia:
        return None
    ultimo = int(autonomia[-1]["ano"])
    depois = [linha for linha in cobertura if not linha["ano"].startswith("Até") and int(linha["ano"]) > ultimo]
    bev = sum(linha["bev"] for linha in depois)
    if not bev:
        return None
    return {
        "ultimo_ano": ultimo,
        "primeiro_ano_sem": ultimo + 1,
        "bev": bev,
        "pct_com_dado": percentual(sum(linha["com_dado"] for linha in depois), bev),
    }


def calcular_painel(condado=None):
    consulta = Veiculo.objects.all()
    if condado:
        consulta = consulta.filter(condado=condado)

    resumo = consulta.aggregate(
        total=Count("id"),
        bev=Count("id", filter=Q(tipo=Veiculo.Tipo.BEV)),
        desconhecida=Count("id", filter=Q(elegibilidade=Veiculo.Elegibilidade.DESCONHECIDA)),
    )
    total = resumo["total"]

    anos = defaultdict(lambda: {"bev": 0, "phev": 0})
    for linha in consulta.values("ano_modelo", "tipo").annotate(total=Count("id")):
        ano = max(linha["ano_modelo"], ANO_DE_CORTE)
        anos[ano]["bev" if linha["tipo"] == Veiculo.Tipo.BEV else "phev"] += linha["total"]
    serie_anos = [
        {"ano": f"Até {ano}" if ano == ANO_DE_CORTE else str(ano), **valores} for ano, valores in sorted(anos.items())
    ]

    elegibilidade_por_chave = dict(
        consulta.values_list("elegibilidade").annotate(total=Count("id")).values_list("elegibilidade", "total")
    )
    elegibilidade = [
        {
            "chave": chave,
            "nome": rotulo,
            "total": elegibilidade_por_chave.get(chave, 0),
            "pct": percentual(elegibilidade_por_chave.get(chave, 0), total),
        }
        for chave, rotulo in Veiculo.Elegibilidade.choices
    ]

    montadoras = ranking(consulta, ["montadora"], total)
    cobertura = cobertura_por_ano(consulta)
    autonomia = autonomia_por_ano(consulta, cobertura)
    condados_estado = contagem_por_condado()
    total_estado = sum(condados_estado.values())

    return {
        "condado": condado,
        "total": total,
        "pct_estado": percentual(total, total_estado),
        "bev": resumo["bev"],
        "phev": total - resumo["bev"],
        "pct_bev": percentual(resumo["bev"], total),
        "pct_desconhecida": percentual(resumo["desconhecida"], total),
        "mediana_autonomia_bev": mediana_autonomia(consulta.filter(tipo=Veiculo.Tipo.BEV)),
        "montadora_lider": montadoras[0] if montadoras else None,
        "anos": serie_anos,
        "modelos": ranking(consulta, ["montadora", "modelo"], total),
        "montadoras": montadoras,
        "elegibilidade": elegibilidade,
        "autonomia": autonomia,
        "cobertura": cobertura,
        "lacuna": resumo_da_lacuna(cobertura, autonomia),
        "cidades": ranking(consulta, ["cidade"], total),
    }


def painel(condado=None):
    return em_cache("painel", lambda: calcular_painel(condado), condado or "todos")


def contagem_por_condado():
    return em_cache(
        "contagem_condados",
        lambda: dict(Veiculo.objects.values_list("condado").annotate(total=Count("id")).values_list("condado", "total")),
    )


def calcular_tabela_condados():
    """Uma linha por condado: tamanho da frota, fatia BEV e os dois modelos mais registrados."""
    contagens = contagem_por_condado()
    total_estado = sum(contagens.values())
    bev = dict(
        Veiculo.objects.filter(tipo=Veiculo.Tipo.BEV)
        .values_list("condado")
        .annotate(total=Count("id"))
        .values_list("condado", "total")
    )
    modelos = defaultdict(list)
    for linha in (
        Veiculo.objects.values("condado", "montadora", "modelo").annotate(total=Count("id")).order_by("condado", "-total")
    ):
        if len(modelos[linha["condado"]]) < 2:
            modelos[linha["condado"]].append(linha)

    tabela = []
    for condado, total in sorted(contagens.items(), key=lambda item: -item[1]):
        primeiro, *resto = modelos[condado]
        segundo = resto[0] if resto else None
        tabela.append(
            {
                "condado": condado,
                "total": total,
                "pct_estado": percentual(total, total_estado),
                "pct_bev": percentual(bev.get(condado, 0), total),
                "lider": formatar_nome(f"{primeiro['montadora']} {primeiro['modelo']}"),
                "lider_total": primeiro["total"],
                "lider_pct": percentual(primeiro["total"], total),
                "segundo": formatar_nome(f"{segundo['montadora']} {segundo['modelo']}") if segundo else None,
                "segundo_pct": percentual(segundo["total"], total) if segundo else None,
            }
        )
    return tabela


def tabela_condados():
    return em_cache("tabela_condados", calcular_tabela_condados)


def leitura_operacional(dados, efeito=None, recarga_atual=None, recarga_geral=None):
    """Pontos de atenção escritos a partir dos números (nada aqui é fixo no texto)."""
    tabela = tabela_condados()
    pontos = []

    if dados["condado"]:
        posicao = next(i for i, linha in enumerate(tabela, start=1) if linha["condado"] == dados["condado"])
        pontos.append(
            f"{dados['condado']} concentra {em_portugues(dados['pct_estado'], 1 if dados['pct_estado'] >= 1 else 2)}% da frota do estado "
            f"e é o {posicao}º de {len(tabela)} condados em volume."
        )
    else:
        tres = tabela[:3]
        fatia = sum(linha["pct_estado"] for linha in tres)
        nomes = ", ".join(linha["condado"] for linha in tres[:2]) + f" e {tres[2]['condado']}"
        pontos.append(
            f"{fatia:.0f}% da frota está em 3 dos {len(tabela)} condados ({nomes}). "
            "Infraestrutura de recarga fora desse eixo é o gargalo para a meta de 2035."
        )

    if efeito and efeito["variacao_pct"] is not None:
        sinal = "caíram" if efeito["variacao_pct"] < 0 else "subiram"
        conclusao = (
            "queda estatisticamente significativa"
            if efeito["significativo"]
            else "diferença ainda dentro do acaso para este recorte"
        )
        pontos.append(
            f"Depois do fim do crédito federal, as vendas de carro novo {sinal} "
            f"{em_portugues(abs(efeito['variacao_pct']))}% contra os mesmos meses do ano anterior ({conclusao})."
        )

    lider = dados["montadora_lider"]
    if lider:
        pontos.append(
            f"{lider['nome']} responde por {lider['pct']:.0f}% dos registros: alta dependência de um único fornecedor "
            "para peças, assistência e padrão de conector."
        )

    if recarga_atual and recarga_atual.get("por_ponto"):
        texto = f"São {em_portugues(recarga_atual['por_ponto'])} veículos por ponto público de recarga"
        if dados["condado"] and recarga_geral:
            texto += f" (estado: {em_portugues(recarga_geral['estado']['por_ponto'])})"
        elif recarga_geral and recarga_geral["piores"]:
            pior = recarga_geral["piores"][0]
            texto += f"; o pior caso é {pior['condado']}, com {em_portugues(pior['por_ponto'])}"
        pontos.append(texto + ".")
    elif dados["condado"] and recarga_atual is not None:
        pontos.append(f"{dados['condado']} não tem nenhum ponto público de recarga cadastrado no NREL.")

    pontos.append(
        f"{dados['pct_desconhecida']:.0f}% da frota está sem autonomia pesquisada pelo DOL, "
        "então a elegibilidade a incentivos não pode ser auditada."
    )
    return pontos


def estatisticas_cidade(nome):
    def calcular():
        consulta = Veiculo.objects.filter(cidade=nome)
        total = consulta.count()
        bev = consulta.filter(tipo=Veiculo.Tipo.BEV).count()
        return {
            "total": total,
            "pct_bev": percentual(bev, total),
            "mediana_autonomia_bev": mediana_autonomia(consulta.filter(tipo=Veiculo.Tipo.BEV)),
            "modelos": ranking(consulta, ["montadora", "modelo"], total, limite=5),
            "montadoras": ranking(consulta, ["montadora"], total, limite=3),
        }

    return em_cache("cidade", calcular, nome)


# ---------------------------------------------------------------------------
# Vendas de carros novos e o fim do crédito federal
# ---------------------------------------------------------------------------


def somar_mes(dia, meses):
    total = dia.year * 12 + dia.month - 1 + meses
    return date(total // 12, total % 12 + 1, 1)


def ultimo_mes():
    """A série vai até o último mês que existe no arquivo de vendas."""
    return VendaMensal.objects.order_by("-mes").values_list("mes", flat=True).first()


def calcular_vendas_mensais(condado=None):
    fim = ultimo_mes()
    if not fim:
        return []
    consulta = VendaMensal.objects.filter(mes__gte=INICIO_SERIE_VENDAS, mes__lte=fim)
    if condado:
        consulta = consulta.filter(condado=condado)
    valores = defaultdict(lambda: {"bev": 0, "phev": 0})
    for mes, tipo, total in consulta.values_list("mes", "tipo").annotate(total=Sum("quantidade")).values_list(
        "mes", "tipo", "total"
    ):
        valores[mes]["bev" if tipo == Veiculo.Tipo.BEV else "phev"] += total
    serie = []
    mes = INICIO_SERIE_VENDAS
    while mes <= fim:  # meses sem venda entram como zero: a série fica contínua
        serie.append({"mes": f"{mes:%Y-%m}", **valores[mes]})
        mes = somar_mes(mes, 1)
    return serie


def vendas_mensais(condado=None):
    return em_cache("vendas", lambda: calcular_vendas_mensais(condado), condado or "todos")


def nome_do_mes(texto):
    meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
    ano, mes = texto.split("-")
    return f"{meses[int(mes) - 1]}/{ano}"


def efeito_fim_do_credito(serie):
    """
    Compara cada mês depois do fim do crédito com o mesmo mês do ano anterior (pareado, sem efeito de sazonalidade)
    e testa a diferença com t pareado e Wilcoxon. Também mede a corrida de jul-set/2025 antes do prazo.
    """
    total = {linha["mes"]: linha["bev"] + linha["phev"] for linha in serie}
    inicio = f"{FIM_CREDITO_FEDERAL:%Y-%m}"
    depois = [mes for mes in total if mes >= inicio]
    meses = [mes for mes in depois if f"{int(mes[:4]) - 1}{mes[4:]}" in total]
    pares = [(total[mes], total[f"{int(mes[:4]) - 1}{mes[4:]}"]) for mes in meses]
    if len(pares) < 3:
        return None
    atuais = [atual for atual, _ in pares]
    anteriores = [anterior for _, anterior in pares]
    soma_atual, soma_anterior = sum(atuais), sum(anteriores)

    p_t = p_wilcoxon = None
    calculo = None
    if soma_anterior and any(a != b for a, b in pares):
        p_t = float(stats.ttest_rel(atuais, anteriores).pvalue)
        try:
            p_wilcoxon = float(stats.wilcoxon(atuais, anteriores).pvalue)
        except ValueError:
            p_wilcoxon = None
        calculo = conta_do_teste_pareado(meses, atuais, anteriores)

    corrida_atual = sum(total.get(f"2025-{mes:02d}", 0) for mes in (7, 8, 9))
    corrida_anterior = sum(total.get(f"2024-{mes:02d}", 0) for mes in (7, 8, 9))
    pico = max((mes for mes in total if mes < inicio), key=lambda mes: total[mes], default=None)

    return {
        "periodo": f"{nome_do_mes(depois[0])} a {nome_do_mes(depois[-1])}",
        "periodo_anterior": f"{nome_do_mes(str(int(depois[0][:4]) - 1) + depois[0][4:])} a "
        f"{nome_do_mes(str(int(depois[-1][:4]) - 1) + depois[-1][4:])}",
        "meses": len(pares),
        "depois": soma_atual,
        "antes": soma_anterior,
        "variacao_pct": percentual(soma_atual - soma_anterior, soma_anterior) if soma_anterior else None,
        "p_t": p_t,
        "p_wilcoxon": p_wilcoxon,
        "significativo": p_t is not None and p_t < 0.05,
        "corrida_pct": percentual(corrida_atual - corrida_anterior, corrida_anterior) if corrida_anterior else None,
        "mes_pico": nome_do_mes(pico) if pico else None,
        "vendas_pico": total.get(pico) if pico else None,
        "calculo": calculo,
    }


def conta_do_teste_pareado(meses, atuais, anteriores):
    """
    As contas do teste t pareado e do Wilcoxon, passo a passo, para mostrar no painel.
    d = vendas do mês − vendas do mesmo mês um ano antes.
    """
    diferencas = [atual - anterior for atual, anterior in zip(atuais, anteriores)]
    n = len(diferencas)
    media = sum(diferencas) / n
    desvio = (sum((d - media) ** 2 for d in diferencas) / (n - 1)) ** 0.5  # desvio-padrão amostral (n − 1)
    erro_padrao = desvio / n**0.5
    graus = n - 1
    t = media / erro_padrao if erro_padrao else None
    t_critico = float(stats.t.ppf(0.975, graus))

    # Wilcoxon: ordena |d| (sem os zeros), dá postos (empate = posto médio) e soma os postos de cada sinal.
    nao_nulas = [d for d in diferencas if d]
    postos = stats.rankdata([abs(d) for d in nao_nulas])
    soma_positivos = float(sum(posto for posto, d in zip(postos, nao_nulas) if d > 0))
    soma_negativos = float(sum(posto for posto, d in zip(postos, nao_nulas) if d < 0))
    posto_de = dict(zip(range(len(nao_nulas)), postos))
    linhas, indice = [], 0
    for mes, atual, anterior, d in zip(meses, atuais, anteriores, diferencas):
        posto = None
        if d:
            posto = float(posto_de[indice])
            indice += 1
        linhas.append(
            {"mes": nome_do_mes(mes), "atual": atual, "anterior": anterior, "diferenca": d, "posto": posto}
        )

    return {
        "linhas": linhas,
        "n": n,
        "soma_diferencas": sum(diferencas),
        "media": media,
        "desvio": desvio,
        "erro_padrao": erro_padrao,
        "graus": graus,
        "t": t,
        "t_critico": t_critico,
        "ic_inferior": media - t_critico * erro_padrao,
        "ic_superior": media + t_critico * erro_padrao,
        "n_wilcoxon": len(nao_nulas),
        "w_positivos": soma_positivos,
        "w_negativos": soma_negativos,
        "w": min(soma_positivos, soma_negativos),
        "w_esperado": len(nao_nulas) * (len(nao_nulas) + 1) / 4,  # média de W⁺ se não houvesse efeito
    }


# ---------------------------------------------------------------------------
# Adoção por habitante e renda
# ---------------------------------------------------------------------------


def calcular_adocao_e_renda():
    veiculos = contagem_por_condado()
    pontos = []
    for condado in Condado.objects.all():
        total = veiculos.get(condado.nome, 0)
        pontos.append(
            {
                "condado": condado.nome,
                "veiculos": total,
                "populacao": condado.populacao,
                "por_mil": round(1000 * total / condado.populacao, 1) if condado.populacao else 0,
                "renda": condado.renda_mediana,
            }
        )
    validos = [ponto for ponto in pontos if ponto["renda"]]
    if len(validos) < 5:
        return {"pontos": pontos, "n": len(validos)}
    rendas = [ponto["renda"] / 1000 for ponto in validos]
    adocao = [ponto["por_mil"] for ponto in validos]
    spearman = stats.spearmanr(rendas, adocao)
    pearson = stats.pearsonr(rendas, adocao)
    regressao = stats.linregress(rendas, adocao)
    calculo = conta_da_correlacao(rendas, adocao)
    return {
        "pontos": sorted(pontos, key=lambda ponto: -ponto["por_mil"]),
        "n": len(validos),
        "spearman": round(float(spearman.statistic), 2),
        "p_spearman": float(spearman.pvalue),
        "pearson": round(float(pearson.statistic), 2),
        "p_pearson": float(pearson.pvalue),
        "inclinacao": round(float(regressao.slope), 2),  # veículos por mil hab. a cada US$ 1 mil de renda
        "intercepto": round(float(regressao.intercept), 2),
        "r2": round(float(regressao.rvalue) ** 2, 2),
        "calculo": calculo,
        "por_mil_estado": round(1000 * sum(veiculos.values()) / sum(p["populacao"] for p in pontos), 1)
        if pontos
        else None,
    }


def conta_da_correlacao(x, y):
    """
    As contas de Pearson, Spearman e da regressão linear, passo a passo, para mostrar no painel.
    x = renda mediana (US$ mil), y = veículos por mil habitantes; um ponto por condado.
    """
    n = len(x)
    media_x, media_y = sum(x) / n, sum(y) / n
    sxx = sum((xi - media_x) ** 2 for xi in x)
    syy = sum((yi - media_y) ** 2 for yi in y)
    sxy = sum((xi - media_x) * (yi - media_y) for xi, yi in zip(x, y))
    r = sxy / (sxx * syy) ** 0.5
    t_r = r * ((n - 2) / (1 - r**2)) ** 0.5
    inclinacao = sxy / sxx
    intercepto = media_y - inclinacao * media_x

    postos_x, postos_y = stats.rankdata(x), stats.rankdata(y)  # empate = posto médio
    soma_d2 = float(sum((px - py) ** 2 for px, py in zip(postos_x, postos_y)))
    rho_formula = 1 - 6 * soma_d2 / (n * (n**2 - 1))
    rho = float(stats.spearmanr(x, y).statistic)  # Pearson aplicado aos postos (exato mesmo com empates)
    t_rho = rho * ((n - 2) / (1 - rho**2)) ** 0.5
    return {
        "n": n,
        "graus": n - 2,
        "media_x": media_x,
        "media_y": media_y,
        "sxx": sxx,
        "syy": syy,
        "sxy": sxy,
        "r": r,
        "r2": r**2,
        "t_r": t_r,
        "inclinacao": inclinacao,
        "intercepto": intercepto,
        "soma_d2": soma_d2,
        "n_cubo": n * (n**2 - 1),
        "rho_formula": rho_formula,
        "rho": rho,
        "t_rho": t_rho,
        "tem_empates": len(set(x)) < n or len(set(y)) < n,
    }


def adocao_e_renda():
    return em_cache("adocao_renda", calcular_adocao_e_renda)


# ---------------------------------------------------------------------------
# Infraestrutura de recarga
# ---------------------------------------------------------------------------


def calcular_recarga():
    veiculos = contagem_por_condado()
    bev = dict(
        Veiculo.objects.filter(tipo=Veiculo.Tipo.BEV)
        .values_list("condado")
        .annotate(total=Count("id"))
        .values_list("condado", "total")
    )
    linhas = []
    for condado in Condado.objects.all():
        total = veiculos.get(condado.nome, 0)
        pontos = condado.pontos_recarga
        linhas.append(
            {
                "condado": condado.nome,
                "veiculos": total,
                "bev": bev.get(condado.nome, 0),
                "estacoes": condado.estacoes_recarga,
                "pontos": pontos,
                "rapidos": condado.pontos_rapidos,
                "por_ponto": round(total / pontos, 1) if pontos else None,
                "bev_por_rapido": round(bev.get(condado.nome, 0) / condado.pontos_rapidos, 1)
                if condado.pontos_rapidos
                else None,
            }
        )
    total_veiculos = sum(linha["veiculos"] for linha in linhas)
    total_pontos = sum(linha["pontos"] for linha in linhas)
    total_rapidos = sum(linha["rapidos"] for linha in linhas)
    total_bev = sum(linha["bev"] for linha in linhas)
    grandes = [linha for linha in linhas if linha["veiculos"] >= MINIMO_VEICULOS_RECARGA and linha["por_ponto"]]
    return {
        "condados": {linha["condado"]: linha for linha in linhas},
        "estado": {
            "veiculos": total_veiculos,
            "estacoes": sum(linha["estacoes"] for linha in linhas),
            "pontos": total_pontos,
            "rapidos": total_rapidos,
            "por_ponto": round(total_veiculos / total_pontos, 1) if total_pontos else None,
            "bev": total_bev,
            "bev_por_rapido": round(total_bev / total_rapidos, 1) if total_rapidos else None,
        },
        "piores": sorted(grandes, key=lambda linha: -linha["por_ponto"])[:TOP_N],
        "sem_ponto": sorted(
            (linha["condado"] for linha in linhas if not linha["pontos"] and linha["veiculos"]),
        ),
    }


def recarga():
    return em_cache("recarga", calcular_recarga)
