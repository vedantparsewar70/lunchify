export interface HealthInput {
  configured: boolean;
  initError: string | null;
  dbConnected: boolean;
  dbError: string | null;
}

/**
 * Public health payload: enough for uptime monitoring, without infrastructure details
 * (project ID, credential presence/length, raw error text, runtime environment).
 * Diagnostic detail is written to the server logs instead.
 */
export function publicHealthPayload(input: HealthInput, timestamp = new Date().toISOString()) {
  const healthy = input.configured && input.dbConnected;
  return {
    status: healthy ? 'HEALTHY' : 'MISCONFIGURED',
    timestamp,
    firebase: {
      isConfigured: input.configured,
      isConnectedToDatabase: input.dbConnected,
    },
  };
}
