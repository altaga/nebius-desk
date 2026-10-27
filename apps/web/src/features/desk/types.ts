export type DeviceRow = {
  id: string;
  name: string;
  hostname: string;
  agent_name?: string;
  kind: string;
  status: string;
  agent_count: number;
  remote_enabled?: boolean;
  last_seen_at?: string | null;
  board_emu?: boolean;
};

export type SessionRow = {
  id: string;
  title: string;
  status: string;
  agent_id: string;
  pinned?: boolean;
  pinned_at?: string | null;
  updated_at?: string | null;
};
