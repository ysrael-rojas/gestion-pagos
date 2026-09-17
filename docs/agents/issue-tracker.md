# Issue tracker: GitHub

Los issues y las especificaciones de este repo viven como issues de GitHub. Usa el CLI `gh` para todas las operaciones.

## Convenciones

- **Crear un issue**: `gh issue create --title "..." --body "..."`. Usa un heredoc para cuerpos multilínea.
- **Leer un issue**: `gh issue view <number> --comments`, filtrando comentarios con `jq` y trayendo también los labels.
- **Listar issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` con los filtros `--label` y `--state` que correspondan.
- **Comentar un issue**: `gh issue comment <number> --body "..."`
- **Aplicar / quitar labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Cerrar**: `gh issue close <number> --comment "..."`

Infiere el repo desde `git remote -v`; `gh` lo hace automáticamente cuando se ejecuta dentro de un clon.

## Pull requests como superficie de triage

**PRs como superficie de solicitudes: no.** _(Ponlo en `yes` si este repo trata los PRs externos como feature requests; `/triage` lee esta bandera.)_

Cuando está en `yes`, los PRs pasan por los mismos labels y estados que los issues, usando los equivalentes de `gh pr`:

- **Leer un PR**: `gh pr view <number> --comments` y `gh pr diff <number>` para el diff.
- **Listar PRs externos para triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` y conserva solo `authorAssociation` de `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` o `NONE` (descarta `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comentar / etiquetar / cerrar**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub comparte un único espacio de numeración entre issues y PRs, así que un `#42` pelado puede ser cualquiera de los dos: resuélvelo con `gh pr view 42` y cae a `gh issue view 42`.

## Cuando una skill dice "publicar en el issue tracker"

Crea un issue de GitHub.

## Cuando una skill dice "traer el ticket relevante"

Ejecuta `gh issue view <number> --comments`.

## Operaciones de wayfinding

Las usa `/wayfinder`. El **mapa** es un único issue con **issues hijos** como tickets.

- **Mapa**: un único issue etiquetado `wayfinder:map`, que contiene el cuerpo con Notes / Decisions-so-far / Fog. `gh issue create --label wayfinder:map`.
- **Ticket hijo**: un issue enlazado al mapa como sub-issue de GitHub (`gh api` sobre el endpoint de sub-issues). Donde los sub-issues no estén habilitados, agrega el hijo a una lista de tareas en el cuerpo del mapa y pon `Part of #<map>` al inicio del cuerpo del hijo. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Una vez reclamado, el ticket se asigna al dev que lo conduce.
- **Bloqueos**: las **dependencias nativas de issues** de GitHub, la representación canónica y visible en la UI. Agrega una arista con `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, donde `<blocker-db-id>` es el **database id** numérico del bloqueador (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _no_ el `#number` ni el `node_id`). GitHub reporta `issue_dependencies_summary.blocked_by` (solo bloqueadores abiertos, la compuerta viva). Donde las dependencias no estén disponibles, cae a una línea `Blocked by: #<n>, #<n>` al inicio del cuerpo del hijo. Un ticket está desbloqueado cuando todos sus bloqueadores están cerrados.
- **Consulta de frontera**: lista los hijos abiertos del mapa (`gh issue list --state open`, acotado a los sub-issues / lista de tareas del mapa), descarta cualquiera con un bloqueador abierto (`issue_dependencies_summary.blocked_by > 0`, o un issue abierto en la línea `Blocked by`) o con un assignee; gana el primero en el orden del mapa.
- **Reclamar**: `gh issue edit <n> --add-assignee @me`, la primera escritura de la sesión.
- **Resolver**: `gh issue comment <n> --body "<answer>"`, luego `gh issue close <n>`, luego agrega un puntero de contexto (gist + link) al Decisions-so-far del mapa.
