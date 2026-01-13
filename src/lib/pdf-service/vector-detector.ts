/**
 * Vector Graphics Detector
 *
 * Analyzes PDF operator lists to detect and classify vector graphic regions.
 * Vector graphics in PDFs are drawn using path operations (moveTo, lineTo,
 * curveTo) and painting operations (stroke, fill).
 */

import type { VectorRegion } from './types';

// ============================================================================
// Types
// ============================================================================

/** PDF.js operator codes */
export const OPS = {
  // Path construction
  constructPath: 91,
  // Path painting
  stroke: 64,
  fill: 65,
  eoFill: 66,
  fillStroke: 67,
  eoFillStroke: 68,
  closePath: 17,
  closeStroke: 70,
  closeFillStroke: 71,
  closeEoFillStroke: 72,
  // State
  save: 10,
  restore: 11,
  transform: 12,
  // Drawing
  rectangle: 19,
  paintImageXObject: 85,
  paintImageXObjectRepeat: 88,
  paintXObject: 83,
  // Text (for filtering)
  beginText: 28,
  endText: 29,
  showText: 43,
  showSpacedText: 44,
} as const;

/** Sub-operations within constructPath */
export const PathOps = {
  moveTo: 1,
  lineTo: 2,
  curveTo: 3,
  curveTo2: 4,
  curveTo3: 5,
  closePath: 6,
  rectangle: 7,
} as const;

interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PathInfo {
  bounds: PathBounds;
  hasStroke: boolean;
  hasFill: boolean;
  pathOpsCount: number;
}

interface Viewport {
  width: number;
  height: number;
  scale: number;
  transform?: number[];
}

// ============================================================================
// Operator List Analysis
// ============================================================================

/**
 * Detect vector graphic regions from a PDF.js operator list.
 */
export function detectVectorRegionsFromOpList(
  fnArray: number[],
  argsArray: unknown[][],
  viewport: Viewport,
  options: {
    minRegionSize?: number;
    proximityThreshold?: number;
    excludeTextUnderlines?: boolean;
  } = {}
): VectorRegion[] {
  const {
    minRegionSize = 20, // Minimum dimension in pixels
    proximityThreshold = 15, // Max gap between paths to cluster
    excludeTextUnderlines = true,
  } = options;

  // Collect all path operations
  const paths: PathInfo[] = [];
  let currentPathBounds: PathBounds | null = null;
  let currentPathOpsCount = 0;
  let inTextBlock = false;

  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i];
    const args = argsArray[i];

    // Track text blocks to filter out text underlines
    if (op === OPS.beginText) {
      inTextBlock = true;
      continue;
    }
    if (op === OPS.endText) {
      inTextBlock = false;
      continue;
    }

    // Skip paths that are likely text underlines
    if (excludeTextUnderlines && inTextBlock) {
      continue;
    }

    // Handle path construction
    if (op === OPS.constructPath) {
      const subOps = args[0];
      const coords = args[1];
      // Guard: ensure subOps is an array before processing
      if (!Array.isArray(subOps) || !Array.isArray(coords)) {
        continue;
      }
      currentPathBounds = computePathBounds(subOps as number[], coords as number[], viewport);
      currentPathOpsCount = subOps.length;
      continue;
    }

    // Handle rectangle shorthand
    if (op === OPS.rectangle) {
      const [x, y, w, h] = args as number[];
      currentPathBounds = {
        minX: x,
        minY: y,
        maxX: x + w,
        maxY: y + h,
      };
      currentPathOpsCount = 1;
      continue;
    }

    // Handle path painting operations
    const isPaintOp =
      op === OPS.stroke ||
      op === OPS.fill ||
      op === OPS.eoFill ||
      op === OPS.fillStroke ||
      op === OPS.eoFillStroke ||
      op === OPS.closeStroke ||
      op === OPS.closeFillStroke ||
      op === OPS.closeEoFillStroke;

    if (isPaintOp && currentPathBounds) {
      const hasStroke =
        op === OPS.stroke ||
        op === OPS.fillStroke ||
        op === OPS.eoFillStroke ||
        op === OPS.closeStroke ||
        op === OPS.closeFillStroke ||
        op === OPS.closeEoFillStroke;

      const hasFill =
        op === OPS.fill ||
        op === OPS.eoFill ||
        op === OPS.fillStroke ||
        op === OPS.eoFillStroke ||
        op === OPS.closeFillStroke ||
        op === OPS.closeEoFillStroke;

      paths.push({
        bounds: currentPathBounds,
        hasStroke,
        hasFill,
        pathOpsCount: currentPathOpsCount,
      });

      currentPathBounds = null;
      currentPathOpsCount = 0;
    }
  }

  // Filter out tiny paths (likely decorations)
  const significantPaths = paths.filter((p) => {
    const width = p.bounds.maxX - p.bounds.minX;
    const height = p.bounds.maxY - p.bounds.minY;
    return width >= minRegionSize || height >= minRegionSize;
  });

  // Cluster adjacent paths into regions
  const clusters = clusterPaths(significantPaths, proximityThreshold);

  // Convert clusters to VectorRegions
  return clusters.map((cluster) => {
    const bbox = computeClusterBbox(cluster, viewport);
    const pathCount = cluster.reduce((sum, p) => sum + p.pathOpsCount, 0);
    const hasStroke = cluster.some((p) => p.hasStroke);
    const hasFill = cluster.some((p) => p.hasFill);

    // Estimate complexity based on path count and variety
    const complexity = Math.min(1, pathCount / 100);

    // Guess type based on characteristics
    const type = classifyRegionType(cluster, bbox, viewport);

    return {
      bbox,
      pathCount,
      hasStroke,
      hasFill,
      complexity,
      type,
    };
  });
}

