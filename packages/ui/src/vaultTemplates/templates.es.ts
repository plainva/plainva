import type { VaultTemplateDefinition } from "./types";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";
import { buildAce, type AceStrings } from "./aceTemplate";
import { buildJd, type JdStrings } from "./jdTemplate";
import { buildJournal, type JournalStrings } from "./journalTemplate";
import { buildGtd, type GtdStrings } from "./gtdTemplate";
import { buildZettelkasten, type ZettelkastenStrings } from "./zettelkastenTemplate";

const PARA_STRINGS_ES: ParaStrings = {
  name: "PARA",
  description: "Proyectos, Áreas, Recursos, Archivo — organizado por cercanía a la acción (Tiago Forte).",
  folders: {
    projects: "Proyectos",
    tasks: "Tareas",
    areas: "Áreas",
    resources: "Recursos",
    archive: "Archivo",
    templates: "Plantillas",
  },
  folderHints: {
    projects: "Iniciativas con un objetivo claro y una fecha de fin (Proyectos.base).",
    tasks: "Próximos pasos individuales — cada una apunta a su proyecto (Tareas.base).",
    areas: "Responsabilidades permanentes, sin fecha de fin.",
    resources: "Temas, material y referencias para consultar.",
    archive: "Lo terminado o inactivo procedente de las demás carpetas.",
  },
  welcome: {
    file: "Bienvenida.md",
    description: "Punto de partida y guía rápida para este vault.",
    title: "Bienvenida",
    intro:
      "Este vault está organizado según el método PARA (Tiago Forte): el contenido se ordena por cercanía a la acción, no por tema. Los ejemplos de abajo son notas reales — cámbialas, muévelas, bórralas.",
    outro:
      "Abre las bases de datos para ver los proyectos por estado, asignarles tareas y vincularlos con sus áreas — lo terminado se mueve a Archivo, mientras que los enlaces y los resúmenes index.md se mantienen automáticamente.",
  },
  welcomeSections: { databases: "Tus bases de datos", start: "Por dónde empezar" },
  baseFiles: { projects: "Proyectos.base", tasks: "Tareas.base", areas: "Áreas.base" },
  keys: { status: "estado", area: "area", due: "fecha", tasks: "tareas", project: "proyecto", projects: "proyectos" },
  options: {
    projectStatus: ["Planificado", "Activo", "En espera", "Terminado"],
    taskStatus: ["Abierto", "En curso", "Terminado"],
  },
  views: { table: "Tabla", byStatus: "Por estado" },
  templates: {
    project: { file: "Proyecto.md", body: "# {{title}}\n\n## Objetivo\n\n## Próximos pasos\n\n- [ ] \n" },
    task: { file: "Tarea.md", body: "# {{title}}\n\n## Notas\n\n- [ ] \n" },
  },
  samples: {
    areas: [
      {
        title: "Equipo",
        body: "Un área es una responsabilidad permanente y sin fecha de fin. Los proyectos se vinculan con ella mediante su propiedad Área — la tabla de Áreas.base los refleja de vuelta.",
      },
      { title: "Finanzas", body: "Contabilidad, contratos, seguros. Sigue activa incluso cuando no hay ningún proyecto abierto." },
      { title: "Salud", body: "Todo lo que necesita atención constante en lugar de tener un final." },
    ],
    projects: [
      {
        title: "Declaración de la renta 2026",
        body: "Un proyecto tiene un objetivo claro y un final previsible. Este está planificado pero aún no ha comenzado — por eso aparece en la primera columna del tablero.",
        props: { estado: "Planificado", area: "[[Finanzas]]", fecha: "{{today+45}}" },
      },
      {
        title: "Mudanza a la nueva oficina",
        body: "El ejemplo activo: las tareas de abajo apuntan aquí mediante su propiedad Proyecto, y Proyectos.base las refleja de vuelta en su columna Tareas.\n\n- [ ] Anotar el objetivo del proyecto\n- [ ] Decidir el próximo paso",
        props: { estado: "Activo", area: "[[Equipo]]", fecha: "{{today+21}}" },
      },
      {
        title: "Programa de espalda",
        body: "Esperando algo fuera de tu control — en este caso, una cita. Para eso está la tercera columna.",
        props: { estado: "En espera", area: "[[Salud]]", fecha: "{{today+10}}" },
      },
      {
        title: "Relanzamiento del sitio web",
        body: "Terminado. Un proyecto acabado sigue siendo visible hasta que lo mueves al Archivo — la base de datos sigue a la nota.",
        props: { estado: "Terminado", area: "[[Equipo]]", fecha: "{{today-5}}" },
      },
    ],
    tasks: [
      {
        title: "Pedir presupuestos a empresas de mudanzas",
        body: "Una tarea es un único paso siguiente y concreto.",
        props: { estado: "Abierto", proyecto: "[[Mudanza a la nueva oficina]]", fecha: "{{today+3}}" },
      },
      {
        title: "Comprobar el plazo de preaviso de las oficinas antiguas",
        body: "Empezada pero sin terminar — la columna central del tablero.",
        props: { estado: "En curso", proyecto: "[[Mudanza a la nueva oficina]]", fecha: "{{today+1}}" },
      },
      {
        title: "Acordar el plano con el equipo",
        body: "Arrastra la tarjeta a otra columna del tablero: Plainva escribe el nuevo estado en la nota.",
        props: { estado: "En curso", proyecto: "[[Mudanza a la nueva oficina]]", fecha: "{{today+7}}" },
      },
      {
        title: "Ordenar los recibos",
        body: "Pertenece a un proyecto que aún no ha comenzado — eso está permitido, y a menudo resulta útil.",
        props: { estado: "Abierto", proyecto: "[[Declaración de la renta 2026]]", fecha: "{{today+14}}" },
      },
      {
        title: "Pedir cita con el fisioterapeuta",
        body: "Terminada. La tarea sigue siendo una nota; solo ha cambiado su estado.",
        props: { estado: "Terminado", proyecto: "[[Programa de espalda]]", fecha: "{{today-2}}" },
      },
      {
        title: "Redirigir el dominio antiguo",
        body: "El último paso del proyecto terminado.",
        props: { estado: "Terminado", proyecto: "[[Relanzamiento del sitio web]]", fecha: "{{today-6}}" },
      },
    ],
    resources: [
      {
        title: "Lista de comprobación para la mudanza de oficina",
        body: "Los recursos son material de consulta — sin objetivo, sin fecha de fin. Deliberadamente no están en ninguna base de datos: no todo necesita filas y columnas.\n\n- [ ] Cambiar la dirección en el banco y el seguro\n- [ ] Medir la red y las impresoras",
      },
      {
        title: "Qué diferencia a PARA de las carpetas",
        body: "PARA organiza por cercanía a la acción: los proyectos terminan, las áreas siguen activas, los recursos son material de consulta, el archivo es todo lo demás. Mueve una nota entre carpetas en cuanto cambie su función.",
      },
    ],
    archive: [
      {
        title: "Feria comercial 2025",
        body: "Así es como se ve algo archivado: una nota normal, solo que en otra carpeta. No se pierde nada — simplemente ya no aparece en las bases de datos activas.",
      },
    ],
  },
};

