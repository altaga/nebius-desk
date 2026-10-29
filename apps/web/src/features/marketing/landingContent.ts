export type Route = "edge" | "cloud" | "web";

export const HERO_PROOF = [
  { value: "$0", label: "for every turn that stays on the Jetson" },
  { value: "Nemotron", label: "on Nebius, only when a question earns it" },
  { value: "Cited", label: "live web answers through Tavily" },
] as const;

export const SESSION: { ask: string; route: Route; where: string; meta: string; reply: string }[] = [
  {
    ask: "What's eating the GPU right now?",
    route: "edge",
    where: "Jetson",
    meta: "local · $0",
    reply: "ollama is using 61% of the GPU and 3.1 GB of RAM. Temperature is steady at 52 °C.",
  },
  {
    ask: "Plan a safe rollout for the new vision model.",
    route: "cloud",
    where: "Nebius",
    meta: "1,240 → 310 tokens",
    reply: "Compressed on the Jetson, reasoned on Nemotron. A three-stage plan with a rollback step is ready.",
  },
  {
    ask: "What changed in JetPack this month?",
    route: "web",
    where: "Tavily",
    meta: "1 search credit",
    reply: "Two releases and a security note. Summary below, with three sources.",
  },
];

export const FEATURES = [
  { icon: "chat", title: "Chat with the machine", text: "Ask the Jetson to read a log, summarize a folder, or run a task. It answers with the context of the box itself." },
  { icon: "terminal", title: "Terminal", text: "A real shell on the device, in the browser and on your phone. No SSH keys or port forwarding." },
  { icon: "files", title: "Files", text: "Browse, upload, edit, and preview files on the Jetson without copying anything off it." },
  { icon: "browser", title: "Browser", text: "A browser that runs on the box for research and web tasks, with a live view of every step." },
  { icon: "services", title: "Services & previews", text: "Start a web app on the Jetson and open its preview from anywhere, behind your sign-in." },
  { icon: "health", title: "Live health", text: "GPU, CPU, memory, disk, and temperature, streamed from the device while you work." },
] as const;

export const LANES: { route: Route; where: string; title: string; text: string; tag: string }[] = [
  {
    route: "edge",
    where: "Jetson",
    title: "Local by default",
    text: "Summaries, memory, file work, and quick answers run on the device's own models. Private, instant, and never billed.",
    tag: "$0",
  },
  {
    route: "cloud",
    where: "Nebius",
    title: "Hard reasoning on demand",
    text: "Long plans, tricky code, and deep analysis go to Nemotron on Nebius Token Factory. The Jetson compresses the prompt first, so you pay for fewer tokens.",
    tag: "Plan credits",
  },
  {
    route: "web",
    where: "Tavily",
    title: "Fresh facts from the web",
    text: "When an answer needs today's information, Desk searches the web and cites where it came from.",
    tag: "1 credit / search",
  },
];

export const TRUST = [
  { title: "Your data stays home", text: "Files, memory, and local turns never leave the Jetson unless you send them." },
  { title: "You approve the risky parts", text: "Installs and destructive commands wait for your OK before they run." },
  { title: "Spend you can predict", text: "Cloud calls draw from a fixed balance with caps. Every reply shows its cost." },
] as const;

export const INCLUDED = [
  ["Remote desk, terminal, and files", "Unlimited"],
  ["Local models and live health", "Unlimited"],
  ["Nebius reasoning credits", "$3"],
  ["Tavily web searches", "500"],
] as const;

export const STEPS = [
  ["Install the agent", "Put the Desk agent on your Jetson. That box becomes your computer."],
  ["Sign in", "Open the desk from a browser or your phone. Both share the same session."],
  ["Get to work", "Chat, terminal, and files reach the machine. Nebius steps in only for the hard turns."],
] as const;
