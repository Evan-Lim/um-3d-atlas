import type {
  ComputedRoute,
  GraphData,
  RouteMode,
  RouteStep,
  SearchItem,
  TransitData,
  TransitRoute,
} from '../types/map';

const METERS_PER_LAT = 110540;
const METERS_PER_LON = 111320 * Math.cos((3.122 * Math.PI) / 180);

const KIND_NAMES: Record<number, 'road' | 'footway' | 'shortcut' | 'steps'> = {
  0: 'road',
  1: 'footway',
  2: 'shortcut',
  3: 'steps',
};

interface AdjEdge {
  to: number;
  dist: number;
  kind: number;
  flags: number;
  name: string;
}

export function distMeters(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * METERS_PER_LON;
  const dy = (b[1] - a[1]) * METERS_PER_LAT;
  return Math.hypot(dx, dy);
}

function compassDirection(from: [number, number], to: [number, number]): string {
  const dx = (to[0] - from[0]) * METERS_PER_LON;
  const dy = (to[1] - from[1]) * METERS_PER_LAT;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return dirs[Math.round(deg / 45) % 8];
}

function turnVerb(p0: [number, number], p1: [number, number], p2: [number, number]): string {
  const ax = (p1[0] - p0[0]) * METERS_PER_LON;
  const ay = (p1[1] - p0[1]) * METERS_PER_LAT;
  const bx = (p2[0] - p1[0]) * METERS_PER_LON;
  const by = (p2[1] - p1[1]) * METERS_PER_LAT;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 0.5 || lb < 0.5) return 'Continue';
  const dot = (ax * bx + ay * by) / (la * lb);
  const cross = (ax * by - ay * bx) / (la * lb);
  const ang = (Math.atan2(cross, dot) * 180) / Math.PI;
  if (ang > 35 && ang < 135) return 'Turn left';
  if (ang >= 15 && ang <= 35) return 'Keep left';
  if (ang < -35 && ang > -135) return 'Turn right';
  if (ang <= -15 && ang >= -35) return 'Keep right';
  if (Math.abs(ang) >= 135) return 'Make a U-turn';
  return 'Continue straight';
}

class MinHeap {
  private data: { node: number; f: number }[] = [];

  get size() {
    return this.data.length;
  }

  push(node: number, f: number) {
    this.data.push({ node, f });
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      const tmp = this.data[p];
      this.data[p] = this.data[i];
      this.data[i] = tmp;
      i = p;
    }
  }

  pop(): { node: number; f: number } | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        let best = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && this.data[l].f < this.data[best].f) best = l;
        if (r < n && this.data[r].f < this.data[best].f) best = r;
        if (best === i) break;
        const tmp = this.data[i];
        this.data[i] = this.data[best];
        this.data[best] = tmp;
        i = best;
      }
    }
    return top;
  }
}

export class CampusRouter {
  private nodes: [number, number][];
  private adj: AdjEdge[][];
  private drivableNodes: Set<number>;
  private accessibleNodes: Set<number>;
  private transitRoutes: TransitRoute[] = [];
  private routePolylines = new Map<string, [number, number][]>();

  constructor(graph: GraphData, transit?: TransitData) {
    this.nodes = graph.nodes;
    this.adj = Array.from({ length: graph.nodes.length }, () => []);
    this.drivableNodes = new Set();
    this.accessibleNodes = new Set();

    for (const [u, v, dist, kind, flags, name] of graph.edges) {
      this.adj[u].push({ to: v, dist, kind, flags, name });
      this.adj[v].push({ to: u, dist, kind, flags, name });
      if (flags & 1) {
        this.drivableNodes.add(u);
        this.drivableNodes.add(v);
      }
      if (kind !== 3 && flags & 2) {
        this.accessibleNodes.add(u);
        this.accessibleNodes.add(v);
      }
    }

    if (transit) {
      this.transitRoutes = transit.routes;
      for (const ft of transit.geojson.features) {
        const rid = String((ft.properties as Record<string, unknown>)?.id ?? '');
        if (ft.geometry.type === 'LineString' && rid) {
          this.routePolylines.set(rid, ft.geometry.coordinates as [number, number][]);
        }
      }
    }
  }

