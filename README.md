# ImageEngine — High-Performance SVG to Image Edge API

> **Public Service:** `https://imagengine.grisma.com.np`  
> An ultra-fast, privacy-first edge microservice that rasterizes dynamic or static SVG graphics into high-resolution PNG, JPG, or WebP formats with multi-tier global edge caching.

---

## Highlights

- **⚡ Sub-20ms Engine:** Native-compiled vector rasterization with full CSS gradients, filters, typography, and SVG paths.
- **🌍 Multi-Tier Edge CDN Caching:** Out-of-the-box support for Edge CDN caches, browser caches, and Cloudflare CDN with up to 1-year cache TTL.
- **🖼️ Self-Hosting Social Previews:** Every page (`/`, `/docs`, `/privacy`, `/terms`) generates its Open Graph (`og:image`) and Twitter Card image dynamically via its own `/api` endpoint.
- **📱 WhatsApp & Social Ready:** Generates clean, standard pixel formats (PNG and JPG) so WhatsApp, Facebook, LinkedIn, Twitter/X, and Slack render full rich cards immediately.
- **🔒 Privacy by Design:** 100% in-memory processing. Zero analytics, zero databases, zero tracking cookies, zero permanent storage.

---

## Project Structure

```text
imagengine/
├── api/
│   └── index.js             # High-performance serverless image rasterizer & cache controller
├── public/
│   ├── index.html           # Landing page with interactive live playground & OG generator
│   ├── docs.html            # Complete developer API reference & integration snippets
│   ├── privacy.html         # Privacy policy (zero tracking, in-memory processing)
│   └── terms.html           # Terms of service & developer fair use quota
├── vercel.json              # Edge routing rewrites & security headers
└── package.json             # Service dependencies and metadata
```

---

## API Reference

### Endpoint

```http
GET  https://imagengine.grisma.com.np/api?url={ENCODED_SVG_URL}&format={png|jpg|webp}&width=1200
POST https://imagengine.grisma.com.np/api?format={png|jpg|webp}&width=1200
```

### Query Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `url` | `string` | — | Full, URL-encoded path to the source SVG file. |
| `format` | `string` | `png` | Target image format: `png`, `jpg` (or `jpeg`), `webp`. |
| `width` | `number` | `1200` | Target width in pixels (range: `100` to `2400`). Aspect ratio is preserved. |
| `quality` | `number` | `85` | Compression quality for `jpg` and `webp` (range: `10` to `100`). |
| `title` | `string` | — | Dynamic card mode: Headline text. |
| `subtitle` | `string` | — | Dynamic card mode: Secondary description line. |
| `badge` | `string` | — | Dynamic card mode: Top pill badge label. |

---

## Edge & Cloudflare Caching

ImageEngine dispatches comprehensive cache control headers across all standardized edge protocols:

```http
Cache-Control: public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800, stale-if-error=86400
CDN-Cache-Control: public, max-age=31536000, stale-while-revalidate=604800
Vercel-CDN-Cache-Control: public, max-age=31536000, stale-while-revalidate=604800
Cloudflare-CDN-Cache-Control: public, max-age=31536000, stale-while-revalidate=604800
Surrogate-Control: max-age=31536000
ETag: "9b3c...f1a"
Vary: Accept-Encoding
```

### Cloudflare Setup (Optional Custom Domain Proxy)

If routing your domain (`imagengine.grisma.com.np`) through Cloudflare's orange-cloud proxy:
1. In the **Cloudflare Dashboard**, navigate to **Caching** → **Cache Rules**.
2. Create a rule named `Cache ImageEngine API`:
   - **When incoming requests match:** `URI Path starts with "/api"`
   - **Cache Eligibility:** `Eligible for cache`
   - **Edge TTL:** `Respect origin (or Override to 1 year)`
   - **Browser TTL:** `Respect origin`
3. Because ImageEngine emits `Cloudflare-CDN-Cache-Control: max-age=31536000`, Cloudflare will cache cold outputs at the nearest edge data center.

### Cloudflare WAF Rule on Upstream SVG Origins

If your source SVG host (e.g. `election.topnepali.com`) is protected by Cloudflare Bot Fight Mode or strict WAF managed rules, it might challenge or block automated SVG fetch calls from serverless edge runtimes:

- **Outgoing User-Agent:** `ImageEngine/1.0 (+https://imagengine.grisma.com.np)`
- **Recommended Cloudflare WAF Custom Rule:**
  - **Rule:** `(http.user_agent contains "ImageEngine")`
  - **Action:** **Skip** &rarr; *WAF Managed Rules, Bot Fight Mode, Rate Limiting*

---

## Free Developer Quota & Fair Use

| Metric | Free Tier Quota | Notes |
| :--- | :--- | :--- |
| **Monthly Cold Renders** | 500,000 requests | Applies only to first-time renders. Cached hits are free. |
| **Bandwidth Allowance** | 100 GB / month | Outbound data transfer. |
| **Resolution Range** | 100px — 2,400px width | Recommended: `1200px` for social cards. |
| **Max SVG Ingestion Size** | 512 KB | Maximum uncompressed XML payload size. |
| **Edge Cache Retention** | Up to 1 Year | Cached globally across 300+ edge locations. |

---

## Integration Quickstart

### 1. HTML Open Graph Meta Tags (WhatsApp / Social Media)

```html
<meta property="og:title" content="My Project" />
<meta property="og:description" content="Next generation developer platform" />
<meta property="og:image" content="https://imagengine.grisma.com.np/api?title=My+Project&subtitle=Next+generation+developer+platform&badge=v1.0&format=png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/png" />
```

### 2. cURL

```bash
# Render dynamic card
curl -o og-preview.png "https://imagengine.grisma.com.np/api?title=Release+v2.0&subtitle=Production+Ready&format=png"

# Convert external SVG
curl -o external.webp "https://imagengine.grisma.com.np/api?url=https%3A%2F%2Fexample.com%2Fdiagram.svg&format=webp&width=1600"
```

### 3. JavaScript / TypeScript Helper

```typescript
export function getOgImageUrl(options: { title: string; subtitle?: string; badge?: string; format?: 'png' | 'jpg' | 'webp' }) {
  const params = new URLSearchParams({
    title: options.title,
    subtitle: options.subtitle || '',
    badge: options.badge || 'Live',
    format: options.format || 'png',
    width: '1200'
  });
  return `https://imagengine.grisma.com.np/api?${params.toString()}`;
}
```

---

## License

MIT © [Grisma Bhandari](https://grisma.com.np). Free for personal, community, and commercial open-source use.
