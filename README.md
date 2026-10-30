# Receitas por orçamento

App que, dado um orçamento semanal, sugere refeições com base nos produtos e preços do Continente.
Corre toda no browser (GitHub Pages), com login e dados no Firebase, e instala-se no telemóvel como uma app.

```
docs/        a app (é o que o GitHub Pages publica)
tests-js/    testes do planeador e do estado do catálogo
firestore.rules   regras de segurança do Firestore
FIREBASE.md  guia passo a passo para criar o projeto Firebase
legacy/      o servidor antigo (FastAPI), só no teu PC: não vai para o GitHub
```

## Como funciona

| Peça | Onde |
|---|---|
| App (HTML, JavaScript, receitas) | GitHub Pages, repositório público |
| Login | Firebase Authentication (email e palavra-passe) |
| Plano guardado e preferências de cada pessoa | Firestore, `users/{uid}` |
| Preços do Continente | Firestore, `prices/continente`: só leem os membros (quem tem um documento em `members/` ou `admins/`) |
| Planeador | JavaScript, no browser (`docs/js/planner.js`) |
| Atualização dos preços | um script local, no teu PC (não faz parte deste repositório) |

Os preços nunca estão no repositório público. Os que estão em `docs/data/sample-prices.json` são inventados,
só servem para o modo de demonstração e para os testes.

## Começar

1. Cria o projeto Firebase e as regras com o guia **[FIREBASE.md](FIREBASE.md)**.
2. Cola a configuração do Firebase em `docs/js/firebase-config.js`.
3. Publica os preços no Firestore (secção abaixo).
4. Publica a app no GitHub Pages (secção abaixo).

Enquanto o `firebase-config.js` tiver `COLOCA_AQUI`, a app corre em **modo de demonstração**: qualquer email entra,
os dados ficam só no dispositivo e os preços são os de exemplo. Serve para ver a app sem Firebase.

### Ver a app no PC

```powershell
.venv\Scripts\python.exe -m http.server 8000 --directory docs
```

Abre http://localhost:8000. (No VS Code/Claude, o `.claude/launch.json` já tem esta configuração.)

## Funcionalidades

- **Plano por orçamento:** escolhe refeições dentro do orçamento, a variar entre carne e peixe (o livro de receitas só tem pratos de carne e de peixe), com custo calculado em embalagens inteiras.
- **Lista de compras com caixas:** marcas o que já pões no carrinho, tocando na linha. As marcas ficam no dispositivo e valem enquanto o plano for o mesmo. Vem agrupada pela **secção do supermercado**: frescos primeiro e congelados no fim.
- **Já tenho em casa:** o que marcares não entra no custo nem na lista. O **alho** vem marcado por defeito. Fica guardado por utilizador.
- **Evitar:** glúten, lactose, peixe ou ovos (indicativo: confirma sempre nos rótulos; `docs/data/ingredients.json`).
- **Trocar:** o ícone da roda, em cada refeição, troca só essa refeição por outra, dentro do orçamento, e a nova fica no mesmo lugar. *Sugerir plano* gera sempre um plano novo.
- **Plano guardado:** cada utilizador tem só o último plano; um novo substitui o anterior. *Mostrar plano* volta a mostrá-lo, em qualquer dispositivo.
- **Sem rede:** a app, as receitas e os últimos preços ficam guardados no dispositivo, por isso abre, mostra o plano e até gera planos novos sem ligação (o SDK do Firebase também fica guardado).
- **Ingredientes e calorias:** cada refeição mostra os ingredientes para o número de pessoas escolhido e uma estimativa de calorias por pessoa, calculadas ao mostrar (por isso aparecem também em planos guardados antes). É só uma estimativa: usa valores aproximados por 100 g de `docs/data/ingredients.json` (campo `kcal`) e não conta azeite, sal nem pimenta. Ao acrescentar um ingrediente novo, junta-lhe o `kcal` (e o `unit_g` se for contado à unidade); um teste avisa se faltar.
- **Listas guardadas:** podes guardar até 5 planos, cada um com o seu nome e a lista de compras, abri-los mais tarde (também sem rede, no supermercado) e apagá-los. Guardam-se por utilizador. O "último plano" continua a existir à parte, em *Mostrar plano*.
- **Favoritos:** uma vista com as receitas que marcaste como favoritas, com ingredientes (para o número de pessoas do formulário), calorias e passos.
- **Mais variedade:** com a opção ligada (é o normal), o plano sorteia entre as receitas quase tão baratas como a melhor, em vez de escolher sempre as mesmas. Pode custar um pouco mais, sempre dentro do orçamento.
- **Favoritas e "nunca mais sugerir":** dentro de cada refeição marcas uma receita como favorita (sai mais vezes) ou rejeitas-a (não volta a sair e é trocada logo). As listas ficam em Preferências, onde se desfaz. Ficam guardadas por utilizador.
- **Meta de calorias:** em Preferências indicas uma meta por refeição e por pessoa (200 a 3000 kcal). O plano mostra a média e se fica perto, acima ou abaixo da meta (margem de 15 %).
- **Temas:** o botão da paleta, no topo, escolhe entre *Automático* (segue o tema do telemóvel), *Fresco* (claro), *Sóbrio* (escuro) e *Mercado* (papel e talão). A escolha fica no dispositivo. Cada tema é um bloco de cores em `docs/style.css`; para criar outro, copia um bloco e acrescenta-o em `docs/js/theme.js`. Um teste confirma o contraste das cores (WCAG).
- **Administração (só admin):** estado do catálogo (ingredientes sem produtos, receitas indisponíveis, links que falharam).

