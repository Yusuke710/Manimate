import HomeClient from "@/app/HomeClient";
import { getLocalCloudSyncStatus } from "@/lib/local/cloud-sync-connect";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initialCloudAuthStatus = await getLocalCloudSyncStatus();
  return <HomeClient initialCloudAuthStatus={initialCloudAuthStatus} />;
}
