import { DEFAULT_DAILY_NOTE_TYPE } from "../../contexts/VaultContext";
import { welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";

/** Brazilian Portuguese template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    {
      id: "para",
      name: "PARA",
      description: "Projetos, Áreas, Recursos, Arquivo — organizados por grau de ação (Tiago Forte).",
      folders: ["Projetos", "Tarefas", "Áreas", "Recursos", "Arquivo", "Modelos"],
      bases: [
        defineBase({
          path: "Projetos.base",
          sourceFolder: "Projetos",
          columns: [
            { key: "status", input: "status", options: ["Planejado", "Ativo", "Aguardando", "Concluído"] },
            { key: "area", input: "relation", relationBase: "Áreas.base", relationLimit: "one" },
            { key: "prazo", input: "date" },
            { key: "tarefas", reverseOf: { base: "Tarefas.base", property: "projeto" } },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Por status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Modelos/Projeto.md",
        }),
        defineBase({
          path: "Tarefas.base",
          sourceFolder: "Tarefas",
          columns: [
            { key: "status", input: "status", options: ["A fazer", "Em andamento", "Concluída"] },
            { key: "projeto", input: "relation", relationBase: "Projetos.base", relationLimit: "one" },
            { key: "prazo", input: "date" },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Por status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Modelos/Tarefa.md",
        }),
        defineBase({
          path: "Áreas.base",
          sourceFolder: "Áreas",
          columns: [{ key: "projetos", reverseOf: { base: "Projetos.base", property: "area" } }],
          views: [{ name: "Tabela", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Bem-vindo.md",
          description: "Ponto de partida e guia rápido para este vault.",
          body: welcomeBody(
            "Bem-vindo",
            "Este vault é organizado com o método PARA (Tiago Forte): o conteúdo é organizado por grau de ação, não por assunto.",
            [
              { name: "Projetos", description: "Iniciativas com um objetivo claro e uma data de término (Projetos.base)." },
              { name: "Tarefas", description: "Próximos passos individuais — cada um aponta para seu projeto (Tarefas.base)." },
              { name: "Áreas", description: "Responsabilidades contínuas, sem data de término." },
              { name: "Recursos", description: "Temas, material e referências que vale a pena guardar." },
              { name: "Arquivo", description: "Itens concluídos ou inativos vindos das outras pastas." },
            ],
            "Abra as bases de dados Projetos.base, Tarefas.base e Áreas.base para ver os projetos por status, atribuir tarefas a eles e vinculá-los às suas áreas — o que já foi concluído vai para o Arquivo, enquanto os links e as visões gerais em index.md são mantidos automaticamente."
          ),
        },
        {
          path: "Projetos/Exemplo de projeto.md",
          description: "Um exemplo de nota de projeto.",
          properties: { status: "Ativo", area: "[[Exemplo de área]]" },
          body: "# Exemplo de projeto\n\nUm projeto tem um objetivo claro e um fim previsível. Registre aqui o propósito, os próximos passos e os resultados.\n\n- [ ] Anotar o objetivo do projeto\n- [ ] Definir o próximo passo\n",
        },
        {
          path: "Tarefas/Exemplo de tarefa.md",
          description: "Um exemplo de tarefa vinculada ao seu projeto.",
          properties: { status: "A fazer", projeto: "[[Exemplo de projeto]]" },
          body: "# Exemplo de tarefa\n\nUma tarefa é um único próximo passo concreto. Por meio da propriedade Projeto ela pertence ao Exemplo de projeto.\n",
        },
        {
          path: "Áreas/Exemplo de área.md",
          description: "Um exemplo de área de responsabilidade.",
          body: "# Exemplo de área\n\nUma área é uma responsabilidade contínua sem data de término — por exemplo \"Saúde\" ou \"Finanças\". Os projetos se vinculam a ela por meio da propriedade Área.\n",
        },
        {
          path: "Modelos/Projeto.md",
          properties: { status: "Planejado" },
          body: "# {{title}}\n\n## Objetivo\n\n## Próximos passos\n\n- [ ] \n",
        },
        {
          path: "Modelos/Tarefa.md",
          properties: { status: "A fazer" },
          body: "# {{title}}\n\n## Notas\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Modelos" },
    },
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Uma ideia por nota, densamente conectada — notas fugazes, de literatura e permanentes (Luhmann).",
      folders: ["Notas Fugazes", "Notas de Literatura", "Notas Permanentes", "Modelos"],
      bases: [
        defineBase({
          path: "Literatura.base",
          sourceFolder: "Notas de Literatura",
          columns: [
            { key: "autor", input: "text" },
            { key: "ano", input: "number" },
            { key: "tipo", input: "select", options: ["Livro", "Artigo", "Vídeo", "Podcast", "Site"] },
            { key: "status", input: "status", options: ["A ler", "Lido", "Processado"] },
            { key: "url", input: "url" },
            { key: "notas", reverseOf: { base: "Notas.base", property: "fonte" } },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Por status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Modelos/Nota de literatura.md",
        }),
        defineBase({
          path: "Notas.base",
          sourceFolder: "Notas Permanentes",
          columns: [{ key: "fonte", input: "relation", relationBase: "Literatura.base" }],
          views: [{ name: "Tabela", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Bem-vindo.md",
          description: "Ponto de partida e guia rápido para este vault.",
          body: welcomeBody(
            "Bem-vindo",
            "Este vault segue o método Zettelkasten (Niklas Luhmann): uma ideia por nota — as conexões nascem de links, não de hierarquias de pastas.",
            [
              { name: "Notas Fugazes", description: "Pensamentos rápidos e crus — passageiros, processados depois." },
              { name: "Notas de Literatura", description: "Resumos do que você leu, com suas próprias palavras, com a fonte." },
              { name: "Notas Permanentes", description: "Ideias bem formuladas e duradouras — uma por nota, muito interligadas." },
            ],
            "Use a Literatura.base para acompanhar suas fontes pelo status de leitura; a Notas.base conecta as notas permanentes à literatura de que vieram por meio da propriedade Fonte."
          ),
        },
        {
          path: "Notas Permanentes/Nota de exemplo.md",
          description: "Um exemplo de nota permanente.",
          properties: { fonte: ["[[Nota de literatura de exemplo]]"] },
          body: "# Nota de exemplo\n\nUma nota permanente contém exatamente uma ideia, escrita em frases completas e com suas próprias palavras.\n\nConecte notas relacionadas diretamente no texto — é assim que a rede de ideias cresce.\n",
        },
        {
          path: "Notas de Literatura/Nota de literatura de exemplo.md",
          description: "Um exemplo de nota de literatura.",
          properties: { autor: "Niklas Luhmann", ano: 1992, tipo: "Livro", status: "Lido" },
          body: "# Nota de literatura de exemplo\n\nResuma com suas próprias palavras o que você leu e registre a fonte. As notas permanentes apontam de volta para esta nota de literatura por meio da propriedade Fonte.\n",
        },
        {
          path: "Modelos/Nota de literatura.md",
          properties: { status: "A ler" },
          body: "# {{title}}\n\n## Resumo\n\n## Fonte\n",
        },
      ],
      settings: { templateFolder: "Modelos" },
    },
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Calendário e Empenhos — trabalho de conhecimento centrado em MOCs, segundo Nick Milo.",
      folders: ["Atlas", "Calendário", "Empenhos"],
      notes: [
        {
          path: "Bem-vindo.md",
          description: "Ponto de partida e guia rápido para este vault.",
          body: welcomeBody(
            "Bem-vindo",
            "Este vault usa o esquema ACE de \"Linking Your Thinking\" (Nick Milo): o conhecimento é conectado por Maps of Content (MOCs) em vez de um aninhamento profundo.",
            [
              { name: "Atlas", description: "Mapas do seu conhecimento — MOCs e notas de visão geral." },
              { name: "Calendário", description: "Notas ligadas ao tempo — notas diárias, diários, retrospectivas." },
              { name: "Empenhos", description: "Tudo aquilo em que você está trabalhando ativamente." },
            ],
            "Comece no Atlas com a nota Home e conecte-se ao seu conhecimento a partir dali."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Seu Map of Content de nível mais alto.",
          body: "# Home\n\nA nota Home é seu ponto de entrada: conecte aqui os Maps of Content mais importantes e os empenhos atuais.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Áreas e categorias numeradas (10-19 / 11 / 11.01) para uma localização estrita.",
      folders: [
        "00-09 Sistema",
        "00-09 Sistema/00 Índice",
        "10-19 Pessoal",
        "10-19 Pessoal/11 Finanças",
        "10-19 Pessoal/12 Saúde",
        "20-29 Trabalho",
        "20-29 Trabalho/21 Projetos",
        "20-29 Trabalho/22 Reuniões",
      ],
      notes: [
        {
          path: "Bem-vindo.md",
          description: "Ponto de partida e guia rápido para este vault.",
          body: welcomeBody(
            "Bem-vindo",
            "Este vault é organizado com o Johnny.Decimal: no máximo dez áreas (10-19, 20-29, …), no máximo dez categorias por área (11, 12, …) — e cada nota recebe um ID como 11.01.",
            [
              { name: "00-09 Sistema", description: "Gerenciamento do próprio sistema — índice e convenções." },
              { name: "10-19 Pessoal", description: "Área de exemplo para temas pessoais." },
              { name: "20-29 Trabalho", description: "Área de exemplo para temas de trabalho." },
            ],
            "Renomeie áreas e categorias para combinar com seus temas — a profundidade deliberadamente limitada (área → categoria → ID) é o cerne do método."
          ),
        },
        {
          path: "00-09 Sistema/00 Índice/00.00 Índice.md",
          description: "O índice Johnny.Decimal: todos os números em um só lugar.",
          body: "# 00.00 Índice\n\nMantenha aqui a lista de todas as áreas, categorias e IDs. Quem procura um número consulta esta nota primeiro.\n\n## 10-19 Pessoal\n\n- 11 Finanças\n- 12 Saúde\n\n## 20-29 Trabalho\n\n- 21 Projetos\n- 22 Reuniões\n",
        },
      ],
    },
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — Caixa de Entrada, Tarefas, Projetos, Referência e listas Algum Dia.",
      folders: ["Caixa de Entrada", "Tarefas", "Projetos", "Referência", "Algum Dia", "Modelos"],
      bases: [
        defineBase({
          path: "Tarefas.base",
          sourceFolder: "Tarefas",
          columns: [
            { key: "status", input: "status", options: ["Caixa de Entrada", "Próxima", "Aguardando", "Algum Dia", "Concluída"] },
            { key: "contexto", input: "select", options: ["@Casa", "@Trabalho", "@Recados", "@Telefone"] },
            { key: "projeto", input: "relation", relationBase: "Projetos.base", relationLimit: "one" },
            { key: "prazo", input: "date" },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Por status", type: "board", groupBy: "status" },
            { name: "Por contexto", type: "board", groupBy: "contexto" },
          ],
          newItemTemplate: "Modelos/Tarefa.md",
        }),
        defineBase({
          path: "Projetos.base",
          sourceFolder: "Projetos",
          columns: [
            { key: "status", input: "status", options: ["Ativo", "Aguardando", "Algum Dia", "Concluído"] },
            { key: "tarefas", reverseOf: { base: "Tarefas.base", property: "projeto" } },
          ],
          views: [
            { name: "Tabela", type: "table" },
            { name: "Por status", type: "board", groupBy: "status" },
          ],
          newItemTemplate: "Modelos/Projeto.md",
        }),
      ],
      notes: [
        {
          path: "Bem-vindo.md",
          description: "Ponto de partida e guia rápido para este vault.",
          body: welcomeBody(
            "Bem-vindo",
            "Este vault segue o Getting Things Done (David Allen): tudo cai primeiro na Caixa de Entrada e a partir dali é processado em tarefas e projetos concretos.",
            [
              { name: "Caixa de Entrada", description: "Ponto de coleta de tudo o que é novo — esvazie-a regularmente." },
              { name: "Tarefas", description: "Próximas ações individuais — organizadas por status e contexto (Tarefas.base)." },
              { name: "Projetos", description: "Tudo o que precisa de mais de um passo (Projetos.base)." },
              { name: "Referência", description: "Material de consulta sem necessidade de ação." },
              { name: "Algum Dia", description: "Ideias e planos para fazer mais tarde, talvez." },
            ],
            "Na Tarefas.base você atribui cada tarefa a um projeto por meio da propriedade Projeto; a Projetos.base então mostra automaticamente o que pertence a cada projeto na coluna Tarefas. A revisão semanal mantém o sistema confiável."
          ),
        },
        {
          path: "Revisão Semanal.md",
          description: "Checklist para a revisão semanal do GTD.",
          body: "# Revisão Semanal\n\n- [ ] Zerar a caixa de entrada\n- [ ] Percorrer a lista de projetos e verificar as próximas ações\n- [ ] Passar os olhos na lista Algum Dia\n- [ ] Olhar o calendário das próximas duas semanas\n",
        },
        {
          path: "Projetos/Exemplo de projeto.md",
          description: "Um exemplo de nota de projeto GTD.",
          properties: { status: "Ativo" },
          body: "# Exemplo de projeto\n\nResultado desejado: qual é a cara do \"concluído\"?\n\nPróxima ação:\n\n- [ ] Anotar o único próximo passo concreto\n",
        },
        {
          path: "Tarefas/Exemplo de tarefa.md",
          description: "Um exemplo de tarefa vinculada a um projeto.",
          properties: { status: "Próxima", contexto: "@Trabalho", projeto: "[[Exemplo de projeto]]" },
          body: "# Exemplo de tarefa\n\nUma tarefa é uma próxima ação individual e concreta. Por meio da propriedade Projeto ela pertence ao Exemplo de projeto.\n",
        },
        {
          path: "Tarefas/Coletar ideias.md",
          description: "Um exemplo de item recém-chegado à caixa de entrada.",
          properties: { status: "Caixa de Entrada" },
          body: "# Coletar ideias\n\nAcabou de cair na caixa de entrada e ainda não foi processado. Na próxima revisão esta tarefa ganha um contexto e um projeto.\n",
        },
        {
          path: "Modelos/Tarefa.md",
          properties: { status: "Caixa de Entrada" },
          body: "# {{title}}\n\n## Notas\n\n- [ ] \n",
        },
        {
          path: "Modelos/Projeto.md",
          properties: { status: "Ativo" },
          body: "# {{title}}\n\n## Resultado desejado\n\n## Próximos passos\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Modelos" },
    },
    {
      id: "journal",
      name: "Journal",
      description: "Notas diárias com um modelo pronto e uma base de dados de diário — as notas diárias já vêm configuradas.",
      folders: ["Journal", "Modelos"],
      bases: [
        defineBase({
          path: "Journal.base",
          sourceFolder: "Journal",
          columns: [
            { key: "data", input: "date" },
            { key: "humor", input: "select", options: ["Bom", "Neutro", "Ruim", "Produtivo", "Cansado"] },
            { key: "palavras-chave", input: "tags" },
          ],
          views: [
            { name: "Tabela", type: "table", sort: [{ property: "data", direction: "DESC" }] },
            { name: "Calendário", type: "calendar", dateField: "data" },
          ],
        }),
      ],
      notes: [
        {
          path: "Bem-vindo.md",
          description: "Ponto de partida e guia rápido para este vault.",
          body: welcomeBody(
            "Bem-vindo",
            "Este vault é feito para a escrita diária: as notas diárias ficam na pasta Journal e são criadas a partir do modelo na pasta Modelos.",
            [
              { name: "Journal", description: "Suas notas diárias, uma por dia." },
              { name: "Modelos", description: "Modelos para novas notas — o modelo de nota diária já está configurado." },
            ],
            "Abra o calendário na barra lateral direita e clique em um dia para criar sua primeira nota diária. A Journal.base mostra suas entradas em uma tabela e em um calendário — com data, humor e palavras-chave."
          ),
        },
        {
          path: "Modelos/Nota Diária.md",
          description: "Modelo para novas notas diárias — {{date}}, {{time}} e {{title}} são substituídos.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { data: "{{date}}" },
          body: "# {{title}}\n\n## Notas\n\n## Tarefas\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Journal", templateFolder: "Modelos", dailyNoteTemplate: "Nota Diária.md" },
    },
  ];
}
