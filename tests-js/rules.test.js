// Verificações de sanidade ao texto de firestore.rules.
//
// NÃO substituem testar as regras no Simulador do Firebase (FIREBASE.md, passo 5): isto só apanha
// regressões óbvias, como alguém voltar a abrir os preços a qualquer conta ou deixar escrever.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

// Texto do bloco `match /caminho/... { ... }` (com chavetas equilibradas).
function block(path) {
  const header = `match ${path}`;
  const start = rules.indexOf(header);
  assert.ok(start >= 0, `não há bloco para ${path}`);
  // O próprio caminho pode ter chavetas ({uid}); o bloco abre na primeira que vem depois dele.
  const open = rules.indexOf("{", start + header.length);
  let depth = 0;
  for (let i = open; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    if (rules[i] === "}" && --depth === 0) return rules.slice(start, i + 1);
  }
  throw new Error(`bloco ${path} sem fecho`);
}

test("nenhuma regra deixa tudo aberto", () => {
  assert.doesNotMatch(rules, /if\s+true/);
  assert.doesNotMatch(rules, /allow\s+[a-z, ]+;/); // todas têm de ter condição
});

test("os preços só se leem sendo membro e nunca se escrevem", () => {
  const prices = block("/prices/{document}");
  assert.match(prices, /allow read: if isMember\(\);/);
  assert.match(prices, /allow write: if false;/);
  assert.doesNotMatch(prices, /allow read: if signedIn\(\)/); // ter conta não chega
});

test("o documento de cada utilizador exige ser membro e ser o próprio", () => {
  const users = block("/users/{uid}");
  assert.match(users, /allow read: if isMember\(\) && request\.auth\.uid == uid;/);
  assert.match(users, /allow create, update: if isMember\(\)\s*&& request\.auth\.uid == uid/);
  assert.match(users, /hasOnly\(\['settings', 'lastPlan'\]\)/);
  assert.match(users, /allow delete: if false;/);
});

test("members e admins só se leem o próprio e a app nunca escreve", () => {
  for (const path of ["/members/{uid}", "/admins/{uid}"]) {
    const part = block(path);
    assert.match(part, /allow read: if signedIn\(\) && request\.auth\.uid == uid;/, path);
    assert.match(part, /allow write: if false;/, path);
  }
});

test("ser membro é ter documento em members ou admins", () => {
  const fn = rules.slice(rules.indexOf("function isMember()"), rules.indexOf("// Preços do Continente"));
  assert.match(fn, /signedIn\(\)/);
  assert.match(fn, /\/members\/\$\(request\.auth\.uid\)/);
  assert.match(fn, /\/admins\/\$\(request\.auth\.uid\)/);
});

test("tudo o resto está fechado", () => {
  const rest = block("/{document=**}");
  assert.match(rest, /allow read, write: if false;/);
});
