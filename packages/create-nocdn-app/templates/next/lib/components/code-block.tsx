import type { BundledLanguage } from "shiki";
import { codeToHtml } from "shiki";

interface CodeBlockProps {
  children: string;
  lang: BundledLanguage;
}

export async function CodeBlock({ children, lang }: CodeBlockProps) {
  const html = await codeToHtml(children, {
    lang,
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: false,
  });

  return (
    <div
      className="font-ioskeley-mono text-sm [&_pre]:bg-transparent [&_pre]:m-0 [&_pre]:p-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
