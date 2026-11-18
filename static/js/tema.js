/* Define o tema antes da primeira pintura. Três estados: claro, escuro e sistema (padrão). */
(function () {
  var CHAVE = "tema";
  var raiz = document.documentElement;
  var midia = window.matchMedia("(prefers-color-scheme: dark)");

  function obter() {
    try {
      return localStorage.getItem(CHAVE) || "sistema";
    } catch (e) {
      return "sistema";
    }
  }

  function aplicar(tema) {
    var escuro = tema === "escuro" || (tema === "sistema" && midia.matches);
    raiz.classList.toggle("dark", escuro);
    raiz.style.colorScheme = escuro ? "dark" : "light";
  }

  function definir(tema) {
    try {
      if (tema === "sistema") localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, tema);
    } catch (e) {}
    raiz.classList.add("sem-transicao");
    aplicar(tema);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        raiz.classList.remove("sem-transicao");
      });
    });
    window.dispatchEvent(new CustomEvent("tema-alterado", { detail: tema }));
  }

  function escuroAtivo() {
    return raiz.classList.contains("dark");
  }

  function alternar() {
    var querEscuro = !escuroAtivo();
    definir(querEscuro === midia.matches ? "sistema" : querEscuro ? "escuro" : "claro");
  }

  midia.addEventListener("change", function () {
    if (obter() !== "sistema") return;
    aplicar("sistema");
    window.dispatchEvent(new CustomEvent("tema-alterado", { detail: "sistema" }));
  });

  window.tema = { obter: obter, definir: definir, alternar: alternar, escuroAtivo: escuroAtivo };
  aplicar(obter());
})();
