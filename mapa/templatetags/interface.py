from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe

register = template.Library()

# Caminhos dos ícones no estilo Lucide (stroke 2, currentColor).
ICONES = {
    "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "seta-direita": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "seta-esquerda": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    "seta-cima": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    "sol": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/>'
    '<path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/>'
    '<path d="m19.07 4.93-1.41 1.41"/>',
    "lua": '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    "pino": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>'
    '<circle cx="12" cy="10" r="3"/>',
    "carro": '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5'
    'c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/>'
    '<circle cx="17" cy="17" r="2"/>',
    "grafico": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    "alvo": '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    "alerta": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/>'
    '<path d="M12 17h.01"/>',
    "seta-baixo": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    "cursor": '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435'
    'l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
}


@register.simple_tag
def icone(nome, classes="size-4", traco="2"):
    """Desenha um ícone SVG inline (permitido pela CSP: não tem style= nem script)."""
    return mark_safe(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="{escape(traco)}" stroke-linecap="round" stroke-linejoin="round" '
        f'class="{escape(classes)}" aria-hidden="true" focusable="false">{ICONES[nome]}</svg>'
    )


# Conjuntos de classes Tailwind repetidos nos templates. Escritos por extenso para o Tailwind encontrá-los
# (esta pasta está no @source do app.css).
CLASSES = {
    "card-titulo": "font-semibold tracking-tight",
    "card-descricao": "mt-0.5 text-sm text-pretty text-zinc-500 dark:text-zinc-400",
    "kpi-rotulo": "text-sm text-zinc-500 dark:text-zinc-400",
    "kpi-valor": "mt-2 text-3xl font-semibold tracking-tight",
    "kpi-nota": "mt-1 text-xs text-pretty text-zinc-500 dark:text-zinc-400",
    "secao-rotulo": "flex items-center gap-2 text-sm font-medium text-zinc-500 dark:text-zinc-400",
    "secao-titulo": "mt-1.5 text-2xl font-semibold tracking-tight text-balance",
    "ver-dados": "focus-ring inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-xs font-medium "
    "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50",
    "tabela": "w-full text-left text-sm "
    "[&_th]:px-3 [&_th]:py-2 [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_td]:whitespace-nowrap "
    "[&_td]:text-zinc-600 [&_td]:tabular-nums dark:[&_td]:text-zinc-300 [&_tbody_th]:font-normal "
    "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-zinc-50 [&_thead_th]:text-xs [&_thead_th]:font-medium "
    "[&_thead_th]:text-zinc-500 dark:[&_thead_th]:bg-zinc-800 dark:[&_thead_th]:text-zinc-400 "
    "[&_tbody_tr]:border-t [&_tbody_tr]:border-zinc-100 dark:[&_tbody_tr]:border-zinc-800 "
    "[&_tr[aria-current=true]]:bg-red-50/70 dark:[&_tr[aria-current=true]]:bg-red-500/10",
    "aviso": "flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700 ring-1 "
    "ring-red-600/15 ring-inset dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20",
    "selo-alerta": "inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium "
    "text-red-700 ring-1 ring-red-600/15 ring-inset dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20",
    "vazio": "rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 "
    "dark:border-zinc-700 dark:text-zinc-400",
    "legenda": "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300",
    "estatistica": "rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/60",
    # Carrossel das contas estatísticas
    "trilho": "flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] "
    "[&::-webkit-scrollbar]:hidden",
    "cartao": "w-full shrink-0 snap-start snap-always",
    "passo-rotulo": "text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400",
    "passo": "text-xs leading-5 text-pretty text-zinc-600 dark:text-zinc-300",
    "formula": "mt-1 overflow-x-auto rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs leading-6 whitespace-nowrap "
    "text-zinc-800 tabular-nums dark:bg-zinc-800/60 dark:text-zinc-200",
}


@register.simple_tag
def classe(nome):
    """Devolve um conjunto de classes Tailwind de CLASSES: class="{% classe 'tabela' %}"."""
    return CLASSES[nome]


@register.filter
def valor_p(valor):
    """Formata o valor-p como se escreve num relatório: 'p < 0,001' ou 'p = 0,03'."""
    if valor is None:
        return "p indisponível"
    if valor < 0.001:
        return "p < 0,001"
    return f"p = {valor:.3f}".replace(".", ",")


@register.filter
def num(valor, casas=2):
    """Número no formato brasileiro com sinal de menos tipográfico: -1917.04 -> '−1.917,04'."""
    if valor is None:
        return "–"
    casas = int(casas)
    texto = f"{abs(valor):,.{casas}f}".replace(",", "@").replace(".", ",").replace("@", ".")
    negativo = valor < 0 and round(abs(valor), casas) != 0
    return f"−{texto}" if negativo else texto


@register.inclusion_tag("partials/carrossel_controles.html")
def controles_carrossel(rotulos):
    """Legenda + setas + bolinhas do carrossel: {% controles_carrossel "Resultado|Teste t|Wilcoxon" %}."""
    return {"rotulos": rotulos.split("|")}


@register.filter
def porcento(valor):
    """0.51 -> '51%'."""
    return f"{round(100 * valor)}%" if valor is not None else "–"


@register.filter
def razao(valor, base):
    """Quantas vezes valor é a base, com uma casa: 62.0 / 32.3 -> '1,9'."""
    return num(valor / base, 1) if valor and base else "–"
