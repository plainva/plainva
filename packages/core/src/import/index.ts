export * from './ImportTypes.js';
export * from './ImportRegistry.js';
export * from './zipUtils.js';
export * from './adapters/GenericMarkdownImporter.js';
export * from './adapters/SimplenoteImporter.js';
export * from './adapters/GoogleKeepImporter.js';
export * from './adapters/EvernoteEnexImporter.js';
export * from './adapters/LogseqImporter.js';
export * from './adapters/NotionImporter.js';

import { defaultImportRegistry } from './ImportRegistry.js';
import { GenericMarkdownImporter } from './adapters/GenericMarkdownImporter.js';
import { SimplenoteImporter } from './adapters/SimplenoteImporter.js';
import { GoogleKeepImporter } from './adapters/GoogleKeepImporter.js';
import { EvernoteEnexImporter } from './adapters/EvernoteEnexImporter.js';
import { LogseqImporter } from './adapters/LogseqImporter.js';
import { NotionFileImporter, NotionApiImporter } from './adapters/NotionImporter.js';

// Register all standard PKM import adapters into the default registry
defaultImportRegistry.register(new GenericMarkdownImporter());
defaultImportRegistry.register(new SimplenoteImporter());
defaultImportRegistry.register(new GoogleKeepImporter());
defaultImportRegistry.register(new EvernoteEnexImporter());
defaultImportRegistry.register(new LogseqImporter());
defaultImportRegistry.register(new NotionFileImporter());
defaultImportRegistry.register(new NotionApiImporter());
