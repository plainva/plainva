# Grafo

Stand: 2026-07-14

O grafo do Plainva é uma ferramenta de trabalho, não um pôster: ele mostra onde você está, o que está conectado, o que está faltando — e você pode agir diretamente nele. Existe UM único motor de grafo com três formas de aparecer.

## Grafo de contexto (barra lateral direita)

Abra a seção **Grafo** na barra lateral direita. Ela mostra a nota ativa no centro, a estrutura de pastas acima, para visões gerais de pasta (index.md) as notas contidas abaixo, referências recebidas à esquerda e as enviadas à direita. Relações vindas de bancos de dados trazem o nome da propriedade como rótulo.

- Clicar em um nó abre a nota (o foco acompanha você).
- Ctrl/Cmd+clique abre em uma divisão, clique do meio em uma nova aba.
- Arraste um nó para outro lugar e ele fica fixado (um pontinho), lembrado por nota — reabra essa nota e seu layout está de volta. A nota ativa sempre permanece no centro. O **alfinete** no canto superior direito alterna entre lembrar e não lembrar as posições; desativá-lo descarta o layout lembrado desta nota.
- Abaixo, aparecem até três **sugestões**: notas que mencionam sua nota ativa (mas não a vinculam), costumam ser vinculadas junto com ela, compartilham uma vizinhança semelhante ou compartilham uma tag rara. Quando o título ocorre como texto na nota que está sendo editada, a sugestão mostra uma **prévia do trecho** que seria vinculado; **Vincular** transforma exatamente esse trecho em um link wiki (como `[[Alvo|texto]]` quando o texto visível difere do alvo). Se não houver um trecho correspondente, o link é adicionado ao final da nota (a prévia indica isso). **Descartar sugestão** memoriza sua decisão.

## Mapa do vault (aba própria)

Abra o mapa com **Ctrl/Cmd+Shift+G**, pelo ícone de grafo na **barra de ações** no canto esquerdo, ou pela paleta de comandos (**Abrir grafo**). Ele abre em sua própria aba. Em vez de um emaranhado, você vê a estrutura real de pastas como bolhas — duplo clique em uma bolha desdobra suas notas, **Recolher todas as pastas** volta ao estado anterior. O layout é determinístico: o mesmo mapa parece igual toda vez que você o abre. **Navegue pelo mapa** com o botão do meio do mouse ou Ctrl/Cmd+arrastar, e dê **zoom** com a roda do mouse. Arraste um nó e ele fica fixado (um pontinho). No canto superior direito, o **alfinete** alterna entre lembrar e não lembrar as posições: desative-o para descartar o layout lembrado deste mapa e voltar ao layout automático (o mesmo que **Redefinir layout** no menu de contexto). As fixações são armazenadas por dispositivo.

Ferramentas na barra superior:

- Estilos de aresta em um relance (legenda, no canto inferior esquerdo): **relações** são linhas de destaque sólidas com um rótulo, **links** são tracejados, **incorporações** são pontilhadas.
- **Buscar** esmaece tudo o que não corresponde. Filtre por **tipo** (OKF) e **tag**; os tipos de aresta (**Links**, **Relações**, **Incorporações**) são alternados individualmente.
- Notas de visão geral gerenciadas pelo Plainva (`index.md` e `log.md`) ficam ocultas por padrão — elas se vinculam a quase tudo e sobrecarregariam o grafo; isso também vale para o grafo de contexto e o grafo de banco de dados. No mapa do vault, você as recupera pelo botão **Filtros** com a caixa **Mostrar index.md**.
- **Focar na seleção** reduz o mapa a uma nota selecionada mais 1–3 saltos de vizinhança.
- **Mapa de calor** clareia as notas editadas recentemente (7/30/90 dias) — "no que eu estava trabalhando?"
- **Viagem no tempo** mostra as notas por sua data de criação; o controle deslizante reproduz o crescimento do seu vault. A data vem de uma propriedade `date`/`datum`, senão da data de criação do arquivo (uma aproximação para vaults somente na nuvem).

Trabalhando no mapa:

- Arraste um nó **sobre** outro: o Plainva propõe gravar um link de texto — ou diretamente uma **relação** correspondente dos seus bancos de dados (se a relação permitir exatamente uma entrada, o Plainva pergunta antes de substituir).
- Clique com o botão direito em um nó: Abrir, Espiar, Abrir na divisão, **Nova nota conectada**, Renomear (com atualização de links em todo o vault), Adicionar aos favoritos, Excluir.
- Clique com o botão direito em uma área vazia: **Nova nota**, Redefinir layout, **Exportar como PNG/SVG**.
- Clicar em um feixe de links entre pastas lista os links individuais; passar o mouse sobre um link mostra a frase em que ele aparece.
- **Arrastar em uma área vazia** desenha um retângulo de seleção e marca várias notas (Shift+arrastar estende uma seleção existente); arraste depois um dos nós marcados e todos se movem juntos. O rodapé permite adicionar aos favoritos ou excluir a seleção.

## Limpando

O botão **Limpar** abre uma lista de trabalho com três abas: **Órfãs** (notas sem conexões), **Links quebrados** (alvos que não existem — **Criar nota** os cria) e **Menções** (**Escanear o vault** encontra lugares em que uma nota é citada pelo nome mas não vinculada; **Vincular** transforma a ocorrência em um link wiki). O rodapé do mapa mostra a contagem de órfãs — clicar nele abre o painel.

## Grafo como visualização de banco de dados

Todo banco de dados `.base` pode ganhar uma visualização **Grafo** (adicionar visualização → **Grafo**): as linhas do banco de dados viram nós, suas **relações** viram arestas rotuladas. Na barra superior você escolhe as propriedades de aresta, **Cor por** uma propriedade de seleção, **Tamanho por** um número e se os **alvos externos** (relações que apontam para fora do banco de dados) ou **relações de entrada** (relações de outros bancos de dados que apontam para estas entradas — por exemplo, as tarefas de um projeto) aparecem. A visualização é salva de forma compatível com o Obsidian — o Obsidian mostra o mesmo arquivo como uma tabela.

## Limites

- O grafo mostra notas (arquivos), não parágrafos individuais.
- Fixações e sugestões descartadas ficam em `.plainva/` e não viajam com a sincronização — o layout base é idêntico em todos os dispositivos.
- As sugestões são análises puramente do vault; nada sai da sua máquina.
