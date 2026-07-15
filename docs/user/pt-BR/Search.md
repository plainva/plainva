# Busca

Última revisão: 2026-07-15

O Plainva oferece três formas de buscar: busca de texto completo em todo o vault, o alternador rápido para abrir arquivos, e localizar e substituir dentro de uma nota.

## Busca de texto completo no vault

O campo de busca no topo da barra lateral busca em todo o vault — títulos *e* conteúdos. Ele é sustentado por um índice de texto completo local (SQLite FTS5) que é construído quando o vault abre e mantido atualizado a cada alteração; a busca, portanto, funciona offline e sem atraso perceptível.

A busca reage enquanto você digita: prefixos de palavra já encontram resultados ("Proj" encontra "Projeto plano") — sem precisar de Enter. O **X** à direita do campo limpa a busca atual (ou pressione `Esc`); a barra lateral volta então a mostrar a árvore de arquivos normal.

A lista de resultados mostra a contagem de ocorrências no topo e agrupa os resultados: primeiro os resultados de **Nome do arquivo** (o termo aparece no nome da nota), depois os de **Conteúdo**. Cada linha mostra o ícone do documento, o caminho da pasta e — para resultados de conteúdo — um trecho de texto com a correspondência destacada. Clicar em um resultado abre a nota e pula direto para a primeira ocorrência; ela fica selecionada ali. Se nada corresponder, a lista exibe **Nenhum resultado**.

O campo de busca também se aplica às outras visualizações da barra lateral: em **Tags** ele filtra a lista de tags, em **Favoritos** filtra os favoritos.

### Operadores de busca

- `"frase exata"` — aspas correspondem exatamente à sequência de palavras. Isso também funciona como busca por palavra inteira para um único termo: `"plano"` encontra "plano" mas não "planejamento".
- `-termo` — exclui notas que contenham o termo (também funciona com frases: `-"versão antiga"`).
- `path:pasta` — apenas arquivos cujo caminho contenha o texto (ex.: `path:Projetos`; com espaços: `path:"Minha Pasta"`).
- `tag:nome` — apenas notas com essa tag, incluindo tags aninhadas: `tag:projeto` também encontra `#projeto/interno`. `tag:#projeto` também funciona.
- Os operadores podem ser negados (`-path:Arquivo`, `-tag:concluido`) e combinados livremente com termos de busca: `plano tag:projeto -rascunho`.
- Vários termos são combinados com E. Caracteres especiais como `- ( ) : *` dentro dos termos são inofensivos — o Plainva trata a entrada literalmente.

## Alternador rápido

`Ctrl+O` ou `Ctrl+K` abre o alternador rápido: digite, navegue com as setas, abra com `Enter`. Sem digitação, ele mostra a lista de **Arquivos recentes** — a forma mais rápida de pular entre suas notas atuais. Os resultados também podem ser abertos diretamente em uma nova aba (o rodapé do diálogo mostra as teclas correspondentes).

A correspondência é aproximada (fuzzy): `prjplan` também encontra "Project Plan" — as letras só precisam aparecer na ordem certa, e o início das palavras conta mais. E quando a nota ainda não existe, a lista mostra **Criar '…'**: `Enter` a cria imediatamente (na raiz do vault) e a abre — digite um nome, pressione Enter e comece a escrever.

Abaixo dos resultados por nome, o alternador também mostra um grupo **Conteúdo**: notas cujo texto corresponde à sua entrada, com um trecho destacado da correspondência. Abrir um resultado desses pula direto para a correspondência dentro da nota — assim como na busca da barra lateral.

## Localizar e substituir dentro de uma nota

`Ctrl+F` abre a barra de busca do editor (na Visualização ao vivo e no modo de código-fonte):

- **Localizar** com `Enter`/**próximo** e **anterior** pelos resultados; **todos** destaca todas as ocorrências.
- Opções: **diferenciar maiúsculas**, **palavra inteira**, **regex**.
- **Substituir**: substituir resultados individuais (**substituir**) ou **substituir todos**.

### Em todo o vault

`Ctrl/Cmd+Shift+F` (ou **Localizar e substituir no vault** na paleta de comandos) busca em todas as notas de uma vez. Digite um termo, pressione **Localizar**, e as correspondências aparecem agrupadas por nota, cada uma com uma linha de contexto. Digite uma substituição, desmarque qualquer nota que você queira deixar de fora, e **Substituir em N notas** reescreve o restante — cada nota é gravada de volta com segurança (escrita atômica + um snapshot de versão), então uma pré-visualização desatualizada nunca pode sobrescrever conteúdo mais recente. Diferenciar maiúsculas, palavra inteira e regex também funcionam aqui; no modo regex, as referências retroativas `$1`/`$2` ficam disponíveis na substituição.

## Tags

A visualização da barra lateral **Tags** lista todas as `#tags` do vault com uma contagem de ocorrências; um clique mostra os **Arquivos com #tag**. As tags funcionam no texto (`#projeto`) e no frontmatter (`tags: [projeto]`). O campo de busca da barra lateral também filtra a lista de tags.

**Renomear uma tag** em todo o vault: clique com o botão direito em uma tag na visualização **Tags** e digite um novo nome. O Plainva reescreve a tag em todos os lugares — no corpo das notas (`#tag` e suas subtags `#tag/child`) e no frontmatter (`tags:`) — gravando de volta cada nota afetada pelo mesmo caminho seguro. Tags não relacionadas que apenas contêm o nome (por exemplo, `#area/tag`) permanecem intocadas.

## Navegando dentro de uma nota

A **Estrutura** na barra lateral direita lista todos os títulos da nota ativa — um clique pula até o ponto. Para pular entre notas, os **Backlinks** (quem faz link para cá) e os botões **Voltar**/**Avançar** do editor também ajudam.

## Veja também

- [Atalhos de Teclado](Keyboard_Shortcuts.md)
- [Bancos de Dados (.base)](Databases_Base.md) — consultas estruturadas sobre propriedades em vez de texto completo