const ACE_STRINGS_ES: AceStrings = {
  name: "ACE (Linking Your Thinking)",
  description: "Atlas, Calendario y Esfuerzos — trabajo del conocimiento centrado en los MOC, según Nick Milo.",
  folders: { atlas: "Atlas", calendar: "Calendario", efforts: "Esfuerzos" },
  folderHints: {
    atlas: "Los mapas de tu conocimiento — MOC y notas de síntesis.",
    calendar: "Lo vinculado al tiempo — notas diarias, diarios, retrospectivas.",
    efforts: "Todo aquello en lo que estás trabajando activamente.",
  },
  welcome: {
    file: "Bienvenida.md",
    title: "Bienvenida",
    description: "Punto de partida y guía rápida para este vault.",
    intro:
      "Este vault utiliza el esquema ACE de «Linking Your Thinking» (Nick Milo): el conocimiento se enlaza mediante Maps of Content (MOC) en lugar de anidarse profundamente. Todo lo de abajo cuelga de la nota Home — recórrelo y luego mira el grafo.",
    outro:
      "Empieza en el Atlas con la nota Home y teje enlaces hacia tu conocimiento desde ahí. Un MOC no es más que una nota: puede crecer, dividirse y volver a desaparecer.",
  },
  welcomeSections: { start: "Por dónde empezar" },
  home: {
    title: "Home",
    description: "Tu Map of Content de nivel superior.",
    lead: "La nota Home es tu punto de entrada: enlaza aquí tus Maps of Content más importantes y tus esfuerzos actuales. Ninguna carpeta logra eso — una carpeta solo puede archivar una nota en un único lugar.",
    mapsHeading: "Mapas",
    effortsHeading: "Esfuerzos actuales",
  },
  maps: [
    {
      title: "MOC de escritura",
      body: "Un Map of Content reúne lo que pertenece a un tema y lo organiza con tus propias palabras. No sustituye a un índice — es tu visión de un tema, en un momento dado.",
      leads: "Desde aquí:",
    },
    {
      title: "MOC de jardín",
      body: "Un MOC también puede señalar fuera del Atlas: este mapa lleva a un esfuerzo en curso. Ese enlazado cruzado es la idea central.",
      leads: "Desde aquí:",
    },
  ],
  samples: {
    atlas: [
      {
        title: "Por qué mapas en vez de carpetas",
        body: "Una carpeta responde a «¿dónde está?». Un mapa responde a «¿qué pertenece junto, y por qué?» — y la misma nota puede aparecer en varios mapas.\n\nVolver al mapa: [[MOC de escritura]].",
      },
    ],
    efforts: [
      {
        title: "Construir un bancal elevado",
        body: "Un esfuerzo (effort) es algo en lo que estás trabajando ahora mismo, con un final previsible. Deliberadamente no vive en el Atlas: el Atlas es para lo que perdura.\n\n- [ ] Decidir las medidas\n- [ ] Conseguir la madera\n\nPertenece a [[MOC de jardín]].",
      },
    ],
    calendar: [
      {
        title: "{{today}}",
        body: "Lo vinculado al tiempo pertenece a la carpeta Calendario: notas diarias, retrospectivas, todo lo que está ligado a una fecha y no a un tema.\n\nVisto hoy: [[Por qué mapas en vez de carpetas]].",
      },
    ],
  },
};

