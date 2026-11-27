// The providers' calendar targets, loaded with the first calendar that is connected (performance plan L5): without
// one the start bundle carries none of their code (ICS and HTML reading among it).
export { CalDavPimTarget, DevicePimTarget, GooglePimTarget, GraphPimTarget } from "@plainva/core";
// The expansion a pull uses, for drawing a new series by its occurrences (issue 119) - it reads ICS too.
export { expandEventDraft } from "@plainva/core";
