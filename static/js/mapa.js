/*
 * Mapa dos EUA (us-atlas, já projetado em Albers 975x610) com Washington em destaque.
 * Clique em Washington: o mapa aproxima e mostra os condados coloridos pela quantidade de veículos.
 * Clique num condado: filtra o painel. Clique numa cidade: o painel lateral carrega os detalhes (htmx).
 */
(function () {
  "use strict";

  const LARGURA = 975;
  const ALTURA = 610;
  const ID_WASHINGTON = "53"; // código FIPS do estado

  // Faixas do coroplético (6 classes da rampa azul fill-seq-0..5) para cada métrica.
  const METRICAS = {
    total: { titulo: "Veículos por condado", limites: [100, 500, 2000, 10000, 30000], unidade: "veículos" },
    porMil: { titulo: "Veículos por mil habitantes", limites: [10, 20, 30, 40, 50], unidade: "por mil hab." },
  };
  const SEQUENCIAL = ["fill-seq-0", "fill-seq-1", "fill-seq-2", "fill-seq-3", "fill-seq-4", "fill-seq-5"];

  // Classes Tailwind de cada elemento do SVG (o @source do app.css inclui static/js).
  const TRACO_FIXO = "[vector-effect:non-scaling-stroke]";
  const CLASSE = {
    svg: "block h-auto w-full",
    estado: `${TRACO_FIXO} fill-zinc-200 stroke-white stroke-[0.75] [stroke-linejoin:round] transition-[fill,opacity] duration-300 ease-spring hover:fill-zinc-300 group-data-[estado=washington]:opacity-35 dark:fill-zinc-800 dark:stroke-zinc-950 dark:hover:fill-zinc-700`,
    washington: `${TRACO_FIXO} cursor-pointer fill-red-500 stroke-white stroke-[0.75] outline-none transition-[fill] duration-200 hover:fill-red-600 focus-visible:fill-red-600 focus-visible:stroke-zinc-900 focus-visible:stroke-2 dark:stroke-zinc-950 dark:hover:fill-red-400 dark:focus-visible:fill-red-400 dark:focus-visible:stroke-zinc-50`,
    condado: `${TRACO_FIXO} cursor-pointer stroke-white stroke-[0.75] outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:opacity-80 aria-[current=true]:stroke-zinc-900 aria-[current=true]:stroke-[2.5] dark:stroke-zinc-900 dark:aria-[current=true]:stroke-zinc-50`,
    contorno: `${TRACO_FIXO} pointer-events-none fill-none stroke-zinc-900 stroke-[1.25] dark:stroke-zinc-50`,
    marcador: "group/marcador animate-surgir cursor-pointer outline-none origin-center [transform-box:fill-box]",
    pulso: "pointer-events-none origin-center fill-red-500 opacity-0 [transform-box:fill-box] group-aria-[current=true]/marcador:animate-pulsar",
    ponto: `${TRACO_FIXO} fill-zinc-900 stroke-white stroke-2 transition-[fill] duration-150 group-hover/marcador:fill-red-600 group-focus-visible/marcador:fill-red-600 group-aria-[current=true]/marcador:fill-red-600 dark:fill-zinc-50 dark:stroke-zinc-900 dark:group-hover/marcador:fill-red-500 dark:group-focus-visible/marcador:fill-red-500 dark:group-aria-[current=true]/marcador:fill-red-500`,
    rotulo: "pointer-events-none fill-zinc-900 font-semibold stroke-white [paint-order:stroke] [stroke-linejoin:round] dark:fill-zinc-50 dark:stroke-zinc-950",
    legendaTexto: "fill-zinc-500 tabular-nums dark:fill-zinc-400",
  };

  const secao = document.querySelector("[data-mapa]");
  if (!secao || !window.d3 || !window.topojson) return;

  const d3 = window.d3;
  const area = secao.querySelector("[data-mapa-area]");
  const dica = secao.querySelector("[data-mapa-dica]");
  const botaoVoltar = secao.querySelector("[data-voltar]");
  const cidades = lerJson("cidades-mapa", []);
  const metricasCondados = lerJson("metricas-condados", {});
  const linksCidades = document.querySelectorAll("[data-cidade]");
  const botoesMetrica = secao.querySelectorAll("[data-metrica]");
  const numero = new Intl.NumberFormat("pt-BR");
  const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  let metrica = "total";

  const caminho = d3.geoPath(); // os arquivos *-albers-10m.json já vêm projetados
  const projecao = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]); // a mesma do us-atlas

  let camada;
  let grupoCondados;
  let grupoMarcadores;
  let caminhoWashington;
  let washington;
  let cidadeSelecionada = null;

  function lerJson(id, padrao) {
    const elemento = document.getElementById(id);
    return elemento ? JSON.parse(elemento.textContent) : padrao;
  }

  const reduzirMovimento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duracao = (ms) => (reduzirMovimento() ? 0 : ms);
  const estaAproximado = () => secao.dataset.estado === "washington";
  const condadoFiltrado = () => document.getElementById("painel")?.dataset.condado || "";

  /* ---------- Dica que segue o mouse ---------- */

  function mostrarDica(evento, texto) {
    if (evento.pointerType && evento.pointerType !== "mouse") return;
    const [x, y] = d3.pointer(evento, area);
    dica.textContent = texto;
    dica.style.left = `${x}px`;
    dica.style.top = `${y}px`;
    dica.dataset.visivel = "";
  }

  function esconderDica() {
    delete dica.dataset.visivel;
  }

  /* ---------- Desenho ---------- */

  function desenharMapa(atlas) {
    const estados = topojson
      .feature(atlas, atlas.objects.states)
      .features.sort((a, b) => (a.id === ID_WASHINGTON) - (b.id === ID_WASHINGTON)); // Washington por cima
    washington = estados.find((estado) => estado.id === ID_WASHINGTON);
    const condadosWashington = topojson
      .feature(atlas, atlas.objects.counties)
      .features.filter((condado) => condado.id.startsWith(ID_WASHINGTON));

    const svg = d3
      .select(area)
      .insert("svg", ":first-child")
      .attr("class", CLASSE.svg)
      .attr("viewBox", `0 0 ${LARGURA} ${ALTURA}`)
      .attr("role", "group")
      .attr("aria-label", "Mapa dos Estados Unidos com Washington em destaque");

    camada = svg.append("g");

    camada
      .append("g")
      .selectAll("path")
      .data(estados)
      .join("path")
      .attr("class", (estado) => (estado.id === ID_WASHINGTON ? CLASSE.washington : CLASSE.estado))
      .attr("data-washington", (estado) => (estado.id === ID_WASHINGTON ? "" : null))
      .attr("d", caminho)
      .on("pointermove", (evento, estado) => {
        const aviso = estado.id === ID_WASHINGTON && !estaAproximado() ? " · clique para aproximar" : "";
        mostrarDica(evento, estado.properties.name + aviso);
      })
      .on("pointerleave", esconderDica)
      .on("click", (evento, estado) => {
        if (estado.id === ID_WASHINGTON) aproximar();
        else if (estaAproximado()) voltar();
      });

    caminhoWashington = camada
      .select("[data-washington]")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", "Washington: aproximar o mapa")
      .on("keydown", (evento) => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.preventDefault();
          aproximar();
        }
      });

    grupoCondados = camada.append("g").attr("opacity", 0).attr("pointer-events", "none");
    grupoCondados
      .selectAll("path")
      .data(condadosWashington)
      .join("path")
      .attr("d", caminho)
      .attr("role", "button")
      .on("pointermove", (evento, condado) => mostrarDica(evento, `${condado.properties.name} · ${textoCondado(condado)}`))
      .on("pointerleave", esconderDica)
      .on("click", (evento, condado) => filtrarCondado(condado.properties.name))
      .on("keydown", (evento, condado) => {
        if (evento.key === "Enter" || evento.key === " ") {
          evento.preventDefault();
          filtrarCondado(condado.properties.name);
        }
      });

    camada.append("path").datum(washington).attr("class", CLASSE.contorno).attr("data-contorno", "").attr("d", caminho).attr("opacity", 0);
    grupoMarcadores = camada.append("g");

    pintarCondados();
    marcarCondadoFiltrado();

    const carregando = secao.querySelector("[data-mapa-carregando]");
    if (carregando) carregando.remove();
  }

  function valorCondado(nome, chave = metrica) {
    const dados = metricasCondados[nome];
    return dados ? dados[chave] : 0;
  }

  function textoCondado(condado) {
    const nome = condado.properties.name;
    const total = valorCondado(nome, "total");
    const texto = `${numero.format(total)} ${total === 1 ? "veículo" : "veículos"}`;
    return metrica === "porMil" ? `${decimal.format(valorCondado(nome, "porMil"))} por mil hab. (${texto})` : texto;
  }

  // Cor de cada condado pela métrica escolhida (Total ou Por mil habitantes) + legenda.
  function pintarCondados() {
    const escala = d3.scaleThreshold().domain(METRICAS[metrica].limites).range(SEQUENCIAL);
    grupoCondados
      .selectAll("path")
      .attr("class", (condado) => `${CLASSE.condado} ${escala(valorCondado(condado.properties.name))}`)
      .attr("aria-label", (condado) => `${condado.properties.name}: ${textoCondado(condado)}. Filtrar o painel`);
    botoesMetrica.forEach((botao) => botao.setAttribute("aria-checked", String(botao.dataset.metrica === metrica)));
    secao.querySelector("[data-mapa-legenda-titulo]").textContent = METRICAS[metrica].titulo;
    desenharLegenda();
  }

  // Legenda de faixas: 6 blocos com os limites embaixo.
  function desenharLegenda() {
    const svg = d3.select(secao.querySelector("[data-mapa-legenda]"));
    const limites = METRICAS[metrica].limites;
    const largura = 192;
    const bloco = largura / 6;
    svg.attr("viewBox", `0 0 ${largura} 24`);
    svg
      .selectAll("rect")
      .data(d3.range(6))
      .join("rect")
      .attr("class", (indice) => SEQUENCIAL[indice])
      .attr("x", (indice) => indice * bloco + 1)
      .attr("width", bloco - 2)
      .attr("height", 8)
      .attr("rx", 2);
    const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact" });
    svg
      .selectAll("text")
      .data(limites)
      .join("text")
      .attr("class", CLASSE.legendaTexto)
      .attr("x", (_, indice) => (indice + 1) * bloco)
      .attr("y", 21)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .text((valor) => compacto.format(valor));
  }

  function marcarCondadoFiltrado() {
    if (!grupoCondados) return;
    const nome = condadoFiltrado();
    grupoCondados
      .selectAll("path")
      .attr("aria-current", (condado) => (condado.properties.name === nome ? "true" : null))
      .filter((condado) => condado.properties.name === nome)
      .raise();
  }

  // Escala e deslocamento que enquadram Washington no centro do mapa.
  function enquadramentoWashington() {
    const [[x0, y0], [x1, y1]] = caminho.bounds(washington);
    const escala = Math.min(8, 0.86 / Math.max((x1 - x0) / LARGURA, (y1 - y0) / ALTURA));
    const x = LARGURA / 2 - (escala * (x0 + x1)) / 2;
    const y = ALTURA / 2 - (escala * (y0 + y1)) / 2;
    return { escala, transformacao: `translate(${x},${y}) scale(${escala})` };
  }

  function desenharMarcadores(escala) {
    const pontos = cidades
      .map((cidade) => ({ ...cidade, posicao: projecao([cidade.longitude, cidade.latitude]) }))
      .filter((cidade) => cidade.posicao)
      .sort((a, b) => b.total - a.total);

    const raio = d3
      .scaleSqrt()
      .domain([0, d3.max(pontos, (cidade) => cidade.total) || 1])
      .range([0, 8 / escala]);
    const minimo = 3 / escala;
    const tamanhoFonte = 11.5 / escala;

    const marcadores = grupoMarcadores
      .selectAll("a")
      .data(pontos, (cidade) => cidade.slug)
      .join("a")
      .attr("href", (cidade) => cidade.url)
      .attr("class", CLASSE.marcador)
      .attr("aria-label", (cidade) => `${cidade.nome}: ${numero.format(cidade.total)} veículos`)
      .attr("aria-current", (cidade) => (cidade.slug === cidadeSelecionada ? "true" : null))
      .each(function (_, indice) {
        this.style.animationDelay = `${duracao(indice * 45)}ms`;
      })
      .on("pointermove", (evento, cidade) =>
        mostrarDica(evento, `${cidade.nome} · ${numero.format(cidade.total)} veículos`)
      )
      .on("pointerleave", esconderDica)
      .on("click", (evento, cidade) => {
        evento.preventDefault();
        selecionarCidade(cidade.slug, true);
      });

    marcadores.each(function (cidade) {
      const r = Math.max(minimo, raio(cidade.total));
      const grupo = d3.select(this);
      grupo.append("circle").attr("class", CLASSE.pulso).attr("cx", cidade.posicao[0]).attr("cy", cidade.posicao[1]).attr("r", r);
      grupo.append("circle").attr("class", CLASSE.ponto).attr("cx", cidade.posicao[0]).attr("cy", cidade.posicao[1]).attr("r", r);
      cidade.r = r;
    });

    posicionarRotulos(marcadores, pontos, tamanhoFonte, escala);
  }

  // Rótulos sem sobreposição: das maiores para as menores, tenta à direita e depois à esquerda;
  // se não couber em nenhum lado, a cidade fica só com o ponto (o nome aparece na dica).
  function posicionarRotulos(marcadores, pontos, tamanhoFonte, escala) {
    const ocupados = pontos.map((cidade) => caixa(cidade.posicao[0] - cidade.r, cidade.posicao[1] - cidade.r, cidade.r * 2, cidade.r * 2));
    const larguraLetra = tamanhoFonte * 0.58;
    const folga = 3 / escala;

    marcadores.each(function (cidade) {
      const largura = cidade.nome.length * larguraLetra;
      const altura = tamanhoFonte;
      const [x, y] = cidade.posicao;
      const opcoes = [
        { ancora: "start", x: x + cidade.r + folga, caixa: caixa(x + cidade.r + folga, y - altura / 2, largura, altura) },
        { ancora: "end", x: x - cidade.r - folga, caixa: caixa(x - cidade.r - folga - largura, y - altura / 2, largura, altura) },
      ];
      const livre = opcoes.find((opcao) => !ocupados.some((outra) => colide(opcao.caixa, outra)));
      if (!livre) return;
      ocupados.push(livre.caixa);
      d3.select(this)
        .append("text")
        .attr("class", CLASSE.rotulo)
        .attr("x", livre.x)
        .attr("y", y)
        .attr("dy", "0.35em")
        .attr("text-anchor", livre.ancora)
        .attr("font-size", tamanhoFonte)
        .attr("stroke-width", 3 / escala)
        .text(cidade.nome);
    });
  }

  const caixa = (x, y, largura, altura) => ({ x, y, largura, altura });
  const colide = (a, b) => a.x < b.x + b.largura && b.x < a.x + a.largura && a.y < b.y + b.altura && b.y < a.y + a.altura;

  /* ---------- Navegação ---------- */

  function aproximar() {
    if (!washington || estaAproximado()) return Promise.resolve();
    secao.dataset.estado = "washington";
    caminhoWashington.attr("tabindex", -1).attr("aria-label", "Washington");
    esconderDica();

    const { escala, transformacao } = enquadramentoWashington();
    return camada
      .transition()
      .duration(duracao(900))
      .ease(d3.easeCubicInOut)
      .attr("transform", transformacao)
      .end()
      .catch(() => {})
      .then(() => {
        if (!estaAproximado()) return;
        grupoCondados.attr("pointer-events", null).transition().duration(duracao(300)).attr("opacity", 1);
        grupoCondados.selectAll("path").attr("tabindex", 0);
        camada.select("[data-contorno]").transition().duration(duracao(300)).attr("opacity", 1);
        desenharMarcadores(escala);
      });
  }

  function voltar() {
    if (!estaAproximado()) return;
    const focoNoMapa = secao.contains(document.activeElement);
    secao.dataset.estado = "eua";
    esconderDica();
    grupoMarcadores.selectAll("*").remove();
    grupoCondados.interrupt().attr("pointer-events", "none").attr("opacity", 0);
    grupoCondados.selectAll("path").attr("tabindex", null);
    camada.select("[data-contorno]").interrupt().attr("opacity", 0);
    caminhoWashington.attr("tabindex", 0).attr("aria-label", "Washington: aproximar o mapa");
    camada.transition().duration(duracao(750)).ease(d3.easeCubicInOut).attr("transform", "translate(0,0) scale(1)");
    if (focoNoMapa) caminhoWashington.node().focus({ preventScroll: true });
  }

  // Usa o próprio formulário do painel (hx-get + hx-push-url): o endereço fica compartilhável.
  // Não rola até o painel: o resumo do condado aparece logo abaixo do mapa (com link para o painel completo).
  function filtrarCondado(nome) {
    const seletor = document.getElementById("f-condado");
    if (!seletor) return;
    seletor.value = seletor.value === nome ? "" : nome; // clicar de novo no mesmo condado limpa o filtro
    seletor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Marca a cidade no mapa e na lista; com carregarPainel, busca os detalhes pelo htmx.
  function selecionarCidade(slug, carregarPainel) {
    cidadeSelecionada = slug;
    grupoMarcadores.selectAll("a").attr("aria-current", (cidade) => (cidade.slug === slug ? "true" : null));
    linksCidades.forEach((link) => {
      if (link.dataset.cidade === slug) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    const cidade = cidades.find((item) => item.slug === slug);
    if (carregarPainel && cidade && window.htmx) {
      window.htmx.ajax("GET", cidade.url, { target: "#painel-cidade", indicator: "#painel-cidade" });
    }
  }

  /* ---------- Eventos ---------- */

  botaoVoltar.addEventListener("click", voltar);

  botoesMetrica.forEach((botao) =>
    botao.addEventListener("click", () => {
      metrica = botao.dataset.metrica;
      if (grupoCondados) pintarCondados();
    })
  );

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && estaAproximado()) voltar();
  });

  linksCidades.forEach((link) => {
    link.addEventListener("click", () => {
      selecionarCidade(link.dataset.cidade, false);
      aproximar();
    });
  });

  // Painel trocado pelo htmx (filtro mudou): atualiza o contorno do condado escolhido.
  document.body.addEventListener("htmx:afterSettle", (evento) => {
    if (evento.detail.target && evento.detail.target.id === "painel") marcarCondadoFiltrado();
  });

  fetch(secao.dataset.atlas)
    .then((resposta) => {
      if (!resposta.ok) throw new Error(resposta.statusText);
      return resposta.json();
    })
    .then((atlas) => {
      desenharMapa(atlas);
      if (condadoFiltrado()) aproximar(); // chegou com ?condado=: já mostra o estado
    })
    .catch(() => {
      const carregando = secao.querySelector("[data-mapa-carregando]");
      if (carregando) carregando.textContent = "Não foi possível carregar o mapa.";
    });
})();
