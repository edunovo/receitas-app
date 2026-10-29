// Coerência dos dados das receitas: apanha erros de escrita ao acrescentar receitas novas.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { category } from "../docs/js/planner.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../docs/data/${name}`, import.meta.url), "utf8"));
const recipes = load("recipes.json");
const { ingredients } = load("ingredients.json");

const MEAT_OR_FISH = [
  "peito-frango", "perna-frango", "carne-picada", "costeleta-porco", "salsicha-fresca", "bifes-peru",
  "bacalhau", "atum", "salmao", "pescada",
];
const ANIMAL_PRODUCTS = ["ovos", "natas", "queijo-ralado", "mozzarella"];
const uses = (recipe, keys) => recipe.ingredients.some((i) => keys.includes(i.ingredient));

test("o livro só tem pratos de carne e de peixe", () => {
  for (const r of recipes) assert.ok(r.tags.includes("carne") || r.tags.includes("peixe"), `${r.id} não é de carne nem de peixe`);
  assert.ok(recipes.every((r) => uses(r, MEAT_OR_FISH)), "há uma receita sem carne nem peixe nos ingredientes");
});

test("os ids das receitas não se repetem", () => {
  assert.equal(new Set(recipes.map((r) => r.id)).size, recipes.length);
});

test("todos os ingredientes das receitas existem no catálogo, com quantidade positiva", () => {
  for (const r of recipes)
    for (const i of r.ingredients) {
      assert.ok(ingredients[i.ingredient], `${r.id}: ingrediente desconhecido ${i.ingredient}`);
      assert.ok(i.qty > 0 && i.unit, `${r.id}: quantidade inválida em ${i.ingredient}`);
    }
});

test("cada receita tem título, tempo, pelo menos um ingrediente e passos", () => {
  for (const r of recipes) {
    assert.ok(r.title && r.minutes > 0 && r.servings > 0, `${r.id}: dados em falta`);
    assert.ok(r.ingredients.length > 0 && r.steps.length > 0, `${r.id}: sem ingredientes ou passos`);
  }
});

test("as etiquetas são verdadeiras: vegetariana sem carne nem peixe, vegana sem ovos nem lacticínios", () => {
  for (const r of recipes) {
    if (r.tags.includes("vegetariana")) assert.ok(!uses(r, MEAT_OR_FISH), `${r.id} é vegetariana mas leva carne ou peixe`);
    if (r.tags.includes("vegana")) assert.ok(!uses(r, ANIMAL_PRODUCTS), `${r.id} é vegana mas leva ovos ou lacticínios`);
    if (r.tags.includes("carne") || r.tags.includes("peixe"))
      assert.ok(!r.tags.includes("vegetariana"), `${r.id} tem etiquetas contraditórias`);
  }
});

test("a categoria da receita bate com os ingredientes", () => {
  for (const r of recipes) {
    const fish = uses(r, ["bacalhau", "atum", "salmao", "pescada"]);
    const meat = uses(r, MEAT_OR_FISH.filter((k) => !["bacalhau", "atum", "salmao", "pescada"].includes(k)));
    const expected = fish ? "peixe" : meat ? "carne" : "vegetariana";
    assert.equal(category(r), expected, `${r.id}: etiquetada como ${category(r)} mas os ingredientes dizem ${expected}`);
  }
});
