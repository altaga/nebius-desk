"""What a Desk subscription includes. The demo account is on this plan."""

PLAN_ID = "desk"
PLAN_NAME = "Desk"
PRICE_LABEL = "Per Jetson"

# Included with the demo Desk plan. Local work and remote access are not metered.
CLOUD_CREDIT_USD = 3.0
TAVILY_CREDITS = 500
# Fast Nebius list price, used only to estimate what a Jetson call would have cost.
FAST_INPUT_PER_M = 0.06
FAST_OUTPUT_PER_M = 0.24

INSTALL = (
    "Install the Desk agent on the customer's Jetson. "
    "This session is the remote desk for that box."
)

TOOLS: tuple[dict[str, str], ...] = (
    {
        "id": "remote",
        "lane": "access",
        "name": "Remote desk",
        "detail": "Unlimited. Web and phone reach this Jetson with the desk login.",
    },
    {
        "id": "local_model",
        "lane": "jetson",
        "name": "Local model",
        "detail": "Unlimited. Private and light work stays on the device.",
    },
    {
        "id": "memory",
        "lane": "jetson",
        "name": "Device memory",
        "detail": "Notes shared by every chat on this Jetson.",
    },
    {
        "id": "missions",
        "lane": "jetson",
        "name": "Missions",
        "detail": "Parallel tasks forked on the device.",
    },
    {
        "id": "edge",
        "lane": "jetson",
        "name": "Jetson health",
        "detail": "Live temperature, CPU, GPU, RAM, and disk.",
    },
    {
        "id": "cli",
        "lane": "access",
        "name": "Remote CLI",
        "detail": "Shell on the Jetson from the web desk and the phone.",
    },
    {
        "id": "files",
        "lane": "jetson",
        "name": "Files",
        "detail": "List, create, and edit files on the Jetson.",
    },
    {
        "id": "nebius",
        "lane": "nebius",
        "name": "Nebius reasoning",
        "detail": "Hard tasks, compressed, inside the daily allowance.",
    },
    {
        "id": "tavily",
        "lane": "tavily",
        "name": "Tavily search",
        "detail": "One credit per basic search, stopped at the key cap.",
    },
)
