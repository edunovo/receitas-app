import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Catalog, PlanError, category, makePlan, planWeek, recipeAllergens } from "../docs/js/planner.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../docs/data/${name}`, import.meta.url), "utf8"));
const recipes = load("recipes.json");
const ingredients = load("ingredients.json");
const prices = load("sample-prices.json");
const products = prices.products;
const data = { recipes, products, ingredients };

const recipe = (id) => recipes.find((r) => r.id === id);
const base = { provider: "x", budget: 100, meals: 5, people: 2 };
const ids = (plan) => plan.meals.map((m) => m.recipe_id);
const unknownIngredients = (items) => items.filter((i) => !(i in ingredients.ingredients));

// --- dados -------------------------------------------------------------------------------------

test("todas as receitas têm passos, nomes e produtos no catálogo de exemplo", () => {
  const catalog = new Catalog(products);
  for (const r of recipes) {
    assert.ok(r.steps.length >= 3, `${r.id} tem poucos passos`);
    for (const i of r.ingredients) {
      assert.ok(i.ingredient in ingredients.ingredients, `${r.id}: sem nome para ${i.ingredient}`);
      assert.ok(catalog.bestBuy(i.ingredient, i.unit, i.qty), `${r.id}: sem produto para ${i.ingredient}`);
    }
  }
  assert.deepEqual(unknownIngredients(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredient))), []);
});

// --- custo ---------------------------------------------------------------------------------------

test("arredonda para embalagens inteiras", () => {
  const catalog = new Catalog([{ id: "a", name: "Arroz 1kg", price: 1.0, pack_qty: 1000, unit: "g", ingredient: "arroz" }]);
  const buy = catalog.bestBuy("arroz", "g", 1200);
  assert.equal(buy.packs, 2);
  assert.equal(buy.cost, 2.0);
});

test("escolhe o produto mais barato", () => {
  assert.equal(new Catalog(products).bestBuy("arroz", "g", 300).product.id, "arroz-agulha");
});

test("unidade diferente não conta como produto", () => {
  assert.equal(new Catalog(products).bestBuy("arroz", "ml", 300), null);
});

// --- orçamento e lista ---------------------------------------------------------------------------

test("o plano nunca ultrapassa o orçamento", () => {
  for (const budget of [5, 12, 25, 40, 80]) {
    const plan = planWeek({ recipes, products, ...base, budget, meals: 7 });
    assert.ok(plan.total_cost <= budget, `${plan.total_cost} > ${budget}`);
    assert.ok(plan.remaining >= 0);
  }
});

test("o plano diz para quantas pessoas é (a interface mostra-o)", () => {
  assert.equal(planWeek({ recipes, products, ...base, people: 3 }).people, 3);
});

test("o custo da lista de compras bate certo com o total", () => {
  const plan = planWeek({ recipes, products, ...base, budget: 40 });
  const sum = plan.shopping_list.reduce((acc, item) => acc + item.cost, 0);
  assert.ok(Math.abs(sum - plan.total_cost) < 0.011);
});

test("ingredientes partilhados saem mais baratos em conjunto", () => {
  const plan = planWeek({ recipes, products, ...base, meals: 2, locked: ["arroz-frango", "arroz-carne-picada"] }); // partilham arroz e cebola
  const catalog = new Catalog(products);
  const alone = ids(plan).reduce((acc, id) => {
    const needs = new Map(recipe(id).ingredients.map((i) => [`${i.ingredient}|${i.unit}`, i.qty]));
    return acc + catalog.basketCost(needs);
  }, 0);
  assert.ok(plan.total_cost < alone);
});

test("filtro por etiqueta", () => {
  const plan = planWeek({ recipes, products, ...base, meals: 4, requireTags: ["peixe"] });
  assert.ok(plan.meals.length > 0);
  assert.ok(plan.meals.every((m) => m.tags.includes("peixe")));
});

test("receita com ingrediente que o supermercado não tem é ignorada com aviso", () => {
  const impossible = { id: "r", title: "Impossível", servings: 2, minutes: 10, tags: [], steps: [], ingredients: [{ ingredient: "trufa", qty: 10, unit: "g" }] };
  const plan = planWeek({ recipes: [impossible], products, ...base, meals: 1 });
  assert.deepEqual(plan.meals, []);
  assert.ok(plan.warnings.some((w) => w.includes("Impossível")));
});

