# Criar a estrutura no Firebase

Guia passo a passo. Demora uns 20 minutos e não pede cartão: usas o plano gratuito (Spark).
As palavras entre aspas são os nomes dos botões na consola do Firebase (que está em português
se o teu Google estiver em português; senão, os nomes podem estar em inglês).
Em português do Brasil, que é o que aparece em muitas contas, "utilizadores" é **Usuários**, "palavra-passe" é
**senha**, "Definições" é **Configurações**, "Método de início de sessão" é **Método de login** e
"Email/palavra-passe" é **E-mail/senha**. Os atalhos para o Authentication e o Firestore estão no menu da
esquerda, em **Atalhos do projeto**.

## O que vamos criar

```
Firebase
├── Authentication          → quem pode entrar (email e palavra-passe)
└── Firestore (base de dados)
    ├── prices/continente   → preços do Continente (só leem os membros; escreve um script local)
    ├── users/{uid}         → o plano guardado e as preferências de cada pessoa
    ├── members/{uid}       → quem tem acesso (um documento por pessoa, criado por ti)
    └── admins/{uid}        → quem é admin (um documento por admin, criado por ti)
```

Os documentos `members/{uid}` e `admins/{uid}` criam-se à mão, um por pessoa. `prices/continente` cria-o o script
local dos preços e `users/{uid}` cria-o a app quando alguém guarda um plano ou preferências.

| Documento | Campos |
|---|---|
| `prices/continente` | `fetched_at`, `products` (lista com `id`, `name`, `price`, `pack_qty`, `unit`, `ingredient`, `section`), `errors`, `links` |
| `users/{uid}` | `settings` (`pantry`, `avoid`, `dislikes`, `favorites`, `kcalTarget`), `lastPlan` (`request`, `plan`, `savedAt`) |
| `members/{uid}` | um campo qualquer (por exemplo `member: true`); conta a existência do documento |
| `admins/{uid}` | um campo qualquer (por exemplo `admin: true`); conta a existência do documento |

## 1. Criar o projeto