const JD_STRINGS_ES: JdStrings = {
  name: "Johnny.Decimal",
  description: "Zonas y categorías numeradas (10-19 / 11 / 11.01) para encontrarlo todo con total seguridad.",
  folders: {
    system: "00-09 Sistema",
    systemIndex: "00 Índice",
    personal: "10-19 Personal",
    finance: "11 Finanzas",
    health: "12 Salud",
    work: "20-29 Trabajo",
    projects: "21 Proyectos",
    meetings: "22 Reuniones",
  },
  folderHints: {
    system: "La gestión del propio sistema — índice y convenciones.",
    personal: "Zona de ejemplo para temas personales.",
    work: "Zona de ejemplo para temas laborales.",
  },
  welcome: {
    file: "Bienvenida.md",
    title: "Bienvenida",
    description: "Punto de partida y guía rápida para este vault.",
    intro:
      "Este vault está organizado según Johnny.Decimal: como máximo diez zonas (10-19, 20-29, …), como máximo diez categorías por zona (11, 12, …) — y cada nota recibe un identificador como 11.01. Los ejemplos de abajo muestran cómo se ve eso.",
    outro:
      "Renombra las zonas y categorías según tus propios temas — la profundidad deliberadamente limitada (zona → categoría → identificador) es el núcleo del método. Un número nunca se reasigna, ni siquiera cuando la nota desaparece.",
  },
  welcomeSections: { start: "Por dónde empezar" },
  index: {
    id: "00.00",
    title: "Índice",
    description: "El índice Johnny.Decimal: todos los números en un solo lugar.",
    lead: "Mantén aquí la lista de todas las zonas, categorías e identificadores. Quien busque un número mirará primero aquí — si no está en el índice, no existe.",
  },
  samples: [
    {
      id: "11.01",
      title: "Presupuesto doméstico",
      body: "La primera nota en la categoría 11 recibe el 01 — la siguiente el 02, y así sucesivamente. El número se queda con la nota incluso si la renombras.",
    },
    {
      id: "21.01",
      title: "Relanzamiento del sitio web",
      body: "Un proyecto entero también recibe exactamente un número. Todo lo que le pertenece hace referencia a ese número en lugar de desaparecer en una subcarpeta propia.",
    },
    {
      id: "22.01",
      title: "Kick-off del sitio web",
      body: "Las notas de reuniones son una categoría propia para que no saturen el número del proyecto. Esta pertenece a [[21.01 Relanzamiento del sitio web]].",
    },
  ],
};

