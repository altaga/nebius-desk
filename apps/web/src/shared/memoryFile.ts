const FACT = /## Fact\s+([\s\S]*?)(?:\n## |$)/;

export function memoryFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "memory"}.md`;
}

export function memoryFact(markdown: string | undefined): string {
  const source = markdown ?? "";
  const found = source.match(FACT);
  const fact = (found?.[1] ?? source).trim();
  return fact.length > 280 ? `${fact.slice(0, 277)}…` : fact;
}