1. Abre [console.firebase.google.com](https://console.firebase.google.com) e entra com a tua conta Google.
2. **Criar um projeto** → dá-lhe um nome (por exemplo `receitas`) → continuar.
3. Desativa o Google Analytics (não é preciso) → **Criar projeto**.

O plano Spark é o que vem por defeito. Não mudes para o Blaze.

## 2. Registar a app Web

1. Na página inicial do projeto, carrega no ícone **`</>`** (Web).
2. Nome da app: `receitas-web`. **Não** marques "Firebase Hosting" (a app fica no GitHub Pages).
3. **Registar app**. Aparece um bloco `firebaseConfig = { apiKey: …, authDomain: …, projectId: …, … }`.
4. Copia `apiKey`, `authDomain`, `projectId` e `appId` para o ficheiro
   [docs/js/firebase-config.js](docs/js/firebase-config.js), no lugar de cada `COLOCA_AQUI`.

Estes valores não são segredos. A segurança vem do login e das regras (passo 5).

## 3. Ativar o login

1. No menu da esquerda, em **Atalhos do projeto**, clica em **Authentication** (também está em
   **Segurança** ou **Criação**) → **Começar**.
2. Separador **Método de início de sessão** → **Email/palavra-passe** → ativar o primeiro interruptor
   (não o de "link por email") → **Guardar**.
3. Separador **Utilizadores** → **Adicionar utilizador**: cria o teu utilizador e o do nick, cada um com
   um email e uma palavra-passe (mínimo 6 caracteres; usa mais).
4. Separador **Definições** → **Domínios autorizados** → **Adicionar domínio**:
   `o-teu-utilizador.github.io` (só o domínio, sem caminho). O `localhost` já vem na lista.
5. Separador **Definições** → **Ações do usuário** (User actions) → desativa a criação de contas por parte dos
   utilizadores (o cadastro). Não consegui confirmar o nome exato do botão na consola; procura a opção que impede
   os utilizadores de criarem e apagarem contas.

Os utilizadores gerem-se sempre aqui: adicionar pessoas, mudar palavra-passe, desativar ou apagar.

O ponto 5 importa: a chave da app é pública, e sem isto qualquer pessoa consegue criar uma conta no teu projeto
através da API do Firebase. As regras (passo 5) já só deixam entrar os **membros**, mas é melhor não ter contas
de estranhos de todo.

## 4. Criar a base de dados (Firestore)

1. No menu da esquerda, em **Atalhos do projeto**, clica em **Firestore** (também está em
   **Bancos de dados e armazenamento** ou **Criação**) → **Criar base de dados** (**Criar banco de dados**).
2. Escolhe uma localização na Europa (por exemplo `eur3`). **Não se pode mudar depois.**
3. Modo **de produção** (não o modo de teste) → **Criar**.

## 5. Colar as regras de segurança

1. Em Firestore, separador **Regras**.
2. Apaga tudo e cola o conteúdo de [firestore.rules](firestore.rules) → **Publicar**.

As regras fazem isto: só os **membros** (quem tem um documento em `members/` ou `admins/`, passo 6) leem os preços
(ninguém os escreve a partir da app), cada membro só lê e escreve o seu próprio documento, e tudo o resto está
fechado. Quem tiver conta mas não for membro não vê nada.

### Testar as regras (importante)

Eu não consegui testá-las (precisavam do emulador do Firebase). Testa-as tu no separador **Regras**,
no **Simulador de regras** (Rules Playground), antes de usares a app a sério. Os testes "permitido" só dão certo
se o documento em `members/` ou `admins/` já existir, por isso faz primeiro o passo 6 (o simulador usa os dados reais).

| Operação | Caminho | Autenticado como | Resultado esperado |
|---|---|---|---|
| get | `/prices/continente` | UID_A, que tem documento em `members/` | permitido |
| get | `/prices/continente` | UID_X, **sem** documento em `members/` nem `admins/` | **negado** |
| get | `/prices/continente` | não autenticado | **negado** |
| set | `/prices/continente` | qualquer UID | **negado** |
| get | `/users/UID_A` | UID_A (membro) | permitido |
| get | `/users/UID_A` | UID_B | **negado** |
| get | `/members/UID_B` | UID_A | **negado** |
| set | `/members/UID_A` | UID_A | **negado** |
| get | `/admins/UID_B` | UID_A | **negado** |
| set | `/admins/UID_A` | UID_A | **negado** |

Se algum resultado for diferente do esperado, não uses a app e diz-me.

## 6. Dar acesso: o admin e os membros

1. **Authentication → Utilizadores** → copia o **UID** de cada pessoa que vai usar a app (o teu e o do nick).
2. **Firestore → Dados** → **Iniciar coleção** → ID da coleção: `admins`. ID do documento: cola o teu UID.
   Adiciona um campo qualquer (por exemplo `admin`, tipo booleano, `true`) → **Guardar**.
3. Para cada outra pessoa (o nick): **Iniciar coleção** → ID da coleção: `members`, ID do documento: o UID dela,
   campo `member` = `true` → **Guardar**. Nas vezes seguintes, **Adicionar documento** nessa coleção.

Quem tiver um documento em `members/` ou `admins/` com o seu UID é **membro**: lê os preços e guarda o seu plano.
Os admins veem ainda a secção de administração (não precisam de documento em `members/`). Quem só tiver conta,
sem documento, entra mas vê "A tua conta ainda não tem acesso" e não lê nada.

## 7. Publicar os preços

Os preços escrevem-se em `prices/continente` a partir de um script no teu PC, com a chave de uma conta de
serviço. O script não faz parte deste repositório.

1. Consola → roda dentada (**Configurações**) → **Configurações do projeto** → separador **Contas de serviço** →
   **Gerar nova chave privada** → guarda o ficheiro JSON **fora da pasta do projeto**
   (por exemplo `C:\caminho\para\receitas-firebase.json`).
   Esta chave dá acesso total à base de dados: nunca a ponhas no repositório nem a envies a ninguém.
2. O script lê o caminho da chave na variável de ambiente `GOOGLE_APPLICATION_CREDENTIALS`:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\caminho\para\receitas-firebase.json"
```

O documento `prices/continente` tem o formato da tabela no início deste guia.

## 8. Recomendação extra: restringir a chave da app

A `apiKey` está no código público. Convém limitá-la ao teu site, para ninguém a usar noutros sítios:

1. [console.cloud.google.com](https://console.cloud.google.com) → o teu projeto → **APIs e serviços → Credenciais**.
2. Abre a "Browser key" (criada pelo Firebase) → **Restrições de aplicações** → **Sites** →
   adiciona `https://o-teu-utilizador.github.io/*` e, para testar no PC, `http://localhost:8000/*` → **Guardar**. O Google não aceita `*` no lugar da porta
   (`http://localhost:*` dá "domínio do site inválido"): os `*` só valem para subdomínios e para o fim do caminho.

Este passo é **opcional** e só o deves fazer depois de a app estar publicada: quem protege os dados são o login
e as regras, não a chave. Se restringires a chave e deixares de fora o endereço de onde abres a app, o login
falha com "A chave da app não é válida". Para voltar ao normal, remove a restrição.

Convém saber o que isto faz: limita o abuso da quota do teu projeto, mas **não** protege os dados (a documentação do
Firebase diz o mesmo), porque quem usa um script pode falsificar o site de origem. Os dados protegem-nos o login, o
registo desligado (passo 3.5) e as regras.

## Quando alguma coisa não funciona

| Sintoma | Causa provável |
|---|---|
| Aparece "Modo de demonstração" | o `firebase-config.js` ainda tem `COLOCA_AQUI` |
| "Email ou palavra-passe incorretos" | utilizador não criado no passo 3, ou palavra-passe errada |
| Erro de domínio ao entrar | falta adicionar o domínio no passo 3.4 |
| "Missing or insufficient permissions" | as regras não foram publicadas (passo 5), ou a conta não é membro (passo 6) |
| "A tua conta ainda não tem acesso" | falta o documento em `members/` (ou `admins/`) com o UID dessa pessoa (passo 6) |
| "Ainda não há preços" | falta correr o passo 7 |
| Não aparece a secção de administração | falta o documento em `admins/` com o UID certo (passo 6) |
