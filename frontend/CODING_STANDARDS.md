# CODING_STANDARDS — frontend

Padrões para `frontend/` (React 19 + Vite + Tailwind 4 + react-router-dom 7
+ vitest/testing-library). Prescreve o padrão dominante do código real;
divergências estão marcadas como **legado**. Termos de domínio seguem o
glossário em `CONTEXT.md` na raiz.

## 1. Escopo

Aplica-se a `frontend/web/src` e `frontend/tests`. O frontend é um projeto
npm autônomo (fora dos workspaces da raiz) — rodar comandos dentro de
`frontend/`.

## 2. Comandos de verificação

| Comando | O quê |
|---|---|
| `npm run dev` | Vite |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint `strictTypeChecked` + react-hooks/react-refresh |
| `npm run test` | Vitest (jsdom) |

## 3. Estrutura e organização

```
web/src/
├── app/          # App.tsx (layout raiz), router.tsx (única fonte das rotas) e RequireAuth
├── pages/        # telas, sufixo Page (stubs/ para páginas em construção)
├── components/
│   ├── ui/       # genéricos reutilizáveis (Header, BackLink, CtaLink)
│   ├── auth/     # componentes de autenticação (AuthActions)
│   └── home/     # seções da landing, sufixo Section/Card/Boundary
├── hooks/        # hooks customizados useXxx (reservado — ainda vazio)
├── api/          # cliente REST auth+JWT (reservado — ainda vazio)
├── state/        # estado global e auth: AuthProvider, auth-context, useAuth, mock-auth
├── types/        # tipos compartilhados (reservado — ainda vazio)
├── game/         # render/animação do tabuleiro (assets/entities/scenes/systems/utils)
└── styles/       # global.css (@import "tailwindcss" + CSS custom properties)
tests/            # testes na pasta própria, não colocados junto ao código
```

- Respeitar as pastas reservadas do ADR-0001: fetch vai em `api/`, hooks em
  `hooks/`, tipos compartilhados em `types/`.
- Subcomponentes privados ficam no mesmo arquivo do componente pai,
  **sem export**.

## 4. Nomenclatura

- Componentes/páginas PascalCase com sufixo semântico: `HomePage`,
  `HeroSection`, `FeatureCard`, `ErrorBoundary`.
- Props como `interface XxxProps` declarada acima do componente.
- Hooks `useXxx`; variáveis/funções camelCase (`togglePlay`,
  `handleVideoKeyDown`).
- Estrutura técnica em inglês (`title`, `items`, `id`); conteúdo visível e
  nomes de domínio em português (`titulo`, `mensagens`). Não misturar os dois
  no mesmo objeto de dados (legado pontual em `placeholders.ts`).

## 5. Tipagem

- Tipos de dados locais junto dos dados (`export type Trailer = {...}`),
  props sempre tipadas — nunca `any`.
- O frontend hoje não consome `@flicker/shared` (legado): quando o cliente
  WebSocket entrar, decidir o consumo do protocolo tipado em ticket próprio;
  até lá, não duplicar tipos de protocolo à mão em mais de um arquivo.
- CSS variables via sintaxe moderna do Tailwind:
  `text-(--color-muted)` — não `bg-[var(--color-x)]` (legado pontual).

## 6. Erros, logs e assincronia

- Handlers de mídia/eventos usam `.then()/.catch()` encadeado com setState —
  padrão dominante atual; código novo com I/O real (fetch/WS) usa
  `async/await` + try/catch em `api/`/`hooks/`, propagando estado de erro
  para a tela.
- Erro de render em dois níveis: `ErrorBoundary` (classe, única exceção ao
  estilo funcional) envolvendo o Outlet → `ErrorPage` com mensagem; falha
  local troca o componente por placeholder com `role="status"`.
- Loading: `LoadingPage` como fallback de `<Suspense>`; estados de espera
  sempre com `role="status"` e `aria-label`.

## 7. Testes

- Vitest + jsdom + @testing-library/react; setup em `tests/setup.ts`;
  globais habilitados.
- Arquivos em `tests/*.test.tsx`; helper `renderWithRouter` com
  `createMemoryRouter(routes, { initialEntries })` reutilizando o array
  `routes` exportado de `app/router.tsx`.
- Queries por acessibilidade: `getByRole('heading', { name: ... })`,
  `within(section)`; interação com `userEvent.setup()`.
- Mocks com `vi.stubGlobal`/`vi.spyOn` e cleanup em `afterEach`.
- Viewports cobertos com `it.each` (375/768/1280px).

## 8. Segurança

- Nenhum segredo no código; quando existir config de build, usar
  `import.meta.env` com prefixo `VITE_` e listar em `.env.example`.
- Conteúdo externo renderizado sem `dangerouslySetInnerHTML`.

## 9. Evite

- `export default` de componente — named exports sempre.
- Múltiplos componentes exportados do mesmo arquivo (quebra
  `react-refresh/only-export-components`).
- `key={index}` em listas que mudam de ordem/tamanho.
- Classes Tailwind repetidas inline — extrair constante de módulo.
- `placeholders.ts` como arquivo-curinga: fixtures de marketing, labels de
  UI e dados de teste não crescem juntos; separar por responsabilidade.
- Suspense sem lazy loading correspondente.

## 10. Referências

- `CONTEXT.md` — glossário canônico de domínio.
- `docs/adr/0001` — estrutura de pastas e papel de cada diretório.
- `frontend/AGENTS.md` — docs de libs via Context7.
- `.opencode/skills/threejs-board-pieces/` — fluxo específico para peças do
  tabuleiro em Three.js.
