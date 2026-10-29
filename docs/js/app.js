import { LAST_USER_KEY, PRICES_KEY, createBackend, isConfigured, readJson, rememberUser, writeJson } from "./backend.js";
import { mealDetails } from "./nutrition.js";
import { PlanError, category, makePlan } from "./planner.js";
import { catalogStatus } from "./status.js";
import { initThemeMenu } from "./theme.js";

const $ = (id) => document.getElementById(id);
const eur = (n) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const STORE_KEY = "receitas:last-plan";
const CART_KEY = "receitas:cart";
// O alho vem marcado como "já em casa" até o utilizador guardar uma escolha sua: a app contava
// um saco inteiro (400 g, 2,39 €) para usar 10 g numa receita.
const DEFAULT_PANTRY = ["alho"];

let backend = null;
let currentUser = null;
let recipes = [];
let ingredients = null;
let prices = null; // documento de preços: { fetched_at, products, errors, links }
let lastPlan = null; // plano que está no ecrã
let fixed = new Set(); // receitas fixadas pelo utilizador
let userToken = 0; // descarta respostas de um utilizador que entretanto saiu

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const SVG = "http://www.w3.org/2000/svg";

function icon(name, size = 22) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function iconButton(name, label, onClick) {
  const node = el("button", undefined, "icobtn");
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  node.append(icon(name));
  node.addEventListener("click", onClick);
  return node;
}

const formatDate = (iso) =>
  new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const randomSeed = () => Math.floor(Math.random() * 1_000_000);

function showError(text) {
  $("error").textContent = text ?? "";
  $("error").hidden = !text;
}

function setNotice(text) {
  $("notice").textContent = text ?? "";
  $("notice").hidden = !text;
}

// --- cópias no dispositivo ---------------------------------------------------------------------
// O plano e o carrinho ficam também no dispositivo, para os veres sem rede (ex.: no supermercado).

function clearLocalCopies() {
  try {
    for (const key of [STORE_KEY, CART_KEY, PRICES_KEY, LAST_USER_KEY]) localStorage.removeItem(key);
  } catch {
    /* nada a fazer */
  }
}

function keepOfflineCopy(entry) {
  writeJson(STORE_KEY, { ...entry, user: currentUser?.uid ?? null });
}

// --- vistas ------------------------------------------------------------------------------------

function show(view) {
  $("login-view").hidden = view !== "login";
  $("app-view").hidden = view !== "app";
}

function clearResult() {
  lastPlan = null;
  fixed = new Set();
  $("result").hidden = true;
  $("again").hidden = true;
  showError(null);
  for (const id of ["hero-meta", "warnings", "meals", "shopping"]) $(id).replaceChildren();
}

function showLogin() {
  currentUser = null;
  clearResult(); // o plano do utilizador anterior não fica no ecrã
  $("catalog-box").open = false;
  show("login");
  $("session").hidden = true;
  $("admin").hidden = true;
  $("login-form").password.value = "";
}

function showBanner() {
  const text = {
    demo: isConfigured()
      ? "Modo de demonstração (?demo no endereço): os dados ficam só neste dispositivo e qualquer email entra."
      : "Modo de demonstração: os dados ficam só neste dispositivo e qualquer email entra. Configura o Firebase em docs/js/firebase-config.js.",
    offline: "Sem ligação: a mostrar o que está guardado neste dispositivo.",
  }[backend.mode];
  $("mode-banner").textContent = text ?? "";
  $("mode-banner").hidden = !text;
}

// --- dados estáticos e preços ------------------------------------------------------------------

async function loadStaticData() {
  if (recipes.length) return;
  const [recipesResponse, ingredientsResponse] = await Promise.all([fetch("data/recipes.json"), fetch("data/ingredients.json")]);
  if (!recipesResponse.ok || !ingredientsResponse.ok) throw new Error("Não foi possível carregar as receitas.");
  recipes = await recipesResponse.json();
  ingredients = await ingredientsResponse.json();
}

async function loadPrices() {
  try {
    const { prices: loaded, fromCache } = await backend.loadPrices();
    prices = loaded;
    const date = new Date(prices.fetched_at).toLocaleDateString("pt-PT");
    $("updated").textContent = `Preços do Continente de ${date}${fromCache ? " (guardados neste dispositivo)" : ""}`;
    return true;
  } catch (error) {
    prices = null;
    $("updated").textContent = "";
    showError(error.message);
    return false;
  }
}

