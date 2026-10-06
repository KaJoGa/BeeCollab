/**
 * Allowed browser origins, from FRONTEND_ORIGIN (comma-separated, e.g.
 * "https://beecollab.vercel.app,http://localhost:3001"). Unset/empty → '*'
 * so local development keeps working without configuration.
 */
export function getAllowedOrigins(): string | string[] {
  const raw = process.env.FRONTEND_ORIGIN?.trim();
  if (!raw) return '*';
  const origins = raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origins.length > 0 ? origins : '*';
}
