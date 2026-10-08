# Scripts (Beta)

Última revisão: 2026-10-08

Um script é um pequeno programa para aquilo que um modelo faz mal e um programa faz sempre do mesmo jeito: contar, ordenar, comparar, somar. Você o escreve em JavaScript. Ele roda em uma caixa fechada dentro do Plainva: não consegue abrir um arquivo, alcançar a rede nem esperar até mais tarde. Ele só chama as ferramentas que você marcou para ele: elas leem o seu vault do mesmo jeito que as ferramentas da IA, ou deixam uma sugestão sobre a qual você decide. Um script não altera nada por conta própria.

## Executar um script

Seus scripts ficam na aba de IA, em **Habilidades** (no celular, em **Conversas → Habilidades**), no grupo **Scripts**. **Executar** abre o script: preencha o que ele pede e pressione **Executar**. Enquanto ele roda, você vê cada ferramenta que ele chama, e **Parar** o encerra. Depois, o diálogo mostra as **Chamadas**, o **Resultado** — que você pode copiar — e o **Registro**, e também quanto a execução usou dos limites do script.

Uma execução que você inicia aqui fica neste dispositivo: nada dela vai para um modelo, por isso ela também lê notas que você mantém fora da nuvem. **Execução de teste** chama as ferramentas que leem e só anota uma chamada que mostraria algo no app ou deixaria uma sugestão.

## Em uma conversa

Em uma conversa comum, a IA pode encontrar os seus scripts ativos e executar um quando faz sentido; nesse caso, a etapa aparece como **Executando o script “word-count”**. O script lê apenas o que essa conversa pode ler: uma nota que você mantém fora da nuvem permanece fora, e cada nota que o script lê conta entre as que a execução leu. O que ele devolve vai para o modelo como dados, nunca como instruções. Nenhum script é oferecido a uma conversa iniciada por uma habilidade, nem a um app de IA conectado pelo servidor MCP.

## Sugerir alterações

Um script também pode receber ferramentas que sugerem. As ferramentas **Sugerindo alterações em uma nota** e **Sugerindo um valor de propriedade** deixam uma sugestão na margem de uma nota; as ferramentas **Preparando o rascunho de uma nota**, **Preparando o rascunho de uma entrada de banco de dados**, **Preparando o rascunho de uma tarefa** e **Preparando o rascunho de uma entrada de diário** deixam um rascunho. Ambos são assinados com o nome do script, e nada no seu vault muda antes de você aceitar uma sugestão ou criar um rascunho — exatamente como acontece com uma sugestão da IA. Depois de uma execução, o diálogo os lista em **Sugestões e rascunhos**; uma execução iniciada com **Execução de teste** não deixa nada.

O que um script leu decide onde ele pode escrever: uma sugestão ou um rascunho que se baseia em uma nota que você mantém fora da nuvem só pode ficar em um lugar onde vale a mesma regra. Em uma conversa, um script que sugere só é oferecido à IA quando a própria conversa pode sugerir, e o que o script deixa ali leva o nome do modelo da conversa.

## Escrever um script

**Novo script** pede:

- **Nome** — letras minúsculas, algarismos e hífens; ele também é o nome da pasta.
- **Descrição** — para que o script serve; é por ela que você e a IA o reconhecem.
- **Ferramentas** — marque o que o script pode chamar: em **Ler** o que lê, em **Sugerir** o que deixa uma sugestão ou um rascunho. Nada além disso existe para ele.
- **Entradas** — o que o script pede ao iniciar: um nome, se é texto, número ou “sim ou não”, e se é obrigatório.
- **Limites** — segundos de cálculo, chamadas de ferramentas e memória.
- **Código** — o programa.

**Criar e aprovar** grava o script no seu vault como `.agent/scripts/<name>/` — um `manifest.json` e um `main.js` — e o aprova neste dispositivo. **Editar**, no menu de um script, abre o mesmo formulário; **Salvar e aprovar** substitui os arquivos.

O código é o corpo de uma função. `input` traz as entradas pelo nome, `tools.<name>(…)` chama uma ferramenta e é aguardado, `return` devolve o resultado e `console.log(…)` escreve uma linha no registro:

```js
const found = await tools.search_vault({ query: "#" + input.tag, limit: 25 });
const notes = [];
for (const hit of found.results) {
  const note = await tools.read_note({ path: hit.path });
  if (note.text.includes("#" + input.tag)) notes.push(hit.path);
}
return { tag: input.tag, count: notes.length, notes };
```

A linguagem é JavaScript na versão ES2020. Não existe `fetch`, nem temporizador, nem `import`, nem acesso a arquivos, e um script só pode devolver dados que possam ser escritos como JSON. Uma ferramenta que recusa — por causa de uma nota que não existe ou de uma nota que a conversa não pode ler — lança um erro que o script pode capturar.

## O que uma ferramenta retorna

**O que uma ferramenta retorna**, no formulário, abre esta página. Toda ferramenta recebe um objeto e devolve um; `cursor` recebe o `next` da chamada anterior e continua a lista dela.

