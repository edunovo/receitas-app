import { LAST_USER_KEY, PRICES_KEY, createBackend, isConfigured, readJson, rememberUser, writeJson } from "./backend.js";
import { kcalSummary, mealDetails } from "./nutrition.js";
import { PlanError, category, makePlan } from "./planner.js";
import { catalogStatus } from "./status.js";
import { initThemeMenu } from "./theme.js";

const $ = (id) => document.getElementById(id);
const eur = (n) => n.toLocaleString("pt-PT", { style: "currency", currency: "EUR" });
const STORE_KEY = "receitas:last-plan";
const CART_KEY = "receitas:cart";
const SAVED_KEY = "receitas:saved-plans"; // cópia das listas guardadas, para as veres sem rede
const MAX_SAVED = 5; // o mesmo limite que firestore.rules aceita
// O alho vem marcado como "já em casa" até o utilizador guardar uma escolha sua: a app contava
// um saco inteiro (400 g, 2,39 €) para usar 10 g numa receita.
const DEFAULT_PANTRY = ["alho"];

let backend = null;
let currentUser = null;
let recipes = [];
let ingredients = null;
let prices = null; // documento de preços: { fetched_at, products, errors, links }
let lastPlan = null; // plano que está no ecrã
let currentRequest = null; // pedido que deu origem ao plano que está no ecrã
let savedPlans = []; // listas guardadas: { id, name, savedAt, request, plan }
// Preferências que ficam guardadas por utilizador (junto com "já tenho em casa" e "evitar").
const prefsState = { favorites: new Set(), dislikes: new Set(), kcalTarget: null };
const KCAL_MIN = 200; // os mesmos limites que firestore.rules aceita
const KCAL_MAX = 3000;
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

function button(text, onClick, className) {
  const node = el("button", text, className);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function textButton(iconName, text, onClick) {
  const node = el("button", undefined, "btn small");
  node.type = "button";
  node.append(icon(iconName, 18), document.createTextNode(` ${text}`));
  node.addEventListener("click", onClick);
  return node;
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
    for (const key of [STORE_KEY, CART_KEY, SAVED_KEY, PRICES_KEY, LAST_USER_KEY]) localStorage.removeItem(key);
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
  $("result").hidden = true;
  showError(null);
  for (const id of ["hero-meta", "warnings", "meals", "shopping"]) $(id).replaceChildren();
  $("hero-kcal").hidden = true;
  currentRequest = null;
  renderSaved();
}

function showLogin() {
  currentUser = null;
  resetUserState();
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
  resetUserState();
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
      input.addEventListener("change", schedulePrefsSave);
      label.append(input, document.createTextNode(` ${item.label}`));
      return label;
    }),
  );
}

// Guarda pouco depois da última alteração.
function schedulePrefsSave() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(savePrefs, 600);
}

const recipeTitle = (id) => recipes.find((r) => r.id === id)?.title;

// Receitas favoritas e rejeitadas: uma etiqueta por receita; desmarcar tira-a da lista.
function renderRecipeLists() {
  for (const [boxId, ids] of [["dislikes", prefsState.dislikes]]) {
    const box = $(boxId);
    const known = [...ids].filter(recipeTitle);
    if (!known.length) {
      box.replaceChildren(el("span", "Nenhuma por agora.", "muted"));
      continue;
    }
    box.replaceChildren(
      ...known.map((id) => {
        const label = el("label", undefined, "chip");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = true;
        input.addEventListener("change", () => {
          ids.delete(id);
          renderRecipeLists();
          paintFavoriteButtons();
          schedulePrefsSave();
        });
        label.append(input, document.createTextNode(` ${recipeTitle(id)}`));
        return label;
      }),
    );
  }
}

function paintFavoriteButtons() {
  for (const button of document.querySelectorAll(".fav")) {
    const on = prefsState.favorites.has(button.dataset.id);
    button.setAttribute("aria-pressed", String(on));
    button.lastChild.textContent = on ? " Favorita" : " Adicionar às favoritas";
  }
}

