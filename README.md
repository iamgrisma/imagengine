# ImageEngine — High-Performance Edge Image Optimization & CDN Router (v2.0)

> **Documentation Portal:** [imagengine.grisma.info.np](https://imagengine.grisma.info.np)  
> **Edge Endpoints:** `img.topnepali.com` | `img.grisma.info.np`  
> An ultra-fast, multi-tenant edge image proxy that automatically resizes, converts to WebP/AVIF, crops, and accelerates images across global edge CDNs with zero-downtime origin fallback.

---

## Architecture Overview

```text
[ Browser / Client ]
         │
         ▼
[ Cloudflare / Vercel Edge Cache ] (Cached hits served in <10ms globally)
         │ (Cold hit)
         ▼
[ ImageEngine Edge Router ]
  ├── 1. Clean Path Namespace Routing: /{tenant}/{subdomain}/{path...}
  ├── 2. Direct Passthrough: Fast-path for unaltered WebP files
  ├── 3. Dynamic Sharp Pipeline: On-the-fly WebP/AVIF/PNG/JPG conversion
  └── 4. 100% Dimension Preservation: Retains natural dimensions unless w/h requested
         │
         ▼
[ Upstream Origin Server ]
```

---

## Clean Multi-Tenant Routing

ImageEngine uses clean URL paths. No query URL encoding is needed.

```http
https://img.topnepali.com/{tenant}/{subdomain}/{assetPath...}
```

### Subdomain Shorthands
- `main`, `@`, or `www`: Routes to apex/root domain (e.g. `grisma.info.np`).
- Named subdomain: Routes to `{subdomain}.{domain}` (e.g. `election.topnepali.com`, `result.election.gov.np`).

### Examples

| Target Asset on Origin | ImageEngine Edge URL |
| :--- | :--- |
| `https://election.topnepali.com/og/candidate/sobita-gautam.svg` | `https://img.topnepali.com/tn/election/og/candidate/sobita-gautam.webp` |
| `https://result.election.gov.np/Images/Candidate/335208.jpg` | `https://img.topnepali.com/ecn/result/Images/Candidate/335208.webp` |
| `https://grisma.info.np/assets/images/logo.png` | `https://img.grisma.info.np/ginfo/main/assets/images/logo.webp` |
| `https://grisma.com.np/banner.jpg` | `https://img.grisma.info.np/gcom/@/banner.webp` |

---

## Query Parameters

All parameters are optional. By default, ImageEngine preserves **100% of the original dimensions** and serves modern WebP.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `w`, `width` | `integer` | *Original* | Target width in pixels. Preserves aspect ratio if `h` is omitted. |
| `h`, `height` | `integer` | *Original* | Target height in pixels. Preserves aspect ratio if `w` is omitted. |
| `q`, `quality` | `integer` | `85` | Compression quality between `1` and `100`. |
| `format` | `string` | `webp` | Target format: `webp`, `avif`, `jpg`, or `png`. |
| `fit` | `string` | `cover` | Resize fit strategy: `cover`, `contain`, `fill`, `inside`, `outside`. |
| `position` | `string` | `center` | Crop anchor: `center`, `top`, `bottom`, `left`, `right`, `entropy`, `attention`. |
| `avatar` | `boolean` | `false` | Smart square avatar crop (`256x256` anchored to `top`). |
| `blur` | `number` | — | Gaussian blur radius (`0.3` to `1000`). |
| `sharpen` | `boolean` | `false` | Enhances edge clarity. |

---

## Zero-Code Client Drop-In Script

Accelerate all images on your site automatically with automatic fallback to origin:

```html
<script 
  src="https://imagengine.grisma.info.np/engine.js" 
  data-tenant="tn" 
  data-subdomain="election" 
  async>
</script>
```

---

## Tenant Registry Policy

Tenants are configured in `api/index.js`.
- Verified enterprise tenants (`topnepali.com`, `grisma.info.np`, `grisma.com.np`, `grisma.name.np`, `election.gov.np`) run with `rateLimit: false` for unthrottled global edge acceleration.
- New domains can request registration at [grisma.info.np/contact](https://grisma.info.np/contact).

---

## License

MIT © [Grisma Bhandari](https://grisma.com.np).
