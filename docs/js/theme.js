// Temas visuais e o menu para os escolher.
//
// O tema escolhido fica neste dispositivo (localStorage): não vai para o Firestore, por isso cada aparelho
// pode ter o seu. "Automático" segue o tema do telemóvel (escuro → Sóbrio, claro → Fresco).
// As cores de cada tema estão em style.css; a lista de temas está aqui e os dois têm de bater certo
// (há um teste que o verifica).

export const THEMES = [
  { id: "auto", label: "Automático", hint: "Segue o tema do telemóvel", swatch: ["#f5f3ec", "#0f1214", "#1a7f45"] },
  { id: "fresco", label: "Fresco", hint: "Claro, cantos redondos", swatch: ["#f5f3ec", "#1a7f45", "#c0432b"] },
  { id: "sobrio", label: "Sóbrio", hint: "Escuro e discreto", swatch: ["#0f1214", "#62c48a", "#ef9480"] },
  { id: "mercado", label: "Mercado", hint: "Papel e talão", swatch: ["#f1e9d8", "#a23c21", "#2a6485"] },
];

const KEY = "receitas:theme";
const AUTO = "auto";
const SVG = "http://www.w3.org/2000/svg";

/** Tema concreto a usar para uma escolha. "auto" depende de o aparelho estar em modo escuro. */
export function resolve(choice, prefersDark) {
  if (choice === AUTO) return prefersDark ? "sobrio" : "fresco";
  return THEMES.some((t) => t.id === choice) ? choice : "fresco";
}

export function savedChoice() {
  try {
    const value = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === value) ? value : AUTO;
  } catch {
    return AUTO; // o armazenamento pode falhar (modo privado)
  }
}

const darkQuery = () => matchMedia("(prefers-color-scheme: dark)");

/** Aplica a escolha à página e acerta a cor da barra do browser com o fundo do tema. */
export function applyTheme(choice) {
  const theme = resolve(choice, darkQuery().matches);
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  return theme;
}

function icon(name, size) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function initThemeMenu() {
  const button = document.getElementById("theme-btn");
  const popover = document.getElementById("theme-pop");
  let choice = savedChoice();

  const items = THEMES.map((theme) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "theme-item";
    item.setAttribute("role", "menuitemradio");
    item.dataset.id = theme.id;

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    for (const color of theme.swatch) {
      const dot = document.createElement("i");
      dot.style.background = color;
      swatch.append(dot);
    }
    const text = document.createElement("span");
    text.className = "txt";
    const name = document.createElement("b");
    name.textContent = theme.label;
    const hint = document.createElement("small");
    hint.textContent = theme.hint;
    text.append(name, hint);
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.append(icon("check", 18));

    item.append(swatch, text, tick);
    return item;
  });
  popover.replaceChildren(...items);

  const mark = () => items.forEach((item) => item.setAttribute("aria-checked", String(item.dataset.id === choice)));
  const setOpen = (open) => {
    popover.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) items.find((i) => i.dataset.id === choice)?.focus();
  };

  button.addEventListener("click", () => setOpen(popover.hidden));
  popover.addEventListener("click", (e) => {
    const item = e.target.closest("[data-id]");
    if (!item) return;
    choice = item.dataset.id;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* sem armazenamento: o tema vale só até fechar a página */
    }
    applyTheme(choice);
    mark();
    setOpen(false);
    button.focus();
  });
  // Fecha ao clicar fora ou com Escape, e deixa navegar com as setas.
  document.addEventListener("click", (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !button.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (popover.hidden) return;
    if (e.key === "Escape") {
      setOpen(false);
      button.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const index = items.indexOf(document.activeElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    }
  });
  darkQuery().addEventListener("change", () => {
    if (choice === AUTO) applyTheme(AUTO);
  });

  applyTheme(choice);
  mark();
}
