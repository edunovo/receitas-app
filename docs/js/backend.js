// Camada de dados. A interface só fala com isto, nunca diretamente com o Firebase.
//
//   firebase  → login (Authentication) e dados (Firestore): uso real
//   demo      → sem Firebase, tudo no dispositivo: para ver a app antes de configurar o projeto
//   offline   → o Firebase não carregou (sem rede): só o que já está guardado no dispositivo
//
// Interface de cada backend:
//   mode, onUser(callback) → cancelar, signIn(email, password), signOut(), isAdmin(user),
//   isMember(user), loadPrices() → { prices, fromCache }, loadUserDoc(user) → { settings?, lastPlan? },
//   saveSettings(user, settings), saveLastPlan(user, entry)
//
// Membro = tem um documento em members/{uid} (ou admins/{uid}): só esses leem os preços e guardam dados.
// Ter conta não chega (ver firestore.rules).

import { firebaseConfig } from "./firebase-config.js";

// Versão fixa do SDK, servido pela CDN da Google (sem passo de compilação).
const SDK = "https://www.gstatic.com/firebasejs/13.1.0";
export const PRICES_KEY = "receitas:prices";
export const LAST_USER_KEY = "receitas:last-user";

export const isConfigured = () =>
  Boolean(firebaseConfig.apiKey) && !String(firebaseConfig.apiKey).startsWith("COLOCA");

// O armazenamento pode falhar (modo privado, quota): a app tem de funcionar sem ele.
export function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: continua sem guardar */
  }
}

export const rememberUser = (user) => writeJson(LAST_USER_KEY, user ? { uid: user.uid, email: user.email } : null);

const AUTH_MESSAGES = {
  "auth/invalid-credential": "Email ou palavra-passe incorretos.",
  "auth/wrong-password": "Email ou palavra-passe incorretos.",
  "auth/user-not-found": "Email ou palavra-passe incorretos.",
  "auth/invalid-email": "O email não é válido.",
  "auth/user-disabled": "Esta conta está desativada.",
  "auth/too-many-requests": "Demasiadas tentativas. Espera uns minutos e tenta de novo.",
  "auth/network-request-failed": "Sem ligação à internet.",
  // Problemas de configuração do projeto, com a indicação do passo do FIREBASE.md que os resolve.
  "auth/operation-not-allowed": "O login por email e palavra-passe ainda não está ativo no Firebase (FIREBASE.md, passo 3).",
  "auth/configuration-not-found": "O Authentication ainda não foi iniciado no Firebase (FIREBASE.md, passo 3).",
  "auth/invalid-api-key": "A chave da app não é válida: confirma o docs/js/firebase-config.js.",
  "auth/api-key-not-valid": "A chave da app não é válida: confirma o docs/js/firebase-config.js.",
  "auth/unauthorized-domain": "Este endereço não está autorizado no Firebase (FIREBASE.md, passo 3.4).",
};

const NO_ACCESS = "A tua conta ainda não tem acesso. Pede a quem gere a app para te adicionar (FIREBASE.md, passo 6).";

// O Firestore recusa com "permission-denied" quando a conta não é membro: dá-lhe uma mensagem clara.
function accessError(error) {
  return error?.code === "permission-denied" ? Object.assign(new Error(NO_ACCESS), { code: "permission-denied" }) : error;
}

// Os preços ficam também no dispositivo, para planear sem rede. Se o acesso foi recusado, não se usa a cópia.
async function pricesWithCache(load) {
  try {
    const prices = await load();
    writeJson(PRICES_KEY, prices);
    return { prices, fromCache: false };
  } catch (error) {
    const cached = error?.code === "permission-denied" ? null : readJson(PRICES_KEY);
    if (cached) return { prices: cached, fromCache: true };
    throw error;
  }
}

// --- Firebase -----------------------------------------------------------------------------------

