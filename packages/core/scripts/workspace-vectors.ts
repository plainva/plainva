import { buildWorkspaceGoldenVectors } from "../test/workspaceGoldenVectors.js";

process.stdout.write(JSON.stringify(await buildWorkspaceGoldenVectors(), null, 2) + "\n");
