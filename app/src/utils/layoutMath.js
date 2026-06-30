export const cleanOrg = (org) => {
  if (!org) return '';
  return org
    .replace(/^AS\d+\s+/g, '')
    .replace(/,?\s+(Inc\.|L\.L\.C\.|LLC|Corporation|Corp\.|Ltd\.)/g, '')
    .trim();
};

export const formatLabelLines = (label) => {
  if (!label) return [];
  const parts = label.split(' — ');
  if (parts.length < 2) return [label];

  const title = parts[0];
  const details = parts[1];

  // If details contains parentheses, split it
  if (details.includes('(')) {
    const parenIdx = details.indexOf('(');
    const mainDetail = details.substring(0, parenIdx).trim();
    const subDetail = details.substring(parenIdx).trim();
    return [title, mainDetail, subDetail];
  }

  return [title, details];
};

export function calculateNodePositions({ hops, isCacheHit, segWidth = 1400, gap = 180, paddingX = 30 }) {
  // segment partition
  const segments = [];
  let currentSegment = [];
  if (hops) {
    for (const hop of hops) {
      currentSegment.push(hop);
      if (hop.type === 'CNAME_REDIRECT') {
        segments.push(currentSegment);
        currentSegment = [];
      }
    }
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
  }

  const calculatedNodes = [];

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx];
    const segmentStartX = sIdx * (segWidth + gap) + paddingX;

    const clientHop = seg.find(h => h.type === 'CLIENT');
    const localHop = seg.find(h => h.type === 'LOCAL');
    const cnameHop = seg.find(h => h.type === 'CNAME_REDIRECT');
    const nsHops = seg.filter(h => h.type === 'ROOT' || h.type === 'TLD' || h.type === 'AUTH');

    // Lay out CLIENT (Stub Resolver)
    if (clientHop) {
      calculatedNodes.push({
        ...clientHop,
        treeX: segmentStartX,
        treeY: 218,
        isPlaceholder: false
      });
    }

    // Lay out LOCAL (Recursive Resolver - Caching Resolver)
    if (localHop) {
      calculatedNodes.push({
        ...localHop,
        treeX: segmentStartX + 420,
        treeY: 218,
        isPlaceholder: false
      });
    }

    // Lay out nameservers (skip Root, TLD, Auth if it is a cache hit)
    if (!isCacheHit) {
      nsHops.forEach((hop, idx) => {
        let treeY = 218;
        if (nsHops.length === 1) {
          treeY = 218;
        } else if (nsHops.length === 2) {
          treeY = idx === 0 ? 148 : 288;
        } else if (nsHops.length === 3) {
          treeY = idx === 0 ? 78 : idx === 1 ? 218 : 358;
        } else if (nsHops.length > 3) {
          const startY = 30;
          const endY = 406;
          treeY = startY + (idx * (endY - startY)) / (nsHops.length - 1);
        }

        calculatedNodes.push({
          ...hop,
          treeX: segmentStartX + 860, // Stacked on the right
          treeY,
          isPlaceholder: false
        });
      });
    }

    // Lay out CNAME_REDIRECT (redirection node at segment end)
    if (cnameHop) {
      calculatedNodes.push({
        ...cnameHop,
        treeX: segmentStartX + 1180,
        treeY: 218,
        isPlaceholder: false
      });
    }
  }

  return { calculatedNodes, segments };
}
