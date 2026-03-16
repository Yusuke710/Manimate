"use client";

import { useEffect, useRef } from "react";

type FaviconSnapshot = {
  element: HTMLLinkElement;
  href: string | null;
  type: string | null;
  sizes: string | null;
  created: boolean;
};

const BADGED_FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(`
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

function restoreFavicons(snapshots: FaviconSnapshot[], removeCreated: boolean) {
  snapshots.forEach(({ element, href, type, sizes, created }) => {
    if (created && removeCreated) {
      element.remove();
      return;
    }

    if (href) element.setAttribute("href", href);
    else element.removeAttribute("href");

    if (type) element.setAttribute("type", type);
    else element.removeAttribute("type");

    if (sizes) element.setAttribute("sizes", sizes);
    else element.removeAttribute("sizes");
  });
}

export function useBrowserPreviewBadge(active: boolean) {
  const snapshotsRef = useRef<FaviconSnapshot[] | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    let createdFallback = false;

    if (links.length === 0) {
      const fallbackLink = document.createElement("link");
      fallbackLink.rel = "icon";
      document.head.appendChild(fallbackLink);
      links = [fallbackLink];
      createdFallback = true;
    }

    snapshotsRef.current = links.map((element, index) => ({
      element,
      href: element.getAttribute("href"),
      type: element.getAttribute("type"),
      sizes: element.getAttribute("sizes"),
      created: createdFallback && index === 0,
    }));

    return () => {
      if (snapshotsRef.current) restoreFavicons(snapshotsRef.current, true);
    };
  }, []);

  useEffect(() => {
    const snapshots = snapshotsRef.current;
    if (!snapshots) return;

    if (!active) {
      restoreFavicons(snapshots, false);
      return;
    }

    snapshots.forEach(({ element }) => {
      element.setAttribute("href", BADGED_FAVICON_DATA_URL);
      element.setAttribute("type", "image/svg+xml");
      element.setAttribute("sizes", "any");
    });
  }, [active]);
}
