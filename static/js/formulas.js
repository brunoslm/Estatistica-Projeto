/*
 * Desenha as fórmulas em LaTeX com o KaTeX: todo elemento com data-tex tem o código LaTeX como texto.
 *
 * Usa katex.render (no navegador) e não o HTML pronto do servidor: o render aplica os estilos pelo DOM
 * (element.style), que a CSP permite; o HTML do renderToString traria style="" inline, que a CSP bloqueia.
 * Roda no carregamento e em cada conteúdo novo do htmx (painel trocado pelo filtro de condado).
 */
(function () {
  function desenhar(raiz) {
    if (!window.katex || !raiz || !raiz.querySelectorAll) return;
    var alvos = raiz.matches && raiz.matches("[data-tex]") ? [raiz] : raiz.querySelectorAll("[data-tex]");
    Array.prototype.forEach.call(alvos, function (elemento) {
      if (elemento.hasAttribute("data-tex-pronto")) return;
      window.katex.render(elemento.textContent.trim(), elemento, { throwOnError: false, strict: "ignore" });
      elemento.setAttribute("data-tex-pronto", "");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    desenhar(document);
  });
  document.addEventListener("htmx:load", function (evento) {
    desenhar(evento.detail && evento.detail.elt);
  });
})();