async function firebaseBackend() {
  const [{ initializeApp }, authSdk, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  let db;
  try {
    // Guarda os dados no dispositivo para a app abrir e funcionar sem rede.
    db = store.initializeFirestore(app, {
      localCache: store.persistentLocalCache({ tabManager: store.persistentMultipleTabManager() }),
    });
  } catch {
    db = store.getFirestore(app);
  }
  const userRef = (user) => store.doc(db, "users", user.uid);

  return {
    mode: "firebase",
    onUser: (callback) => authSdk.onAuthStateChanged(auth, (user) => callback(user && { uid: user.uid, email: user.email })),
    async signIn(email, password) {
      try {
        await authSdk.signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        throw new Error(AUTH_MESSAGES[error?.code] ?? `Não foi possível entrar (${error?.code ?? "erro desconhecido"}).`);
      }
    },
    signOut: () => authSdk.signOut(auth),
    async isAdmin(user) {
      return (await store.getDoc(store.doc(db, "admins", user.uid))).exists();
    },
    async isMember(user) {
      return (await store.getDoc(store.doc(db, "members", user.uid))).exists();
    },
    loadPrices: () =>
      pricesWithCache(async () => {
        try {
          const snapshot = await store.getDoc(store.doc(db, "prices", "continente"));
          if (!snapshot.exists()) throw new Error("Ainda não há preços publicados (FIREBASE.md, passo 7).");
          return snapshot.data();
        } catch (error) {
          throw accessError(error);
        }
      }),
    async loadUserDoc(user) {
      try {
        const snapshot = await store.getDoc(userRef(user));
        return snapshot.exists() ? snapshot.data() : {};
      } catch (error) {
        throw accessError(error);
      }
    },
    saveSettings: (user, settings) => store.setDoc(userRef(user), { settings }, { merge: true }),
    saveLastPlan: (user, entry) => store.setDoc(userRef(user), { lastPlan: entry }, { merge: true }),
  };
}

// --- demonstração (sem Firebase) ------------------------------------------------------------------

function demoBackend() {
  const KEY = "receitas:demo-user";
  const docKey = (user) => `receitas:demo-doc:${user.uid}`;
  const listeners = new Set();
  const notify = (user) => listeners.forEach((callback) => callback(user));
  const patch = (user, change) => writeJson(docKey(user), { ...(readJson(docKey(user)) ?? {}), ...change });

  return {
    mode: "demo",
    onUser(callback) {
      listeners.add(callback);
      callback(readJson(KEY));
      return () => listeners.delete(callback);
    },
    async signIn(email, password) {
      if (!email || !password) throw new Error("Preenche o email e a palavra-passe.");
      const user = { uid: email.toLowerCase(), email: email.toLowerCase() };
      writeJson(KEY, user);
      notify(user);
    },
    async signOut() {
      localStorage.removeItem(KEY);
      notify(null);
    },
    isAdmin: async (user) => user.email.startsWith("admin"), // só para ver o ecrã de administração
    isMember: async (user) => !user.email.startsWith("semacesso"), // só para ver o ecrã de "sem acesso"
    async loadPrices() {
      const response = await fetch("data/sample-prices.json");
      return { prices: await response.json(), fromCache: false };
    },
    loadUserDoc: async (user) => readJson(docKey(user)) ?? {},
    saveSettings: async (user, settings) => patch(user, { settings }),
    saveLastPlan: async (user, entry) => patch(user, { lastPlan: entry }),
  };
}

// --- sem Firebase (sem rede e SDK não guardado) -------------------------------------------------------

function offlineBackend() {
  const unavailable = () => Promise.reject(new Error("Sem ligação ao servidor."));
  return {
    mode: "offline",
    onUser(callback) {
      callback(readJson(LAST_USER_KEY)); // o último utilizador que entrou neste dispositivo
      return () => {};
    },
    signIn: () => Promise.reject(new Error("Sem ligação à internet.")),
    signOut: async () => rememberUser(null),
    isAdmin: async () => false,
    isMember: async () => true, // sem ligação não dá para saber; o que estiver guardado no dispositivo já foi autorizado
    loadPrices: () => pricesWithCache(unavailable),
    loadUserDoc: unavailable,
    saveSettings: unavailable,
    saveLastPlan: unavailable,
  };
}

export async function createBackend() {
  // "?demo" no endereço força o modo de demonstração (dados só no dispositivo), mesmo com o Firebase configurado.
  const forceDemo = new URLSearchParams(location.search).has("demo");
  if (!isConfigured() || forceDemo) return demoBackend();
  try {
    return await firebaseBackend();
  } catch (error) {
    console.warn("Firebase indisponível, a usar só os dados do dispositivo:", error);
    return offlineBackend();
  }
}
