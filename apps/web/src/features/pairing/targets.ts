/** Local discovery targets. Docker emu first; USB gadget last for a real Jetson. */
export const LOCAL_BOARD_TARGETS = [
  "http://127.0.0.1:18001",
  "http://127.0.0.1:18002",
  "http://127.0.0.1:18003",
  "http://192.168.55.1:8000",
] as const;