// --- sessão ------------------------------------------------------------------------------------

async function enterApp(user) {
  const token = ++userToken;
  currentUser = user;
  rememberUser(user);
  show("app");
  showError(null);

  const admin = await backend.isAdmin(user).catch(() => false);
  // Ter conta não chega: é preciso ser membro (ver firestore.rules). Sem ligação, assume-se que sim.
  const member = admin || (await backend.isMember(user).catch(() => true));
  if (token !== userToken) return;
  $("session").hidden = false;
  $("who").textContent = admin ? `${user.email} · admin` : user.email;
  $("admin").hidden = !admin;
  $("form").hidden = !member;
  if (!member) {
    clearLocalCopies(); // nada de preços nem de planos guardados para quem não tem acesso
    clearResult();
    showError("A tua conta ainda não tem acesso. Pede a quem gere a app para te adicionar.");
    return;
  }

  try {
    await loadStaticData();
  } catch (error) {
    showError(error.message);
    return;
  }
  await loadPrices();
  await loadPrefs();
  if (token !== userToken) return;

  // A cópia local do plano não pode passar de um utilizador para outro.
  const saved = readJson(STORE_KEY);
  if (saved?.user && saved.user !== user.uid) clearLocalCopies();

  if (admin && prices) {
    const date = new Date(prices.fetched_at).toLocaleString("pt-PT");
    $("admin-status").textContent = `Preços publicados a ${date}: ${prices.products.length} produtos.`;
  }
}

function handleUser(user) {
  if (user) enterApp(user);
  else {
    userToken++;
    showLogin();
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  $("login-error").hidden = true;
  try {
    await backend.signIn(form.email.value.trim(), form.password.value);
  } catch (error) {
    $("login-error").textContent = error.message;
    $("login-error").hidden = false;
  }
  form.password.value = "";
});

$("logout").addEventListener("click", async () => {
  clearLocalCopies();
  await backend.signOut();
  handleUser(null); // no demo e offline não há evento de saída
});

// --- preferências ------------------------------------------------------------------------------

const checkedValues = (box) => [...box.querySelectorAll("input:checked")].map((input) => input.value);
let prefsTimer = null;

function buildChips(box, items, selected) {
  box.replaceChildren(
    ...items.map((item) => {
      const label = el("label", undefined, "chip");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.key;
      input.checked = selected.has(item.key);
      input.addEventListener("change", () => {
        clearTimeout(prefsTimer);
        prefsTimer = setTimeout(savePrefs, 600); // guarda pouco depois da última alteração
      });
      label.append(input, document.createTextNode(` ${item.label}`));
      return label;
    }),
  );
}

const usedIngredients = { has: (key) => recipes.some((r) => r.ingredients.some((i) => i.ingredient === key)) };

async function loadPrefs() {
  let settings = null;
  try {
    settings = (await backend.loadUserDoc(currentUser)).settings ?? null;
  } catch {
    $("prefs").hidden = true; // sem ligação não dá para ver nem guardar preferências
    return;
  }
  buildChips(
    $("pantry"),
    Object.entries(ingredients.ingredients)
      .filter(([key]) => usedIngredients.has(key)) // só o que as receitas usam
      .map(([key, info]) => ({ key, label: info.label })),
    new Set(settings ? settings.pantry : DEFAULT_PANTRY),
  );
  buildChips(
    $("avoid"),
    Object.entries(ingredients.allergens).map(([key, name]) => ({ key, label: name })),
    new Set(settings?.avoid ?? []),
  );
  $("prefs").hidden = false;
}

function savePrefs() {
  backend
    .saveSettings(currentUser, { pantry: checkedValues($("pantry")), avoid: checkedValues($("avoid")) })
    .catch(() => {
      /* sem rede: as marcas ficam no ecrã mas não são guardadas */
    });
}

// --- planeador ---------------------------------------------------------------------------------

function buildRequest(seed, extra = {}) {
  const f = $("form");
  return {
    provider: "continente",
    budget: Number(f.budget.value),
    meals: Number(f.meals.value),
    people: Number(f.people.value),
    require_tags: [],
    balance: f.balance.checked,
    have: checkedValues($("pantry")),
    avoid: checkedValues($("avoid")),
    seed,
    ...extra,
  };
}

