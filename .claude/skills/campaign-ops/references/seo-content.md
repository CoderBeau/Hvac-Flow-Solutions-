# SEO Content

The organic half. Strategy comes from `seo-rank-engine` — this file covers **where content goes in this repo and how it ships**.

## Why ads and content belong in one workflow

They feed each other, and running them separately wastes both:

- Search-term reports name the exact phrasing San Antonio homeowners use. That is free keyword research for content — better than any keyword tool, because it's your market and it's spending your money.
- A page that ranks for `ac not cooling san antonio` earns leads at no marginal cost, forever. An ad for the same term costs every click. Anything expensive in paid is a candidate for organic.
- Paid tells you within a week whether a term produces Good leads. That validates the topic *before* you invest in a post.

So the loop is: **run ads → find expensive converting terms → write the page → keep the ad running only where organic doesn't reach.**

## Repo layout

The site is a flat static site served from the repo root with a `CNAME`. Blog content goes in a `blog/` directory:

```
blog/
  index.html                          # post listing
  ac-not-cooling-san-antonio.html
  ac-replacement-cost-san-antonio.html
```

`blog/` does not exist yet — create it with the first post, and add the listing page in the same commit so nothing orphans.

**Match the existing site.** Every page must:

- Link `styles.css` from the root
- Reuse the **footer** markup from `index.html` verbatim
- Include the same favicon, meta viewport, and the `gtag` snippet
- Load `/attribution.js` so a visitor arriving from an ad keeps their campaign context
- End with a CTA to `get-quotes.html` and a `tel:+18305380713` link

> **`styles.css` is a pre-built Tailwind bundle.** Only the utility classes already used elsewhere on the site are compiled into it — arbitrary Tailwind classes on a new page will silently do nothing. Write page-specific CSS in a `<style>` block using the brand palette (`--navy:#0B1E3B`, `--red:#C8102E`, `--orange:#f97316`, `--muted:#5a6a80`, `--border:#dce4ef`, `--bg:#f6f8fb`), the way `get-quotes.html` does. Reusing the footer works because every class it uses is already in the bundle.
>
> `index.html` has no reusable nav — it's a two-audience hero-band layout. Blog pages use their own slim top bar (logo + phone), established by `blog/ac-replacement-cost-san-antonio.html`. Copy that.

A blog post that looks like a different website destroys the trust the rest of the site builds.

## Post structure

```html
<title>[Primary keyword] | HVAC Flow Solutions</title>          <!-- ≤60 chars -->
<meta name="description" content="[...]">                        <!-- ≤155 chars, include San Antonio -->
<link rel="canonical" href="https://boosthvacleads.com/blog/[slug].html">
```

Body:

1. **H1** — the primary keyword, phrased as the homeowner would say it
2. **Answer in the first 100 words.** Someone whose AC just died is not reading an intro. Answer, then explain.
3. **H2 sections** covering the sub-questions people actually ask
4. **A local signal** — San Antonio summer load, hard water on coils, the 2021 freeze, Bexar County permit requirements. This is the E-E-A-T differentiator against national content farms.
5. **CTA block** mid-article and at the end
6. **3–5 internal links** to `get-quotes.html`, `/`, `/blog/`, and sibling posts

> **Do not link homeowner posts to `pricing.html`.** That page sells contractor lead packages — it's the wrong audience entirely, and sending a homeowner researching AC costs into a contractor pricing table kills the conversion.

## Schema

Every post gets `Article` JSON-LD. Posts answering a question also get `FAQPage`.

Add `LocalBusiness` schema to `index.html` if it isn't there yet — it's the strongest single on-page signal for local pack eligibility:

```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "HVAC Flow Solutions",
  "telephone": "+1-830-538-0713",
  "areaServed": { "@type": "City", "name": "San Antonio", "addressRegion": "TX" },
  "url": "https://boosthvacleads.com"
}
```

## Topic priorities

Ordered by lead value, not by traffic. Traffic that doesn't convert is a vanity metric.

| Priority | Topic | Intent |
|---|---|---|
| 1 | AC not cooling / blowing warm — San Antonio | Emergency. Highest intent on the site. |
| 2 | AC replacement cost San Antonio 2026 | Replacement research. Highest lead value. |
| 3 | When to repair vs replace your AC | Decision stage, converts well |
| 4 | How much does AC repair cost in San Antonio | Price research |
| 5 | AC sizing for San Antonio homes | Technical trust builder |
| 6 | Getting through a Texas freeze without heat | Seasonal, publish by November |
| 7 | How to choose an HVAC contractor in San Antonio | Positions the matching service itself |

Topics 1 and 2 map to the two most expensive paid terms. Write those first — they have the highest paid-spend offset.

## Publishing

1. Write the file into `blog/`
2. Update `blog/index.html` with the new entry
3. Confirm `robots.txt` doesn't block it — `dashboard.html` is deliberately excluded, blog posts must not be
4. Add the URL to a sitemap if one exists; if not, create `sitemap.xml` covering every public page
5. Commit and push to the working branch
6. Tell the user to submit the URL in Google Search Console — indexing is not automatic and this is the step that gets skipped

## Do not

- Publish a post without a CTA to `get-quotes.html`
- Write generic national HVAC content — that's what you're competing against and you will lose
- Touch `dashboard.html`, `privacy.html`, or `terms.html` for SEO purposes
- Publish thin pages for every zip code. Doorway pages are a Google penalty risk and rank badly. One strong page beats twenty stub pages. If you want neighborhood coverage, build one substantial Service Areas page with real detail per area.