const usedIngredients = { has: (key) => recipes.some((r) => r.ingredients.some((i) => i.ingredient === key)) };

async function loadPrefs() {
  let settings = null;
  try {
    const doc = await backend.loadUserDoc(currentUser);
    settings = doc.settings ?? null;
    setSavedPlans(doc.savedPlans ?? []);
  } catch {
    const copy = readJson(SAVED_KEY); // sem ligação: as listas que ficaram guardadas neste dispositivo
    if (copy?.user && copy.user === currentUser?.uid) setSavedPlans(copy.list ?? [], false);
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
  prefsState.favorites = new Set(settings?.favorites ?? []);
  prefsState.dislikes = new Set(settings?.dislikes ?? []);
  prefsState.kcalTarget = Number.isFinite(settings?.kcalTarget) ? settings.kcalTarget : null;
  $("kcal-target").value = prefsState.kcalTarget ?? "";
  renderRecipeLists();
  renderFavorites();
  $("prefs").hidden = false;
}

function savePrefs() {
  backend
    .saveSettings(currentUser, {
      pantry: checkedValues($("pantry")),
      avoid: checkedValues($("avoid")),
      dislikes: [...prefsState.dislikes],
      favorites: [...prefsState.favorites],
      kcalTarget: prefsState.kcalTarget, // null sem meta: o Firestore junta campos, por isso tem de ir explícito
    })
    .catch(() => {
      /* sem rede: as marcas ficam no ecrã mas não são guardadas */
    });
}

// Mudar o limite não altera o plano que está no ecrã: avisa se ele já não o cumpre.
$("form").max_minutes.addEventListener("change", () => {
  const limit = Number($("form").max_minutes.value);
  if (!lastPlan || !limit) return;
  const over = lastPlan.meals.filter((meal) => meal.minutes > limit).length;
  if (over) {
    setNotice(
      `${over === 1 ? "Uma refeição deste plano demora" : `${over} refeições deste plano demoram`} mais de ${limit} minutos. O limite aplica-se quando geras um plano novo (Sugerir plano) ou trocas uma refeição.`,
    );
  }
});

$("kcal-target").addEventListener("input", () => {
  // Fora dos limites conta como "sem meta": as regras do Firestore recusariam o resto das preferências.
  const value = Math.round(Number($("kcal-target").value));
  prefsState.kcalTarget = $("kcal-target").value !== "" && value >= KCAL_MIN && value <= KCAL_MAX ? value : null;
  if (lastPlan) renderKcal(lastKcal);
  schedulePrefsSave();
});

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
    max_minutes: Number(f.max_minutes.value) || null,
    have: checkedValues($("pantry")),
    avoid: checkedValues($("avoid")),
    dislikes: [...prefsState.dislikes],
    favorites: [...prefsState.favorites],
    variety: f.variety.checked,
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
  f.max_minutes.value = request.max_minutes ?? ""; // planos antigos não têm limite
  f.variety.checked = request.variety ?? f.variety.checked; // planos antigos não dizem; fica como está
}

// A cor e a etiqueta de cada refeição vêm do tipo de proteína (o mesmo critério do planeador).
// "vegetariana" fica só para mostrar planos guardados antes de as receitas vegetarianas serem retiradas.
const KIND = { carne: ["carne", "Carne"], peixe: ["peixe", "Peixe"], vegetariana: ["veg", "Vegetariana"] };