function restoreForm(request) {
  const f = $("form");
  f.budget.value = request.budget;
  f.meals.value = request.meals;
  f.people.value = request.people;
  f.balance.checked = request.balance;
}

// A cor e a etiqueta de cada refeição vêm do tipo de proteína (o mesmo critério do planeador).
// "vegetariana" fica só para mostrar planos guardados antes de as receitas vegetarianas serem retiradas.
const KIND = { carne: ["carne", "Carne"], peixe: ["peixe", "Peixe"], vegetariana: ["veg", "Vegetariana"] };

function mealItem(meal, info) {
  const [kind, kindLabel] = KIND[category(meal)];
  const li = el("li", undefined, "meal");
  li.dataset.k = kind;

  const sub = el("div", undefined, "sub");
  const clock = el("span");
  clock.style.cssText = "display:inline-flex;align-items:center;gap:4px";
  clock.append(icon("clock", 14), document.createTextNode(`${meal.minutes} min`));
  sub.append(el("span", kindLabel, "tag"), clock);
  if (info?.kcal) sub.append(el("span", `≈ ${info.kcal} kcal`));
  const text = el("div", undefined, "txt");
  text.append(el("div", meal.title, "name"), sub);

  const pin = iconButton("pin", `Fixar ${meal.title}`, () => {
    if (fixed.has(meal.recipe_id)) fixed.delete(meal.recipe_id);
    else fixed.add(meal.recipe_id);
    paintPin();
  });
  const paintPin = () => {
    const on = fixed.has(meal.recipe_id);
    pin.setAttribute("aria-pressed", String(on));
    pin.title = on ? "Fixada: fica na próxima sugestão" : "Fixar para a manter na próxima sugestão";
  };
  paintPin();
  const swap = iconButton("swap", `Trocar ${meal.title}`, () => swapMeal(meal.recipe_id));
  swap.title = "Trocar por outra refeição";

  const main = el("div", undefined, "meal-main");
  main.append(text, pin, swap);

  const steps = el("ol", undefined, "steps");
  steps.append(...meal.steps.map((s) => el("li", s)));
  const details = el("details", undefined, "steps-box");
  details.append(el("summary", info ? "Ingredientes e passos" : "Ver passos"));
  if (info) {
    const list = el("ul", undefined, "ing");
    list.append(
      ...info.ingredients.map((item) => {
        const row = el("li");
        row.append(el("span", item.name), el("span", `${item.qty.toLocaleString("pt-PT")} ${item.unit}${item.home ? " · em casa" : ""}`));
        return row;
      }),
    );
    details.append(el("h4", "Ingredientes"), list);
    if (info.kcal) details.append(el("p", "Calorias estimadas por pessoa, sem azeite, sal nem pimenta.", "muted"));
    details.append(el("h4", "Passos"));
  }
  details.append(steps);

  li.append(main, details);
  return li;
}

// A lista agrupa-se pela secção do supermercado, na ordem de um percurso: frescos primeiro e
// congelados no fim, para não descongelarem no carrinho.
const SECTION_ORDER = ["Frutas e Legumes", "Talho", "Peixaria", "Charcutaria e Queijos", "Laticínios e Ovos", "Mercearia"];

function sectionRank(section) {
  if (!section) return 99;
  if (section === "Congelados") return 90;
  const index = SECTION_ORDER.indexOf(section);
  return index === -1 ? 50 : index;
}

const orderBySection = (items) =>
  [...items].sort(
    (a, b) => sectionRank(a.section) - sectionRank(b.section) || (a.section ?? "").localeCompare(b.section ?? ""),
  );

// Lista de compras com caixas: as marcas ficam no dispositivo e valem enquanto o plano for o mesmo.
const planSignature = (plan) =>
  `${plan.shopping_list.map((s) => `${s.product_id}x${s.packs}`).join("|")}@${plan.total_cost}`;

