import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, type TourStrings } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";
import { buildProject, PROJECT_STRINGS_PT_BR } from "./projectTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";

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

// ---------------------------------------------------------------------------
// ACE, Johnny.Decimal and Journal now use the shared builders too. Folder
// names, welcome copy and (for Journal) the database columns/template/moods
// reuse the strings the previous inline blocks already carried, verbatim
// where the new interface has a matching field. The content those blocks
// never shipped — ACE's two maps and three samples, JD's three numbered
// samples, Journal's two daily entries — is new, translated to match the
// English reference bundles.
// ---------------------------------------------------------------------------

const ACE_STRINGS_PT_BR: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Calendário e Empenhos — trabalho de conhecimento centrado em MOCs, segundo Nick Milo.",
  folders: { atlas: "Atlas", calendar: "Calendário", efforts: "Empenhos" },
  folderHints: {
    atlas: "Mapas do seu conhecimento — MOCs e notas de visão geral.",
    calendar: "Notas ligadas ao tempo — notas diárias, diários, retrospectivas.",
    efforts: "Empenhos — tudo aquilo em que você está trabalhando ativamente.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo",
    description: "Ponto de partida e guia rápido para este vault.",
    intro:
      "Este vault usa o esquema ACE de \"Linking Your Thinking\" (Nick Milo): o conhecimento é conectado por Maps of Content (MOCs) em vez de um aninhamento profundo. Os exemplos abaixo dependem todos da nota Home — clique neles e depois veja o grafo.",
    outro:
      "Comece no Atlas com a nota Home e conecte-se ao seu conhecimento a partir dali. Um MOC é só uma nota: ele pode crescer, se dividir e desaparecer de novo.",
  },
  welcomeSections: { start: "Por onde começar" },
  home: {
    title: "Home",
    description: "Seu Map of Content de nível mais alto.",
    lead: "A nota Home é seu ponto de entrada: conecte aqui os Maps of Content mais importantes e os empenhos atuais. Nenhuma pasta faz isso — uma pasta só consegue guardar uma nota em um único lugar.",
    mapsHeading: "Mapas",
    effortsHeading: "Empenhos atuais",
  },
  maps: [
    {
      title: "MOC de Escrita",
      body: "Um Map of Content reúne o que pertence a um tema e organiza isso com suas próprias palavras. Ele não substitui um sumário — é a sua visão sobre um tema, em um determinado momento.",
      leads: "A partir daqui:",
    },
    {
      title: "MOC de Jardim",
      body: "Um MOC também pode apontar para fora do Atlas: este mapa leva a um empenho em andamento. Essa conexão cruzada é exatamente a ideia.",
      leads: "A partir daqui:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Por que mapas em vez de pastas",
        body: "Uma pasta responde \"onde está isso?\". Um mapa responde \"o que pertence junto, e por quê?\" — e a mesma nota pode aparecer em vários mapas.\n\nVoltar ao mapa: [[MOC de Escrita]].",
      },
    ],
    efforts: [
      {
        title: "Construir um canteiro elevado",
        body: "Um empenho é algo em que você está trabalhando agora, com um fim previsível. Ele propositalmente não fica no Atlas: o Atlas é para o que permanece.\n\n- [ ] Definir as medidas\n- [ ] Comprar a madeira\n\nPertence a [[MOC de Jardim]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Material ligado ao tempo pertence à pasta Calendário: notas diárias, retrospectivas, tudo o que está ligado a uma data e não a um tema.\n\nVisto hoje: [[Por que mapas em vez de pastas]].",
      },
    ],
  },
};