### O que mudou em relação ao servidor antigo
Já não há servidor, por isso: os utilizadores gerem-se na consola do Firebase, e os preços atualizam-se
por um script local no PC (já não há botão na app). O limite de tentativas de login passa a ser o do próprio Firebase.

## Publicar os preços

Os preços ficam no documento `prices/continente` do Firestore (formato em FIREBASE.md). Quem os escreve é um
script local, que corre no teu PC com a chave da conta de serviço do Firebase e que não faz parte deste repositório.
A app só os lê, e só depois de iniciares sessão. Para adicionar um ingrediente novo, junta o nome e os alergénios em
`docs/data/ingredients.json`.

## Publicar a app no GitHub Pages

1. No GitHub, cria um repositório **público** e vazio.
2. Na pasta do projeto:

```powershell
git init -b main
git add .
git status          # confirma que NÃO aparecem legacy/, .venv/ nem ficheiros de chave
git commit -m "Receitas por orçamento"
git remote add origin https://github.com/O-TEU-UTILIZADOR/O-TEU-REPOSITORIO.git
git push -u origin main
```

3. No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/docs`.
4. Passado um minuto a app está em `https://O-TEU-UTILIZADOR.github.io/O-TEU-REPOSITORIO/`.
5. Adiciona esse domínio aos **Domínios autorizados** do Firebase (FIREBASE.md, passo 3.4).

No telemóvel, abre esse endereço no Chrome e escolhe **Instalar app**.

Nunca coloques no repositório a chave da conta de serviço (`*-firebase-adminsdk-*.json`). O `.gitignore` já a exclui.

## Testes

```powershell
node --test tests-js/    # planeador, estado do catálogo, temas e contraste das cores
```

O que **não** está testado automaticamente: a ligação ao Firebase (login e Firestore) e as regras de segurança.
Testa as regras no Simulador do Firebase (FIREBASE.md, passo 5).

## Estrutura de `docs/`

- `js/planner.js`: o planeador. `js/nutrition.js`: calorias e ingredientes por refeição. `js/status.js`: estado do catálogo. `js/backend.js`: Firebase / demonstração / sem rede.
- `js/app.js`: a interface. `js/theme.js`: temas e o menu para os escolher. `js/firebase-config.js`: a tua configuração do Firebase.
- `data/`: receitas e ingredientes (com alergénios), mais os preços de exemplo.
- `sw.js`: service worker (abrir sem rede). `manifest.webmanifest` e `icons/`: instalação no telemóvel.