function renderShopping(plan) {
  const signature = planSignature(plan);
  const saved = readJson(CART_KEY);
  const cart = new Set(saved?.signature === signature ? saved.ids : []);

  const total = plan.shopping_list.length;
  const costById = new Map(plan.shopping_list.map((item) => [item.product_id, item.cost]));
  const updateProgress = () => {
    const inCart = [...cart].reduce((sum, id) => sum + (costById.get(id) ?? 0), 0);
    $("cart-n").textContent = total ? `${cart.size} de ${total} no carrinho` : "Não há nada para comprar: já tens tudo em casa.";
    $("cart-t").textContent = total ? eur(inCart) : "";
    $("cart-fill").style.width = total ? `${(cart.size / total) * 100}%` : "0%";
  };

  const items = orderBySection(plan.shopping_list);
  const hasSections = items.some((item) => item.section);
  const sectionTotal = (section) => items.filter((i) => i.section === section).reduce((sum, i) => sum + i.cost, 0);
  $("shopping").replaceChildren(
    ...items.flatMap((item, index) => {
      const header = [];
      if (hasSections && item.section !== items[index - 1]?.section) {
        const title = el("h3", undefined, "sec");
        title.append(el("span", item.section ?? "Outros"), el("span", eur(sectionTotal(item.section))));
        header.push(title);
      }
      // Toda a linha é um <label>: tocar em qualquer ponto marca o produto.
      const row = el("label", undefined, "row");
      const input = el("input", undefined, "sr-only");
      input.type = "checkbox";
      input.checked = cart.has(item.product_id);
      const paint = () => row.classList.toggle("done", input.checked);
      input.addEventListener("change", () => {
        if (input.checked) cart.add(item.product_id);
        else cart.delete(item.product_id);
        paint();
        writeJson(CART_KEY, { signature, ids: [...cart] });
        updateProgress();
      });
      const box = el("span", undefined, "box");
      box.append(icon("check", 16));
      const name = el("span", item.product_name, "nm");
      const detail = `${item.packs}×${item.leftover_qty > 0 ? ` · sobram ${item.leftover_qty} ${item.unit}` : ""}`;
      name.append(el("small", detail));
      row.append(input, box, name, el("span", eur(item.cost), "pr"));
      paint();
      return [...header, row];
    }),
  );
  $("cartbar").hidden = !total;
  updateProgress();
  if (!total) $("shopping").replaceChildren(el("p", "Não há nada para comprar: já tens tudo em casa.", "muted"));

  const atHome = plan.at_home ?? [];
  $("at-home").textContent = atHome.length ? `Já tens em casa: ${atHome.join(", ")}` : "";
  $("at-home").hidden = !atHome.length;
}

function renderHero(plan) {
  $("hero-total").textContent = eur(plan.total_cost);
  $("hero-of").textContent = `de ${eur(plan.budget)} de orçamento`;
  $("hero-fill").style.width = `${plan.budget > 0 ? Math.min(100, (plan.total_cost / plan.budget) * 100) : 0}%`;

  const meals = el("span");
  meals.append(el("b", String(plan.meals.length)), document.createTextNode(plan.meals.length === 1 ? " refeição" : " refeições"));
  // Os planos guardados antes de existir este campo não dizem para quantas pessoas eram.
  if (plan.people) meals.append(document.createTextNode(` · ${plan.people} ${plan.people === 1 ? "pessoa" : "pessoas"}`));
  const left = el("span");
  left.append(document.createTextNode("sobra "), el("b", eur(plan.remaining)));
  $("hero-meta").replaceChildren(meals, left);
}

function render(plan) {
  lastPlan = plan;
  fixed = new Set([...fixed].filter((id) => plan.meals.some((m) => m.recipe_id === id)));

  renderHero(plan);
  $("warnings").replaceChildren(...plan.warnings.map((w) => el("div", w, "warn")));
  // As calorias e os ingredientes calculam-se agora, por isso aparecem também em planos guardados há mais tempo.
  const people = plan.people ?? Number($("form").people.value);
  const have = new Set(checkedValues($("pantry")));
  $("meals").replaceChildren(
    ...plan.meals.map((meal) => mealItem(meal, mealDetails(meal.recipe_id, people, { recipes, ingredients }, have))),
  );
  renderShopping(plan);
  $("result").hidden = false;
  $("again").hidden = false;
}