const GTD_STRINGS_ES: GtdStrings = {
  name: "GTD",
  description: "Getting Things Done — bandeja de entrada, tareas, proyectos, referencias y lista Algún día.",
  folders: {
    inbox: "Bandeja de entrada",
    tasks: "Tareas",
    projects: "Proyectos",
    reference: "Referencias",
    someday: "Algún día",
    templates: "Plantillas",
  },
  folderHints: {
    inbox: "El punto de recogida de todo lo que llega — vacíala con regularidad.",
    tasks: "Próximas acciones individuales — organizadas por estado y contexto (Tareas.base).",
    projects: "Todo lo que requiere más de un paso (Proyectos.base).",
    reference: "Material de consulta sin necesidad de actuar.",
    someday: "Ideas y proyectos para más adelante.",
  },
  welcome: {
    file: "Bienvenida.md",
    title: "Bienvenida",
    description: "Punto de partida y guía rápida para este vault.",
    intro:
      "Este vault sigue Getting Things Done (David Allen): todo llega primero a la bandeja de entrada y desde ahí se procesa hacia tareas y proyectos concretos.",
    outro:
      "En Tareas.base asignas cada tarea a un proyecto mediante su propiedad Proyecto; Proyectos.base muestra entonces automáticamente qué pertenece a cada proyecto en la columna Tareas. La revisión semanal mantiene el sistema fiable.",
  },
  welcomeSections: { databases: "Tus bases de datos", start: "Por dónde empezar" },
  baseFiles: { tasks: "Tareas.base", projects: "Proyectos.base" },
  keys: { status: "estado", context: "contexto", project: "proyecto", due: "fecha", tasks: "tareas" },
  options: {
    taskStatus: ["Bandeja de entrada", "Siguiente", "En espera", "Algún día", "Terminado"],
    context: ["@Casa", "@Trabajo", "@Recados", "@Teléfono"],
    projectStatus: ["Activo", "En espera", "Algún día", "Terminado"],
  },
  views: { table: "Tabla", byStatus: "Por estado", byContext: "Por contexto" },
  templates: {
    task: { file: "Tarea.md", body: "# {{title}}\n\n## Notas\n\n- [ ] \n" },
    project: { file: "Proyecto.md", body: "# {{title}}\n\n## Resultado deseado\n\n## Próximos pasos\n\n- [ ] \n" },
  },
  review: {
    title: "Revisión semanal",
    description: "Lista de comprobación para la revisión semanal GTD.",
    body: "- [ ] Vaciar la bandeja de entrada\n- [ ] Repasar la lista de proyectos y comprobar las próximas acciones\n- [ ] Echar un vistazo a la lista Algún día\n- [ ] Mirar el calendario de las próximas dos semanas",
  },
  samples: {
    projects: [
      {
        title: "Renovar la cocina",
        body: "Resultado deseado: ¿qué es cierto cuando esto esté terminado? En GTD, cualquier cosa que requiera más de un paso es un proyecto — incluso lo que no parece serlo.",
        props: { estado: "Activo" },
      },
      {
        title: "Revisión del coche",
        body: "Esperando a otra persona — en este caso, una llamada del taller. Por eso este proyecto está en la segunda columna del tablero.",
        props: { estado: "En espera" },
      },
      {
        title: "Aprender a tocar la guitarra",
        body: "Algún día, quizá. Está en el sistema para que deje de rondarte la cabeza — pero ahora mismo no reclama atención.",
        props: { estado: "Algún día" },
      },
      {
        title: "Ordenar los papeles de Hacienda",
        body: "Terminado. Un proyecto acabado sigue siendo visible hasta que lo archivas — la base de datos sigue a la nota.",
        props: { estado: "Terminado" },
      },
    ],
    tasks: [
      {
        title: "Recopilar ideas",
        body: "Recién llegada a la bandeja de entrada y aún sin procesar — por eso no tiene contexto ni proyecto. En la próxima revisión recibirá ambos.",
        props: { estado: "Bandeja de entrada" },
      },
      {
        title: "Medir la cocina",
        body: "Una tarea es una única acción siguiente y concreta. Mediante su propiedad Proyecto pertenece a la reforma.",
        props: { estado: "Siguiente", contexto: "@Casa", proyecto: "[[Renovar la cocina]]", fecha: "{{today+2}}" },
      },
      {
        title: "Revisar el presupuesto del carpintero",
        body: "Arrastra la tarjeta a otra columna del tablero: Plainva escribe el nuevo estado en la nota.",
        props: { estado: "Siguiente", contexto: "@Trabajo", proyecto: "[[Renovar la cocina]]", fecha: "{{today+5}}" },
      },
      {
        title: "Devolver la llamada al taller",
        body: "Esperando a otra persona. El contexto @Teléfono agrupa todo lo que puedes resolver de una vez en cuanto tengas el teléfono en la mano.",
        props: { estado: "En espera", contexto: "@Teléfono", proyecto: "[[Revisión del coche]]" },
      },
      {
        title: "Buscar clases de guitarra cerca",
        body: "Pertenece a un proyecto de algún día y espera con él. Eso también es una decisión — solo que en contra de hacerlo ahora.",
        props: { estado: "Algún día", contexto: "@Recados", proyecto: "[[Aprender a tocar la guitarra]]" },
      },
      {
        title: "Escanear los recibos del año pasado",
        body: "Terminada. La tarea sigue siendo una nota; solo ha cambiado su estado.",
        props: { estado: "Terminado", contexto: "@Casa", proyecto: "[[Ordenar los papeles de Hacienda]]", fecha: "{{today-4}}" },
      },
    ],
    reference: [
      {
        title: "Las dos preguntas de GTD",
        body: "Las referencias son material sin necesidad de actuar — deliberadamente no están en ninguna base de datos.\n\nAl procesar la bandeja de entrada respondes dos preguntas: ¿es accionable? Y si lo es — ¿cuál es la única acción siguiente y concreta? Todo lo demás es referencia, algún día o la papelera.",
      },
    ],
    someday: [
      {
        title: "Álbum de fotos del verano pasado",
        body: "Algún día no significa nunca, significa ahora no. En la revisión semanal repasas esta lista — lo que te llame la atención dos veces se convierte en un proyecto.",
      },
    ],
  },
};

