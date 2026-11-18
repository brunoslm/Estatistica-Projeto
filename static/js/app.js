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
});
