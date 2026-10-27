import { headers } from "next/headers";
import { Landing } from "@/features/marketing/Landing";

function openHref(host: string) {
  const name = host.split(":")[0].toLowerCase();
  if (name === "localhost" || name === "127.0.0.1") {
    return "/login";
  }
  const site = (process.env.SITE_HOST || "").trim().toLowerCase();
  if (!site) return "/login";
  return `https://app.${site}/login`;
}

export default async function HomePage() {
  const host = (await headers()).get("host") || "";
  return <Landing openHref={openHref(host)} />;
}
