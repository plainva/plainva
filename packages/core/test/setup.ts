// Vitest-only setup (vitest.config.ts): `vi.waitFor` waits ten seconds unless
// a test says otherwise, as in the desktop's and the phone's suites
// (helpers/patientWaitFor.ts, Sammelplan 3.160 Nr. 3).
import { vi } from "vitest";
import { makeWaitForPatient } from "./helpers/patientWaitFor.js";

makeWaitForPatient(vi);