// Devolve true se mostrou um plano novo.
async function run(seed, extra = {}) {
  showError(null);
  if (!prices && !(await loadPrices())) return false;
  const request = buildRequest(seed, extra);

  let plan;
  try {
    plan = makePlan(request, { recipes, products: prices.products, ingredients });
  } catch (error) {
    if (!(error instanceof PlanError)) throw error;
    if (request.strict) {
      // Trocar uma refeição sem alternativa possível: o plano que está no ecrã e o guardado mantêm-se.
      setNotice(error.message);
    } else {
      clearResult();
      showError(error.message);
    }
    return false;
  }

  render(plan);
  setNotice("Plano guardado. Substitui o anterior.");
  const entry = { request, plan, savedAt: new Date().toISOString() };
  keepOfflineCopy(entry);
  // Sem esperar: offline, o Firestore guarda o pedido e sincroniza quando houver ligação.
  backend.saveLastPlan(currentUser, entry).catch(() => {
    setNotice("Plano gerado, mas não foi possível guardá-lo online (sem ligação). Fica neste dispositivo.");
  });
  return true;
}

async function swapMeal(recipeId) {
  if (!lastPlan) return;
  const others = lastPlan.meals.map((m) => m.recipe_id).filter((id) => id !== recipeId);
  await run(randomSeed(), { locked: others, exclude: [recipeId], strict: true, meals: lastPlan.meals.length });
}

// "Mostrar plano": o último plano guardado para este utilizador.
async function showLast() {
  showError(null);
  let entry;
  let offline = false;
  try {
    entry = (await backend.loadUserDoc(currentUser)).lastPlan;
    if (!entry) {
      clearResult();
      showError("Ainda não tens nenhum plano guardado.");
      return;
    }
  } catch {
    const saved = readJson(STORE_KEY);
    if (!saved || (saved.user && saved.user !== currentUser.uid)) {
      clearResult();
      showError("Sem ligação e não há nenhuma cópia do plano neste dispositivo.");
      return;
    }
    entry = saved;
    offline = true;
  }
  restoreForm(entry.request);
  render(entry.plan);
  setNotice(
    offline
      ? `Sem ligação. A mostrar a cópia deste dispositivo, guardada a ${formatDate(entry.savedAt)}.`
      : `Plano guardado a ${formatDate(entry.savedAt)}.`,
  );
  if (!offline) keepOfflineCopy(entry);
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  fixed = new Set(); // um plano novo começa sem refeições fixadas
  run(0);
});
$("again").addEventListener("click", () => run(randomSeed(), { locked: [...fixed] }));
$("show-last").addEventListener("click", showLast);

// --- estado do catálogo (só admin) -------------------------------------------------------------

const STATUS_TEXT = {
  "sem-produtos": "os links do catálogo falharam",
  "fora-do-catalogo": "sem links no catálogo",
};

function list(items) {
  const ul = el("ul", undefined, "plain-list");
  ul.append(...items);
  return ul;
}

function renderCatalog(data) {
  const withProducts = data.ingredients.filter((i) => i.status === "ok").length;
  const blocks = [
    el(
      "p",
      `${withProducts} de ${data.ingredients.length} ingredientes têm produtos. ` +
        `${data.recipes_unavailable.length} de ${data.recipes_total} receitas estão indisponíveis.`,
    ),
  ];

  const missing = data.ingredients.filter((i) => i.status !== "ok");
  if (missing.length) {
    blocks.push(el("h3", "Ingredientes sem produtos"));
    blocks.push(list(missing.map((i) => el("li", `${i.label}: ${STATUS_TEXT[i.status]}`))));
  }
  if (data.recipes_unavailable.length) {
    blocks.push(el("h3", "Receitas indisponíveis"));
    blocks.push(list(data.recipes_unavailable.map((r) => el("li", `${r.title}: falta ${r.missing.join(", ")}`))));
  }
  if (data.errors.length) {
    blocks.push(el("h3", `Links com erro (${data.errors.length})`));
    blocks.push(
      list(
        data.errors.map((e) => {
          const li = el("li", `${e.reason} `);
          if (e.url?.startsWith("https://")) {
            const link = el("a", e.url.split("/").pop());
            link.href = e.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            li.append(link);
          }
          return li;
        }),
      ),
    );
  }
  $("catalog-status").replaceChildren(...blocks);
}

$("catalog-box").addEventListener("toggle", () => {
  if (!$("catalog-box").open) return;
  if (prices) renderCatalog(catalogStatus({ recipes, ingredients, prices }));
  else $("catalog-status").textContent = "Ainda não há preços carregados.";
});

// --- arranque ----------------------------------------------------------------------------------

async function init() {
  initThemeMenu();
  backend = await createBackend();
  showBanner();
  backend.onUser(handleUser);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
