/**
 * The AI's ports (performance plan L5): what a surface of the start bundle needs to know of the AI — whether it is
 * on, its session and models once they are made, the doors at a picture and a voice note, a component of the harness
 * once it is loaded — without the harness itself. Nothing here imports a value from `../ai`; the harness re-exports
 * these, so both entries hand out the same state (`aiPorts.test.ts`).
 */
export * from "./aiModule";
export * from "./aiSwitch";
export * from "./localModels";
export * from "./noteAnswers";
export * from "./sessionContext";
export * from "./sessionLoader";
export * from "./settingsIntent";
export * from "./slots";
export * from "./threadReply";
