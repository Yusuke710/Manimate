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

type FaviconSnapshot = {
  element: HTMLLinkElement;
  href: string | null;
  type: string | null;
  sizes: string | null;
  created: boolean;
};

const FAVICON_SELECTOR = 'link[rel~="icon"]';
const OBSERVED_FAVICON_ATTRIBUTES = ["href", "rel", "type", "sizes"] as const;

function captureSnapshot(
  element: HTMLLinkElement,
  created: boolean,
): FaviconSnapshot {
  return {
    element,
    href: element.getAttribute("href"),
    type: element.getAttribute("type"),
    sizes: element.getAttribute("sizes"),
    created,
  };
}

function restoreFavicon(snapshot: FaviconSnapshot, removeCreated: boolean) {
  const { element, href, type, sizes, created } = snapshot;

  element.removeAttribute(BROWSER_PREVIEW_BADGE_ATTR);

  if (created && removeCreated) {
    element.remove();
    return;
  }

  if (href === null) element.removeAttribute("href");
  else if (element.getAttribute("href") !== href) element.setAttribute("href", href);

  if (type === null) element.removeAttribute("type");
  else if (element.getAttribute("type") !== type) element.setAttribute("type", type);

  if (sizes === null) element.removeAttribute("sizes");
  else if (element.getAttribute("sizes") !== sizes) element.setAttribute("sizes", sizes);
}

function restoreFavicons(
  snapshots: Map<HTMLLinkElement, FaviconSnapshot>,
  removeCreated: boolean,
) {
  snapshots.forEach((snapshot) => {
    restoreFavicon(snapshot, removeCreated);
  });
  snapshots.clear();
}

function ensureBadgedFavicon(link: HTMLLinkElement) {
  if (link.getAttribute(BROWSER_PREVIEW_BADGE_ATTR) !== "true") {
    link.setAttribute(BROWSER_PREVIEW_BADGE_ATTR, "true");
  }
  if (link.getAttribute("href") !== BADGED_FAVICON_DATA_URL) {
    link.setAttribute("href", BADGED_FAVICON_DATA_URL);
  }
  if (link.getAttribute("type") !== "image/svg+xml") {
    link.setAttribute("type", "image/svg+xml");
  }
  if (link.getAttribute("sizes") !== "any") {
    link.setAttribute("sizes", "any");
  }
}

function syncBadgedFavicons(
  snapshots: Map<HTMLLinkElement, FaviconSnapshot>,
) {
  if (typeof document === "undefined") return;

  let links = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(FAVICON_SELECTOR),
  );

  if (links.length === 0) {
    const fallbackLink = document.createElement("link");
    fallbackLink.rel = "icon";
    document.head.appendChild(fallbackLink);
    links = [fallbackLink];
    snapshots.set(fallbackLink, captureSnapshot(fallbackLink, true));
  }

  const liveLinks = new Set(links);
  for (const [element] of snapshots) {
    if (!liveLinks.has(element) && !element.isConnected) {
      snapshots.delete(element);
    }
  }

  links.forEach((link) => {
    if (!snapshots.has(link)) {
      snapshots.set(link, captureSnapshot(link, false));
    }
    ensureBadgedFavicon(link);
  });
}

export function useBrowserPreviewBadge(active: boolean) {
  const snapshotsRef = useRef<Map<HTMLLinkElement, FaviconSnapshot>>(new Map());

  useEffect(() => {
    if (typeof document === "undefined" || !active) return;
    const snapshots = snapshotsRef.current;

    const syncManagedFavicons = () => {
      syncBadgedFavicons(snapshots);
    };

    syncManagedFavicons();

    const observer = new MutationObserver(syncManagedFavicons);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...OBSERVED_FAVICON_ATTRIBUTES],
    });

    return () => {
      observer.disconnect();
      restoreFavicons(snapshots, true);
    };
  }, [active]);
}
