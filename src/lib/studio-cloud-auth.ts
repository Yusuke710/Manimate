export const DEFAULT_CLOUD_SYNC_BASE_URL = "https://manimate.ai";

export type CloudAuthStatus =
  | {
      status: "connected";
      base_url: string;
      user_email: string | null;
      user_name: string | null;
      device_name: string | null;
      connected_at: string;
    }
  | {
      status: "pending";
      base_url: string;
      code: string;
      connect_url: string;
      device_name: string | null;
      expires_at: string;
      browser_opened?: boolean;
    }
  | {
      status: "disconnected";
      base_url: string;
    }
  | {
      status: "error";
      base_url: string;
      message: string;
      code?: string | null;
      connect_url?: string | null;
      device_name?: string | null;
      expires_at?: string | null;
      browser_opened?: boolean;
    };

export function createCloudAuthErrorStatus(
  message: string,
  baseUrl = DEFAULT_CLOUD_SYNC_BASE_URL
): CloudAuthStatus {
  return {
    status: "error",
    base_url: baseUrl,
    message,
  };
}
