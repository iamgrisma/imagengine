# ImageEngine — Free Universal SVG to Image Edge API

> **Host domain:** `imagengine.grisma.com.np`  
> A fast, privacy-first edge microservice built for developers that rasterizes any SVG into PNG, JPG, or WebP with 1-year global Edge CDN caching.

---

## What Is Included in This Project?

1. **Root (`/`):** Modern dark-themed Landing Page with an interactive **Live Playground**, instant image preview, format selectors, and one-click URL generator.
2. **API Documentation (`/docs`):** Complete API reference with parameter guides, cURL, HTML, React/Next.js/Astro integration snippets.
3. **API Endpoint (`/api`):**
   - Direct browser visit → automatically redirects to `/docs`.
   - API request with `?url=...` or `?title=...` → returns raw raster image binary with `Content-Type` and 1-year Edge CDN caching headers.
4. **Privacy Policy (`/privacy`):** Transparent zero-storage, zero-tracking policy.
5. **Terms of Service (`/terms`):** Fair use and community guidelines.

---

## How to Deploy to Vercel (Takes ~60 seconds)

1. Create a new GitHub repository (e.g. `imagengine`) and push the contents of this `og-service/` folder into it.
2. Go to [vercel.com](https://vercel.com) and click **"Add New Project"** → select the repository.
3. Click **Deploy**.
4. In Vercel Settings → **Domains**, add:
   - `imagengine.grisma.com.np`
   - Point your DNS CNAME for `imagengine` to `cname.vercel-dns.com`.