const ZK_STRINGS_ES: ZettelkastenStrings = {
  name: "Zettelkasten",
  description: "Una idea por nota, densamente enlazadas — notas fugaces, de lectura y permanentes (Luhmann).",
  folders: {
    fleeting: "Notas fugaces",
    literature: "Notas de lectura",
    permanent: "Notas permanentes",
    templates: "Plantillas",
  },
  folderHints: {
    fleeting: "Pensamientos rápidos y sin pulir — efímeros, se procesan más tarde.",
    literature: "Resúmenes de tus lecturas, con tus propias palabras y la fuente.",
    permanent: "Ideas duraderas y bien redactadas — una por nota, muy enlazadas.",
  },
  welcome: {
    file: "Bienvenida.md",
    title: "Bienvenida",
    description: "Punto de partida y guía rápida para este vault.",
    intro:
      "Este vault sigue el método Zettelkasten (Niklas Luhmann): una idea por nota — las conexiones surgen de los enlaces, no de las jerarquías de carpetas.",
    outro:
      "Usa Literatura.base para seguir tus fuentes por estado de lectura; Notas.base vincula las notas permanentes con la literatura de la que proceden mediante su propiedad Fuente.",
  },
  welcomeSections: { databases: "Tus bases de datos", start: "Por dónde empezar" },
  baseFiles: { literature: "Literatura.base", slips: "Notas.base" },
  keys: { author: "autor", year: "anio", kind: "tipo", status: "estado", url: "url", slips: "notas", source: "fuente" },
  options: {
    kind: ["Libro", "Artículo", "Vídeo", "Podcast", "Web"],
    status: ["Por leer", "Leído", "Procesado"],
  },
  views: { table: "Tabla", byStatus: "Por estado" },
  templates: {
    literature: { file: "Nota de lectura.md", body: "# {{title}}\n\n## Resumen\n\n## Fuente\n" },
    slip: { file: "Nota.md", body: "# {{title}}\n\nUna idea, en frases completas.\n\n## Notas relacionadas\n\n- \n" },
  },
  samples: {
    permanent: [
      {
        title: "Una idea por nota",
        body: "Una nota permanente contiene exactamente una idea, en frases completas y con tus propias palabras. Solo así se puede reutilizar más adelante en otro contexto sin necesidad de consultar la nota original.\n\nSigue con: [[Enlazar en vez de archivar]] y [[Escribir es pensar]].",
        props: { fuente: ["[[Luhmann - Comunicarse con el fichero de notas]]"] },
      },
      {
        title: "Enlazar en vez de archivar",
        body: "Una carpeta obliga a cada nota a caber en un único cajón. Un enlace le permite estar en tantos contextos como le correspondan — por eso un fichero de notas gana valor con el tiempo en lugar de volverse inmanejable.\n\nContraparte: [[Una idea por nota]]. Consecuencia práctica: [[La nota de entrada]].",
        props: { fuente: ["[[Luhmann - Comunicarse con el fichero de notas]]"] },
      },
      {
        title: "Escribir es pensar",
        body: "Si puedes escribir una idea con tus propias palabras, la has entendido; si no puedes, todavía no. Por eso convertir una nota de lectura en una nota permanente no es copiar — es el verdadero trabajo.\n\nVéase también [[Una idea por nota]].",
        props: { fuente: ["[[Ahrens - Cómo tomar notas inteligentes]]"] },
      },
      {
        title: "La nota de entrada",
        body: "Un fichero de notas necesita puertas. Una nota de entrada reúne enlaces a los hilos en los que estás trabajando — no sustituye a un índice, sino que es ella misma una nota que sigue cambiando.\n\nHilos: [[Enlazar en vez de archivar]] · [[Escribir es pensar]].",
      },
    ],
    literature: [
      {
        title: "Luhmann - Comunicarse con el fichero de notas",
        body: "Resume con tus propias palabras lo que has leído y anota la fuente. Las notas permanentes remiten aquí mediante su propiedad Fuente — la columna Notas te muestra cuáles.",
        props: { autor: "Niklas Luhmann", anio: 1981, tipo: "Artículo", estado: "Procesado" },
      },
      {
        title: "Ahrens - Cómo tomar notas inteligentes",
        body: "Leído, pero aún no convertido en notas. Para eso está el estado: la próxima vez que lo mires, te dice dónde se quedó el trabajo.",
        props: { autor: "Sönke Ahrens", anio: 2017, tipo: "Libro", estado: "Leído" },
      },
      {
        title: "Podcast sobre la toma de notas",
        body: "Aún sin leer — o sin escuchar. En el tablero, esta fuente está en la primera columna hasta que la toques.",
        props: { tipo: "Podcast", estado: "Por leer" },
      },
    ],
    fleeting: [
      {
        title: "Notas del paseo",
        body: "Las notas fugaces son material en bruto: garabateadas, incompletas, efímeras. Al procesarlas se convierten en una nota permanente — o en nada, y eso también está bien.\n\n- Idea: los enlaces valen más que las carpetas\n- Comprobar: ¿es correcta esa cita de Luhmann?",
      },
    ],
  },
};

