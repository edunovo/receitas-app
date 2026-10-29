// Planeador: escolhe receitas para a semana dentro de um orçamento. Corre no browser.
//
// O custo é calculado sobre o cabaz inteiro, em embalagens inteiras: um pacote de arroz de 1 kg
// paga-se uma vez, mesmo que duas receitas o usem, por isso receitas que partilham ingredientes
// saem mais baratas em conjunto do que isoladas.
//
// O plano devolvido usa chaves em snake_case (total_cost, recipe_id...) porque é o formato que
// fica guardado no Firestore e que a interface lê.

const EPS = 1e-9;
const keyOf = (ingredient, unit) => `${ingredient}|${unit}`;
const splitKey = (key) => key.split("|");
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export class PlanError extends Error {}

const FAVORITE_FACTOR = 0.75; // as favoritas pesam como se custassem 25 % menos
const SPREAD_MARGIN = 0.6; // € de folga no sorteio, para um custo marginal perto de zero não reduzir as hipóteses a uma
const SPREAD_ATTEMPTS = 8;
const DEFAULT_SPREAD = 0.6; // até 60 % mais caro que a melhor opção do momento

/** Sorteia entre as opções quase tão baratas como a melhor (até `spread` acima, mais uma folga fixa); as favoritas contam a triplicar. */
function pickAmongCheapest(options, spread, random) {
  const cheapest = Math.min(...options.map((o) => o.score));
  const pool = options.filter((o) => o.score <= cheapest * (1 + spread) + SPREAD_MARGIN);
  const tickets = pool.flatMap((o) => (o.favorite ? [o, o, o] : [o]));
  return tickets[Math.floor(random() * tickets.length)];
}

// Gerador pseudo-aleatório com semente (mulberry32): a mesma semente dá sempre o mesmo plano.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- ingredientes e alergénios ---------------------------------------------------------------

export function label(key, ingredients) {
  return ingredients.ingredients[key]?.label ?? key.replaceAll("-", " ");
}

const allergensOf = (key, ingredients) => ingredients.ingredients[key]?.allergens ?? [];

export function recipeAllergens(recipe, ingredients) {
  return new Set(recipe.ingredients.flatMap((i) => allergensOf(i.ingredient, ingredients)));
}

/** Tipo de proteína da receita, usado para variar o plano. */
export function category(recipe) {
  for (const tag of ["carne", "peixe"]) if (recipe.tags.includes(tag)) return tag;
  return "vegetariana";
}

// --- custo -------------------------------------------------------------------------------------

export class Catalog {
  constructor(products) {
    this.byIngredient = new Map();
    for (const product of products) {
      const list = this.byIngredient.get(product.ingredient) ?? [];
      list.push(product);
      this.byIngredient.set(product.ingredient, list);
    }
  }

  /** Produto mais barato (em embalagens inteiras) que cobre `qty`, ou null se não existir. */
  bestBuy(ingredient, unit, qty) {
    let best = null;
    for (const product of this.byIngredient.get(ingredient) ?? []) {
      if (product.unit !== unit) continue;
      const packs = Math.max(1, Math.ceil(qty / product.pack_qty - EPS));
      const cost = round2(packs * product.price);
      const waste = packs * product.pack_qty - qty; // desempata pelo menor desperdício
      if (!best || cost < best.cost || (cost === best.cost && waste < best.waste)) {
        best = { product, packs, cost, waste };
      }
    }
    return best;
  }

  basketCost(needs) {
    let total = 0;
    for (const [key, qty] of needs) {
      const [ingredient, unit] = splitKey(key);
      const buy = this.bestBuy(ingredient, unit, qty);
      if (!buy) return Infinity;
      total += buy.cost;
    }
    return round2(total);
  }
}

/** O que é preciso comprar para a receita. O que já está em casa não entra. */
function recipeNeeds(recipe, people, have) {
  const factor = people / recipe.servings;
  const needs = new Map();
  for (const item of recipe.ingredients) {
    if (!have.has(item.ingredient)) needs.set(keyOf(item.ingredient, item.unit), item.qty * factor);
  }
  return needs;
}

