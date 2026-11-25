/*
 * Gráficos do painel da frota, desenhados com d3 a partir do JSON em #painel[data-graficos].
 * Redesenha quando o htmx troca o painel (filtro de condado) e quando o card muda de largura.
 * Tudo estilizado com classes Tailwind (constante CLASSE); as cores das séries são tokens do tema
 * (fill-serie-1, bg-serie-2...) com valores próprios no claro e no escuro.
 */
(function () {
  "use strict";

  const d3 = window.d3;
  if (!d3) return;

  const numero = new Intl.NumberFormat("pt-BR");
  const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const porcentagem = (valor) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  const observadores = [];

  // Classes Tailwind dos elementos dos gráficos (o @source do app.css inclui static/js).
  const CLASSE = {
    grade: "stroke-zinc-200 [shape-rendering:crispEdges] dark:stroke-zinc-800",
    base: "stroke-zinc-300 [shape-rendering:crispEdges] dark:stroke-zinc-700",
    eixo: "fill-zinc-500 text-[11px] tabular-nums dark:fill-zinc-400",
    rotulo: "fill-zinc-900 text-xs font-semibold tabular-nums dark:fill-zinc-50",
    rotuloSuave: "fill-zinc-500 text-[11px] font-medium dark:fill-zinc-400",
    rotuloInterno: "pointer-events-none fill-white text-xs font-semibold",
    marca: "transition-opacity duration-150",
    linha: "fill-none stroke-2 [stroke-linecap:round] [stroke-linejoin:round]",
    area: "fill-serie-1 opacity-10",
    ponto: "stroke-white stroke-2 dark:stroke-zinc-900",
    mira: "stroke-zinc-300 [shape-rendering:crispEdges] dark:stroke-zinc-600",
    marco: "stroke-zinc-400 [shape-rendering:crispEdges] dark:stroke-zinc-500",
    tendencia: "fill-none stroke-zinc-400 stroke-[1.5] dark:stroke-zinc-500",
    alvo: "fill-transparent",
    esmaecido: "opacity-40",
    dicaTitulo: "mb-1.5 font-semibold text-zinc-900 dark:text-zinc-50",
    dicaLinha: "flex items-center justify-between gap-4 py-0.5",
    dicaChave: "flex items-center gap-1.5",
    dicaValor: "font-medium text-zinc-900 tabular-nums dark:text-zinc-50",
    dicaCor: "inline-block size-2 rounded-sm",
  };
  const PREENCHIMENTO = { "serie-1": "fill-serie-1", "serie-2": "fill-serie-2", "serie-3": "fill-serie-3" };
  const TRACO = { "serie-1": "stroke-serie-1", "serie-2": "stroke-serie-2", "serie-3": "stroke-serie-3" };
  const FUNDO = { "serie-1": "bg-serie-1", "serie-2": "bg-serie-2", "serie-3": "bg-serie-3" };

  // Destaca a marca sob o cursor e esmaece as outras.
  function esmaecer(selecao, ativa) {
    selecao.classed(CLASSE.esmaecido, (item) => (ativa ? item !== ativa : false));
  }

  /* ---------- Dica (tooltip) ---------- */

  const dica = document.getElementById("grafico-dica");

  // linhas: [{ rotulo, valor, cor }] — montado com textContent, nunca innerHTML.
  function mostrarDica(evento, titulo, linhas) {
    if (!dica) return;
    dica.replaceChildren();
    const cabecalho = document.createElement("p");
    cabecalho.className = CLASSE.dicaTitulo;
    cabecalho.textContent = titulo;
    dica.append(cabecalho);
    for (const linha of linhas) {
      const item = document.createElement("div");
      item.className = CLASSE.dicaLinha;
      const chave = document.createElement("span");
      chave.className = CLASSE.dicaChave;
      if (linha.cor) {
        const cor = document.createElement("span");
        cor.className = `${CLASSE.dicaCor} ${FUNDO[linha.cor]}`;
        chave.append(cor);
      }
      chave.append(document.createTextNode(linha.rotulo));
      const valor = document.createElement("span");
      valor.className = CLASSE.dicaValor;
      valor.textContent = linha.valor;
      item.append(chave, valor);
      dica.append(item);
    }
    moverDica(evento);
    dica.dataset.visivel = "";
  }

  function moverDica(evento) {
    if (!dica) return;
    const margem = 14;
    const { width, height } = dica.getBoundingClientRect();
    let x = evento.clientX + margem;
    let y = evento.clientY + margem;
    if (x + width > window.innerWidth - 8) x = evento.clientX - width - margem;
    if (y + height > window.innerHeight - 8) y = evento.clientY - height - margem;
    dica.style.left = `${Math.max(8, x)}px`;
    dica.style.top = `${Math.max(8, y)}px`;
  }

  function esconderDica() {
    if (!dica) return;
    delete dica.dataset.visivel;
    // Volta para o canto: uma dica invisível parada fora da tela não pode gerar rolagem.
    dica.style.left = "0px";
    dica.style.top = "0px";
  }

  /* ---------- Formas ---------- */

  // Retângulo com os cantos de cima arredondados (ponta do dado) e a base reta.
  function colunaArredondada(x, y, largura, altura, raio) {
    if (altura <= 0) return "";
    const r = Math.min(raio, largura / 2, altura);
    return `M${x},${y + altura}V${y + r}Q${x},${y} ${x + r},${y}H${x + largura - r}Q${x + largura},${y} ${x + largura},${y + r}V${y + altura}Z`;
  }

  function novoSvg(elemento, largura, altura) {
    d3.select(elemento).selectAll("svg").remove();
    return d3
      .select(elemento)
      .append("svg")
      .attr("viewBox", `0 0 ${largura} ${altura}`)
      .attr("width", "100%") // largura fixa em px seguraria o card largo quando a janela encolhe
      .attr("height", altura)
      .attr("class", "block overflow-visible")
      .attr("aria-hidden", "true");
  }

  /* ---------- Colunas empilhadas: BEV + PHEV por ano-modelo ---------- */

  function graficoAnos(elemento, dados) {
    const largura = elemento.clientWidth;
    const altura = elemento.clientHeight;
    const margem = { topo: 20, direita: 4, base: 24, esquerda: 40 };
    const svg = novoSvg(elemento, largura, altura);

    const x = d3
      .scaleBand()
      .domain(dados.map((linha) => linha.ano))
      .range([margem.esquerda, largura - margem.direita])
      .paddingInner(0.2)
      .paddingOuter(0.1);
    const maximo = d3.max(dados, (linha) => linha.bev + linha.phev) || 1;
    const y = d3.scaleLinear().domain([0, maximo]).nice().range([altura - margem.base, margem.topo]);
    const larguraColuna = Math.min(24, x.bandwidth());
    const deslocamento = (x.bandwidth() - larguraColuna) / 2;
    const vao = 2; // separação entre BEV e PHEV, na cor da superfície

    // Grade e eixo y
    const ticks = y.ticks(4);
    svg
      .append("g")
      .selectAll("line")
      .data(ticks.filter((valor) => valor > 0))
      .join("line")
      .attr("class", CLASSE.grade)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", (valor) => Math.round(y(valor)) + 0.5)
      .attr("y2", (valor) => Math.round(y(valor)) + 0.5);
    svg
      .append("g")
      .selectAll("text")
      .data(ticks)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", margem.esquerda - 8)
      .attr("y", (valor) => y(valor))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((valor) => (maximo >= 10000 ? compacto.format(valor) : numero.format(valor)));

    // Eixo x: pula rótulos quando não cabem
    const passo = Math.ceil(34 / x.bandwidth());
    svg
      .append("g")
      .selectAll("text")
      .data(dados.filter((_, indice) => (dados.length - 1 - indice) % passo === 0))
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", (linha) => x(linha.ano) + x.bandwidth() / 2)
      .attr("y", altura - 6)
      .attr("text-anchor", "middle")
      .text((linha) => (linha.ano.startsWith("Até") ? `≤${linha.ano.slice(-4)}` : linha.ano));

    const colunas = svg
      .append("g")
      .selectAll("g")
      .data(dados)
      .join("g")
      .attr("class", CLASSE.marca);

    colunas.each(function (linha) {
      const grupo = d3.select(this);
      const xColuna = x(linha.ano) + deslocamento;
      const topoBev = y(linha.bev);
      const alturaBev = y(0) - topoBev;
      const alturaPhev = Math.max(0, y(0) - y(linha.phev) - (linha.bev && linha.phev ? vao : 0));
      if (linha.phev && alturaPhev > 0) {
        grupo.append("rect").attr("class", "fill-serie-1").attr("x", xColuna).attr("y", topoBev).attr("width", larguraColuna).attr("height", alturaBev);
        grupo
          .append("path")
          .attr("class", "fill-serie-2")
          .attr("d", colunaArredondada(xColuna, topoBev - vao - alturaPhev, larguraColuna, alturaPhev, 4));
      } else {
        grupo.append("path").attr("class", "fill-serie-1").attr("d", colunaArredondada(xColuna, topoBev, larguraColuna, alturaBev, 4));
      }
    });

    // Rótulo só no pico
    const pico = dados.reduce((maior, linha) => (linha.bev + linha.phev > maior.bev + maior.phev ? linha : maior), dados[0]);
    svg
      .append("text")
      .attr("class", CLASSE.rotulo)
      .attr("x", x(pico.ano) + x.bandwidth() / 2)
      .attr("y", y(pico.bev + pico.phev) - 6)
      .attr("text-anchor", "middle")
      .text(compacto.format(pico.bev + pico.phev));

    svg
      .append("line")
      .attr("class", CLASSE.base)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", Math.round(y(0)) + 0.5)
      .attr("y2", Math.round(y(0)) + 0.5);

    // Alvos de hover maiores que as colunas
    svg
      .append("g")
      .selectAll("rect")
      .data(dados)
      .join("rect")
      .attr("class", CLASSE.alvo)
      .attr("x", (linha) => x(linha.ano) - (x.step() - x.bandwidth()) / 2)
      .attr("y", margem.topo)
      .attr("width", x.step())
      .attr("height", altura - margem.topo - margem.base)
      .on("pointerenter pointermove", (evento, linha) => {
        esmaecer(colunas, linha);
        mostrarDica(evento, `Ano-modelo ${linha.ano.replace("Até", "até")}`, [
          { rotulo: "BEV", valor: numero.format(linha.bev), cor: "serie-1" },
          { rotulo: "PHEV", valor: numero.format(linha.phev), cor: "serie-2" },
          { rotulo: "Total", valor: numero.format(linha.bev + linha.phev) },
        ]);
      })
      .on("pointerleave", () => {
        esmaecer(colunas, null);
        esconderDica();
      });
  }

  /* ---------- Linha: autonomia mediana dos BEV ---------- */

  function graficoAutonomia(elemento, dados) {
    const largura = elemento.clientWidth;
    const altura = elemento.clientHeight;
    const margem = { topo: 20, direita: 40, base: 24, esquerda: 36 };
    const svg = novoSvg(elemento, largura, altura);

    // Ano numérico: anos sem amostra suficiente viram lacuna na linha (não ligamos pontos distantes).
    const porAno = new Map(dados.map((linha) => [Number(linha.ano), linha]));
    const anos = d3.range(Number(dados[0].ano), Number(dados[dados.length - 1].ano) + 1);
    const serie = anos.map((ano) => ({ ano, linha: porAno.get(ano) || null }));

    const x = d3
      .scaleLinear()
      .domain(d3.extent(anos))
      .range([margem.esquerda + 8, largura - margem.direita]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(dados, (linha) => linha.mediana)])
      .nice()
      .range([altura - margem.base, margem.topo]);

    const ticks = y.ticks(4);
    svg
      .append("g")
      .selectAll("line")
      .data(ticks.filter((valor) => valor > 0))
      .join("line")
      .attr("class", CLASSE.grade)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita + 8)
      .attr("y1", (valor) => Math.round(y(valor)) + 0.5)
      .attr("y2", (valor) => Math.round(y(valor)) + 0.5);
    svg
      .append("g")
      .selectAll("text")
      .data(ticks)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", margem.esquerda - 8)
      .attr("y", (valor) => y(valor))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((valor) => numero.format(valor));

    const passo = Math.max(1, Math.ceil(anos.length / Math.max(1, Math.floor((largura - 80) / 40))));
    svg
      .append("g")
      .selectAll("text")
      .data(anos.filter((_, indice) => (anos.length - 1 - indice) % passo === 0))
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", (ano) => x(ano))
      .attr("y", altura - 6)
      .attr("text-anchor", "middle")
      .text((ano) => ano);

    svg
      .append("line")
      .attr("class", CLASSE.base)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita + 8)
      .attr("y1", Math.round(y(0)) + 0.5)
      .attr("y2", Math.round(y(0)) + 0.5);

    const definido = (ponto) => ponto.linha !== null;
    svg
      .append("path")
      .datum(serie)
      .attr("class", CLASSE.area)
      .attr(
        "d",
        d3
          .area()
          .defined(definido)
          .x((ponto) => x(ponto.ano))
          .y0(y(0))
          .y1((ponto) => y(ponto.linha.mediana))
      );
    svg
      .append("path")
      .datum(serie)
      .attr("class", `${CLASSE.linha} stroke-serie-1`)
      .attr(
        "d",
        d3
          .line()
          .defined(definido)
          .x((ponto) => x(ponto.ano))
          .y((ponto) => y(ponto.linha.mediana))
      );

    // Pontos (anéis na cor da superfície) e rótulo no último valor
    svg
      .append("g")
      .selectAll("circle")
      .data(dados)
      .join("circle")
      .attr("class", `${CLASSE.ponto} fill-serie-1`)
      .attr("cx", (linha) => x(Number(linha.ano)))
      .attr("cy", (linha) => y(linha.mediana))
      .attr("r", 4);
    const ultimo = dados[dados.length - 1];
    svg
      .append("text")
      .attr("class", CLASSE.rotulo)
      .attr("x", x(Number(ultimo.ano)) + 8)
      .attr("y", y(ultimo.mediana))
      .attr("dy", "0.32em")
      .text(`${ultimo.mediana} mi`);

    // Mira + dica no ano mais próximo do cursor
    const mira = svg.append("line").attr("class", CLASSE.mira).attr("y1", margem.topo).attr("y2", altura - margem.base).attr("opacity", 0);
    const destaque = svg.append("circle").attr("class", `${CLASSE.ponto} fill-serie-1`).attr("r", 5.5).attr("opacity", 0);
    svg
      .append("rect")
      .attr("class", CLASSE.alvo)
      .attr("x", margem.esquerda)
      .attr("y", margem.topo)
      .attr("width", Math.max(0, largura - margem.esquerda - margem.direita + 8))
      .attr("height", altura - margem.topo - margem.base)
      .on("pointerenter pointermove", (evento) => {
        const [posicao] = d3.pointer(evento);
        const ano = Math.round(x.invert(posicao));
        const linha = dados.reduce((perto, atual) =>
          Math.abs(Number(atual.ano) - ano) < Math.abs(Number(perto.ano) - ano) ? atual : perto
        );
        const cx = x(Number(linha.ano));
        mira.attr("x1", cx).attr("x2", cx).attr("opacity", 1);
        destaque.attr("cx", cx).attr("cy", y(linha.mediana)).attr("opacity", 1);
        mostrarDica(evento, `Ano-modelo ${linha.ano}`, [
          { rotulo: "Mediana", valor: `${linha.mediana} mi (${numero.format(Math.round(linha.mediana * 1.609))} km)`, cor: "serie-1" },
          { rotulo: "Veículos com o dado", valor: numero.format(linha.amostra) },
        ]);
      })
      .on("pointerleave", () => {
        mira.attr("opacity", 0);
        destaque.attr("opacity", 0);
        esconderDica();
      });
  }

  /* ---------- Colunas: % dos BEV com autonomia pesquisada ---------- */

  function graficoCobertura(elemento, dados) {
    const largura = elemento.clientWidth;
    const altura = elemento.clientHeight;
    const margem = { topo: 20, direita: 4, base: 24, esquerda: 40 };
    const svg = novoSvg(elemento, largura, altura);

    const x = d3
      .scaleBand()
      .domain(dados.map((linha) => linha.ano))
      .range([margem.esquerda, largura - margem.direita])
      .paddingInner(0.2)
      .paddingOuter(0.1);
    const y = d3.scaleLinear().domain([0, 100]).range([altura - margem.base, margem.topo]);
    const larguraColuna = Math.min(24, x.bandwidth());
    const deslocamento = (x.bandwidth() - larguraColuna) / 2;

    const ticks = [0, 25, 50, 75, 100];
    svg
      .append("g")
      .selectAll("line")
      .data(ticks.filter((valor) => valor > 0))
      .join("line")
      .attr("class", CLASSE.grade)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", (valor) => Math.round(y(valor)) + 0.5)
      .attr("y2", (valor) => Math.round(y(valor)) + 0.5);
    svg
      .append("g")
      .selectAll("text")
      .data(ticks)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", margem.esquerda - 8)
      .attr("y", (valor) => y(valor))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((valor) => `${valor}%`);

    const passo = Math.ceil(34 / x.bandwidth());
    svg
      .append("g")
      .selectAll("text")
      .data(dados.filter((_, indice) => (dados.length - 1 - indice) % passo === 0))
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", (linha) => x(linha.ano) + x.bandwidth() / 2)
      .attr("y", altura - 6)
      .attr("text-anchor", "middle")
      .text((linha) => (linha.ano.startsWith("Até") ? `≤${linha.ano.slice(-4)}` : linha.ano));

    const colunas = svg
      .append("g")
      .selectAll("path")
      .data(dados)
      .join("path")
      .attr("class", `${CLASSE.marca} fill-serie-1`)
      .attr("d", (linha) => colunaArredondada(x(linha.ano) + deslocamento, y(linha.pct), larguraColuna, y(0) - y(linha.pct), 4));

    // Rótulos só na virada: o último ano com dado e o primeiro sem.
    const virada = dados.findIndex((linha, indice) => indice > 0 && dados[indice - 1].pct >= 50 && linha.pct < 50);
    const rotulados = virada > 0 ? [dados[virada - 1], dados[virada]] : [];
    svg
      .append("g")
      .selectAll("text")
      .data(rotulados)
      .join("text")
      .attr("class", CLASSE.rotulo)
      .attr("x", (linha) => x(linha.ano) + x.bandwidth() / 2)
      .attr("y", (linha) => y(linha.pct) - 6)
      .attr("text-anchor", "middle")
      .text((linha) => porcentagem(Math.round(linha.pct)));

    svg
      .append("line")
      .attr("class", CLASSE.base)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", Math.round(y(0)) + 0.5)
      .attr("y2", Math.round(y(0)) + 0.5);

    svg
      .append("g")
      .selectAll("rect")
      .data(dados)
      .join("rect")
      .attr("class", CLASSE.alvo)
      .attr("x", (linha) => x(linha.ano) - (x.step() - x.bandwidth()) / 2)
      .attr("y", margem.topo)
      .attr("width", x.step())
      .attr("height", altura - margem.topo - margem.base)
      .on("pointerenter pointermove", (evento, linha) => {
        esmaecer(colunas, linha);
        mostrarDica(evento, `Ano-modelo ${linha.ano.replace("Até", "até")}`, [
          { rotulo: "Cobertura", valor: porcentagem(linha.pct), cor: "serie-1" },
          { rotulo: "BEV com autonomia", valor: numero.format(linha.com_dado) },
          { rotulo: "BEV no total", valor: numero.format(linha.bev) },
        ]);
      })
      .on("pointerleave", () => {
        esmaecer(colunas, null);
        esconderDica();
      });
  }

  /* ---------- Barra segmentada: elegibilidade CAFV ---------- */

  function graficoElegibilidade(elemento, dados) {
    const largura = elemento.clientWidth;
    const altura = 28;
    const svg = novoSvg(elemento, largura, altura);
    const total = d3.sum(dados, (parte) => parte.total) || 1;
    const vao = 2;
    const partes = dados.filter((parte) => parte.total > 0);
    const util = largura - vao * (partes.length - 1);

    let x = 0;
    const blocos = partes.map((parte) => {
      const indice = dados.indexOf(parte) + 1;
      const larguraBloco = (parte.total / total) * util;
      const bloco = { ...parte, indice, x, largura: larguraBloco };
      x += larguraBloco + vao;
      return bloco;
    });

    const grupos = svg.selectAll("g").data(blocos).join("g").attr("class", CLASSE.marca);
    grupos
      .append("rect")
      .attr("class", (bloco) => PREENCHIMENTO[`serie-${bloco.indice}`])
      .attr("x", (bloco) => bloco.x)
      .attr("width", (bloco) => Math.max(0, bloco.largura))
      .attr("height", altura)
      .attr("rx", 4);
    grupos.each(function (bloco) {
      const texto = porcentagem(bloco.pct);
      if (bloco.largura < texto.length * 7.5 + 16) return; // não cabe: fica na legenda e na dica
      d3.select(this)
        .append("text")
        .attr("class", CLASSE.rotuloInterno)
        .attr("x", bloco.x + 8)
        .attr("y", altura / 2)
        .attr("dy", "0.35em")
        .text(texto);
    });
    grupos
      .on("pointerenter pointermove", (evento, bloco) => {
        esmaecer(grupos, bloco);
        mostrarDica(evento, bloco.nome, [
          { rotulo: "Veículos", valor: numero.format(bloco.total), cor: `serie-${bloco.indice}` },
          { rotulo: "Fatia", valor: porcentagem(bloco.pct) },
        ]);
      })
      .on("pointerleave", () => {
        esmaecer(grupos, null);
        esconderDica();
      });
  }

  /* ---------- Linhas: vendas mensais de carros novos (BEV e PHEV) ---------- */

  const lerMes = d3.timeParse("%Y-%m");
  const formatarMes = (data) =>
    data.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "").replace(" de ", "/");

  function graficoVendas(elemento, serie, dados) {
    const largura = elemento.clientWidth;
    const altura = elemento.clientHeight;
    const margem = { topo: 24, direita: 52, base: 24, esquerda: 40 };
    const svg = novoSvg(elemento, largura, altura);
    const pontos = serie.map((linha) => ({ ...linha, data: lerMes(linha.mes) }));

    const x = d3
      .scaleTime()
      .domain(d3.extent(pontos, (ponto) => ponto.data))
      .range([margem.esquerda, largura - margem.direita]);
    const maximo = d3.max(pontos, (ponto) => Math.max(ponto.bev, ponto.phev)) || 1;
    const y = d3.scaleLinear().domain([0, maximo]).nice().range([altura - margem.base, margem.topo]);

    const ticks = y.ticks(4);
    svg
      .append("g")
      .selectAll("line")
      .data(ticks.filter((valor) => valor > 0))
      .join("line")
      .attr("class", CLASSE.grade)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", (valor) => Math.round(y(valor)) + 0.5)
      .attr("y2", (valor) => Math.round(y(valor)) + 0.5);
    svg
      .append("g")
      .selectAll("text")
      .data(ticks)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", margem.esquerda - 8)
      .attr("y", (valor) => y(valor))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((valor) => (maximo >= 10000 ? compacto.format(valor) : numero.format(valor)));

    const anos = x.ticks(d3.timeYear.every(largura < 520 ? 3 : 2));
    svg
      .append("g")
      .selectAll("text")
      .data(anos)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", (data) => x(data))
      .attr("y", altura - 6)
      .attr("text-anchor", "middle")
      .text((data) => data.getFullYear());

    svg
      .append("line")
      .attr("class", CLASSE.base)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", Math.round(y(0)) + 0.5)
      .attr("y2", Math.round(y(0)) + 0.5);

    // Marco: fim do crédito federal
    const fim = lerMes(dados.fimCredito);
    if (fim && fim >= x.domain()[0] && fim <= x.domain()[1]) {
      const xFim = Math.round(x(fim)) + 0.5;
      svg.append("line").attr("class", CLASSE.marco).attr("x1", xFim).attr("x2", xFim).attr("y1", margem.topo - 8).attr("y2", y(0));
      svg
        .append("text")
        .attr("class", CLASSE.rotuloSuave)
        .attr("x", xFim - 6)
        .attr("y", margem.topo - 10)
        .attr("text-anchor", "end")
        .text("fim do crédito federal");
    }

    const series = [
      { chave: "bev", nome: "BEV", cor: "serie-1" },
      { chave: "phev", nome: "PHEV", cor: "serie-2" },
    ];
    for (const item of series) {
      svg
        .append("path")
        .datum(pontos)
        .attr("class", `${CLASSE.linha} ${TRACO[item.cor]}`)
        .attr(
          "d",
          d3
            .line()
            .x((ponto) => x(ponto.data))
            .y((ponto) => y(ponto[item.chave]))
        );
    }

    // Rótulo direto no fim de cada linha (só 2 séries), afastando se ficarem perto demais.
    const ultimo = pontos[pontos.length - 1];
    const posicoes = series.map((item) => ({ ...item, y: y(ultimo[item.chave]) }));
    if (Math.abs(posicoes[0].y - posicoes[1].y) < 14) {
      const meio = (posicoes[0].y + posicoes[1].y) / 2;
      const [cima, baixo] = posicoes[0].y <= posicoes[1].y ? [posicoes[0], posicoes[1]] : [posicoes[1], posicoes[0]];
      cima.y = meio - 7;
      baixo.y = meio + 7;
    }
    svg
      .append("g")
      .selectAll("text")
      .data(posicoes)
      .join("text")
      .attr("class", CLASSE.rotulo)
      .attr("x", largura - margem.direita + 6)
      .attr("y", (item) => item.y)
      .attr("dy", "0.32em")
      .text((item) => item.nome);

    // Mira + dica no mês mais próximo do cursor
    const mira = svg.append("line").attr("class", CLASSE.mira).attr("y1", margem.topo).attr("y2", y(0)).attr("opacity", 0);
    const destaques = series.map((item) =>
      svg.append("circle").attr("class", `${CLASSE.ponto} ${PREENCHIMENTO[item.cor]}`).attr("r", 4).attr("opacity", 0)
    );
    const bissetor = d3.bisector((ponto) => ponto.data).center;
    svg
      .append("rect")
      .attr("class", CLASSE.alvo)
      .attr("x", margem.esquerda)
      .attr("y", margem.topo)
      .attr("width", Math.max(0, largura - margem.esquerda - margem.direita))
      .attr("height", altura - margem.topo - margem.base)
      .on("pointerenter pointermove", (evento) => {
        const [posicao] = d3.pointer(evento);
        const ponto = pontos[bissetor(pontos, x.invert(posicao))];
        const cx = x(ponto.data);
        mira.attr("x1", cx).attr("x2", cx).attr("opacity", 1);
        series.forEach((item, indice) => destaques[indice].attr("cx", cx).attr("cy", y(ponto[item.chave])).attr("opacity", 1));
        mostrarDica(evento, formatarMes(ponto.data), [
          { rotulo: "BEV", valor: numero.format(ponto.bev), cor: "serie-1" },
          { rotulo: "PHEV", valor: numero.format(ponto.phev), cor: "serie-2" },
          { rotulo: "Total", valor: numero.format(ponto.bev + ponto.phev) },
        ]);
      })
      .on("pointerleave", () => {
        mira.attr("opacity", 0);
        destaques.forEach((destaque) => destaque.attr("opacity", 0));
        esconderDica();
      });
  }

  /* ---------- Dispersão: renda mediana × veículos por mil habitantes ---------- */

  function graficoAdocao(elemento, adocao, dados) {
    const pontos = (adocao.pontos || []).filter((ponto) => ponto.renda);
    if (!pontos.length) return;
    const largura = elemento.clientWidth;
    const altura = elemento.clientHeight;
    const margem = { topo: 24, direita: 16, base: 36, esquerda: 40 };
    const svg = novoSvg(elemento, largura, altura);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(pontos, (ponto) => ponto.renda / 1000))
      .nice()
      .range([margem.esquerda, largura - margem.direita]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(pontos, (ponto) => ponto.por_mil)])
      .nice()
      .range([altura - margem.base, margem.topo]);

    const ticksY = y.ticks(4);
    svg
      .append("g")
      .selectAll("line")
      .data(ticksY.filter((valor) => valor > 0))
      .join("line")
      .attr("class", CLASSE.grade)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", (valor) => Math.round(y(valor)) + 0.5)
      .attr("y2", (valor) => Math.round(y(valor)) + 0.5);
    svg
      .append("g")
      .selectAll("text")
      .data(ticksY)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", margem.esquerda - 8)
      .attr("y", (valor) => y(valor))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((valor) => numero.format(valor));
    svg
      .append("g")
      .selectAll("text")
      .data(x.ticks(largura < 520 ? 4 : 7))
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", (valor) => x(valor))
      .attr("y", altura - margem.base + 16)
      .attr("text-anchor", "middle")
      .text((valor) => `${numero.format(valor)} mil`);
    svg
      .append("line")
      .attr("class", CLASSE.base)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", Math.round(y(0)) + 0.5)
      .attr("y2", Math.round(y(0)) + 0.5);
    svg
      .append("text")
      .attr("class", CLASSE.rotuloSuave)
      .attr("x", largura - margem.direita)
      .attr("y", altura - 2)
      .attr("text-anchor", "end")
      .text("renda mediana domiciliar (US$)");
    svg
      .append("text")
      .attr("class", CLASSE.rotuloSuave)
      .attr("x", margem.esquerda)
      .attr("y", margem.topo - 12)
      .text("veículos por mil habitantes");

    // Reta de regressão
    if (adocao.inclinacao !== null && adocao.inclinacao !== undefined) {
      const [x0, x1] = x.domain();
      const reta = (valor) => adocao.intercepto + adocao.inclinacao * valor;
      const inicio = Math.max(x0, -adocao.intercepto / adocao.inclinacao); // não desce abaixo de zero
      svg
        .append("line")
        .attr("class", CLASSE.tendencia)
        .attr("x1", x(inicio))
        .attr("y1", y(Math.max(0, reta(inicio))))
        .attr("x2", x(x1))
        .attr("y2", y(reta(x1)));
    }

    const selecionado = dados.condado;
    const marcas = svg
      .append("g")
      .selectAll("circle")
      .data(pontos)
      .join("circle")
      .attr("class", (ponto) =>
        ponto.condado === selecionado
          ? `${CLASSE.ponto} ${CLASSE.marca} fill-zinc-900 dark:fill-zinc-50`
          : `${CLASSE.ponto} ${CLASSE.marca} fill-serie-1`
      )
      .attr("cx", (ponto) => x(ponto.renda / 1000))
      .attr("cy", (ponto) => y(ponto.por_mil))
      .attr("r", (ponto) => (ponto.condado === selecionado ? 7 : 5));

    // Rótulos só nos extremos e no condado filtrado
    const porAdocao = [...pontos].sort((a, b) => b.por_mil - a.por_mil);
    const rotulados = new Set([porAdocao[0], porAdocao[1], porAdocao[porAdocao.length - 1]].map((ponto) => ponto.condado));
    if (selecionado) rotulados.add(selecionado);
    svg
      .append("g")
      .selectAll("text")
      .data(pontos.filter((ponto) => rotulados.has(ponto.condado)))
      .join("text")
      .attr("class", CLASSE.rotulo)
      .attr("x", (ponto) => x(ponto.renda / 1000) + (x(ponto.renda / 1000) > largura - 90 ? -10 : 10))
      .attr("y", (ponto) => y(ponto.por_mil))
      .attr("dy", "0.32em")
      .attr("text-anchor", (ponto) => (x(ponto.renda / 1000) > largura - 90 ? "end" : "start"))
      .text((ponto) => ponto.condado);

    // Hover pelo ponto mais próximo (Delaunay) e clique filtra o painel pelo condado
    const delaunay = d3.Delaunay.from(
      pontos,
      (ponto) => x(ponto.renda / 1000),
      (ponto) => y(ponto.por_mil)
    );
    let atual = null;
    svg
      .append("rect")
      .attr("class", `${CLASSE.alvo} cursor-pointer`)
      .attr("x", margem.esquerda)
      .attr("y", margem.topo)
      .attr("width", Math.max(0, largura - margem.esquerda - margem.direita))
      .attr("height", altura - margem.topo - margem.base)
      .on("pointerenter pointermove", (evento) => {
        const [px, py] = d3.pointer(evento);
        const ponto = pontos[delaunay.find(px, py)];
        const distancia = Math.hypot(px - x(ponto.renda / 1000), py - y(ponto.por_mil));
        atual = distancia < 32 ? ponto : null;
        esmaecer(marcas, atual);
        if (!atual) return esconderDica();
        mostrarDica(evento, `Condado de ${ponto.condado}`, [
          { rotulo: "Por mil habitantes", valor: decimal.format(ponto.por_mil), cor: "serie-1" },
          { rotulo: "Renda mediana", valor: `US$ ${numero.format(ponto.renda)}` },
          { rotulo: "Veículos", valor: numero.format(ponto.veiculos) },
          { rotulo: "População", valor: numero.format(ponto.populacao) },
        ]);
      })
      .on("pointerleave", () => {
        atual = null;
        esmaecer(marcas, null);
        esconderDica();
      })
      .on("click", () => {
        const seletor = document.getElementById("f-condado");
        if (!atual || !seletor) return;
        seletor.value = seletor.value === atual.condado ? "" : atual.condado;
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      });
  }

  /* ---------- Montagem ---------- */

  /* ---------- Q-Q: diferenças mensais contra os quantis da normal (premissa do teste t) ---------- */

  function graficoNormalidade(elemento, normalidade) {
    const pontos = normalidade.pontos || [];
    if (pontos.length < 3) return;
    const largura = elemento.clientWidth;
    const altura = elemento.clientHeight;
    const margem = { topo: 20, direita: 12, base: 32, esquerda: 52 };
    const svg = novoSvg(elemento, largura, altura);
    // Reta de referência: onde os pontos cairiam se os d fossem normais com a média e o desvio observados.
    const reta = (z) => normalidade.media + normalidade.desvio * z;

    const limiteZ = Math.max(...pontos.map((ponto) => Math.abs(ponto.z))) * 1.15;
    const x = d3.scaleLinear().domain([-limiteZ, limiteZ]).range([margem.esquerda, largura - margem.direita]);
    const valoresY = pontos.map((ponto) => ponto.d).concat([reta(-limiteZ), reta(limiteZ)]);
    const y = d3.scaleLinear().domain(d3.extent(valoresY)).nice().range([altura - margem.base, margem.topo]);

    const ticksY = y.ticks(4);
    svg
      .append("g")
      .selectAll("line")
      .data(ticksY)
      .join("line")
      .attr("class", CLASSE.grade)
      .attr("x1", margem.esquerda)
      .attr("x2", largura - margem.direita)
      .attr("y1", (valor) => Math.round(y(valor)) + 0.5)
      .attr("y2", (valor) => Math.round(y(valor)) + 0.5);
    svg
      .append("g")
      .selectAll("text")
      .data(ticksY)
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", margem.esquerda - 8)
      .attr("y", (valor) => y(valor))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((valor) => compacto.format(valor));
    svg
      .append("g")
      .selectAll("text")
      .data(x.ticks(5).filter(Number.isInteger))
      .join("text")
      .attr("class", CLASSE.eixo)
      .attr("x", (valor) => x(valor))
      .attr("y", altura - margem.base + 16)
      .attr("text-anchor", "middle")
      .text((valor) => numero.format(valor));
    svg
      .append("text")
      .attr("class", CLASSE.rotuloSuave)
      .attr("x", largura - margem.direita)
      .attr("y", altura - 2)
      .attr("text-anchor", "end")
      .text("quantil teórico da normal (z)");
    svg
      .append("text")
      .attr("class", CLASSE.rotuloSuave)
      .attr("x", margem.esquerda - 44)
      .attr("y", margem.topo - 10)
      .text("d (vendas a menos ou a mais)");

    svg
      .append("line")
      .attr("class", CLASSE.tendencia)
      .attr("x1", x(-limiteZ))
      .attr("y1", y(reta(-limiteZ)))
      .attr("x2", x(limiteZ))
      .attr("y2", y(reta(limiteZ)));

    const marcas = svg
      .append("g")
      .selectAll("circle")
      .data(pontos)
      .join("circle")
      .attr("class", `${CLASSE.ponto} ${CLASSE.marca} fill-serie-1`)
      .attr("cx", (ponto) => x(ponto.z))
      .attr("cy", (ponto) => y(ponto.d))
      .attr("r", 5);

    const delaunay = d3.Delaunay.from(
      pontos,
      (ponto) => x(ponto.z),
      (ponto) => y(ponto.d)
    );
    svg
      .append("rect")
      .attr("class", CLASSE.alvo)
      .attr("x", margem.esquerda)
      .attr("y", margem.topo)
      .attr("width", Math.max(0, largura - margem.esquerda - margem.direita))
      .attr("height", Math.max(0, altura - margem.topo - margem.base))
      .on("pointerenter pointermove", (evento) => {
        const [px, py] = d3.pointer(evento);
        const ponto = pontos[delaunay.find(px, py)];
        if (Math.hypot(px - x(ponto.z), py - y(ponto.d)) > 32) {
          esmaecer(marcas, null);
          return esconderDica();
        }
        esmaecer(marcas, ponto);
        mostrarDica(evento, ponto.mes, [
          { rotulo: "d observado", valor: numero.format(ponto.d), cor: "serie-1" },
          { rotulo: "Esperado se normal", valor: numero.format(Math.round(reta(ponto.z))) },
          { rotulo: "z", valor: ponto.z.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) },
        ]);
      })
      .on("pointerleave", () => {
        esmaecer(marcas, null);
        esconderDica();
      });
  }

  const GRAFICOS = {
    anos: graficoAnos,
    autonomia: graficoAutonomia,
    cobertura: graficoCobertura,
    vendas: graficoVendas,
    adocao: graficoAdocao,
    elegibilidade: graficoElegibilidade,
    normalidade: graficoNormalidade,
  };

  function desenharPainel() {
    observadores.splice(0).forEach((observador) => observador.disconnect());
    const painel = document.getElementById("painel");
    if (!painel || !painel.dataset.graficos) return;
    const dados = JSON.parse(painel.dataset.graficos);

    document.querySelectorAll("[data-grafico]").forEach((elemento) => {
      const desenhar = GRAFICOS[elemento.dataset.grafico];
      const serie = dados[elemento.dataset.grafico];
      if (!desenhar || !serie || (Array.isArray(serie) && !serie.length)) return;
      let larguraAnterior = 0;
      const observador = new ResizeObserver(() => {
        // Elemento fora da página (painel antigo trocado pelo htmx) ou ainda sem tamanho: não desenha.
        if (!elemento.isConnected || elemento.clientWidth < 40 || elemento.clientHeight < 20) return;
        if (elemento.clientWidth === larguraAnterior) return;
        larguraAnterior = elemento.clientWidth;
        desenhar(elemento, serie, dados);
      });
      observador.observe(elemento);
      observadores.push(observador);
    });
  }

  desenharPainel();
  // Com hx-swap="outerHTML" o alvo antigo continua com id "painel" no detalhe do evento.
  document.body.addEventListener("htmx:afterSettle", (evento) => {
    if (evento.detail.target && evento.detail.target.id === "painel") {
      esconderDica();
      desenharPainel();
    }
  });
})();