// --- variar proteínas ----------------------------------------------------------------------------

test("variar mistura carne e peixe", () => {
  const plan = planWeek({ recipes, products, ...base, meals: 6, balance: true });
  const kinds = new Set(ids(plan).map((id) => category(recipe(id))));
  assert.deepEqual([...kinds].sort(), ["carne", "peixe"]);
});

test("com pouco dinheiro, variar respeita o orçamento e cai para o que cabe", () => {
  const plan = planWeek({ recipes, products, ...base, budget: 8, meals: 4, balance: true });
  assert.ok(plan.total_cost <= 8);
  assert.ok(plan.meals.length > 0);
});

test("com ou sem variar, o plano respeita o orçamento e o número de refeições", () => {
  for (const balance of [true, false]) {
    for (const meals of [3, 6, 9]) {
      const plan = planWeek({ recipes, products, ...base, budget: 60, meals, balance });
      assert.equal(plan.meals.length, meals);
      assert.ok(plan.total_cost <= 60);
    }
  }
});

// --- já tenho em casa ----------------------------------------------------------------------------

test("o que está em casa sai do custo e da lista", () => {
  const r = recipe("arroz-frango");
  const kwargs = { ...base, meals: 1 };
  const without = planWeek({ recipes: [r], products, ...kwargs });
  const withHave = planWeek({ recipes: [r], products, ...kwargs, have: new Set(["arroz", "cebola"]) });
  assert.ok(withHave.total_cost < without.total_cost);
  assert.ok(withHave.shopping_list.every((i) => !["arroz", "cebola"].includes(i.ingredient)));
  assert.deepEqual(withHave.at_home, ["arroz", "cebola"]);
});

test("em casa, uma receita passa a ser possível mesmo sem o produto no supermercado", () => {
  const noEggs = products.filter((p) => p.ingredient !== "ovos");
  const r = recipe("omelete-atum");
  assert.deepEqual(planWeek({ recipes: [r], products: noEggs, ...base, meals: 1 }).meals, []);
  const plan = planWeek({ recipes: [r], products: noEggs, ...base, meals: 1, have: new Set(["ovos"]) });
  assert.deepEqual(ids(plan), ["omelete-atum"]);
});

test("tudo em casa não custa nada", () => {
  const r = recipe("arroz-atum");
  const have = new Set(r.ingredients.map((i) => i.ingredient));
  const plan = planWeek({ recipes: [r], products, ...base, budget: 10, meals: 1, have });
  assert.equal(plan.total_cost, 0);
  assert.deepEqual(plan.shopping_list, []);
});

test("makePlan devolve os ingredientes em casa com nomes legíveis e ignora chaves desconhecidas", () => {
  const plan = makePlan({ ...base, budget: 60, have: ["arroz", "cebola", "inventado"] }, data);
  assert.ok(!plan.at_home.includes("inventado"));
  assert.ok(plan.at_home.every((name) => ["Arroz", "Cebola"].includes(name)));
});

// --- fixar, excluir e trocar ----------------------------------------------------------------------

test("receitas fixadas mantêm-se", () => {
  const plan = planWeek({ recipes, products, ...base, meals: 4, locked: ["arroz-frango", "arroz-atum"] });
  assert.deepEqual(ids(plan).slice(0, 2), ["arroz-frango", "arroz-atum"]);
  assert.equal(plan.meals.length, 4);
});

test("receita fixada que já não cabe no orçamento é largada com aviso", () => {
  const plan = planWeek({ recipes, products, ...base, budget: 3, meals: 2, locked: ["salmao-forno"] });
  assert.ok(!ids(plan).includes("salmao-forno"));
  assert.ok(plan.warnings.some((w) => w.includes("fixada")));
});

test("receitas excluídas nunca são escolhidas", () => {
  const banned = new Set(["arroz-atum", "arroz-frango", "massa-atum"]);
  const plan = planWeek({ recipes, products, ...base, meals: 8, exclude: banned });
  assert.ok(ids(plan).every((id) => !banned.has(id)));
});

