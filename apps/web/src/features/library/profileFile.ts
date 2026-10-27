function section(markdown: string | undefined, heading: string): string {
  const found = (markdown || "").match(new RegExp(`## ${heading}\\s+([\\s\\S]*?)(?:\\n## |$)`));
  return (found?.[1] || "").trim();
}

export function profileAngle(markdown: string | undefined, fallback = ""): string {
  return section(markdown, "Angle") || fallback;
}

export function profileMethod(markdown: string | undefined): string {
  return section(markdown, "Method");
}