// ============================================================================
// Path Geometry
// ============================================================================

/**
 * Compute bounding box from path construction operations.
 */
function computePathBounds(
  subOps: number[],
  coords: number[],
  viewport: Viewport
): PathBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let coordIndex = 0;

  const updateBounds = (x: number, y: number) => {
    // Apply viewport transform if available
    const tx = viewport.transform
      ? x * viewport.transform[0] + y * viewport.transform[2] + viewport.transform[4]
      : x * viewport.scale;
    const ty = viewport.transform
      ? x * viewport.transform[1] + y * viewport.transform[3] + viewport.transform[5]
      : viewport.height - y * viewport.scale; // Flip Y for PDF coordinate system

    minX = Math.min(minX, tx);
    minY = Math.min(minY, ty);
    maxX = Math.max(maxX, tx);
    maxY = Math.max(maxY, ty);
  };

  for (const op of subOps) {
    switch (op) {
      case PathOps.moveTo:
      case PathOps.lineTo:
        updateBounds(coords[coordIndex], coords[coordIndex + 1]);
        coordIndex += 2;
        break;

      case PathOps.curveTo:
        // Bezier curve: 3 control points
        updateBounds(coords[coordIndex], coords[coordIndex + 1]);
        updateBounds(coords[coordIndex + 2], coords[coordIndex + 3]);
        updateBounds(coords[coordIndex + 4], coords[coordIndex + 5]);
        coordIndex += 6;
        break;

      case PathOps.curveTo2:
      case PathOps.curveTo3:
        // Quadratic curve: 2 control points
        updateBounds(coords[coordIndex], coords[coordIndex + 1]);
        updateBounds(coords[coordIndex + 2], coords[coordIndex + 3]);
        coordIndex += 4;
        break;

      case PathOps.rectangle:
        const x = coords[coordIndex];
        const y = coords[coordIndex + 1];
        const w = coords[coordIndex + 2];
        const h = coords[coordIndex + 3];
        updateBounds(x, y);
        updateBounds(x + w, y + h);
        coordIndex += 4;
        break;

      case PathOps.closePath:
        // No coordinates
        break;
    }
  }

  // Handle empty paths
  if (minX === Infinity) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX, minY, maxX, maxY };
}