test("trocar substitui só a refeição escolhida", () => {
  const plan = makePlan({ ...base, budget: 60, meals: 5 }, data);
  const [target, ...others] = ids(plan);
  const swapped = makePlan({ ...base, budget: 60, meals: 5, locked: others, exclude: [target], strict: true, seed: 11 }, data);
  assert.ok(!ids(swapped).includes(target));
  assert.ok(others.every((id) => ids(swapped).includes(id)));
  assert.equal(swapped.meals.length, 5);
});

test("trocar sem alternativa possível falha em vez de devolver menos refeições", () => {
  const plan = makePlan({ ...base, budget: 30, meals: 3 }, data);
  const kept = ids(plan).slice(1);
  const everythingElse = recipes.map((r) => r.id).filter((id) => !kept.includes(id));
  assert.throws(
    () => makePlan({ ...base, budget: plan.total_cost, meals: 3, locked: kept, exclude: everythingElse, strict: true }, data),
    PlanError,
  );
});

// --- alergénios -----------------------------------------------------------------------------------

test("evitar alergénios filtra as receitas", () => {
  const avoid = ["lactose", "gluten", "peixe", "ovo"];
  const plan = makePlan({ ...base, budget: 60, meals: 8, avoid }, data);
  assert.ok(plan.meals.length > 0);
  for (const id of ids(plan)) {
    assert.ok(![...recipeAllergens(recipe(id), ingredients)].some((a) => avoid.includes(a)), id);
  }
});

test("mapa de alergénios", () => {
  assert.deepEqual([...recipeAllergens(recipe("bacalhau-natas"), ingredients)].sort(), ["lactose", "peixe"]);
});

// --- semente e validação -------------------------------------------------------------------------

test("a mesma semente dá o mesmo plano", () => {
  const a = makePlan({ ...base, budget: 60, meals: 6, seed: 42 }, data);
  const b = makePlan({ ...base, budget: 60, meals: 6, seed: 42 }, data);
  assert.deepEqual(a, b);
});

test("pedidos inválidos são recusados", () => {
  for (const bad of [{ budget: 0 }, { budget: -5 }, { budget: 20000 }, { meals: 0 }, { meals: 22 }, { people: 0 }, { people: 13 }, { budget: Number.NaN }]) {
    assert.throws(() => makePlan({ ...base, ...bad }, data), PlanError);
  }
});

// --- variedade, favoritas e "nunca mais sugerir" ----------------------------------------------------

const seeds = Array.from({ length: 30 }, (_, i) => i);
const planFor = (seed, extra = {}) => makePlan({ ...base, budget: 60, meals: 7, seed, ...extra }, data);

test("com variedade saem mais receitas diferentes, sem passar o orçamento nem perder refeições", () => {
  const distinct = (variety) => new Set(seeds.flatMap((seed) => ids(planFor(seed, { variety })))).size;
  assert.ok(distinct(true) >= distinct(false) * 1.5, "a variedade quase não mudou o leque de receitas");
  for (const seed of seeds) {
    const cheap = planFor(seed);
    const varied = planFor(seed, { variety: true });
    assert.ok(varied.total_cost <= 60);
    assert.ok(varied.meals.length >= cheap.meals.length);
  }
});

test("com variedade, a mesma semente dá o mesmo plano", () => {
  assert.deepEqual(planFor(5, { variety: true }), planFor(5, { variety: true }));
});

test("as receitas marcadas como 'nunca mais sugerir' não saem, nem a trocar nem com variedade", () => {
  const dislikes = ["arroz-atum", "arroz-frango", "massa-atum", "salmao-forno", "pescada-forno", "inventada"];
  for (const variety of [false, true]) {
    for (const seed of seeds) {
      const plan = planFor(seed, { dislikes, variety, meals: 10 });
      assert.ok(ids(plan).every((id) => !dislikes.includes(id)), `saiu uma receita rejeitada (semente ${seed})`);
    }
  }
});

test("as favoritas saem mais vezes", () => {
  const favorites = ["bife-vaca-arroz-brocolos", "arroz-camarao"];
  const count = (extra) => seeds.filter((seed) => ids(planFor(seed, { variety: true, ...extra })).some((id) => favorites.includes(id))).length;
  assert.ok(count({ favorites }) > count({}), `${count({ favorites })} planos com favoritas contra ${count({})} sem`);
});