| Ferramenta | Você passa | Você recebe |
|---|---|---|
| `search_vault` — **Pesquisando no vault** | `query`; opcionais: `folder`, `limit` (até 25), `cursor` | `results`: uma lista de `{ title, path, snippet }`; `next` |
| `read_note` — **Lendo uma nota** | `path`; opcionais: `section`, `maxChars` (200 a 20.000), `cursor` | `path`, `text`, `next` |
| `get_outline` — **Lendo a estrutura** | `path` | `path`; `properties`: nome e valor; `sections`: uma lista de `{ level, text, section }` |
| `query_base` — **Lendo um banco de dados** | `base`, o caminho do arquivo `.base`; opcionais: `view`, `limit` (até 50), `cursor` | `base`, `view`, `views`; `rows`: uma lista de `{ title, path, properties }`; `next` |
| `get_tasks` — **Lendo tarefas** | opcionais: `range` (`today`, `upcoming`, `overdue`, `inbox`, `all`, `done`), `limit` (até 50), `cursor` | `tasks`: uma lista de `{ state, title, due, priority, path, note, source }`; `next` |
| `get_backlinks` — **Lendo backlinks** | `path`; opcionais: `limit` (até 50), `cursor` | `path`; `notes`: uma lista de `{ title, path, links, places }`; `next` |
| `graph_neighborhood` — **Seguindo links** | `path`; opcionais: `depth` (1 ou 2), `limit` (até 50) | `path`; `notes`: uma lista de `{ title, path, fromHere, toHere, via }` |
| `get_recent` — **Olhando notas recentes** | opcionais: `kind` (`opened` ou `edited`), `limit` (até 20) | `kind`; `notes`: uma lista de `{ title, path, at }` |
| `get_calendar` — **Lendo compromissos** | `from` e `to` como `YYYY-MM-DD`; opcionais: `details`, `limit` (até 100) | `events`: uma lista de `{ day, start, end, allDay, title, cancelled, place, with, others, online, event }`; `more` |
| `run_command` — **Usando o aplicativo** | `id`, um comando do app como `open-note`, `show-in-graph` ou `open-calendar`; opcional: `args` com `path`, `section` ou `date` | `done`, `command` |
| `propose_edit` — **Sugerindo alterações em uma nota** | `path`; `edits`, uma lista de `{ find, replace }`, ou `append`; opcionais: `section`, `note` | `proposed`, `path`, `passages` |
| `set_property` — **Sugerindo um valor de propriedade** | `path`, `key`, `value`; opcional: `note` | `proposed`, `path`, `property` |
| `create_note` — **Preparando o rascunho de uma nota** | `title`, `content`; opcional: `folder` | `drafted`, `kind`, `title` |
| `create_entry` — **Preparando o rascunho de uma entrada de banco de dados** | `base`, `title`; opcionais: `properties`, `content` | `drafted`, `kind`, `title`, `base` |
| `create_task` — **Preparando o rascunho de uma tarefa** | `text` | `drafted`, `kind`, `title` |
| `add_journal_entry` — **Preparando o rascunho de uma entrada de diário** | `text`; opcional: `task` | `drafted`, `kind` |

## Limites

Um script traz os limites no manifesto dele. O formulário define três deles:

| Limite | Padrão | Intervalo |
|---|---|---|
| **Segundos de cálculo** | 5 | 1 a 30 |
| **Chamadas de ferramentas** | 20 | 0 a 50 |
| **Memória em MB** | 32 | 8 a 128 |

Só conta o tempo em que um script calcula, não o tempo que uma ferramenta leva. Um script que ultrapassa um limite é encerrado, o diálogo diz qual limite foi, e um script encerrado não devolve nada. Os argumentos de uma chamada e o resultado podem ter, cada um, no máximo 64 KB.

## Nada roda antes da sua aprovação

Um script novo ou alterado — que chegou pela sincronização ou foi escrito por outro programa — só roda quando você o aprova **neste dispositivo**. Ele aguarda no topo de **Habilidades**, em **Aguardando sua aprovação**. **Revisar e aprovar** mostra **O que ele pode fazer**, os **Limites**, a **Entrada** e todo o **Código** do script, e diz se o código pode ser lido como JavaScript; um código que não pode ser lido não é aprovado.

Com **Aprovar**, este dispositivo assina exatamente estes arquivos. A chave para isso é criada neste dispositivo e fica no chaveiro dele. Qualquer alteração em um arquivo anula a aprovação, e em cada um dos seus outros dispositivos o script espera por uma aprovação própria — uma aprovação não pode ser levada de um dispositivo para outro. **Retirar aprovação**, no menu de um script, a desfaz, e **Ver o código** mostra a revisão de novo.

## Limites da beta

Um script sugere e deixa rascunhos; ele nunca renomeia, move nem exclui uma nota, e não escreve nenhum e-mail nem nenhum compromisso. Uma habilidade não pode iniciar um script, e a pasta `scripts/` de uma habilidade não é executada. O e-mail, a internet e as ferramentas de servidores externos não estão disponíveis para scripts.
