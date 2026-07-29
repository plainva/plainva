import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";

/** Brazilian Portuguese template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */
const PARA_STRINGS_PT_BR: ParaStrings = {
  name: "PARA",
  description: "Projetos, Áreas, Recursos, Arquivo — organizados por grau de ação (Tiago Forte).",
  folders: {
    projects: "Projetos",
    tasks: "Tarefas",
    areas: "Áreas",
    resources: "Recursos",
    archive: "Arquivo",
    templates: "Modelos",
  },
  folderHints: {
    projects: "Iniciativas com um objetivo claro e uma data de término (Projetos.base).",
    tasks: "Próximos passos individuais — cada um aponta para seu projeto (Tarefas.base).",
    areas: "Responsabilidades contínuas, sem data de término.",
    resources: "Temas, material e referências que vale a pena guardar.",
    archive: "Itens concluídos ou inativos vindos das outras pastas.",
  },
  welcome: {
    file: "Bem-vindo.md",
    description: "Ponto de partida e guia rápido para este vault.",
    title: "Bem-vindo",
    intro:
      "Este vault é organizado com o método PARA (Tiago Forte): o conteúdo é organizado por grau de ação, não por assunto. Os exemplos abaixo são notas reais — altere-as, mova-as, exclua-as.",
    outro:
      "Abra as bases de dados para ver os projetos por status, atribuir tarefas a eles e vinculá-los às suas áreas — o que já foi concluído vai para o Arquivo, enquanto os links e as visões gerais em index.md são mantidos automaticamente.",
  },
  welcomeSections: { databases: "Suas bases de dados", start: "Por onde começar" },
  baseFiles: { projects: "Projetos.base", tasks: "Tarefas.base", areas: "Áreas.base" },
  keys: { status: "status", area: "area", due: "prazo", tasks: "tarefas", project: "projeto", projects: "projetos" },
  options: {
    projectStatus: ["Planejado", "Ativo", "Aguardando", "Concluído"],
    taskStatus: ["A fazer", "Em andamento", "Concluída"],
  },
  views: { table: "Tabela", byStatus: "Por status" },
  templates: {
    project: { file: "Projeto.md", body: "# {{title}}\n\n## Objetivo\n\n## Próximos passos\n\n- [ ] \n" },
    task: { file: "Tarefa.md", body: "# {{title}}\n\n## Notas\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Equipe",
        body: "Uma área é uma responsabilidade contínua sem data de término. Os projetos se conectam a ela por meio da propriedade Área — a tabela em Áreas.base os espelha de volta.",
      },
      { title: "Finanças", body: "Contabilidade, contratos, seguros. Continua funcionando mesmo quando nenhum projeto está aberto." },
      { title: "Saúde", body: "Tudo o que precisa de atenção contínua em vez de ter um fim." },
    ],
    projects: [
      {
        title: "Imposto de Renda 2026",
        body: "Um projeto tem um objetivo claro e um fim previsível. Este está planejado, mas ainda não foi iniciado — por isso está na primeira coluna do quadro.",
        props: { status: "Planejado", area: "[[Finanças]]", prazo: "{{today+45}}" },
      },
      {
        title: "Mudança para o novo escritório",
        body: "O exemplo ativo: as tarefas abaixo apontam para cá por meio da propriedade Projeto, e a Projetos.base as espelha de volta na coluna Tarefas.\n\n- [ ] Anotar o objetivo do projeto\n- [ ] Definir o próximo passo",
        props: { status: "Ativo", area: "[[Equipe]]", prazo: "{{today+21}}" },
      },
      {
        title: "Programa para as costas",
        body: "Esperando por algo fora do seu controle — aqui, uma consulta. É para isso que serve a terceira coluna.",
        props: { status: "Aguardando", area: "[[Saúde]]", prazo: "{{today+10}}" },
      },
      {
        title: "Relançamento do site",
        body: "Concluído. Um projeto finalizado continua visível até que você o mova para o Arquivo — a base de dados segue o arquivo.",
        props: { status: "Concluído", area: "[[Equipe]]", prazo: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Pedir orçamentos de mudança",
        body: "Uma tarefa é um único próximo passo concreto.",
        props: { status: "A fazer", projeto: "[[Mudança para o novo escritório]]", prazo: "{{today+3}}" },
      },
      {
        title: "Verificar o prazo de aviso da sala antiga",
        body: "Iniciada, mas ainda não concluída — a coluna do meio no quadro.",
        props: { status: "Em andamento", projeto: "[[Mudança para o novo escritório]]", prazo: "{{today+1}}" },
      },
      {
        title: "Combinar a planta com a equipe",
        body: "Arraste o cartão para outra coluna no quadro: o Plainva grava o novo status na nota.",
        props: { status: "Em andamento", projeto: "[[Mudança para o novo escritório]]", prazo: "{{today+7}}" },
      },
      {
        title: "Organizar os recibos",
        body: "Pertence a um projeto que ainda não começou — isso é permitido e muitas vezes útil.",
        props: { status: "A fazer", projeto: "[[Imposto de Renda 2026]]", prazo: "{{today+14}}" },
      },
      {
        title: "Marcar a consulta de fisioterapia",
        body: "Concluída. A tarefa continua sendo uma nota; só o status dela mudou.",
        props: { status: "Concluída", projeto: "[[Programa para as costas]]", prazo: "{{today-2}}" },
      },
      {
        title: "Redirecionar o domínio antigo",
        body: "O último passo do projeto concluído.",
        props: { status: "Concluída", projeto: "[[Relançamento do site]]", prazo: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Checklist de mudança de escritório",
        body: "Recursos são material de consulta — sem objetivo, sem data de término. Eles ficam propositalmente fora de qualquer base de dados: nem tudo precisa de linhas e colunas.\n\n- [ ] Atualizar o endereço no banco e no seguro\n- [ ] Medir a rede e as impressoras",
      },
      {
        title: "O que diferencia o PARA de pastas comuns",
        body: "O PARA organiza por grau de ação: projetos terminam, áreas continuam funcionando, recursos são material de consulta, o arquivo é tudo o mais. Mova uma nota entre as pastas assim que a função dela mudar.",
      },
    ],
    archive: [
      {
        title: "Feira comercial 2025",
        body: "É assim que fica um item arquivado: uma nota comum, só que em outra pasta. Nada se perde — ela simplesmente não aparece mais nas bases de dados ativas.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// GTD and Zettelkasten reuse folder names, .base file names, frontmatter keys,
// option values, view names and template bodies from the previous inline
// blocks; sample notes, the GTD review checklist and the Zettelkasten slip
// template are new content, translated to match.
// ---------------------------------------------------------------------------

const GTD_STRINGS_PT_BR: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — Caixa de Entrada, Tarefas, Projetos, Referência e listas Algum Dia.",
  folders: {
    inbox: "Caixa de Entrada",
    tasks: "Tarefas",
    projects: "Projetos",
    reference: "Referência",
    someday: "Algum Dia",
    templates: "Modelos",
  },
  folderHints: {
    inbox: "Ponto de coleta de tudo o que é novo — esvazie-a regularmente.",
    tasks: "Próximas ações individuais — organizadas por status e contexto (Tarefas.base).",
    projects: "Tudo o que precisa de mais de um passo (Projetos.base).",
    reference: "Material de consulta sem necessidade de ação.",
    someday: "Ideias e planos para fazer mais tarde, talvez.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo",
    description: "Ponto de partida e guia rápido para este vault.",
    intro:
      "Este vault segue o Getting Things Done (David Allen): tudo cai primeiro na Caixa de Entrada e a partir dali é processado em tarefas e projetos concretos.",
    outro:
      "Na Tarefas.base você atribui cada tarefa a um projeto por meio da propriedade Projeto; a Projetos.base então mostra automaticamente o que pertence a cada projeto na coluna Tarefas. A revisão semanal mantém o sistema confiável.",
  },
  welcomeSections: { databases: "Suas bases de dados", start: "Por onde começar" },
  baseFiles: { tasks: "Tarefas.base", projects: "Projetos.base" },
  keys: { status: "status", context: "contexto", project: "projeto", due: "prazo", tasks: "tarefas" },
  options: {
    taskStatus: ["Caixa de Entrada", "Próxima", "Aguardando", "Algum Dia", "Concluída"],
    context: ["@Casa", "@Trabalho", "@Recados", "@Telefone"],
    projectStatus: ["Ativo", "Aguardando", "Algum Dia", "Concluído"],
  },
  views: { table: "Tabela", byStatus: "Por status", byContext: "Por contexto" },
  templates: {
    task: { file: "Tarefa.md", body: "# {{title}}\n\n## Notas\n\n- [ ] \n" },
    project: { file: "Projeto.md", body: "# {{title}}\n\n## Resultado desejado\n\n## Próximos passos\n\n- [ ] \n" },
  },
  review: {
    title: "Revisão Semanal",
    description: "Checklist para a revisão semanal do GTD.",
    body: "- [ ] Zerar a caixa de entrada\n- [ ] Percorrer a lista de projetos e verificar as próximas ações\n- [ ] Passar os olhos na lista Algum Dia\n- [ ] Olhar o calendário das próximas duas semanas",
  },
  samples: {
    projects: [
      {
        title: "Reformar a cozinha",
        body: "Resultado desejado: o que estará pronto quando isso terminar? No GTD, tudo o que exige mais de um passo é um projeto — inclusive coisas que não parecem um.",
        props: { status: "Ativo" },
      },
      {
        title: "Revisão do carro",
        body: "Esperando por outra pessoa — aqui, um retorno da oficina. É por isso que esse projeto está na segunda coluna do quadro.",
        props: { status: "Aguardando" },
      },
      {
        title: "Aprender espanhol",
        body: "Algum dia, talvez. Está no sistema para não ficar só na cabeça — mas não pede atenção agora.",
        props: { status: "Algum Dia" },
      },
      {
        title: "Organizar a declaração de imposto",
        body: "Concluído. Um projeto terminado continua visível até você arquivá-lo — a base de dados segue o arquivo.",
        props: { status: "Concluído" },
      },
    ],
    tasks: [
      {
        title: "Coletar ideias",
        body: "Acabou de cair na caixa de entrada e ainda não foi processada — por isso não tem contexto nem projeto. Na próxima revisão ela ganha os dois.",
        props: { status: "Caixa de Entrada" },
      },
      {
        title: "Medir a cozinha",
        body: "Uma tarefa é uma única próxima ação concreta. Por meio da propriedade Projeto ela pertence à reforma.",
        props: { status: "Próxima", contexto: "@Casa", projeto: "[[Reformar a cozinha]]", prazo: "{{today+2}}" },
      },
      {
        title: "Revisar o orçamento do marceneiro",
        body: "Arraste o cartão para outra coluna no quadro: o Plainva grava o novo status na nota.",
        props: { status: "Próxima", contexto: "@Trabalho", projeto: "[[Reformar a cozinha]]", prazo: "{{today+5}}" },
      },
      {
        title: "Ligar de volta para a oficina",
        body: "Esperando por outra pessoa. O contexto @Telefone reúne tudo o que você consegue resolver de uma vez assim que o telefone estiver na mão.",
        props: { status: "Aguardando", contexto: "@Telefone", projeto: "[[Revisão do carro]]" },
      },
      {
        title: "Procurar um curso de idiomas por perto",
        body: "Pertence a um projeto para algum dia e espera junto com ele. Isso também é uma decisão — só que contra fazer agora.",
        props: { status: "Algum Dia", contexto: "@Recados", projeto: "[[Aprender espanhol]]" },
      },
      {
        title: "Digitalizar os recibos do ano passado",
        body: "Concluída. A tarefa continua sendo uma nota; só o status dela mudou.",
        props: { status: "Concluída", contexto: "@Casa", projeto: "[[Organizar a declaração de imposto]]", prazo: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "As duas perguntas do GTD",
        body: "Referência é material sem necessidade de ação — por isso fica propositalmente fora de qualquer base de dados.\n\nAo processar a caixa de entrada, você responde duas perguntas: é acionável? E se for — qual é a única próxima ação concreta? Tudo o mais é referência, algum dia, ou lixeira.",
      },
    ],
    someday: [
      {
        title: "Álbum de fotos das últimas férias",
        body: "Algum dia não significa nunca, significa não agora. Durante a revisão semanal você passa os olhos nesta lista — o que chamar sua atenção duas vezes vira um projeto.",
      },
    ],
  },
};

const ZK_STRINGS_PT_BR: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Uma ideia por nota, densamente conectada — notas fugazes, de literatura e permanentes (Luhmann).",
  folders: {
    fleeting: "Notas Fugazes",
    literature: "Notas de Literatura",
    permanent: "Notas Permanentes",
    templates: "Modelos",
  },
  folderHints: {
    fleeting: "Pensamentos rápidos e crus — passageiros, processados depois.",
    literature: "Resumos do que você leu, com suas próprias palavras, com a fonte.",
    permanent: "Ideias bem formuladas e duradouras — uma por nota, muito interligadas.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo",
    description: "Ponto de partida e guia rápido para este vault.",
    intro:
      "Este vault segue o método Zettelkasten (Niklas Luhmann): uma ideia por nota — as conexões nascem de links, não de hierarquias de pastas.",
    outro:
      "Use a Literatura.base para acompanhar suas fontes pelo status de leitura; a Notas.base conecta as notas permanentes à literatura de que vieram por meio da propriedade Fonte.",
  },
  welcomeSections: { databases: "Suas bases de dados", start: "Por onde começar" },
  baseFiles: { literature: "Literatura.base", slips: "Notas.base" },
  keys: { author: "autor", year: "ano", kind: "tipo", status: "status", url: "url", slips: "notas", source: "fonte" },
  options: {
    kind: ["Livro", "Artigo", "Vídeo", "Podcast", "Site"],
    status: ["A ler", "Lido", "Processado"],
  },
  views: { table: "Tabela", byStatus: "Por status" },
  templates: {
    literature: { file: "Nota de literatura.md", body: "# {{title}}\n\n## Resumo\n\n## Fonte\n" },
    slip: { file: "Nota permanente.md", body: "# {{title}}\n\nUma ideia, em frases completas.\n\n## Notas relacionadas\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Uma ideia por nota",
        body: "Uma nota permanente contém exatamente uma ideia, em frases completas e com suas próprias palavras. Só assim ela pode ser reaproveitada depois em outro contexto, sem que seja preciso consultar a original.\n\nContinue com: [[Vincular em vez de arquivar]] e [[Escrever é pensar]].",
        props: { fonte: ["[[Luhmann - Comunicação com o fichário]]"] },
      },
      {
        title: "Vincular em vez de arquivar",
        body: "Uma pasta obriga cada nota a caber em uma única gaveta. Um link permite que ela pertença a quantos contextos fizerem sentido — por isso um fichário ganha valor com o tempo, em vez de virar uma bagunça.\n\nComparar com: [[Uma ideia por nota]]. Consequência prática: [[A nota de entrada]].",
        props: { fonte: ["[[Luhmann - Comunicação com o fichário]]"] },
      },
      {
        title: "Escrever é pensar",
        body: "Quem consegue escrever uma ideia com suas próprias palavras a entendeu; quem não consegue, ainda não. Transformar uma nota de literatura em uma nota permanente não é copiar — é o verdadeiro trabalho.\n\nVeja também [[Uma ideia por nota]].",
        props: { fonte: ["[[Ahrens - Como fazer boas anotações]]"] },
      },
      {
        title: "A nota de entrada",
        body: "Um fichário precisa de portas. Uma nota de entrada reúne links para os fios em que você está trabalhando — ela não substitui um índice, é ela própria uma nota que muda o tempo todo.\n\nFios: [[Vincular em vez de arquivar]] · [[Escrever é pensar]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Comunicação com o fichário",
        body: "Resuma aqui, com suas próprias palavras, o que você leu, e registre a fonte. As notas permanentes apontam para esta nota de literatura por meio da propriedade Fonte — na coluna Notas você vê quais são elas.",
        props: { autor: "Niklas Luhmann", ano: 1981, tipo: "Artigo", status: "Processado" },
      },
      {
        title: "Ahrens - Como fazer boas anotações",
        body: "Lido, mas ainda não transformado em notas. É exatamente para isso que serve o status: ele diz, na próxima olhada, onde o trabalho parou.",
        props: { autor: "Sönke Ahrens", ano: 2017, tipo: "Livro", status: "Lido" },
      },
      {
        title: "Podcast sobre tomar notas",
        body: "Ainda não lido — ou ouvido. No quadro, essa fonte fica na primeira coluna até você lidar com ela.",
        props: { tipo: "Podcast", status: "A ler" },
      },
    ],
    fleeting: [
      {
        title: "Anotações de uma caminhada",
        body: "Notas fugazes são material bruto: rabiscadas, incompletas, passageiras. Ao processá-las, elas viram uma nota permanente — ou nada, e tudo bem também.\n\n- Ideia: links valem mais do que pastas\n- Conferir: essa citação de Luhmann está certa?",
      },
    ],
  },
};

export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_PT_BR),
    buildZettelkasten(ZK_STRINGS_PT_BR),
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
    buildGtd(GTD_STRINGS_PT_BR),
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
