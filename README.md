# 2nd_opinion_construction
Construction website

## Project Structure & Deployment
Netlify deploys directly from the `/public` directory, so the files in that folder are the live source of truth.
- All site assets—HTML, CSS, JavaScript, and brand imagery—must live inside `/public`.
- Root-level `index.html`, `styles.css`, and `submit.html` are archived in `/legacy` for historical reference and should not be edited.
- Any new static asset (images, PDFs, downloads, etc.) must be added to `/public`.

```
project-root/
├── public/          # All live site files
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── web_logo.png
│   └── fb_logo.png
├── legacy/          # Archived duplicates (do not edit)
├── .github/         # Workflows
├── netlify.toml     # Netlify config
└── README.md
```

When editing or adding features, always modify files inside `/public`. Netlify will ignore root-level HTML/CSS/JS.
