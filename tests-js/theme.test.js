import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { THEMES, resolve } from "../docs/js/theme.js";

const css = readFileSync(new URL("../docs/style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");

test("cada tema da lista existe no CSS (e vice-versa)", () => {
  const concretos = THEMES.map((t) => t.id).filter((id) => id !== "auto");
  for (const id of concretos) assert.match(css, new RegExp(`\\[data-theme="${id}"\\]\\s*\\{`), `falta o tema ${id} em style.css`);
  const noCss = [...css.matchAll(/^\[data-theme="([a-z]+)"\]\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual(noCss.sort(), [...concretos].sort(), "há temas no CSS que não estão no menu");
});

test("os temas têm nome, descrição e três cores de amostra, e o id não se repete", () => {
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  for (const t of THEMES) {
    assert.ok(t.label && t.hint, `tema ${t.id} sem nome ou descrição`);
    assert.equal(t.swatch.length, 3);
    assert.ok(t.swatch.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `cores inválidas em ${t.id}`);
  }
});

test("o automático segue o escuro do aparelho", () => {
  assert.equal(resolve("auto", true), "sobrio");
  assert.equal(resolve("auto", false), "fresco");
});

test("uma escolha concreta ignora o modo escuro e uma desconhecida cai no Fresco", () => {
  for (const dark of [true, false]) {
    assert.equal(resolve("mercado", dark), "mercado");
    assert.equal(resolve("sobrio", dark), "sobrio");
    assert.equal(resolve("coisa-que-nao-existe", dark), "fresco");
  }
});

test("o script do <head> só aceita os temas que existem (para a página não piscar)", () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  for (const t of THEMES.filter((t) => t.id !== "auto")) assert.ok(script.includes(`"${t.id}"`), `o script do head não conhece ${t.id}`);
  assert.ok(script.includes("receitas:theme"), "o script do head tem de ler a mesma chave que o theme.js");
});
