import { CodeBlock } from "@/lib/components/code-block";

export default function Home() {
  return (
    <div className="flex flex-col gap-4 p-18">
      <div className="border-shadow w-fit bg-white rounded-lg p-4">
        <CodeBlock lang="css">
          {`.border-shadow {
  box-shadow:
    0px 0px 0px 1px rgba(0, 0, 0, 0.06),
    0px 1px 2px -1px rgba(0, 0, 0, 0.06),
    0px 2px 4px 0px rgba(0, 0, 0, 0.04);
}`}
        </CodeBlock>
      </div>
    </div>
  );
}
