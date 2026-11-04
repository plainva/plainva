// Vitest-only setup, registered after test-localstorage.ts (vite.config.ts).
// `vi.waitFor` waits ten seconds unless a test says otherwise, as in the
// desktop's and the core's suites (packages/core/test/helpers/patientWaitFor.ts,
// Sammelplan 3.160 Nr. 3).
import { vi } from "vitest";
import { makeWaitForPatient } from "../../../packages/core/test/helpers/patientWaitFor";

makeWaitForPatient(vi);
