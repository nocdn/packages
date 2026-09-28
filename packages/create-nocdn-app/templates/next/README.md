# {{project-name}}

A [Next.js](https://nextjs.org) App Router project with React Compiler, Cache Components, typed routes, Tailwind CSS, and strict TypeScript enabled.

Requires Node.js 20.19 or newer.

## Development

Install dependencies and start the development server:

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Quality checks

```bash
bun run lint
bun run typecheck
```

`typecheck` generates Next.js route types before running TypeScript. To format the project, run `bun run format`.

## Production

Build and run the production server:

```bash
bun run build
bun run start
```

This project uses [`next/font`](https://nextjs.org/docs/app/getting-started/fonts) to self-host and optimize its fonts.

## Dependency audit

`npm audit` may report upstream advisories for PostCSS and Sharp versions pinned internally by Next.js 16.2.11, plus build-time ESLint plugins. This template does not force unsupported dependency overrides: [Next.js maintainers have confirmed](https://github.com/vercel/next.js/issues/93234) that the PostCSS advisory does not affect normal Next.js builds, and the untouched image configuration does not allow remote image sources. Upgrade the pinned Next.js and ESLint packages when compatible patched stable releases are available.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

For other targets and self-hosting, see the [Next.js deployment documentation](https://nextjs.org/docs/app/getting-started/deploying).