function merge(a, b) {
  const merged = new Map(a);
  for (const [key, qty] of b) merged.set(key, (merged.get(key) ?? 0) + qty);
  return merged;
}

// --- planeamento ---------------------------------------------------------------------------------

export function planWeek({
  recipes,
  products,
  provider,
  budget,
  meals,
  people,
  requireTags = [],
  maxRepeat = 1,
  balance = true,
  have = new Set(),
  locked = [],
  exclude = new Set(),
  seed = 0,
  variety = 0.3,
  spread = 0,
  favorites = new Set(),
}) {
  const catalog = new Catalog(products);
  const random = seededRandom(seed);
  const warnings = [];

  const candidates = [];
  for (const recipe of recipes) {
    if (exclude.has(recipe.id)) continue;
    if (requireTags.length && !requireTags.every((tag) => recipe.tags.includes(tag))) continue;
    if (catalog.basketCost(recipeNeeds(recipe, people, have)) === Infinity) {
      warnings.push(`'${recipe.title}' ignorada: há ingredientes que o supermercado não tem.`);
      continue;
    }
    candidates.push(recipe);
  }

  const chosen = [];
  const uses = new Map();
  const used = (recipe) => uses.get(recipe.id) ?? 0;
  let needs = new Map();
  let currentCost = 0;

  // Receitas fixadas entram primeiro, se ainda forem possíveis e couberem no orçamento.
  const byId = new Map(candidates.map((r) => [r.id, r]));
  for (const recipeId of locked.slice(0, meals)) {
    const recipe = byId.get(recipeId);
    if (!recipe || used(recipe) >= maxRepeat) continue;
    const newNeeds = merge(needs, recipeNeeds(recipe, people, have));
    const newCost = catalog.basketCost(newNeeds);
    if (newCost > budget + EPS) {
      warnings.push(`'${recipe.title}' estava fixada mas já não cabe no orçamento.`);
      continue;
    }
    chosen.push(recipe);
    uses.set(recipe.id, used(recipe) + 1);
    needs = newNeeds;
    currentCost = newCost;
  }

  const kinds = [...new Set(candidates.map(category))];
  for (let slot = meals - chosen.length; slot > 0; slot--) {
    // Com `balance`, tenta primeiro a categoria menos representada até agora e só passa
    // à seguinte se nenhuma receita dela couber no orçamento.
    const counts = new Map(kinds.map((k) => [k, chosen.filter((r) => category(r) === k).length]));
    const order = balance
      ? kinds.map((k) => ({ k, n: counts.get(k), r: random() })).sort((a, b) => a.n - b.n || a.r - b.r).map((x) => x.k)
      : [null];

    let best = null;
    for (const wanted of order) {
      const options = [];
      for (const recipe of candidates) {
        if (used(recipe) >= maxRepeat || (wanted && category(recipe) !== wanted)) continue;
        const newNeeds = merge(needs, recipeNeeds(recipe, people, have));
        const newCost = catalog.basketCost(newNeeds);
        if (newCost > budget + EPS) continue;
        // custo marginal com uma pequena variação para não sair sempre o mesmo plano;
        // as favoritas "custam" um pouco menos, por isso saem mais vezes
        const favorite = favorites.has(recipe.id);
        const score = (newCost - currentCost) * (1 + random() * variety) * (favorite ? FAVORITE_FACTOR : 1);
        options.push({ score, recipe, newNeeds, newCost, favorite });
      }
      if (options.length) {
        best = spread > 0 ? pickAmongCheapest(options, spread, random) : options.reduce((a, b) => (b.score < a.score ? b : a));
        break;
      }
    }
    if (!best) break;
    chosen.push(best.recipe);
    uses.set(best.recipe.id, used(best.recipe) + 1);
    needs = best.newNeeds;
    currentCost = best.newCost;
  }

  if (chosen.length < meals) {
    warnings.push(`Só foi possível planear ${chosen.length} de ${meals} refeições com este orçamento e filtros.`);
  }

  const shopping = [...needs.keys()].sort().map((key) => {
    const [ingredient, unit] = splitKey(key);
    const qty = needs.get(key);
    const { product, packs, cost } = catalog.bestBuy(ingredient, unit, qty);
    return {
      ingredient,
      product_id: product.id,
      product_name: product.name,
      packs,
      unit_price: product.price,
      cost,
      needed_qty: round2(qty),
      leftover_qty: round2(packs * product.pack_qty - qty),
      unit,
      section: product.section ?? null,
    };
  });

  const atHome = new Set(chosen.flatMap((r) => r.ingredients.map((i) => i.ingredient)).filter((k) => have.has(k)));
  return {
    provider,
    budget,
    people,
    total_cost: currentCost,
    remaining: round2(budget - currentCost),
    meals: chosen.map((r) => ({ recipe_id: r.id, title: r.title, minutes: r.minutes, tags: r.tags, steps: r.steps })),
    shopping_list: shopping,
    at_home: [...atHome].sort(),
    warnings,
  };
}

