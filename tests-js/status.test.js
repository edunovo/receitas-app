import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { catalogStatus } from "../docs/js/status.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../docs/data/${name}`, import.meta.url), "utf8"));
const recipes = load("recipes.json");
const ingredients = load("ingredients.json");

const prices = {
  fetched_at: "2026-10-29T10:00:00+00:00",
  products: [{ id: "1", name: "Arroz", price: 1, pack_qty: 1000, unit: "g", ingredient: "arroz" }],
  links: { arroz: 2, ovos: 1 },
  errors: [
    "https://www.continente.pt/produto/ovos-1.html: produto indisponível (redirecionou)",
    "mensagem sem url",
  ],
};

test("classifica os ingredientes pelo que o catálogo tem", () => {
  const status = Object.fromEntries(catalogStatus({ recipes, ingredients, prices }).ingredients.map((r) => [r.ingredient, r.status]));
  assert.equal(status.arroz, "ok");
  assert.equal(status.ovos, "sem-produtos"); // tem link, mas nenhum produto veio bem
  assert.equal(status.massa, "fora-do-catalogo"); // nem sequer tem link
});

test("lista as receitas que ficam impossíveis e o que lhes falta", () => {
  const { recipes_unavailable, recipes_total } = catalogStatus({ recipes, ingredients, prices });
  const missing = Object.fromEntries(recipes_unavailable.map((r) => [r.id, r.missing]));
  assert.ok(missing["omelete-atum"].includes("Ovos"));
  assert.ok(recipes_total >= recipes_unavailable.length && recipes_unavailable.length > 0);
});

test("interpreta os links com erro", () => {
  const { errors, updated_at } = catalogStatus({ recipes, ingredients, prices });
  assert.deepEqual(errors[0], { url: "https://www.continente.pt/produto/ovos-1.html", reason: "produto indisponível (redirecionou)" });
  assert.deepEqual(errors[1], { url: null, reason: "mensagem sem url" });
  assert.equal(updated_at, "2026-10-29T10:00:00+00:00");
});

test("com o catálogo completo de exemplo nenhuma receita fica indisponível", () => {
  const sample = load("sample-prices.json");
  assert.deepEqual(catalogStatus({ recipes, ingredients, prices: sample }).recipes_unavailable, []);
});
