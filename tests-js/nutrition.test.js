import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { kcalPerPerson, scaledIngredients } from "../docs/js/nutrition.js";
import { makePlan } from "../docs/js/planner.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../docs/data/${name}`, import.meta.url), "utf8"));
const recipes = load("recipes.json");
const catalog = load("ingredients.json");
const products = load("sample-prices.json").products;

test("todos os ingredientes têm calorias, e os que se contam à unidade têm o peso da unidade", () => {
  for (const [key, info] of Object.entries(catalog.ingredients)) {
    assert.ok(info.kcal > 0 && info.kcal < 900, `${key}: kcal por 100 g inválido`);
  }
  for (const r of recipes)
    for (const i of r.ingredients)
      if (i.unit === "un") assert.ok(catalog.ingredients[i.ingredient].unit_g > 0, `${r.id}: falta unit_g em ${i.ingredient}`);
});

test("as calorias por pessoa de todas as receitas são plausíveis (sopas leves até pratos de carne)", () => {
  for (const r of recipes) {
    const kcal = kcalPerPerson(r, catalog);
    assert.ok(kcal >= 120 && kcal <= 1000, `${r.id}: ${kcal} kcal por pessoa parece errado`);
  }
});

test("o cálculo bate certo numa receita feita à mão", () => {
  const recipe = {
    servings: 2,
    ingredients: [
      { ingredient: "arroz", qty: 150, unit: "g" }, // 532,5
      { ingredient: "ovos", qty: 4, unit: "un" }, // 4 × 55 g × 1,43 = 314,6
    ],
  };
  // (532,5 + 314,6) / 2 = 423,5 → arredonda a 10
  assert.equal(kcalPerPerson(recipe, catalog), 420);
});

test("sem calorias de um ingrediente não se inventa um total", () => {
  const recipe = { servings: 2, ingredients: [{ ingredient: "arroz", qty: 100, unit: "g" }, { ingredient: "misterio", qty: 50, unit: "g" }] };
  assert.equal(kcalPerPerson(recipe, catalog), null);
});

test("as quantidades escalam com o número de pessoas e marcam o que está em casa", () => {
  const recipe = recipes.find((r) => r.id === "tortilha-batata"); // 4 ovos para 2 pessoas
  const four = scaledIngredients(recipe, 4, catalog, new Set(["cebola"]));
  assert.equal(four.find((i) => i.name === "Ovos").qty, 8);
  assert.equal(four.find((i) => i.name === "Cebola").home, true);
  assert.equal(four.find((i) => i.name === "Batata").home, false);
  const one = scaledIngredients(recipe, 1, catalog, new Set());
  assert.equal(one.find((i) => i.name === "Ovos").qty, 2);
});

test("o plano traz ingredientes e calorias em cada refeição", () => {
  const plan = makePlan(
    { provider: "x", budget: 60, meals: 4, people: 3, require_tags: [], balance: true, have: ["alho"], avoid: [], seed: 1 },
    { recipes, products, ingredients: catalog },
  );
  for (const meal of plan.meals) {
    assert.ok(meal.kcal > 0, `${meal.recipe_id} sem calorias`);
    assert.ok(meal.ingredients.length > 0);
    const original = recipes.find((r) => r.id === meal.recipe_id);
    assert.equal(meal.ingredients.length, original.ingredients.length);
    for (const item of meal.ingredients) if (item.name === "Alho") assert.equal(item.home, true);
  }
});