  findNearestNode(coord: [number, number], mode: RouteMode = 'walk', stepFree = false): number {
    let bestIdx = 0;
    let bestD = Infinity;
    const filterSet =
      mode === 'drive' ? this.drivableNodes : stepFree ? this.accessibleNodes : null;

    for (let i = 0; i < this.nodes.length; i++) {
      if (filterSet && !filterSet.has(i)) continue;
      const d = distMeters(coord, this.nodes[i]);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private edgeWeight(edge: AdjEdge, mode: 'walk' | 'drive', stepFree: boolean): number {
    if (mode === 'drive') {
      return edge.flags & 1 ? edge.dist : Infinity;
    }
    if (stepFree) {
      if (edge.kind === 3 || !(edge.flags & 2)) return Infinity;
      if (edge.kind === 2) return edge.dist * 0.9;
      if (edge.kind === 0) return edge.dist * 1.15;
      return edge.dist;
    }
    if (edge.kind === 2) return edge.dist * 0.85;
    if (edge.kind === 1) return edge.dist * 0.96;
    if (edge.kind === 3) return edge.dist * 1.12;
    return edge.dist * 1.22;
  }

  private runAStar(
    startIdx: number,
    goalIdx: number,
    mode: 'walk' | 'drive',
    stepFree: boolean,
  ): { nodeSeq: number[]; edgeSeq: AdjEdge[] } | null {
    const n = this.nodes.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const parentEdge: (AdjEdge | null)[] = new Array(n).fill(null);
    const closed = new Uint8Array(n);

    const hScale = mode === 'drive' ? 1.0 : stepFree ? 0.88 : 0.82;
    const goalCoord = this.nodes[goalIdx];

    gScore[startIdx] = 0;
    const heap = new MinHeap();
    heap.push(startIdx, distMeters(this.nodes[startIdx], goalCoord) * hScale);

    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop()!;
      const u = cur.node;
      if (u === goalIdx) {
        found = true;
        break;
      }
      if (closed[u]) continue;
      closed[u] = 1;

      for (const edge of this.adj[u]) {
        if (closed[edge.to]) continue;
        const w = this.edgeWeight(edge, mode, stepFree);
        if (!Number.isFinite(w)) continue;
        const tentative = gScore[u] + w;
        if (tentative < gScore[edge.to]) {
          gScore[edge.to] = tentative;
          parent[edge.to] = u;
          parentEdge[edge.to] = edge;
          const h = distMeters(this.nodes[edge.to], goalCoord) * hScale;
          heap.push(edge.to, tentative + h);
        }
      }
    }

    if (!found) return null;

    const nodeSeq: number[] = [];
    const edgeSeq: AdjEdge[] = [];
    let cur = goalIdx;
    while (cur !== -1) {
      nodeSeq.push(cur);
      const pe = parentEdge[cur];
      if (pe) edgeSeq.push(pe);
      cur = parent[cur];
    }
    nodeSeq.reverse();
    edgeSeq.reverse();
    return { nodeSeq, edgeSeq };
  }

  private buildWalkLegs(nodeSeq: number[], edgeSeq: AdjEdge[]) {
    const coordinates: [number, number][] = nodeSeq.map((idx) => this.nodes[idx]);
    const segments: ComputedRoute['segments'] = [];
    let totalDistanceM = 0;
    let shortcutCount = 0;
    let stepsCount = 0;

    interface RawLeg {
      kind: 'road' | 'footway' | 'shortcut' | 'steps';
      name: string;
      dist: number;
      coords: [number, number][];
    }
    const legs: RawLeg[] = [];

    for (let i = 0; i < edgeSeq.length; i++) {
      const e = edgeSeq[i];
      const k = KIND_NAMES[e.kind] || 'footway';
      const c0 = this.nodes[nodeSeq[i]];
      const c1 = this.nodes[nodeSeq[i + 1]];
      totalDistanceM += e.dist;

      if (segments.length > 0 && segments[segments.length - 1].kind === k) {
        segments[segments.length - 1].coordinates.push(c1);
      } else {
        segments.push({ kind: k, coordinates: [c0, c1] });
      }

      const prevLeg = legs[legs.length - 1];
      if (prevLeg && prevLeg.name === e.name && prevLeg.kind === k) {
        prevLeg.dist += e.dist;
        prevLeg.coords.push(c1);
      } else {
        if (k === 'shortcut') shortcutCount++;
        if (k === 'steps') stepsCount++;
        legs.push({ kind: k, name: e.name, dist: e.dist, coords: [c0, c1] });
      }
    }

    const steps: RouteStep[] = [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (leg.dist < 2 && legs.length > 1) continue;
      let action = '';
      if (i === 0) {
        const dir = compassDirection(leg.coords[0], leg.coords[leg.coords.length - 1]);
        action = `Head ${dir} on ${leg.name}`;
      } else {
        const prev = legs[i - 1];
        const verb = turnVerb(
          prev.coords[Math.max(0, prev.coords.length - 2)],
          leg.coords[0],
          leg.coords[Math.min(1, leg.coords.length - 1)],
        );
        if (leg.kind === 'shortcut') {
          action = `${verb} onto shortcut (${leg.name})`;
        } else if (leg.kind === 'steps') {
          action = `${verb} via stairway`;
        } else {
          action = `${verb} onto ${leg.name}`;
        }
      }
      steps.push({
        instruction: action,
        detail:
          leg.kind === 'shortcut'
            ? 'Covered walkway / pedestrian shortcut'
            : leg.kind === 'steps'
              ? 'Outdoor campus steps'
              : leg.kind === 'road'
                ? 'Roadside'
                : 'Campus footpath',
        distanceM: Math.round(leg.dist),
        kind: leg.kind,
        coord: leg.coords[0],
      });
    }

    return { coordinates, segments, totalDistanceM, shortcutCount, stepsCount, steps };
  }

  /**
   * Join a custom start/end coordinate (map pick, device location) to the
   * nearest graph node so the drawn route begins where the visitor is.
   */
  private connectPointEnds(
    origin: SearchItem,
    dest: SearchItem,
    coordinates: [number, number][],
    segments: ComputedRoute['segments'],
  ): { startM: number; endM: number } {
    let startM = 0;
    let endM = 0;

    if (origin.entrance_node < 0 && coordinates.length > 0) {
      const gap = distMeters(origin.center, coordinates[0]);
      if (gap > 3) {
        const first = coordinates[0];
        coordinates.unshift(origin.center);
        if (segments.length > 0) {
          segments[0].coordinates.unshift(origin.center);
        } else if (coordinates.length > 1) {
          segments.push({ kind: 'footway', coordinates: [origin.center, first] });
        }
        startM = gap;
      }
    }

    if (dest.entrance_node < 0 && coordinates.length > 0) {
      const last = coordinates[coordinates.length - 1];
      const gap = distMeters(last, dest.center);
      if (gap > 3) {
        coordinates.push(dest.center);
        if (segments.length > 0) {
          segments[segments.length - 1].coordinates.push(dest.center);
        } else {
          segments.push({ kind: 'footway', coordinates: [last, dest.center] });
        }
        endM = gap;
      }
    }

    return { startM, endM };
  }

  private sliceBusPolyline(
    routeId: string,
    boardCoord: [number, number],
    alightCoord: [number, number],
  ): [number, number][] {
    const poly = this.routePolylines.get(routeId);
    if (!poly || poly.length < 2) return [boardCoord, alightCoord];
    let i0 = 0;
    let d0 = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const d = distMeters(poly[i], boardCoord);
      if (d < d0) {
        d0 = d;
        i0 = i;
      }
    }
    let i1 = i0;
    let d1 = Infinity;
    // Search forward first along loop
    for (let i = i0; i < poly.length; i++) {
      const d = distMeters(poly[i], alightCoord);
      if (d < d1) {
        d1 = d;
        i1 = i;
      }
    }
    if (d1 > 120) {
      // Allow wrap-around on circular route
      for (let i = 0; i < i0; i++) {
        const d = distMeters(poly[i], alightCoord);
        if (d < d1) {
          d1 = d;
          i1 = i;
        }
      }
    }
    if (i1 >= i0) {
      const sl = poly.slice(i0, i1 + 1);
      return sl.length >= 2 ? sl : [boardCoord, alightCoord];
    }
    const wrapped = [...poly.slice(i0), ...poly.slice(0, i1 + 1)];
    return wrapped.length >= 2 ? wrapped : [boardCoord, alightCoord];
  }

