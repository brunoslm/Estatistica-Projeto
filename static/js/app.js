/*
 * Componentes Alpine registrados para o build CSP (@alpinejs/csp).
 * Os templates só referenciam propriedades e métodos daqui; nenhuma expressão inline.
 */
document.addEventListener("alpine:init", () => {
  const Alpine = window.Alpine;

  // Navbar que ganha uma sombra suave depois de rolar a página.
  Alpine.data("navbar", () => ({
    rolou: window.scrollY > 4,
    rolar() {
      this.rolou = window.scrollY > 4;
    },
    get classeNav() {
      return this.rolou ? "shadow-[0_8px_30px_-12px_rgb(0_0_0/0.12)]" : "";
    },
  }));

  // Seletor Claro / Escuro. Radios nativos: as setas do teclado trocam a opção.
  // Sem escolha salva o site segue o aparelho; escolher o mesmo tema do aparelho apaga a escolha (tema.alternar).
  Alpine.data("seletorTema", () => ({
    escuro: window.tema ? window.tema.escuroAtivo() : false,
    init() {
      window.addEventListener("tema-alterado", () => (this.escuro = window.tema.escuroAtivo()));
    },
    get ehClaro() {
      return !this.escuro;
    },
    get ehEscuro() {
      return this.escuro;
    },
    escolher(evento) {
      const querEscuro = evento.target.value === "escuro";
      if (querEscuro !== window.tema.escuroAtivo()) window.tema.alternar();
    },
  }));
  // Carrossel de cartões com bolinhas. O trilho rola com scroll-snap (arrastar no celular funciona sozinho);
  // bolinhas e setas só mandam rolar. Os cartões fora de vista ficam inert (fora do Tab e do leitor de tela).
  Alpine.data("carrossel", () => {
    let trilho, cartoes, pontos, legenda, botaoAnterior, botaoProximo, quadro;
    const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)");
    return {
      atual: 0,
      init() {
        trilho = this.$refs.trilho;
        cartoes = Array.from(trilho.children);
        pontos = Array.from(this.$el.querySelectorAll("[data-ponto]"));
        legenda = this.$el.querySelector("[data-carrossel-legenda]");
        botaoAnterior = this.$el.querySelector("[data-anterior]");
        botaoProximo = this.$el.querySelector("[data-proximo]");
        trilho.addEventListener(
          "scroll",
          () => {
            cancelAnimationFrame(quadro);
            quadro = requestAnimationFrame(() => this.sincronizar());
          },
          { passive: true },
        );
        this.marcar();
      },
      sincronizar() {
        const indice = Math.round(trilho.scrollLeft / Math.max(trilho.clientWidth, 1));
        if (indice !== this.atual) {
          this.atual = indice;
          this.marcar();
        }
      },
      marcar() {
        pontos.forEach((ponto, indice) => ponto.setAttribute("aria-current", String(indice === this.atual)));
        cartoes.forEach((cartao, indice) => (cartao.inert = indice !== this.atual));
        if (legenda) legenda.textContent = `${this.atual + 1}/${cartoes.length} · ${pontos[this.atual].dataset.rotulo}`;
        if (botaoAnterior) botaoAnterior.disabled = this.atual === 0;
        if (botaoProximo) botaoProximo.disabled = this.atual === cartoes.length - 1;
      },
      mostrar(indice) {
        this.atual = Math.min(Math.max(indice, 0), cartoes.length - 1);
        trilho.scrollTo({ left: this.atual * trilho.clientWidth, behavior: reduzirMovimento.matches ? "auto" : "smooth" });
        this.marcar();
      },
      irPara(evento) {
        this.mostrar(Number(evento.currentTarget.dataset.ponto));
      },
      anterior() {
        this.mostrar(this.atual - 1);
      },
      proximo() {
        this.mostrar(this.atual + 1);
      },
    };
  });
});
