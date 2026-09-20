export type RenderConnection = {
  mode: "local" | "cloud" | null;
  status: "ready" | "disconnected" | "pending" | "error";
  user_email?: string;
  connect_url?: string;
  message?: string;
};
