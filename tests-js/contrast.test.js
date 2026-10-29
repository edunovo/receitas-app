// Contraste das paletas dos temas (WCAG 2.x). Lê as cores diretamente de docs/style.css, por isso
// qualquer tema novo ou cor alterada é verificada automaticamente.
//
// Texto normal: mínimo 4,5:1. Elementos de interface (contornos de caixas, ícones): mínimo 3:1.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../docs/style.css", import.meta.url), "utf8");

function tokens(theme) {
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  assert.ok(block, `não encontrei o tema ${theme} em style.css`);
  const map = {};
  for (const [, name, value] of block[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) map[name] = value;
  return map;
}

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [primeiro plano, fundo, mínimo, descrição]
const PAIRS = [
  ["text", "bg", 4.5, "texto sobre o fundo"],
  ["text", "surface", 4.5, "texto sobre cartões"],
  ["muted", "bg", 4.5, "texto secundário sobre o fundo"],
  ["muted", "surface", 4.5, "texto secundário sobre cartões"],
  ["accent-ink", "accent", 4.5, "texto dos botões principais"],
  ["accent-text", "surface", 4.5, "texto de destaque (links, ícones ativos) sobre cartões"],
  ["accent-text", "accent-soft", 4.5, "texto de destaque sobre o realce"],
  ["text", "accent-soft", 4.5, "texto sobre o realce"],
  ["carne", "surface", 4.5, "etiqueta Carne"],
  ["peixe", "surface", 4.5, "etiqueta Peixe"],
  ["veg", "surface", 4.5, "etiqueta Vegetariana"],
  ["warn", "warn-bg", 4.5, "avisos"],
  ["err", "bg", 4.5, "mensagens de erro"],
  ["muted", "surface", 3, "contorno das caixas da lista (interface)"],
];

for (const theme of ["fresco", "sobrio", "mercado"]) {
  test(`contraste do tema ${theme}`, () => {
    const t = tokens(theme);
    const falhas = [];
    for (const [fg, bg, min, what] of PAIRS) {
      assert.ok(t[fg] && t[bg], `faltam as cores ${fg}/${bg} no tema ${theme}`);
      const r = ratio(t[fg], t[bg]);
      if (r < min) falhas.push(`${what}: ${t[fg]} sobre ${t[bg]} = ${r.toFixed(2)}:1 (mínimo ${min}:1)`);
    }
    assert.deepEqual(falhas, [], `\n${theme}:\n  ${falhas.join("\n  ")}`);
  });
}