  private computeBusRoute(
    origin: SearchItem,
    dest: SearchItem,
    stepFree: boolean,
  ): ComputedRoute | null {
    if (this.transitRoutes.length === 0) {
      return this.computeWalkOrDrive(origin, dest, 'walk', stepFree);
    }

    const startNode =
      !stepFree && origin.entrance_node >= 0 && origin.entrance_node < this.nodes.length
        ? origin.entrance_node
        : this.findNearestNode(origin.center, 'walk', stepFree);
    const goalNode =
      !stepFree && dest.entrance_node >= 0 && dest.entrance_node < this.nodes.length
        ? dest.entrance_node
        : this.findNearestNode(dest.center, 'walk', stepFree);

    // Direct 1-bus candidates
    interface BusCandidate {
      legs: { route: TransitRoute; boardIdx: number; alightIdx: number; busDistM: number; stopCount: number }[];
      firstStopWalkM: number;
      lastStopWalkM: number;
      scoreMin: number;
    }

    let best: BusCandidate | null = null;

    const legDistance = (r: TransitRoute, i: number, j: number): { dist: number; stops: number } => {
      const m = r.leg_distances_m.length;
      if (m === 0) return { dist: distMeters(r.stops[i].coord, r.stops[j].coord), stops: 1 };
      let d = 0;
      let count = 0;
      let idx = i;
      let safety = 0;
      while (idx !== j && safety <= m + 2) {
        d += r.leg_distances_m[idx % m] ?? 250;
        idx = (idx + 1) % r.stops.length;
        if (idx === r.stops.length - 1 && j < i) idx = 0;
        count += 1;
        safety += 1;
      }
      return { dist: d, stops: Math.max(1, count) };
    };

    for (const r of this.transitRoutes) {
      for (let i = 0; i < r.stops.length; i++) {
        const w1 = distMeters(origin.center, r.stops[i].coord);
        if (w1 > 750) continue;
        for (let j = 0; j < r.stops.length; j++) {
          if (i === j) continue;
          // For unidirectional/open routes require i < j; circular loops allow wrap
          const isLoop = r.code !== 'D' || j > i;
          if (!isLoop && j < i) continue;
          const w2 = distMeters(r.stops[j].coord, dest.center);
          if (w2 > 750) continue;
          const { dist: bd, stops } = legDistance(r, i, j);
          if (bd < 180) continue;
          const score = (w1 + w2) / 75 + r.headway_min * 0.45 + bd / 360;
          if (!best || score < best.scoreMin) {
            best = {
              legs: [{ route: r, boardIdx: i, alightIdx: j, busDistM: bd, stopCount: stops }],
              firstStopWalkM: w1,
              lastStopWalkM: w2,
              scoreMin: score,
            };
          }
        }
      }
    }

    // 1-transfer candidates (especially useful MRT/LRT <-> Residential Colleges via UM Central/DTC)
    for (const r1 of this.transitRoutes) {
      for (let i = 0; i < r1.stops.length; i++) {
        const w1 = distMeters(origin.center, r1.stops[i].coord);
        if (w1 > 700) continue;
        for (let t1 = 0; t1 < r1.stops.length; t1++) {
          if (t1 === i) continue;
          const { dist: bd1, stops: s1 } = legDistance(r1, i, t1);
          if (bd1 < 180) continue;
          for (const r2 of this.transitRoutes) {
            if (r2.id === r1.id) continue;
            for (let t2 = 0; t2 < r2.stops.length; t2++) {
              if (distMeters(r1.stops[t1].coord, r2.stops[t2].coord) > 120) continue;
              for (let j = 0; j < r2.stops.length; j++) {
                if (j === t2) continue;
                const w2 = distMeters(r2.stops[j].coord, dest.center);
                if (w2 > 700) continue;
                const { dist: bd2, stops: s2 } = legDistance(r2, t2, j);
                if (bd2 < 180) continue;
                const score =
                  (w1 + w2) / 75 +
                  (r1.headway_min + r2.headway_min) * 0.4 +
                  (bd1 + bd2) / 360 +
                  4.5; // transfer penalty
                if (!best || score < best.scoreMin) {
                  best = {
                    legs: [
                      { route: r1, boardIdx: i, alightIdx: t1, busDistM: bd1, stopCount: s1 },
                      { route: r2, boardIdx: t2, alightIdx: j, busDistM: bd2, stopCount: s2 },
                    ],
                    firstStopWalkM: w1,
                    lastStopWalkM: w2,
                    scoreMin: score,
                  };
                }
              }
            }
          }
        }
      }
    }

    if (!best) {
      return this.computeWalkOrDrive(origin, dest, 'walk', stepFree);
    }

    // Assemble walk -> bus -> (transfer walk -> bus) -> walk
    const firstBoardStop = best.legs[0].route.stops[best.legs[0].boardIdx];
    const lastAlightStop = best.legs[best.legs.length - 1].route.stops[best.legs[best.legs.length - 1].alightIdx];

    const coordinates: [number, number][] = [];
    const segments: ComputedRoute['segments'] = [];
    const steps: RouteStep[] = [];
    let totalDistanceM = 0;
    let shortcutCount = 0;
    let stepsCount = 0;

    if (origin.kind === 'room' && origin.floor && origin.floor > 0) {
      steps.push({
        instruction: `Exit ${origin.title} (Level ${origin.floor})`,
        detail: 'Head down to ground exit',
        distanceM: 15,
        kind: 'indoor',
        coord: origin.center,
      });
    }

    const walkIn = this.runAStar(startNode, firstBoardStop.walk_node, 'walk', stepFree);
    if (walkIn) {
      const parsed = this.buildWalkLegs(walkIn.nodeSeq, walkIn.edgeSeq);
      coordinates.push(...parsed.coordinates);
      segments.push(...parsed.segments);
      totalDistanceM += parsed.totalDistanceM;
      shortcutCount += parsed.shortcutCount;
      stepsCount += parsed.stepsCount;
      if (parsed.totalDistanceM >= 20) {
        steps.push({
          instruction: `Walk to ${firstBoardStop.name}`,
          detail: `${Math.round(parsed.totalDistanceM)} m via campus walkways`,
          distanceM: Math.round(parsed.totalDistanceM),
          kind: 'footway',
          coord: origin.center,
        });
      }
    }

    const busRoutesUsed: string[] = [];
    for (let li = 0; li < best.legs.length; li++) {
      const leg = best.legs[li];
      const boardStop = leg.route.stops[leg.boardIdx];
      const alightStop = leg.route.stops[leg.alightIdx];
      busRoutesUsed.push(leg.route.code);

      if (li > 0) {
        const prevAlight = best.legs[li - 1].route.stops[best.legs[li - 1].alightIdx];
        const xferWalk = distMeters(prevAlight.coord, boardStop.coord);
        if (xferWalk > 12) {
          segments.push({ kind: 'footway', coordinates: [prevAlight.coord, boardStop.coord] });
          steps.push({
            instruction: `Transfer walk to ${boardStop.name}`,
            detail: `${Math.round(xferWalk)} m transfer`,
            distanceM: Math.round(xferWalk),
            kind: 'footway',
            coord: prevAlight.coord,
          });
          totalDistanceM += xferWalk;
        }
      }

      const poly = this.sliceBusPolyline(leg.route.id, boardStop.coord, alightStop.coord);
      coordinates.push(...poly);
      segments.push({
        kind: 'bus',
        color: leg.route.color,
        routeCode: leg.route.code,
        coordinates: poly,
      });
      totalDistanceM += leg.busDistM;

      steps.push({
        instruction: `Board ${leg.route.code} (${leg.route.operator})`,
        detail: `${boardStop.name} → ${alightStop.name} (${leg.stopCount} stop${leg.stopCount > 1 ? 's' : ''}) • every ~${leg.route.headway_min} min`,
        distanceM: Math.round(leg.busDistM),
        kind: 'bus',
        routeCode: leg.route.code,
        routeColor: leg.route.color,
        coord: boardStop.coord,
      });
    }

    const walkOut = this.runAStar(lastAlightStop.walk_node, goalNode, 'walk', stepFree);
    if (walkOut) {
      const parsed = this.buildWalkLegs(walkOut.nodeSeq, walkOut.edgeSeq);
      coordinates.push(...parsed.coordinates);
      segments.push(...parsed.segments);
      totalDistanceM += parsed.totalDistanceM;
      shortcutCount += parsed.shortcutCount;
      stepsCount += parsed.stepsCount;
      if (parsed.totalDistanceM >= 20) {
        steps.push({
          instruction: `Alight at ${lastAlightStop.name} and walk to ${dest.title}`,
          detail: `${Math.round(parsed.totalDistanceM)} m final walk`,
          distanceM: Math.round(parsed.totalDistanceM),
          kind: 'footway',
          coord: lastAlightStop.coord,
        });
      }
    }

    const connector = this.connectPointEnds(origin, dest, coordinates, segments);
    totalDistanceM += connector.startM + connector.endM;
    if (connector.startM > 3) {
      steps.unshift({
        instruction: `Start from ${origin.title}`,
        detail: 'Head to the nearest campus path',
        distanceM: Math.round(connector.startM),
        kind: 'footway',
        coord: origin.center,
      });
    }

    if (dest.kind === 'room') {
      const floorText = dest.floor && dest.floor > 0 ? `Level ${dest.floor}` : 'Ground Floor (G)';
      steps.push({
        instruction: `Enter building and proceed to ${floorText}`,
        detail: `Head inside to ${dest.title}`,
        distanceM: 15,
        kind: 'indoor',
        coord: dest.center,
      });
    }
    steps.push({
      instruction: `Arrive at ${dest.title}`,
      detail: dest.subtitle,
      distanceM: 0,
      kind: 'indoor',
      coord: dest.center,
    });

    const walkDist = Math.max(0, best.firstStopWalkM + best.lastStopWalkM + connector.startM + connector.endM);
    const busDist = Math.max(0, totalDistanceM - walkDist);
    const waitMin = best.legs.reduce((acc, l) => acc + l.route.headway_min * 0.45, 0);
    const estimatedMinutes = Math.max(2, Math.round(walkDist / 78 + busDist / 380 + waitMin));

    return {
      mode: 'bus',
      stepFreeUsed: stepFree,
      coordinates,
      segments,
      totalDistanceM: Math.round(totalDistanceM),
      estimatedMinutes,
      shortcutCount,
      stepsCount,
      busRoutesUsed,
      steps,
      originLabel: origin.title,
      destLabel: dest.title,
    };
  }

