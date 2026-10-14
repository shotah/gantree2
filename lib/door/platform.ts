/** Effective door Google OAuth client: stored Settings DO values win over deploy env. */

export function effectiveGoogle(
  deploy: { clientId?: string; clientSecret?: string },
  stored: { clientId?: string; clientSecret?: string },
): { clientId: string; clientSecret: string; idFromDeploy: boolean; secretFromDeploy: boolean } {
  const storedId = stored.clientId?.trim() ?? "";
  const storedSecret = stored.clientSecret?.trim() ?? "";
  const deployId = deploy.clientId?.trim() ?? "";
  const deploySecret = deploy.clientSecret?.trim() ?? "";
  const clientId = storedId || deployId;
  const clientSecret = storedSecret || deploySecret;
  return {
    clientId,
    clientSecret,
    idFromDeploy: clientId.length > 0 && storedId.length === 0,
    secretFromDeploy: clientSecret.length > 0 && storedSecret.length === 0,
  };
}
