// Estimativa de calorias e lista de ingredientes de uma refeição.
//
// Cada ingrediente de ingredients.json tem `kcal` por 100 g (ou 100 ml) tal como é usado nas receitas:
// o arroz e a massa em cru, o grão e o feijão já cozidos, a perna de frango e as costeletas com osso.
// Os ovos (unidade "un") têm também `unit_g`, o peso de um ovo. É uma estimativa para dar uma ideia,
// não um valor nutricional: não conta o azeite, o sal nem a pimenta, que as receitas assumem que há em casa.

const roundTo = (x, step) => Math.round(x / step) * step;

function grams(item, info) {
  if (item.unit === "un") return info?.unit_g ? item.qty * info.unit_g : null;
  return item.qty; // g ou ml: o `kcal` do ingrediente já é por 100 g/ml
}

/** Calorias por pessoa de uma receita (arredondadas a 10), ou null se faltar o valor de algum ingrediente. */
export function kcalPerPerson(recipe, catalog) {
  let total = 0;
  for (const item of recipe.ingredients) {
    const info = catalog.ingredients[item.ingredient];
    const g = grams(item, info);
    if (g === null || !Number.isFinite(info?.kcal)) return null;
    total += (g * info.kcal) / 100;
  }
  return roundTo(total / recipe.servings, 10);
}

/** Ingredientes de uma receita para `people` pessoas, na ordem da receita. `have` marca o que já está em casa. */
export function scaledIngredients(recipe, people, catalog, have) {
  const factor = people / recipe.servings;
  return recipe.ingredients.map((item) => {
    const qty = item.qty * factor;
    return {
      name: catalog.ingredients[item.ingredient]?.label ?? item.ingredient.replaceAll("-", " "),
      qty: item.unit === "un" ? Math.max(0.5, roundTo(qty, 0.5)) : Math.max(1, Math.round(qty)),
      unit: item.unit,
      home: have.has(item.ingredient),
    };
  });
}
