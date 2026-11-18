# Carros elétricos em Washington

Projeto de estatística em Django. Página inicial com o mapa dos EUA (us-atlas + d3): Washington em vermelho;
clique para aproximar e ver os condados coloridos pela quantidade de veículos. Abaixo, o painel da frota
(filtrável por condado, pelo select ou clicando no mapa).

## Rodar

```bash
source .venv/bin/activate              # ou: python -m venv .venv && pip install -r requirements.txt
python manage.py migrate
python manage.py importar_veiculos     # lê dados/Electric_Vehicle_Population_Data.csv (~20 s)
python manage.py baixar_fontes         # população, renda, carregadores e vendas mensais (~20 s, usa o curl)
python manage.py importar_fontes
python manage.py runserver
```

A base vem do portal oficial: https://data.wa.gov (dataset `f6w7-q2d2`, "Electric Vehicle Population Data").
Para atualizar, baixe o CSV de novo para `dados/` e rode `importar_veiculos`: o cache das estatísticas se
renova sozinho (a chave inclui a versão da importação).

## Fontes complementares

| Arquivo em `dados/` | Fonte | Uso |
|---|---|---|
| `populacao_condados_2025.csv` | Census, Population Estimates 2025 | veículos por mil habitantes |
| `renda_condados_2024.txt` | Census SAIPE 2024 | renda mediana domiciliar por condado |
| `carregadores_wa.json` | NREL/AFDC (estações públicas em funcionamento) | veículos por ponto de recarga |
| `vendas_novos_por_mes.json` | data.wa.gov `rpr4-cgyd` (agregado pela API) | carros novos vendidos por mês |

## Análises estatísticas

- **Fim do crédito federal (30/09/2025):** cada mês depois do fim é comparado com o mesmo mês do ano
  anterior (pareado, sem sazonalidade); diferença testada com t pareado e Wilcoxon (`scipy.stats`).
- **Renda × adoção:** Spearman, Pearson e regressão linear entre a renda mediana e os veículos por mil
  habitantes nos 39 condados. É uma análise ecológica: correlação por condado, não causa.
- **Recarga:** veículos por ponto público e BEV por ponto rápido (DC). As estações são ligadas ao condado
  pelo ZIP (o condado mais comum entre os veículos daquele ZIP).

## Decisões de dados

- Só entram veículos com `State == WA` (os de outros estados são contados e informados no rodapé).
- `Electric Range = 0` significa "autonomia não pesquisada" e vira nulo: médias e medianas usam só quem tem o dado.
- O campo `Electric Utility` lista várias distribuidoras por área (sobreposição de território), por isso
  não há gráfico de "demanda por distribuidora": o número enganaria.
- As 15 cidades do mapa são recalculadas a cada importação (as com mais veículos, no ponto mediano da frota de cada uma).

## Estrutura

- `frota/` — modelos `Veiculo`, `Condado`, `VendaMensal` e `Importacao`; comandos `importar_veiculos`,
  `baixar_fontes` e `importar_fontes`; `estatisticas.py` (toda a agregação, os testes e o cache).
- `mapa/` — modelo `Cidade`, views da página inicial (página completa ou fragmento htmx) e detalhe da cidade.
- `static/js/mapa.js` (mapa d3), `static/js/painel.js` (gráficos d3), `static/js/app.js` (componentes Alpine CSP).

## Front-end (tudo local, nada de CDN)

Estilo 100% Tailwind v4: as cores dos gráficos e do mapa são tokens do tema (`fill-serie-1`, `fill-seq-3`...,
com valores próprios no tema escuro) e os conjuntos de classes repetidos ficam em `CLASSES`
(`mapa/templatetags/interface.py`, usado com `{% classe "tabela" %}`) e nas constantes `CLASSE` do JS.

```bash
npm install
npm run vendor      # copia d3, topojson-client, us-atlas, htmx, Alpine CSP e a fonte Inter para static/
npm run build:css   # compila assets/css/app.css -> static/css/app.css (use watch:css enquanto edita)
```
