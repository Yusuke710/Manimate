"use client";

import { useEffect, useRef, useState } from "react";

export default function ShareButton({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [connect, setConnect] = useState<{ url: string; code: string } | null>(null);
  const [error, setError] = useState("");
  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); setError(""); setCopied(true); }
    catch { setError("Copy failed. Copy the link manually."); }
  }
  async function share() {
    setOpen(true); setBusy(true); setCopied(false); setError(""); setUrl("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/share`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sharing failed");
      if (result.connect_url) setConnect({ url: result.connect_url, code: result.code });
      else { setConnect(null); setUrl(result.share_url); await copy(result.share_url); }
    } catch (error) { setError(error instanceof Error ? error.message : "Sharing failed"); }
    finally { setBusy(false); }
  }
  return <div ref={root} className="share-control">
    <button className={`share-trigger ${open || copied ? "emphasized" : ""} ${error ? "has-error" : ""}`} title={error || "Create a shareable manimate.ai link and copy it"} disabled={disabled || busy} onClick={share}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M20 16.5a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 16.5" /></svg>
      <span style={{ letterSpacing: copied ? "0.01em" : undefined }}>{busy ? "Creating..." : copied ? "Copied" : "Share"}</span>
    </button>
    {open && <div role="dialog" aria-label="Share animation" className="share-popover">
      <div className="share-header">
        <div className="share-logo" aria-hidden="true">∑</div>
        <div style={{ minWidth: 0 }}><h3>Share With Manimate</h3><p>This creates a share link and copies it to your clipboard.</p></div>
      </div>
      {connect && <div className="share-connect"><p>Connect to manimate.ai to share. Code: {connect.code}</p><a href={connect.url} target="_blank" rel="noreferrer">Connect account</a><button onClick={share} disabled={busy}>Continue</button></div>}
      {url && <>
        <label><span>Share Link</span><input aria-label="Share link" readOnly value={url} onFocus={event => event.target.select()} /></label>
        <button className="share-copy" style={{ background: copied ? "var(--accent-hover)" : "var(--accent)" }} onClick={() => copy(url)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          <span>{copied ? "Link Copied" : "Copy Link"}</span>
        </button>
      </>}
      {error && <div className="share-error" role="alert">{error}</div>}
    </div>}
    <style jsx>{`
      .share-control { position: relative; display: flex; align-items: center; }
      .share-trigger { display: inline-flex; align-items: center; gap: 7px; min-height: 29px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border-main); background: var(--bg-white); color: var(--text-primary); font: 500 13px var(--font); cursor: pointer; transition: all .16s ease; }
      .share-trigger.emphasized { border-color: rgba(43,181,160,.26); background: linear-gradient(180deg, rgba(43,181,160,.12) 0%, rgba(43,181,160,.07) 100%); box-shadow: 0 6px 18px rgba(43,181,160,.10); }
      .emphasized svg { color: var(--accent); }
      .share-trigger.has-error, .has-error svg { color: #b42318; }
      .share-trigger:disabled { opacity: .55; cursor: default; }
      .share-popover { position: absolute; right: 0; top: calc(100% + 10px); z-index: 40; width: min(340px, calc(100vw - 32px)); padding: 14px; border-radius: 16px; border: 1px solid rgba(0,0,0,.07); background: linear-gradient(180deg, rgba(255,255,255,.98) 0%, rgba(250,250,250,.98) 100%); box-shadow: 0 22px 44px rgba(15,23,42,.14); display: flex; flex-direction: column; gap: 12px; }
      .share-header { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 14px; background: linear-gradient(135deg, rgba(43,181,160,.10) 0%, rgba(43,181,160,.04) 55%, rgba(255,255,255,.9) 100%); border: 1px solid rgba(43,181,160,.14); }
      .share-logo { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.86); color: var(--accent); box-shadow: inset 0 0 0 1px rgba(43,181,160,.12); font: 20px/1 'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif; flex-shrink: 0; }
      h3 { margin: 0; font: 400 17px/1.1 var(--font-display); color: var(--text-primary); }
      p { margin: 5px 0 0; font-size: 12px; line-height: 1.55; color: var(--text-secondary); }
      label { display: flex; flex-direction: column; gap: 7px; }
      label > span { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); }
      input { width: 100%; padding: 11px 12px; border: 1px solid rgba(0,0,0,.08); border-radius: 10px; background: var(--bg-main); color: var(--text-primary); font: 12px 'Monaco', 'Menlo', monospace; box-shadow: inset 0 1px 0 rgba(255,255,255,.8); }
      .share-copy { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(43,181,160,.16); color: #fff; font-size: 12px; font-weight: 600; letter-spacing: .01em; cursor: pointer; box-shadow: 0 12px 24px rgba(43,181,160,.18); }
      .share-error { padding: 10px 11px; border-radius: 10px; border: 1px solid rgba(180,35,24,.10); background: rgba(180,35,24,.04); font-size: 12px; line-height: 1.5; color: #b42318; }
      .share-connect a { color: var(--accent); margin-right: 12px; }
    `}</style>
  </div>;
}
