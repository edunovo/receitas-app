// Estado do catálogo: que ingredientes têm produtos e que receitas ficam impossíveis por falta deles.
// Calculado no browser a partir das receitas e do documento de preços.

import { Catalog, label } from "./planner.js";

export function catalogStatus({ recipes, ingredients, prices }) {
  const catalog = new Catalog(prices.products);
  const found = {};
  for (const product of prices.products) found[product.ingredient] = (found[product.ingredient] ?? 0) + 1;

  const used = [...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredient)))];
  const rows = used
    .sort((a, b) => label(a, ingredients).localeCompare(label(b, ingredients), "pt"))
    .map((key) => {
      const links = prices.links?.[key] ?? 0;
      const count = found[key] ?? 0;
      return {
        ingredient: key,
        label: label(key, ingredients),
        links,
        products: count,
        status: count ? "ok" : links ? "sem-produtos" : "fora-do-catalogo",
      };
    });

  const unavailable = recipes
    .map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      missing: [
        ...new Set(
          recipe.ingredients
            .filter((i) => !catalog.bestBuy(i.ingredient, i.unit, i.qty))
            .map((i) => label(i.ingredient, ingredients)),
        ),
      ].sort(),
    }))
    .filter((recipe) => recipe.missing.length);

  const errors = (prices.errors ?? []).map((line) => {
    const match = line.match(/^(https?:\/\/\S+?\.html): (.*)$/);
    return match ? { url: match[1], reason: match[2] } : { url: null, reason: line };
  });

  return {
    updated_at: prices.fetched_at,
    ingredients: rows,
    recipes_total: recipes.length,
    recipes_unavailable: unavailable,
    errors,
  };
}