function mealItem(meal, info, { readonly = false } = {}) {
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

  const swap = iconButton("swap", `Trocar ${meal.title}`, () => swapMeal(meal.recipe_id));
  swap.title = "Trocar por outra refeição";

  const main = el("div", undefined, "meal-main");
  main.append(text, ...(readonly ? [] : [swap]));

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

  const favorite = textButton("heart", "Adicionar às favoritas", () => {
    if (prefsState.favorites.has(meal.recipe_id)) prefsState.favorites.delete(meal.recipe_id);
    else prefsState.favorites.add(meal.recipe_id);
    paintFavoriteButtons();
    renderFavorites();
    schedulePrefsSave();
  });
  favorite.classList.add("fav");
  favorite.dataset.id = meal.recipe_id;
  const never = textButton("ban", "Nunca mais sugerir", () => dislikeMeal(meal));
  const prefsRow = el("div", undefined, "meal-prefs");
  prefsRow.append(favorite, ...(readonly ? [] : [never]));
  // Só para receitas que ainda existem: nos planos antigos pode haver pratos já retirados.
  if (recipeTitle(meal.recipe_id)) details.append(prefsRow);

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

let lastKcal = [];

function renderKcal(perMeal) {
  const summary = kcalSummary(perMeal, prefsState.kcalTarget);
  const box = $("hero-kcal");
  box.hidden = !summary;
  if (!summary) return;
  const verdict = { perto: "perto da meta", acima: "acima da meta", abaixo: "abaixo da meta" }[summary.status];
  box.textContent = `≈ ${summary.average} kcal por refeição, em média${verdict ? ` · ${verdict} de ${summary.target}` : ""}`;
  box.className = `kcal${summary.status && summary.status !== "perto" ? " off" : ""}`;
}

function render(plan) {
  lastPlan = plan;

  renderHero(plan);
  $("warnings").replaceChildren(...plan.warnings.map((w) => el("div", w, "warn")));
  // As calorias e os ingredientes calculam-se agora, por isso aparecem também em planos guardados há mais tempo.
  const people = plan.people ?? Number($("form").people.value);
  const have = new Set(checkedValues($("pantry")));
  const details = plan.meals.map((meal) => mealDetails(meal.recipe_id, people, { recipes, ingredients }, have));
  $("meals").replaceChildren(...plan.meals.map((meal, index) => mealItem(meal, details[index])));
  paintFavoriteButtons();
  lastKcal = details.map((info) => info?.kcal ?? null);
  renderKcal(lastKcal);
  renderShopping(plan);
  $("result").hidden = false;
  renderSaved();
}

// Devolve true se mostrou um plano novo.
async function run(seed, extra = {}) {
  const { slot, ...requestExtra } = extra; // `slot`: posição da refeição trocada; não faz parte do pedido
  showError(null);
  if (!prices && !(await loadPrices())) return false;
  const request = buildRequest(seed, requestExtra);

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

  // Ao trocar uma refeição, a nova fica no lugar da que saiu (e não no fim da lista).
  const added = slot === undefined ? -1 : plan.meals.findIndex((m) => !request.locked.includes(m.recipe_id));
  if (added >= 0) plan.meals.splice(slot, 0, ...plan.meals.splice(added, 1));

  currentRequest = request;
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
  const slot = lastPlan.meals.findIndex((m) => m.recipe_id === recipeId);
  return run(randomSeed(), { locked: others, exclude: [recipeId], strict: true, meals: lastPlan.meals.length, slot });
}

// "Nunca mais sugerir": guarda a receita como rejeitada e troca-a já por outra.
async function dislikeMeal(meal) {
  prefsState.dislikes.add(meal.recipe_id);
  prefsState.favorites.delete(meal.recipe_id);
  renderRecipeLists();
  schedulePrefsSave();
  if (await swapMeal(meal.recipe_id)) {
    setNotice(`Plano guardado. «${meal.title}» não volta a ser sugerida; podes desfazer em Preferências.`);
  }
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
  currentRequest = entry.request;
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
  run(randomSeed()); // cada vez que se pede, sai um plano diferente
});
$("show-last").addEventListener("click", showLast);

// --- listas guardadas e favoritos ----------------------------------------------------------------
// Até 5 planos com a sua lista de compras, com nome; ficam por utilizador e abrem-se sem rede.

function resetUserState() {
  prefsState.favorites = new Set();
  prefsState.dislikes = new Set();
  prefsState.kcalTarget = null;
  savedPlans = [];
  renderSaved();
  renderFavorites();
}

