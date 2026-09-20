"use client";
import type { RenderConnection } from "@/lib/render-connection";
export function CloudAuthGate({isLoading, status, onRetry}: {
  isLoading: boolean; status: RenderConnection; onRetry: () => void;
  onSelectMode: (mode: "local" | "cloud") => void;
}) {
  const button = {border: "1px solid #ddd", borderRadius: 12, padding: "14px 18px", background: "white", cursor: "pointer", fontSize: 15};
  return <main style={{minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f6f3ec", padding: 24}}>
    <section style={{width: "min(460px,100%)", padding: "34px 26px 28px", borderRadius: 24, background: "#fbfaf7", border: "1px solid #0f172a1a", boxShadow: "0 24px 60px #0f172a14", textAlign: "center"}}>
      <div style={{font: "28px Georgia", marginBottom: 24}}><span style={{fontSize: 44, color: "#2bb5a0"}}>∑</span> Manimate</div>
      <h1 style={{fontSize: 20, fontWeight: 500}}>{status.mode ? "Connect cloud rendering" : "Finish setup in your terminal"}</h1>
      {!status.mode ? <>
        <p style={{color: "#525252", lineHeight: 1.6}}>Run <code>manimate</code> in your terminal to choose Local or Cloud.</p>
      </> : <>
        <p style={{color: status.status === "error" ? "#b42318" : "#525252", lineHeight: 1.6}}>
          {status.message || (status.status === "pending" ? "Finish connecting in your browser. This window will continue automatically." : "Connect to Manimate to render videos in the cloud.")}
        </p>
        {status.status === "pending" && status.connect_url ? <a href={status.connect_url} target="_blank" rel="noreferrer" style={{...button, display: "block"}}>Open sign-in page</a> :
          <button style={{...button, width: "100%"}} disabled={isLoading || status.status === "pending"} onClick={onRetry}>{isLoading || status.status === "pending" ? "Opening sign-in…" : "Continue with Google"}</button>}
      </>}
    </section>
  </main>;
}