// --- pedido completo (o que a interface chama) -------------------------------------------------------------

function validate(request) {
  const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  if (!(request.budget > 0 && request.budget <= 10000)) throw new PlanError("O orçamento tem de estar entre 0 e 10 000 €.");
  if (!inRange(request.meals, 1, 21)) throw new PlanError("O número de refeições tem de estar entre 1 e 21.");
  if (!inRange(request.people, 1, 12)) throw new PlanError("O número de pessoas tem de estar entre 1 e 12.");
}

/**
 * Gera um plano a partir do pedido da interface.
 * `data` traz { recipes, products, ingredients } (ver data/ e o documento de preços).
 * Com `strict`, falha em vez de devolver menos refeições (usado ao trocar uma refeição).
 */
export function makePlan(request, { recipes, products, ingredients }) {
  validate(request);
  const avoid = new Set((request.avoid ?? []).filter((a) => a in ingredients.allergens));
  const allowed = recipes.filter((r) => ![...recipeAllergens(r, ingredients)].some((a) => avoid.has(a)));
  const have = new Set((request.have ?? []).filter((k) => k in ingredients.ingredients));
  const known = new Set(recipes.map((r) => r.id));
  const dislikes = (request.dislikes ?? []).filter((id) => known.has(id)); // "nunca mais sugerir"
  const favorites = new Set((request.favorites ?? []).filter((id) => known.has(id)));

  const options = {
    recipes: allowed,
    products,
    provider: request.provider,
    budget: request.budget,
    meals: request.meals,
    people: request.people,
    requireTags: request.require_tags ?? [],
    maxRepeat: request.max_repeat ?? 1,
    balance: request.balance ?? true,
    have,
    locked: request.locked ?? [],
    exclude: new Set([...(request.exclude ?? []), ...dislikes]),
    favorites,
    seed: request.seed ?? 0,
  };

  // Com `variety`, sorteia entre as receitas quase tão baratas como a melhor. Só aceita o sorteio se der
  // tantas refeições como o plano mais barato; senão tenta outra vez (a mesma semente dá sempre a mesma
  // sequência de tentativas) e, em último caso, fica com o plano mais barato.
  const cheapest = planWeek(options);
  let plan = null;
  if (request.variety) {
    for (let attempt = 0; attempt < SPREAD_ATTEMPTS && !plan; attempt++) {
      const candidate = planWeek({ ...options, spread: request.variety_spread ?? DEFAULT_SPREAD, seed: options.seed * 131 + attempt });
      if (candidate.meals.length >= cheapest.meals.length) plan = candidate;
    }
  }
  plan ??= cheapest;
  if (request.strict && plan.meals.length < request.meals) {
    throw new PlanError("Não encontrei nenhuma alternativa que caiba no orçamento.");
  }
  plan.at_home = plan.at_home.map((key) => label(key, ingredients));
  return plan;
}