function setSavedPlans(list, keepCopy = true) {
  savedPlans = list.slice(0, MAX_SAVED);
  if (keepCopy) writeJson(SAVED_KEY, { user: currentUser?.uid ?? null, list: savedPlans });
  renderSaved();
}

function renderSaved() {
  $("saved-count").textContent = `${savedPlans.length} de ${MAX_SAVED}`;
  const full = savedPlans.length >= MAX_SAVED;
  $("save-plan").disabled = !lastPlan || full;
  $("save-hint").textContent = full
    ? `Já tens ${MAX_SAVED} listas guardadas. Apaga uma para guardar outra.`
    : !lastPlan
      ? "Gera ou abre um plano para o poderes guardar."
      : "";

  if (!savedPlans.length) {
    $("saved-list").replaceChildren(el("li", "Ainda não guardaste nenhuma lista.", "muted"));
    return;
  }
  $("saved-list").replaceChildren(
    ...savedPlans.map((entry) => {
      const li = el("li");
      li.append(el("div", entry.name, "name"));
      const meals = entry.plan.meals.length;
      li.append(el("div", `${meals} ${meals === 1 ? "refeição" : "refeições"} · ${eur(entry.plan.total_cost)} · guardada a ${formatDate(entry.savedAt)}`, "info"));
      const actions = el("div", undefined, "row-actions");
      actions.append(
        button("Abrir", () => openSaved(entry), "btn small primary"),
        button("Apagar", () => deleteSaved(entry), "btn small"),
      );
      li.append(actions);
      return li;
    }),
  );
}

async function persistSaved(next, failure) {
  const previous = savedPlans;
  setSavedPlans(next);
  try {
    await backend.saveSavedPlans(currentUser, next);
    return true;
  } catch {
    setSavedPlans(previous);
    setNotice(failure);
    return false;
  }
}

async function saveCurrentPlan() {
  if (!lastPlan || !currentRequest || savedPlans.length >= MAX_SAVED) return;
  const typed = $("save-name").value.trim();
  const entry = {
    id: Date.now().toString(36),
    name: typed || `Plano de ${new Date().toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })}`,
    savedAt: new Date().toISOString(),
    request: currentRequest,
    plan: lastPlan,
  };
  if (await persistSaved([...savedPlans, entry], "Não foi possível guardar a lista (sem ligação). Tenta de novo quando tiveres rede.")) {
    $("save-name").value = "";
    setNotice(`Lista «${entry.name}» guardada.`);
  }
}

function openSaved(entry) {
  showError(null);
  restoreForm(entry.request);
  currentRequest = entry.request;
  render(entry.plan);
  setNotice(`Lista «${entry.name}», guardada a ${formatDate(entry.savedAt)}.`);
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteSaved(entry) {
  await persistSaved(
    savedPlans.filter((saved) => saved.id !== entry.id),
    "Não foi possível apagar a lista (sem ligação). Tenta de novo quando tiveres rede.",
  );
}

// Favoritos: as receitas marcadas, com ingredientes e passos, para o número de pessoas do formulário.
function renderFavorites() {
  const known = [...prefsState.favorites].filter(recipeTitle);
  $("fav-count").textContent = String(known.length);
  if (!known.length) {
    $("fav-list").replaceChildren(el("li", "Ainda não tens favoritos. Abre uma refeição e toca em \"Adicionar às favoritas\".", "muted"));
    return;
  }
  const people = Number($("form").people.value) || 2;
  const have = new Set(checkedValues($("pantry")));
  $("fav-list").replaceChildren(
    ...known.map((id) => {
      const recipe = recipes.find((r) => r.id === id);
      const meal = { recipe_id: id, title: recipe.title, minutes: recipe.minutes, tags: recipe.tags, steps: recipe.steps };
      const info = mealDetails(id, people, { recipes, ingredients }, have);
      return mealItem(meal, info, { readonly: true });
    }),
  );
  paintFavoriteButtons();
}

$("save-plan").addEventListener("click", saveCurrentPlan);
$("form").people.addEventListener("input", renderFavorites); // as quantidades dependem das pessoas

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
