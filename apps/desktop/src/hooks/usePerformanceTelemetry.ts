import { useEffect, useState } from 'react';

export function usePerformanceTelemetry(componentName: string) {
  const [startTime] = useState(() => performance.now());
  
  useEffect(() => {
    const endTime = performance.now();
    const duration = endTime - startTime;
    if (duration > 50) {
      console.warn(`[Telemetry] ${componentName} render + commit took ${duration.toFixed(2)}ms`);
    }
  });
}