const JOURNAL_STRINGS_ES: JournalStrings = {
  name: "Journal",
  description: "Notas diarias con una plantilla ya preparada y una base de datos de diario — las notas diarias quedan conectadas al instante.",
  folders: { journal: "Diario", templates: "Plantillas" },
  folderHints: {
    journal: "Tus notas diarias, una por día.",
    templates: "Las plantillas para notas nuevas — la plantilla de nota diaria ya está configurada.",
  },
  welcome: {
    file: "Bienvenida.md",
    title: "Bienvenida",
    description: "Punto de partida y guía rápida para este vault.",
    intro:
      "Este vault está pensado para la escritura diaria: las notas diarias viven en la carpeta Diario y se crean a partir de la plantilla de la carpeta Plantillas. Ya hay dos días de ejemplo — hoy y ayer.",
    outro:
      "Abre el calendario en la barra lateral derecha y haz clic en un día para crear la siguiente nota diaria. Diario.base muestra tus entradas como tabla y en un calendario — con fecha, ánimo y palabras clave.",
  },
  welcomeSections: { databases: "Tus bases de datos", start: "Por dónde empezar" },
  baseFile: "Diario.base",
  keys: { date: "fecha", mood: "animo", tags: "palabrasclave" },
  moods: ["Bien", "Neutral", "Mal", "Productivo", "Cansado"],
  views: { table: "Tabla", calendar: "Calendario" },
  template: {
    file: "Nota diaria.md",
    description: "Plantilla para las nuevas notas diarias — {{date}}, {{time}} y {{title}} se sustituyen automáticamente.",
    body: "# {{title}}\n\n## Notas\n\n## Tareas\n\n- [ ] \n",
  },
  samples: [
    {
      offset: 0,
      mood: "Productivo",
      tags: ["trabajo", "escritura"],
      body: "Así se ve una entrada. El ánimo y las etiquetas viven en el frontmatter — así es como Diario.base puede ordenarlas y filtrarlas sin que tengas que mantener nada por duplicado.\n\n## Notas\n\n- El calendario en la barra lateral derecha te lleva a cualquier día.\n\n## Tareas\n\n- [x] Escribir la primera nota diaria\n- [ ] Volver mañana",
    },
    {
      offset: -1,
      mood: "Cansado",
      tags: ["cotidiano"],
      body: "Una entrada corta también es una entrada. Con el tiempo, lo interesante no es el día concreto sino la serie de días — para eso está la tabla ordenada por fecha.\n\n## Notas\n\n- Poco hecho, pero salida temprana.",
    },
  ],
};

/** Spanish template set — folder/file names follow the app language.
 *
 * PARA, GTD, Zettelkasten and Journal additionally ship pre-wired `.base`
 * databases (Gesamtplan DB-Vorlagen 2026-07-04); ACE and Johnny.Decimal stay
 * link-/folder-based on purpose. Database column KEYS are translated but kept
 * ASCII/diacritic-free; option VALUES, view names and `.base` file names are
 * fully localized. Relation columns and their reverse counterparts are wired
 * here so the databases show real data as soon as the vault is indexed. */
export function templates(): VaultTemplateDefinition[] {
  return [
    // TODO(P4): replace with this language's own tour strings (structure is identical).
    buildPlainvaTour(TOUR_STRINGS_EN),
    buildPara(PARA_STRINGS_ES),
    buildZettelkasten(ZK_STRINGS_ES),
    buildAce(ACE_STRINGS_ES),
    buildJd(JD_STRINGS_ES),
    buildGtd(GTD_STRINGS_ES),
    buildJournal(JOURNAL_STRINGS_ES),
  ];
}