  private computeWalkOrDrive(
    origin: SearchItem,
    dest: SearchItem,
    mode: 'walk' | 'drive',
    stepFree: boolean,
  ): ComputedRoute | null {
    const startIdx =
      mode === 'walk' && !stepFree && origin.entrance_node >= 0 && origin.entrance_node < this.nodes.length
        ? origin.entrance_node
        : this.findNearestNode(origin.center, mode, stepFree);
    const goalIdx =
      mode === 'walk' && !stepFree && dest.entrance_node >= 0 && dest.entrance_node < this.nodes.length
        ? dest.entrance_node
        : this.findNearestNode(dest.center, mode, stepFree);

    const res = this.runAStar(startIdx, goalIdx, mode, stepFree);
    if (!res) {
      if (mode === 'drive' || stepFree) {
        return this.computeWalkOrDrive(origin, dest, 'walk', false);
      }
      return null;
    }

    const built = this.buildWalkLegs(res.nodeSeq, res.edgeSeq);
    const connector = this.connectPointEnds(origin, dest, built.coordinates, built.segments);
    built.totalDistanceM += connector.startM + connector.endM;
    const steps: RouteStep[] = [];
    let totalDistanceM = built.totalDistanceM;

    if (origin.kind === 'room' && origin.floor && origin.floor > 0) {
      steps.push({
        instruction: `Exit ${origin.title} (Level ${origin.floor})`,
        detail: 'Take stairs or lift to Ground floor and exit building',
        distanceM: 15,
        kind: 'indoor',
        coord: origin.center,
      });
    }

    if (connector.startM > 3) {
      steps.push({
        instruction: `Start from ${origin.title}`,
        detail: 'Head to the nearest campus path',
        distanceM: Math.round(connector.startM),
        kind: 'footway',
        coord: origin.center,
      });
    }

    steps.push(...built.steps);

    const lastCoord = built.coordinates[built.coordinates.length - 1] ?? dest.center;
    const finalGap = distMeters(lastCoord, dest.center);
    if (mode === 'drive' && finalGap > 20) {
      steps.push({
        instruction: `Park nearby and walk ${Math.round(finalGap)} m to entrance`,
        detail: 'Destination is inside pedestrian campus zone',
        distanceM: Math.round(finalGap),
        kind: 'footway',
        coord: dest.center,
      });
      totalDistanceM += finalGap;
    }

    if (dest.kind === 'room') {
      const floorText = dest.floor && dest.floor > 0 ? `Level ${dest.floor}` : 'Ground Floor (G)';
      steps.push({
        instruction: `Enter building and proceed to ${floorText}`,
        detail:
          dest.floor && dest.floor > 0
            ? `Use main lobby stairs or lift to ${floorText}`
            : 'Room is on the ground floor',
        distanceM: 15,
        kind: 'indoor',
        coord: dest.center,
      });
    }

    steps.push({
      instruction: `Arrive at ${dest.title}`,
      detail: dest.subtitle,
      distanceM: 0,
      kind: 'indoor',
      coord: dest.center,
    });

    const speedMpm = mode === 'drive' ? 420 : stepFree ? 68 : 80;
    const estimatedMinutes = Math.max(1, Math.round(totalDistanceM / speedMpm));

    return {
      mode,
      stepFreeUsed: mode === 'walk' && stepFree,
      coordinates: built.coordinates,
      segments: built.segments,
      totalDistanceM: Math.round(totalDistanceM),
      estimatedMinutes,
      shortcutCount: built.shortcutCount,
      stepsCount: built.stepsCount,
      busRoutesUsed: [],
      steps,
      originLabel: origin.title,
      destLabel: dest.title,
    };
  }

  computeRoute(
    origin: SearchItem,
    dest: SearchItem,
    mode: RouteMode,
    options?: { stepFree?: boolean },
  ): ComputedRoute | null {
    const stepFree = Boolean(options?.stepFree);
    if (mode === 'bus') {
      return this.computeBusRoute(origin, dest, stepFree);
    }
    return this.computeWalkOrDrive(origin, dest, mode, stepFree);
  }
}
