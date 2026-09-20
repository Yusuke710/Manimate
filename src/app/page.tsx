import HomeClient from "@/app/HomeClient";
import { renderConnection } from "@/lib/local/render-connection";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initialCloudAuthStatus = await renderConnection();
  return <HomeClient initialCloudAuthStatus={initialCloudAuthStatus} />;
}
