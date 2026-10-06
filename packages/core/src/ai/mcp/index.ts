/**
 * The MCP client's building blocks (plan §17.2, threat T10): everything that
 * decides what a foreign server may show and do, as pure functions with tests.
 * The client itself — transports, the SDK, the settings surface — is built on
 * these; see docs/engineering/MCP_Client_Architecture.md.
 */
export * from "./listing.js";
export * from "./pin.js";
export * from "./names.js";
export * from "./grants.js";
export * from "./tokenBroker.js";
export * from "./results.js";