const JD_STRINGS_PT_BR: JdStrings = {
  name: "Johnny.Decimal",
  description: "Áreas e categorias numeradas (10-19 / 11 / 11.01) para uma localização estrita.",
  folders: {
    system: "00-09 Sistema",
    systemIndex: "00 Índice",
    personal: "10-19 Pessoal",
    finance: "11 Finanças",
    health: "12 Saúde",
    work: "20-29 Trabalho",
    projects: "21 Projetos",
    meetings: "22 Reuniões",
  },
  folderHints: {
    system: "Gerenciamento do próprio sistema — índice e convenções.",
    personal: "Área de exemplo para temas pessoais.",
    work: "Área de exemplo para temas de trabalho.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo",
    description: "Ponto de partida e guia rápido para este vault.",
    intro:
      "Este vault é organizado com o Johnny.Decimal: no máximo dez áreas (10-19, 20-29, …), no máximo dez categorias por área (11, 12, …) — e cada nota recebe um ID como 11.01. Os exemplos abaixo mostram como isso funciona na prática.",
    outro:
      "Renomeie áreas e categorias para combinar com seus temas — a profundidade deliberadamente limitada (área → categoria → ID) é o cerne do método. Um número nunca é reaproveitado, mesmo quando a nota desaparece.",
  },
  welcomeSections: { start: "Por onde começar" },
  index: {
    id: "00.00",
    title: "Índice",
    description: "O índice Johnny.Decimal: todos os números em um só lugar.",
    lead: "Mantenha aqui a lista de todas as áreas, categorias e IDs. Quem procura um número consulta esta nota primeiro. Se não estiver no índice, ela não existe.",
  },
  samples: [
    {
      id: "11.01",
      title: "Orçamento doméstico",
      body: "A primeira nota na categoria 11 recebe 01 — a próxima recebe 02, e assim por diante. O número permanece com a nota mesmo quando você a renomeia.",
    },
    {
      id: "21.01",
      title: "Relançamento do site",
      body: "Um projeto inteiro também recebe exatamente um número. Tudo o que pertence a ele se refere a esse número, em vez de desaparecer em uma subpasta própria.",
    },
    {
      id: "22.01",
      title: "Kick-off do site",
      body: "Notas de reunião são uma categoria própria para não sobrecarregar o número do projeto. Esta pertence a [[21.01 Relançamento do site]].",
    },
  ],
};

