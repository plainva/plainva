import { DEFAULT_DAILY_NOTE_TYPE, welcomeBody, type VaultTemplateDefinition } from "./types";
import { defineBase } from "./baseBuilders";
import { buildPlainvaTour, TOUR_STRINGS_EN } from "./plainvaTour";
import { buildPara, type ParaStrings } from "./paraTemplate";

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
    {
      id: "zettelkasten",
      name: "Zettelkasten",
      description: "Una idea por nota, densamente enlazadas — notas fugaces, de lectura y permanentes (Luhmann).",
      folders: ["Notas fugaces", "Notas de lectura", "Notas permanentes", "Plantillas"],
      bases: [
        defineBase({
          path: "Literatura.base",
          sourceFolder: "Notas de lectura",
          columns: [
            { key: "autor", input: "text" },
            { key: "anio", input: "number" },
            { key: "tipo", input: "select", options: ["Libro", "Artículo", "Vídeo", "Podcast", "Web"] },
            { key: "estado", input: "status", options: ["Por leer", "Leído", "Procesado"] },
            { key: "url", input: "url" },
            { key: "notas", reverseOf: { base: "Notas.base", property: "fuente" } },
          ],
          views: [
            { name: "Tabla", type: "table" },
            { name: "Por estado", type: "board", groupBy: "estado" },
          ],
          newItemTemplate: "Plantillas/Nota de lectura.md",
        }),
        defineBase({
          path: "Notas.base",
          sourceFolder: "Notas permanentes",
          columns: [{ key: "fuente", input: "relation", relationBase: "Literatura.base" }],
          views: [{ name: "Tabla", type: "table" }],
        }),
      ],
      notes: [
        {
          path: "Bienvenida.md",
          description: "Punto de partida y guía rápida para este vault.",
          body: welcomeBody(
            "Bienvenida",
            "Este vault sigue el método Zettelkasten (Niklas Luhmann): una idea por nota — las conexiones surgen de los enlaces, no de las jerarquías de carpetas.",
            [
              { name: "Notas fugaces", description: "Pensamientos rápidos y sin pulir — efímeros, se procesan más tarde." },
              { name: "Notas de lectura", description: "Resúmenes de tus lecturas, con tus propias palabras y la fuente." },
              { name: "Notas permanentes", description: "Ideas duraderas y bien redactadas — una por nota, muy enlazadas." },
            ],
            "Usa Literatura.base para seguir tus fuentes por estado de lectura; Notas.base vincula las notas permanentes con la literatura de la que proceden mediante su propiedad Fuente."
          ),
        },
        {
          path: "Notas permanentes/Nota de ejemplo.md",
          description: "Un ejemplo de nota permanente.",
          properties: { fuente: ["[[Nota de lectura de ejemplo]]"] },
          body: "# Nota de ejemplo\n\nUna nota permanente contiene exactamente una idea, redactada en frases completas y con tus propias palabras.\n\nEnlaza las notas relacionadas directamente en el texto — así crece la red de ideas.\n",
        },
        {
          path: "Notas de lectura/Nota de lectura de ejemplo.md",
          description: "Un ejemplo de nota de lectura.",
          properties: { autor: "Niklas Luhmann", anio: 1992, tipo: "Libro", estado: "Leído" },
          body: "# Nota de lectura de ejemplo\n\nResume con tus propias palabras lo que has leído y anota la fuente. Las notas permanentes remiten a esta nota de lectura mediante su propiedad Fuente.\n",
        },
        {
          path: "Plantillas/Nota de lectura.md",
          properties: { estado: "Por leer" },
          body: "# {{title}}\n\n## Resumen\n\n## Fuente\n",
        },
      ],
      settings: { templateFolder: "Plantillas" },
    },
    {
      id: "ace",
      name: "ACE (Linking Your Thinking)",
      description: "Atlas, Calendario y Esfuerzos — trabajo del conocimiento centrado en los MOC, según Nick Milo.",
      folders: ["Atlas", "Calendario", "Esfuerzos"],
      notes: [
        {
          path: "Bienvenida.md",
          description: "Punto de partida y guía rápida para este vault.",
          body: welcomeBody(
            "Bienvenida",
            "Este vault utiliza el esquema ACE de «Linking Your Thinking» (Nick Milo): el conocimiento se enlaza mediante Maps of Content (MOC) en lugar de anidarse profundamente.",
            [
              { name: "Atlas", description: "Los mapas de tu conocimiento — MOC y notas de síntesis." },
              { name: "Calendario", description: "Lo vinculado al tiempo — notas diarias, diarios, retrospectivas." },
              { name: "Esfuerzos", description: "Todo aquello en lo que estás trabajando activamente." },
            ],
            "Empieza en el Atlas con la nota Home y teje enlaces hacia tu conocimiento desde ahí."
          ),
        },
        {
          path: "Atlas/Home.md",
          description: "Tu Map of Content de nivel superior.",
          body: "# Home\n\nLa nota Home es tu punto de entrada: enlaza aquí tus Maps of Content más importantes y tus esfuerzos actuales.\n",
        },
      ],
    },
    {
      id: "jd",
      name: "Johnny.Decimal",
      description: "Zonas y categorías numeradas (10-19 / 11 / 11.01) para encontrarlo todo con total seguridad.",
      folders: [
        "00-09 Sistema",
        "00-09 Sistema/00 Índice",
        "10-19 Personal",
        "10-19 Personal/11 Finanzas",
        "10-19 Personal/12 Salud",
        "20-29 Trabajo",
        "20-29 Trabajo/21 Proyectos",
        "20-29 Trabajo/22 Reuniones",
      ],
      notes: [
        {
          path: "Bienvenida.md",
          description: "Punto de partida y guía rápida para este vault.",
          body: welcomeBody(
            "Bienvenida",
            "Este vault está organizado según Johnny.Decimal: como máximo diez zonas (10-19, 20-29, …), como máximo diez categorías por zona (11, 12, …) — y cada nota recibe un identificador como 11.01.",
            [
              { name: "00-09 Sistema", description: "La gestión del propio sistema — índice y convenciones." },
              { name: "10-19 Personal", description: "Zona de ejemplo para temas personales." },
              { name: "20-29 Trabajo", description: "Zona de ejemplo para temas laborales." },
            ],
            "Renombra las zonas y categorías según tus propios temas — la profundidad deliberadamente limitada (zona → categoría → identificador) es el núcleo del método."
          ),
        },
        {
          path: "00-09 Sistema/00 Índice/00.00 Índice.md",
          description: "El índice Johnny.Decimal: todos los números en un solo lugar.",
          body: "# 00.00 Índice\n\nMantén aquí la lista de todas las zonas, categorías e identificadores. Quien busque un número mirará primero aquí.\n\n## 10-19 Personal\n\n- 11 Finanzas\n- 12 Salud\n\n## 20-29 Trabajo\n\n- 21 Proyectos\n- 22 Reuniones\n",
        },
      ],
    },
    {
      id: "gtd",
      name: "GTD",
      description: "Getting Things Done — bandeja de entrada, tareas, proyectos, referencias y lista Algún día.",
      folders: ["Bandeja de entrada", "Tareas", "Proyectos", "Referencias", "Algún día", "Plantillas"],
      bases: [
        defineBase({
          path: "Tareas.base",
          sourceFolder: "Tareas",
          columns: [
            { key: "estado", input: "status", options: ["Bandeja de entrada", "Siguiente", "En espera", "Algún día", "Terminado"] },
            { key: "contexto", input: "select", options: ["@Casa", "@Trabajo", "@Recados", "@Teléfono"] },
            { key: "proyecto", input: "relation", relationBase: "Proyectos.base", relationLimit: "one" },
            { key: "fecha", input: "date" },
          ],
          views: [
            { name: "Tabla", type: "table" },
            { name: "Por estado", type: "board", groupBy: "estado" },
            { name: "Por contexto", type: "board", groupBy: "contexto" },
          ],
          newItemTemplate: "Plantillas/Tarea.md",
        }),
        defineBase({
          path: "Proyectos.base",
          sourceFolder: "Proyectos",
          columns: [
            { key: "estado", input: "status", options: ["Activo", "En espera", "Algún día", "Terminado"] },
            { key: "tareas", reverseOf: { base: "Tareas.base", property: "proyecto" } },
          ],
          views: [
            { name: "Tabla", type: "table" },
            { name: "Por estado", type: "board", groupBy: "estado" },
          ],
          newItemTemplate: "Plantillas/Proyecto.md",
        }),
      ],
      notes: [
        {
          path: "Bienvenida.md",
          description: "Punto de partida y guía rápida para este vault.",
          body: welcomeBody(
            "Bienvenida",
            "Este vault sigue Getting Things Done (David Allen): todo llega primero a la bandeja de entrada y desde ahí se procesa hacia tareas y proyectos concretos.",
            [
              { name: "Bandeja de entrada", description: "El punto de recogida de todo lo que llega — vacíala con regularidad." },
              { name: "Tareas", description: "Próximas acciones individuales — organizadas por estado y contexto (Tareas.base)." },
              { name: "Proyectos", description: "Todo lo que requiere más de un paso (Proyectos.base)." },
              { name: "Referencias", description: "Material de consulta sin necesidad de actuar." },
              { name: "Algún día", description: "Ideas y proyectos para más adelante." },
            ],
            "En Tareas.base asignas cada tarea a un proyecto mediante su propiedad Proyecto; Proyectos.base muestra entonces automáticamente qué pertenece a cada proyecto en la columna Tareas. La revisión semanal mantiene el sistema fiable."
          ),
        },
        {
          path: "Revisión semanal.md",
          description: "Lista de comprobación para la revisión semanal GTD.",
          body: "# Revisión semanal\n\n- [ ] Vaciar la bandeja de entrada\n- [ ] Repasar la lista de proyectos y comprobar las próximas acciones\n- [ ] Echar un vistazo a la lista Algún día\n- [ ] Mirar el calendario de las próximas dos semanas\n",
        },
        {
          path: "Proyectos/Proyecto de ejemplo.md",
          description: "Un ejemplo de nota de proyecto GTD.",
          properties: { estado: "Activo" },
          body: "# Proyecto de ejemplo\n\nResultado deseado: ¿cómo se ve «terminado»?\n\nPróxima acción:\n\n- [ ] Anotar el próximo paso concreto\n",
        },
        {
          path: "Tareas/Tarea de ejemplo.md",
          description: "Un ejemplo de tarea vinculada a un proyecto.",
          properties: { estado: "Siguiente", contexto: "@Trabajo", proyecto: "[[Proyecto de ejemplo]]" },
          body: "# Tarea de ejemplo\n\nUna tarea es una única próxima acción concreta. Mediante su propiedad Proyecto pertenece al Proyecto de ejemplo.\n",
        },
        {
          path: "Tareas/Recopilar ideas.md",
          description: "Un ejemplo de elemento recién llegado a la bandeja de entrada.",
          properties: { estado: "Bandeja de entrada" },
          body: "# Recopilar ideas\n\nRecién llegado a la bandeja de entrada y aún sin procesar. En la próxima revisión esta tarea recibirá un contexto y un proyecto.\n",
        },
        {
          path: "Plantillas/Tarea.md",
          properties: { estado: "Bandeja de entrada" },
          body: "# {{title}}\n\n## Notas\n\n- [ ] \n",
        },
        {
          path: "Plantillas/Proyecto.md",
          properties: { estado: "Activo" },
          body: "# {{title}}\n\n## Resultado deseado\n\n## Próximos pasos\n\n- [ ] \n",
        },
      ],
      settings: { templateFolder: "Plantillas" },
    },
    {
      id: "journal",
      name: "Journal",
      description: "Notas diarias con una plantilla ya preparada y una base de datos de diario — las notas diarias quedan conectadas al instante.",
      folders: ["Diario", "Plantillas"],
      bases: [
        defineBase({
          path: "Diario.base",
          sourceFolder: "Diario",
          columns: [
            { key: "fecha", input: "date" },
            { key: "animo", input: "select", options: ["Bien", "Neutral", "Mal", "Productivo", "Cansado"] },
            { key: "palabrasclave", input: "tags" },
          ],
          views: [
            { name: "Tabla", type: "table", sort: [{ property: "fecha", direction: "DESC" }] },
            { name: "Calendario", type: "calendar", dateField: "fecha" },
          ],
        }),
      ],
      notes: [
        {
          path: "Bienvenida.md",
          description: "Punto de partida y guía rápida para este vault.",
          body: welcomeBody(
            "Bienvenida",
            "Este vault está pensado para la escritura diaria: las notas diarias viven en la carpeta Diario y se crean a partir de la plantilla de la carpeta Plantillas.",
            [
              { name: "Diario", description: "Tus notas diarias, una por día." },
              { name: "Plantillas", description: "Las plantillas para notas nuevas — la plantilla de nota diaria ya está configurada." },
            ],
            "Abre el calendario en la barra lateral derecha y haz clic en un día para crear tu primera nota diaria. Diario.base muestra tus entradas como tabla y en un calendario — con fecha, ánimo y palabras clave."
          ),
        },
        {
          path: "Plantillas/Nota diaria.md",
          description: "Plantilla para las nuevas notas diarias — {{date}}, {{time}} y {{title}} se sustituyen automáticamente.",
          type: DEFAULT_DAILY_NOTE_TYPE,
          properties: { fecha: "{{date}}" },
          body: "# {{title}}\n\n## Notas\n\n## Tareas\n\n- [ ] \n",
        },
      ],
      settings: { dailyNotesFolder: "Diario", templateFolder: "Plantillas", dailyNoteTemplate: "Nota diaria.md" },
    },
  ];
}
