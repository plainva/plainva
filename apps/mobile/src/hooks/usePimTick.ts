import { useEffect, useState } from "react";
import { onPimChanged } from "../services/pim/pimChanged";

/** A number that moves on every `m-pim-changed`: put it in the dependencies of the effect that loads appointments. */
export function usePimTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => onPimChanged(window, () => setTick((v) => v + 1)), []);
  return tick;
}
