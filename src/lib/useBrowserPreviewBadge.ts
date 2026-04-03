"use client";

import { useEffect, useRef } from "react";

export const BROWSER_PREVIEW_BADGE_ATTR = "data-browser-preview-badge";
export const BADGED_FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="#ffffff"/>
  <text
    x="16"
    y="15"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="serif"
    font-size="26"
    font-weight="400"
    fill="#2BB5A0"
  >∑</text>
  <circle cx="25" cy="7" r="5" fill="#2BB5A0" stroke="#ffffff" stroke-width="2"/>
</svg>
`)}`;

const BADGED_FAVICON_RELS = ["icon", "shortcut icon"] as const;

function removeManagedFavicons(elements: HTMLLinkElement[]) {
  elements.forEach((element) => element.remove());
  elements.length = 0;
}

function createManagedFavicon(rel: (typeof BADGED_FAVICON_RELS)[number]): HTMLLinkElement {
  const link = document.createElement("link");
  link.setAttribute(BROWSER_PREVIEW_BADGE_ATTR, "true");
  link.rel = rel;
  link.href = BADGED_FAVICON_DATA_URL;
  link.type = "image/svg+xml";
  link.sizes = "any";
  return link;
}

function ensureManagedFavicons(): HTMLLinkElement[] {
  if (typeof document === "undefined") return [];

  const managedByRel = new Map<string, HTMLLinkElement>();
  document.head
    .querySelectorAll<HTMLLinkElement>(`link[${BROWSER_PREVIEW_BADGE_ATTR}="true"]`)
    .forEach((link) => {
      if (!managedByRel.has(link.rel)) {
        managedByRel.set(link.rel, link);
        return;
      }

      link.remove();
    });

  return BADGED_FAVICON_RELS.map((rel) => {
    const existing = managedByRel.get(rel);
    if (existing) {
      existing.href = BADGED_FAVICON_DATA_URL;
      existing.type = "image/svg+xml";
      existing.sizes = "any";
      return existing;
    }

    const link = createManagedFavicon(rel);
    document.head.appendChild(link);
    return link;
  });
}

export function useBrowserPreviewBadge(active: boolean) {
  const managedFaviconsRef = useRef<HTMLLinkElement[]>([]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    removeManagedFavicons(managedFaviconsRef.current);

    if (!active) {
      return;
    }

    const syncManagedFavicons = () => {
      managedFaviconsRef.current = ensureManagedFavicons();
    };

    syncManagedFavicons();

    const observer = new MutationObserver(() => {
      syncManagedFavicons();
    });
    observer.observe(document.head, { childList: true });

    return () => {
      observer.disconnect();
      removeManagedFavicons(managedFaviconsRef.current);
    };
  }, [active]);
}