// ============================================================================
// Path Clustering
// ============================================================================

/**
 * Cluster paths that are spatially adjacent.
 */
function clusterPaths(paths: PathInfo[], proximityThreshold: number): PathInfo[][] {
  if (paths.length === 0) return [];

  const clusters: PathInfo[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < paths.length; i++) {
    if (assigned.has(i)) continue;

    // Start a new cluster
    const cluster: PathInfo[] = [paths[i]];
    assigned.add(i);

    // Find all paths that overlap or are close to this cluster
    let changed = true;
    while (changed) {
      changed = false;

      for (let j = 0; j < paths.length; j++) {
        if (assigned.has(j)) continue;

        // Check if this path is close to any path in the cluster
        for (const clusterPath of cluster) {
          if (areBoundsClose(clusterPath.bounds, paths[j].bounds, proximityThreshold)) {
            cluster.push(paths[j]);
            assigned.add(j);
            changed = true;
            break;
          }
        }
      }
    }

    // Only keep clusters with multiple paths or large single paths
    if (cluster.length >= 2 || cluster[0].pathOpsCount >= 5) {
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Check if two bounding boxes are close enough to cluster.
 */
function areBoundsClose(a: PathBounds, b: PathBounds, threshold: number): boolean {
  // Check if boxes overlap or are within threshold distance
  const horizontalGap = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const verticalGap = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));

  return horizontalGap <= threshold && verticalGap <= threshold;
}

/**
 * Compute the bounding box of a cluster.
 */
function computeClusterBbox(
  cluster: PathInfo[],
  viewport: Viewport
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const path of cluster) {
    minX = Math.min(minX, path.bounds.minX);
    minY = Math.min(minY, path.bounds.minY);
    maxX = Math.max(maxX, path.bounds.maxX);
    maxY = Math.max(maxY, path.bounds.maxY);
  }

  // Return as [x, y, width, height]
  return [minX, minY, maxX - minX, maxY - minY];
}

// ============================================================================
// Region Classification
// ============================================================================

/**
 * Classify the type of vector region based on its characteristics.
 */
function classifyRegionType(
  cluster: PathInfo[],
  bbox: [number, number, number, number],
  viewport: Viewport
): VectorRegion['type'] {
  const [x, y, width, height] = bbox;
  const aspectRatio = width / (height || 1);
  const pathCount = cluster.reduce((sum, p) => sum + p.pathOpsCount, 0);
  const hasStrokes = cluster.some((p) => p.hasStroke);
  const hasFills = cluster.some((p) => p.hasFill);

  // Small, roughly square shapes with fills might be logos
  if (width < 200 && height < 200 && aspectRatio > 0.5 && aspectRatio < 2 && hasFills) {
    return 'logo';
  }

  // Long horizontal or vertical thin shapes are likely decorations
  if ((aspectRatio > 10 || aspectRatio < 0.1) && pathCount < 5) {
    return 'decoration';
  }

  // Large regions with many paths and both strokes and fills are likely diagrams
  if (pathCount > 20 && hasStrokes && hasFills) {
    return 'diagram';
  }

  // Rectangular regions with structured content might be charts
  if (aspectRatio > 0.5 && aspectRatio < 3 && pathCount > 10) {
    return 'chart';
  }

  return 'unknown';
}

// ============================================================================
// SVG Generation
// ============================================================================

/**
 * Generate a simple SVG from path data.
 * This is a fallback when full SVGGraphics is not available.
 */
export function generateSimpleSvg(
  region: VectorRegion,
  viewport: Viewport
): string {
  const [x, y, width, height] = region.bbox;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}">
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#ccc" stroke-dasharray="4"/>
  <text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#666">
    [Vector Graphic: ${region.type}]
  </text>
</svg>`;
}

// ============================================================================
// Exports
// ============================================================================

export type { PathBounds, PathInfo, Viewport };