const JOURNAL_STRINGS_PT_BR: JournalStrings = {
  name: "Journal",
  description: "Notas diárias com um modelo pronto e uma base de dados de diário — as notas diárias já vêm configuradas.",
  folders: { journal: "Journal", templates: "Modelos" },
  folderHints: {
    journal: "Suas notas diárias, uma por dia.",
    templates: "Modelos para novas notas — o modelo de nota diária já está configurado.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo",
    description: "Ponto de partida e guia rápido para este vault.",
    intro:
      "Este vault é feito para a escrita diária: as notas diárias ficam na pasta Journal e são criadas a partir do modelo na pasta Modelos. Dois dias de exemplo já estão lá — hoje e ontem.",
    outro:
      "Abra o calendário na barra lateral direita e clique em um dia para criar a próxima nota diária. A Journal.base mostra suas entradas em uma tabela e em um calendário — com data, humor e palavras-chave.",
  },
  welcomeSections: { databases: "Suas bases de dados", start: "Por onde começar" },
  baseFile: "Journal.base",
  keys: { date: "data", mood: "humor", tags: "palavras-chave" },
  moods: ["Bom", "Neutro", "Ruim", "Produtivo", "Cansado"],
  views: { table: "Tabela", calendar: "Calendário" },
  template: {
    file: "Nota Diária.md",
    description: "Modelo para novas notas diárias — {{date}}, {{time}} e {{title}} são substituídos.",
    body: "# {{title}}\n\n## Notas\n\n## Tarefas\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Produtivo",
      tags: ["trabalho", "escrita"],
      body: "É assim que fica uma entrada. Humor e palavras-chave ficam no frontmatter — é por isso que a Journal.base consegue ordenar e filtrar por eles sem que você precise manter nada duas vezes.\n\n## Notas\n\n- O calendário na barra lateral direita leva você a qualquer dia.\n\n## Tarefas\n\n- [x] Escrever a primeira nota diária\n- [ ] Voltar amanhã",
    },
    {
      offset: -1,
      mood: "Cansado",
      tags: ["cotidiano"],
      body: "Uma entrada curta também é uma entrada. Com o tempo, o interessante não é o dia isolado, mas a sequência deles — é para isso que serve a tabela ordenada por data.\n\n## Notas\n\n- Pouco feito, mas terminei cedo.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Plainva Tour: a showcase vault, not an organizational method. Folder names,
// database column keys, view names and the sub-item labels follow the same
// ASCII-key / localized-value convention as the bundles above; several values
// (Áreas/Projetos/Tarefas, "Concluído"/"Ativo"/…, the 3-step task status) are
// reused verbatim from PARA_STRINGS_PT_BR, since it is the same underlying
// concept. "Journal" and "cover" stay untranslated, matching the loanword
// choice JOURNAL_STRINGS_PT_BR and TOUR_STRINGS_EN/DE already made.
// ---------------------------------------------------------------------------

/** The one note that shows the editor itself: callouts, a table, a diagram, a
 * formula, a footnote, a highlight, tasks and an embedded image. The wiki
 * links and the image path deliberately match this bundle's own sample
 * titles and folder name ("Anexos/skizze.svg" — the filename itself is a
 * shared literal across every language, only the folder is localized). */
const CHEAT_SHEET_PT_BR = `Tudo abaixo é Markdown puro. Alterne entre leitura e edição na barra de ferramentas — o editor mostra as marcas de formatação só onde está o seu cursor.

> [!tip] Blocos de destaque
> Comece uma citação com \`> [!tip]\`. Há mais tipos: note, warning, danger, example, question.

## Uma tabela

| Atalho | Faz |
| --- | --- |
| \`Mod+P\` | Paleta de comandos |
| \`Mod+O\` | Abertura rápida |
| \`F1\` | Todos os atalhos de teclado |

## Um diagrama

\`\`\`mermaid
flowchart LR
  A[Nota rápida] --> B[Tarefa]
  B --> C[Projeto]
  C --> D[Área]
\`\`\`

## Uma fórmula

No texto: $E = mc^2$

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## Uma imagem

![[Anexos/skizze.svg]]

## Tarefas e destaques

- [x] Algo concluído
- [ ] Algo ==que vale a pena marcar== #tour

Os links apontam para notas: [[Relançamento do site]] e [[Trabalho]].

Notas de rodapé também funcionam.[^1]

[^1]: Assim como esta.
`;

/** Brazilian Portuguese strings for the Plainva Tour. */
const TOUR_STRINGS_PT_BR: TourStrings = {
  name: "Tour do Plainva",
  description: "Um vault guiado: mural, notas diárias, áreas, projetos e tarefas — todas as visões que o Plainva oferece, preenchidas com exemplos.",
  folders: {
    quickNotes: "Notas Rápidas",
    journal: "Journal",
    areas: "Áreas",
    projects: "Projetos",
    tasks: "Tarefas",
    resources: "Recursos",
    archive: "Arquivo",
    attachments: "Anexos",
    templates: "Modelos",
  },
  folderHints: {
    quickNotes: "Tudo o que ainda não tem um lugar — mostrado como um mural.",
    journal: "Uma nota por dia, mostrada em um calendário.",
    areas: "Responsabilidades contínuas, como uma galeria.",
    projects: "Coisas com um fim, em um quadro e uma linha do tempo.",
    tasks: "A base de dados padrão de tarefas — quadro e tabela.",
    resources: "Material que você quer guardar.",
    archive: "Trabalho concluído; mover uma nota para cá a remove das visões ativas.",
    attachments: "Imagens e arquivos.",
    templates: "Modelos de nota, cada um vinculado à sua base de dados.",
  },
  welcome: {
    file: "Bem-vindo.md",
    title: "Bem-vindo ao Plainva",
    intro: "Este vault é um tour guiado. Cada pasta abaixo está cheia de exemplos, e cada base de dados mostra uma visão diferente — abra-as e mude o que quiser: nada aqui é precioso.",
    outro: "Tudo o que você vê aqui é Markdown puro, nesta pasta. Exclua o que não precisar, renomeie o resto — e o vault passa a ser seu.",
  },
  templates: {
    project: { file: "Projeto.md", body: "# {{title}}\n\n## Objetivo\n\n## Próximos passos\n\n- [ ] \n" },
    task: { file: "Tarefa.md", body: "# {{title}}\n\n" },
    area: { file: "Área.md", body: "# {{title}}\n\n## Como saber que está indo bem\n\n" },
    resource: { file: "Recurso.md", body: "# {{title}}\n\n## Por que vale a pena guardar\n\n" },
    quickNote: { file: "Nota Rápida.md", body: "# {{title}}\n\n" },
    daily: {
      file: "Nota Diária.md",
      description: "Modelo para novas notas diárias — {{date}}, {{time}} e {{daily±1}} são substituídos ao criar a nota.",
      body: "# {{title}}\n\n{{daily-1}} · {{date:dddd}} · {{daily+1}}\n\n## Tarefas\n\n- [ ] \n\n## Notas\n\n{{cursor}}\n",
    },
    meeting: {
      file: "Reunião.md",
      description: "Não está vinculada a nenhuma base de dados — aparece em \"Mostrar todos os modelos\". Faz três perguntas em UM único diálogo.",
      body: "# {{title}}\n\n**Tipo:** {{select:Tipo|Semanal,Individual,Workshop,Revisão}}\n**Data:** {{date_prompt:Data da reunião}}\n**Presentes:** {{prompt:Presentes|eu}}\n\n## Pauta\n\n{{cursor}}\n\n## Decisões\n\n## Tarefas\n\n- [ ] \n",
    },
  },
  baseFiles: {
    areas: "Áreas.base",
    projects: "Projetos.base",
    tasks: "Tarefas.base",
    resources: "Recursos.base",
    quickNotes: "Notas Rápidas.base",
    journal: "Journal.base",
    archive: "Arquivo.base",
  },
  keys: {
    focus: "foco", cover: "cover", projects: "projetos",
    status: "status", area: "area", start: "inicio", end: "fim", tasks: "tarefas",
    done: "feito", project: "projeto", due: "prazo", priority: "prioridade",
    date: "data", mood: "humor", topics: "topicos",
    kind: "tipo", url: "url", readStatus: "status",
    finished: "concluido",
  },
  options: {
    projectStatus: ["Planejado", "Ativo", "Aguardando", "Concluído"],
    taskStatus: ["A fazer", "Em andamento", "Concluída"],
    priority: ["Alta", "Média", "Baixa"],
    mood: ["Bom", "Neutro", "Difícil", "Produtivo"],
    resourceKind: ["Livro", "Artigo", "Vídeo", "Ferramenta", "Referência"],
    resourceStatus: ["Novo", "Lido"],
  },
  views: {
    table: "Tabela", board: "Quadro", timeline: "Linha do Tempo", gallery: "Galeria",
    list: "Lista", tree: "Árvore", calendar: "Calendário", pinboard: "Mural",
  },
  subItems: { parent: "Tarefa Principal", children: "Subtarefas" },
  welcomeSections: { databases: "Suas bases de dados", start: "Por onde começar" },
  samples: {
    areas: [
      { title: "Trabalho", body: "Tudo pelo que sou pago. Os projetos aqui têm prazos.", icon: "💼", color: "#2a7f7b", props: { foco: "Entregar sem hora extra", cover: "Anexos/cover.svg" } },
      { title: "Casa", body: "O apartamento, a papelada, as coisas que precisam continuar funcionando.", icon: "🏠", color: "#8a6d3b", props: { foco: "Nada atrasado", cover: "Anexos/cover.svg" } },
      { title: "Saúde", body: "Sono, movimento, alimentação — as coisas chatas que decidem tudo o mais.", icon: "🌱", color: "#3d7f4a", props: { foco: "Três sessões por semana" } },
      { title: "Aprendizado", body: "No que eu quero ficar melhor no próximo ano.", icon: "📚", color: "#5a5a8a", props: { foco: "Um livro por mês" } },
    ],
    projects: [
      { title: "Relançamento do site", body: "Nova página inicial e uma estrutura mais clara.\n\nVeja [[Trabalho]].", props: { status: "Ativo", area: "[[Trabalho]]", inicio: "{{today-6}}", fim: "{{today+9}}" } },
      { title: "Mudança do escritório", body: "Sala menor, mesma mesa.", props: { status: "Planejado", area: "[[Trabalho]]", inicio: "{{today+4}}", fim: "{{today+13}}" } },
      { title: "Declaração de imposto", body: "Esperando por dois recibos.", props: { status: "Aguardando", area: "[[Casa]]", inicio: "{{today-3}}", fim: "{{today+6}}" } },
      { title: "Plano de maratona", body: "Doze semanas, três corridas por semana.\n\nPertence a [[Saúde]].", props: { status: "Concluído", area: "[[Saúde]]", inicio: "{{today-12}}", fim: "{{today-2}}" } },
    ],
    tasks: [
      { title: "Rascunhar a página inicial", body: "Duas variantes, depois decidir.", props: { feito: false, status: "Em andamento", projeto: "[[Relançamento do site]]", prazo: "{{today+1}}", prioridade: "Alta" } },
      { title: "Coletar feedback", body: "Três pessoas, quinze minutos cada.", props: { feito: false, status: "A fazer", projeto: "[[Relançamento do site]]", prazo: "{{today+5}}", prioridade: "Média", parent: "[[Rascunhar a página inicial]]" } },
      { title: "Escrever os textos", body: "Frases curtas.", props: { feito: false, status: "A fazer", projeto: "[[Relançamento do site]]", prazo: "{{today+7}}", prioridade: "Média" } },
      { title: "Organizar as páginas antigas", body: "", props: { feito: true, status: "Concluída", projeto: "[[Relançamento do site]]", prazo: "{{today-2}}", prioridade: "Baixa" } },
      { title: "Medir a nova sala", body: "A mesa tem 160 cm.", props: { feito: false, status: "A fazer", projeto: "[[Mudança do escritório]]", prazo: "{{today+3}}", prioridade: "Média" } },
      { title: "Pedir caixas", body: "", props: { feito: false, status: "A fazer", projeto: "[[Mudança do escritório]]", prazo: "{{today+8}}", prioridade: "Baixa" } },
      { title: "Pedir os recibos", body: "Por e-mail, seja breve.", props: { feito: false, status: "Em andamento", projeto: "[[Declaração de imposto]]", prazo: "{{today}}", prioridade: "Alta" } },
      { title: "Marcar a fisioterapia", body: "", props: { feito: true, status: "Concluída", projeto: "[[Plano de maratona]]", prazo: "{{today-4}}", prioridade: "Média" } },
      { title: "Planejar a próxima temporada", body: "Distâncias mais curtas, mais sono.", props: { feito: false, status: "A fazer", prazo: "{{today+11}}", prioridade: "Baixa" } },
    ],
    quickNotes: [
      { title: "Leia isto primeiro", body: "Os cartões deste mural são notas comuns. Arraste-os, fixe-os, colora-os — ou apague tudo.\n\n#tour", pinned: true, color: "#2a7f7b" },
      { title: "Compras", body: "- [ ] Café\n- [ ] Azeite\n- [x] Pão\n\n#casa", color: "#8a6d3b" },
      { title: "Ideia para uma noite de leitura", body: "Uma vez por mês, um livro, sem slides.\n\n#ideia" },
      { title: "Citação", body: "> Uma nota que você nunca mais encontra é como se nunca tivesse sido escrita.\n\n#citacao", color: "#5a5a8a" },
      { title: "Esboço", body: "A imagem abaixo está na pasta de anexos.\n\n![[Anexos/skizze.svg]]\n\n#tour", pinned: true },
      { title: "Teclado", body: "`Mod+P` abre a paleta de comandos, `F1` lista todos os atalhos.\n\n#tour" },
    ],
    journal: [
      { title: "{{today}}", body: "Comecei o tour. O quadro faz mais sentido do que uma lista.\n\nTrabalhei em [[Rascunhar a página inicial]].", props: { data: "{{today}}", humor: "Produtivo", topicos: ["tour"] } },
      { title: "{{today-1}}", body: "Dia tranquilo. Organizei os papéis da [[Declaração de imposto]].", props: { data: "{{today-1}}", humor: "Neutro", topicos: ["casa"] } },
    ],
    resources: [
      { title: "Guia rápido de Markdown", body: CHEAT_SHEET_PT_BR, props: { tipo: "Referência", status: "Lido", cover: "Anexos/cover.svg" } },
      { title: "Manual do Plainva", body: "O manual completo está em plainva.com/docs.", props: { tipo: "Referência", url: "https://plainva.com/docs", status: "Novo" } },
      { title: "Trabalho focado", body: "Cal Newport. O capítulo sobre planejamento de horários é o mais útil.", props: { tipo: "Livro", status: "Novo", area: "[[Aprendizado]]" } },
      { title: "Atalhos de teclado", body: "Pressione `F1` no Plainva — a lista é pesquisável.", props: { tipo: "Referência", status: "Lido", area: "[[Aprendizado]]" } },
    ],
    archive: [
      { title: "Site antigo", body: "Substituído por [[Relançamento do site]]. Mantido por causa dos textos.", props: { concluido: "{{today-20}}" } },
    ],
  },
};

export function templates(): VaultTemplateDefinition[] {
  return [
    buildPlainvaTour(TOUR_STRINGS_PT_BR),
    buildPara(PARA_STRINGS_PT_BR),
    buildZettelkasten(ZK_STRINGS_PT_BR),
    buildAce(ACE_STRINGS_PT_BR),
    buildJd(JD_STRINGS_PT_BR),
    buildGtd(GTD_STRINGS_PT_BR),
    buildJournal(JOURNAL_STRINGS_PT_BR),
    buildProject(PROJECT_STRINGS_PT_BR),
  ];
}
