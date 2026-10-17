// Server-side check, so no env var is exposed to the client bundle. Vercel sets
// VERCEL_ENV to "preview" on preview deployments. Production shows nothing.
export function PreviewBanner({ env = process.env.VERCEL_ENV }: { env?: string }) {
  if (env !== "preview") return null;
  return (
    <div className="preview-banner" role="note">
      Preview · synthetic data
    </div>
  );
}
