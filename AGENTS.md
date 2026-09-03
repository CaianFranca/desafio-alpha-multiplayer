## Agent skills

### Issue tracker

Issues e specs vivem no GitHub Issues deste repo, via CLI `gh`. Veja `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário de labels em português (5 estados + 2 categorias), mapeado para os papéis canônicos da triagem. Veja `docs/agents/triage-labels.md`.

### Domain docs

Layout single-context — `CONTEXT.md` + `docs/adr/` na raiz. Veja `docs/agents/domain.md`.

### Bug reports

Bug confirmado durante a sessão — erro reproduzível, teste falhando por causa
real, comportamento divergente com causa identificada — invoque a skill
`reportar-bug` (`.opencode/skills/reportar-bug/SKILL.md`): ela cria a issue e
a adiciona ao Project na coluna "Reports de Bug".

