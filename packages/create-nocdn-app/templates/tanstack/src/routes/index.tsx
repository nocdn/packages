import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({ component: HomePage })
const appName = "{{project-name}}"

function HomePage() {
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
        <p className="text-muted-foreground text-sm tracking-[0.24em] uppercase">TanStack Start</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{appName}</h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-7">
          Start building in <span className="code-inline">src/routes</span> and keep shared styles
          in <span className="code-inline">src/globals.css</span>.
        </p>
      </div>
    </main>
  )
}
