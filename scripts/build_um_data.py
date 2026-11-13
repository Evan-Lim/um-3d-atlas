import heapq
import json
import math
import os
import sys
from collections import defaultdict, deque

sys.path.insert(0, os.path.dirname(__file__))
from um_curated_metadata import BUILDING_ROOM_PROFILES, EXTRA_BUILDING_OVERRIDES, FACULTIES

RAW_PATH = r"C:\Users\EvanLim\.gemini\antigravity\brain\c8580084-3c0d-494a-bff2-4e4f26e9e9c4\scratch\osm_um_raw\um_osm_merged.json"
KERINCHI_TILE_PATH = r"C:\Users\EvanLim\.gemini\antigravity\brain\c8580084-3c0d-494a-bff2-4e4f26e9e9c4\scratch\osm_um_raw\tile_kerinchi.json"
NOM_PATH = r"C:\Users\EvanLim\.gemini\antigravity\brain\c8580084-3c0d-494a-bff2-4e4f26e9e9c4\scratch\nom_relation_4046604.json"
OUT_DIR = r"C:\Users\EvanLim\.gemini\antigravity\scratch\um-3d-map\public\data"
os.makedirs(OUT_DIR, exist_ok=True)

METERS_PER_DEG_LAT = 110540.0
REF_LAT = 3.122
METERS_PER_DEG_LON = 111320.0 * math.cos(math.radians(REF_LAT))


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    dx = (lon2 - lon1) * METERS_PER_DEG_LON
    dy = (lat2 - lat1) * METERS_PER_DEG_LAT
    return math.hypot(dx, dy)


def signed_ring_area(ring: list[list[float]]) -> float:
    area = 0.0
    for i in range(len(ring) - 1):
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return area * 0.5


def normalize_ring(ring: list[list[float]], ccw: bool = True) -> list[list[float]]:
    """Remove duplicate vertices, close ring, and enforce RFC 7946 winding."""
    cleaned: list[list[float]] = []
    for pt in ring:
        p = [round(float(pt[0]), 7), round(float(pt[1]), 7)]
        if not cleaned or abs(p[0] - cleaned[-1][0]) > 1e-8 or abs(p[1] - cleaned[-1][1]) > 1e-8:
            cleaned.append(p)
    if len(cleaned) >= 2 and abs(cleaned[0][0] - cleaned[-1][0]) < 1e-8 and abs(cleaned[0][1] - cleaned[-1][1]) < 1e-8:
        cleaned.pop()
    if len(cleaned) < 3:
        return []
    cleaned.append(list(cleaned[0]))
    sa = signed_ring_area(cleaned)
    if ccw and sa < 0:
        cleaned.reverse()
    elif (not ccw) and sa > 0:
        cleaned.reverse()
    return cleaned


def pt_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-18) + xi):
            inside = not inside
        j = i
    return inside


def pt_in_multipoly(lon: float, lat: float, polys: list) -> bool:
    for poly in polys:
        if pt_in_ring(lon, lat, poly[0]):
            if not any(pt_in_ring(lon, lat, hole) for hole in poly[1:]):
                return True
    return False


def ring_area_m2(ring: list[list[float]]) -> float:
    if len(ring) < 3:
        return 0.0
    lon0, lat0 = ring[0]
    area = 0.0
    for i in range(len(ring) - 1):
        x1 = (ring[i][0] - lon0) * METERS_PER_DEG_LON
        y1 = (ring[i][1] - lat0) * METERS_PER_DEG_LAT
        x2 = (ring[i + 1][0] - lon0) * METERS_PER_DEG_LON
        y2 = (ring[i + 1][1] - lat0) * METERS_PER_DEG_LAT
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def ring_centroid(ring: list[list[float]]) -> tuple[float, float]:
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    if not pts:
        return (0.0, 0.0)
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def way_coords(way: dict, nodes: dict) -> list[list[float]]:
    coords = []
    for nid in way.get("nodes", []):
        n = nodes.get(nid)
        if n:
            coords.append([round(n["lon"], 7), round(n["lat"], 7)])
    return coords


def stitch_relation_rings_by_role(rel: dict, ways: dict, nodes: dict, roles: tuple[str, ...]) -> list[list[list[float]]]:
    role_ways = []
    for m in rel.get("members", []):
        if m.get("type") == "way" and m.get("role", "outer") in roles:
            w = ways.get(m["ref"])
            if w and len(w.get("nodes", [])) >= 2:
                role_ways.append(list(w["nodes"]))

    rings = []
    used = [False] * len(role_ways)
    for i in range(len(role_ways)):
        if used[i]:
            continue
        used[i] = True
        chain = list(role_ways[i])
        while chain[0] != chain[-1]:
            found = False
            for j in range(len(role_ways)):
                if used[j]:
                    continue
                cand = role_ways[j]
                if cand[0] == chain[-1]:
                    chain.extend(cand[1:])
                    used[j] = True
                    found = True
                    break
                elif cand[-1] == chain[-1]:
                    chain.extend(list(reversed(cand[:-1])))
                    used[j] = True
                    found = True
                    break
            if not found:
                break
        if len(chain) >= 3:
            coords = [[round(nodes[nid]["lon"], 7), round(nodes[nid]["lat"], 7)] for nid in chain if nid in nodes]
            norm = normalize_ring(coords, ccw=(roles != ("inner",)))
            if norm and ring_area_m2(norm) >= 8.0:
                rings.append(norm)
    return rings


def sutherland_hodgman_clip_rect(poly_uv: list[tuple[float, float]], u0: float, u1: float, v0: float, v1: float) -> list[tuple[float, float]]:
    def clip_edge(pts, inside_fn, intersect_fn):
        if not pts:
            return []
        out = []
        prev = pts[-1]
        prev_in = inside_fn(prev)
        for curr in pts:
            curr_in = inside_fn(curr)
            if curr_in:
                if not prev_in:
                    out.append(intersect_fn(prev, curr))
                out.append(curr)
            elif prev_in:
                out.append(intersect_fn(prev, curr))
            prev = curr
            prev_in = curr_in
        return out

    def lerp(a, b, t):
        return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))

    pts = list(poly_uv)
    pts = clip_edge(pts, lambda p: p[0] >= u0, lambda a, b: lerp(a, b, (u0 - a[0]) / ((b[0] - a[0]) or 1e-12)))
    pts = clip_edge(pts, lambda p: p[0] <= u1, lambda a, b: lerp(a, b, (u1 - a[0]) / ((b[0] - a[0]) or 1e-12)))
    pts = clip_edge(pts, lambda p: p[1] >= v0, lambda a, b: lerp(a, b, (v0 - a[1]) / ((b[1] - a[1]) or 1e-12)))
    pts = clip_edge(pts, lambda p: p[1] <= v1, lambda a, b: lerp(a, b, (v1 - a[1]) / ((b[1] - a[1]) or 1e-12)))
    return pts


def poly_area_2d(pts: list[tuple[float, float]]) -> float:
    if len(pts) < 3:
        return 0.0
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) * 0.5


def vertical_spans_at_u(poly_uv: list[tuple[float, float]], u_val: float) -> list[tuple[float, float]]:
    vs = []
    n = len(poly_uv)
    for i in range(n):
        x1, y1 = poly_uv[i]
        x2, y2 = poly_uv[(i + 1) % n]
        if (x1 <= u_val < x2) or (x2 <= u_val < x1):
            t = (u_val - x1) / ((x2 - x1) or 1e-12)
            vs.append(y1 + t * (y2 - y1))
    vs.sort()
    spans = []
    for k in range(0, len(vs) - 1, 2):
        if vs[k + 1] - vs[k] > 1.0:
            spans.append((vs[k], vs[k + 1]))
    return spans


def principal_angle(pts_xy: list[tuple[float, float]]) -> float:
    best_len = -1.0
    best_ang = 0.0
    for i in range(len(pts_xy)):
        x1, y1 = pts_xy[i]
        x2, y2 = pts_xy[(i + 1) % len(pts_xy)]
        d = math.hypot(x2 - x1, y2 - y1)
        if d > best_len:
            best_len = d
            best_ang = math.atan2(y2 - y1, x2 - x1)
    return best_ang


def chaikin_smooth_closed(pts: list[tuple[float, float]], passes: int = 2) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    cur = list(pts)
    for _ in range(passes):
        nxt = []
        n = len(cur)
        for i in range(n):
            p0 = cur[i]
            p1 = cur[(i + 1) % n]
            nxt.append((0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]))
            nxt.append((0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]))
        cur = nxt
    return cur


def _pt_in_xy_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _pt_to_seg_dist2(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    c2 = vx * vx + vy * vy
    if c2 <= 1e-12:
        return wx * wx + wy * wy
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / c2))
    dx = px - (ax + t * vx)
    dy = py - (ay + t * vy)
    return dx * dx + dy * dy


def build_organic_zone_polygons(
    bldg_rings: list[list[list[float]]],
    pad_m: float = 20.0,
    cell_m: float = 5.5,
) -> list[list[list[float]]]:
    """Build tight, building-aligned compound outer rings from actual member buildings (no square boxes)."""
    if not bldg_rings:
        return []
    all_pts = [p for r in bldg_rings for p in r]
    lon0 = sum(p[0] for p in all_pts) / len(all_pts)
    lat0 = sum(p[1] for p in all_pts) / len(all_pts)

    xy_rings = [
        [((p[0] - lon0) * METERS_PER_DEG_LON, (p[1] - lat0) * METERS_PER_DEG_LAT) for p in r[:-1]]
        for r in bldg_rings
        if len(r) >= 4
    ]
    xy_rings = [r for r in xy_rings if len(r) >= 3]
    if not xy_rings:
        return []

    xs = [p[0] for r in xy_rings for p in r]
    ys = [p[1] for r in xy_rings for p in r]
    x_min = min(xs) - pad_m - cell_m
    y_min = min(ys) - pad_m - cell_m
    x_max = max(xs) + pad_m + cell_m
    y_max = max(ys) + pad_m + cell_m

    cols = max(8, min(140, int(math.ceil((x_max - x_min) / cell_m))))
    rows = max(8, min(140, int(math.ceil((y_max - y_min) / cell_m))))
    dx = (x_max - x_min) / cols
    dy = (y_max - y_min) / rows
    pad2 = pad_m * pad_m

    ring_bboxes = [
        (min(p[0] for p in r) - pad_m, min(p[1] for p in r) - pad_m,
         max(p[0] for p in r) + pad_m, max(p[1] for p in r) + pad_m, r)
        for r in xy_rings
    ]

    occ = [[False] * cols for _ in range(rows)]
    for ry in range(rows):
        py = y_min + (ry + 0.5) * dy
        for rx in range(cols):
            px = x_min + (rx + 0.5) * dx
            hit = False
            for bx0, by0, bx1, by1, r in ring_bboxes:
                if px < bx0 or px > bx1 or py < by0 or py > by1:
                    continue
                if _pt_in_xy_ring(px, py, r):
                    hit = True
                    break
                n = len(r)
                for i in range(n):
                    ax, ay = r[i]
                    bx, by = r[(i + 1) % n]
                    if _pt_to_seg_dist2(px, py, ax, ay, bx, by) <= pad2:
                        hit = True
                        break
                if hit:
                    break
            occ[ry][rx] = hit

    # Extract boundary directed grid segments (CCW around occupied cells)
    adj: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for ry in range(rows):
        for rx in range(cols):
            if not occ[ry][rx]:
                continue
            if ry == 0 or not occ[ry - 1][rx]:
                adj.setdefault((rx, ry), []).append((rx + 1, ry))
            if rx == cols - 1 or not occ[ry][rx + 1]:
                adj.setdefault((rx + 1, ry), []).append((rx + 1, ry + 1))
            if ry == rows - 1 or not occ[ry + 1][rx]:
                adj.setdefault((rx + 1, ry + 1), []).append((rx, ry + 1))
            if rx == 0 or not occ[ry][rx - 1]:
                adj.setdefault((rx, ry + 1), []).append((rx, ry))

    loops: list[list[tuple[int, int]]] = []
    used = set()
    for start_u, outs in adj.items():
        for start_v in outs:
            if (start_u, start_v) in used:
                continue
            loop = [start_u]
            u, v = start_u, start_v
            steps = 0
            while steps < 5000:
                used.add((u, v))
                loop.append(v)
                if v == start_u:
                    break
                cands = [w for w in adj.get(v, []) if (v, w) not in used]
                if not cands:
                    break
                # Turn right preference keeps outer perimeter clean
                dvx, dvy = v[0] - u[0], v[1] - u[1]
                def turn_rank(w):
                    wx, wy = w[0] - v[0], w[1] - v[1]
                    cross = dvx * wy - dvy * wx
                    dot = dvx * wx + dvy * wy
                    return -math.atan2(cross, dot)
                cands.sort(key=turn_rank)
                u, v = v, cands[0]
                steps += 1
            if len(loop) >= 4 and loop[-1] == loop[0]:
                loops.append(loop[:-1])

    out_rings: list[list[list[float]]] = []
    for lp in loops:
        # Remove collinear intermediate grid vertices before Chaikin smoothing
        simp = []
        n = len(lp)
        for i in range(n):
            p_prev = lp[(i - 1) % n]
            p_cur = lp[i]
            p_next = lp[(i + 1) % n]
            if (p_cur[0] - p_prev[0]) * (p_next[1] - p_cur[1]) != (p_cur[1] - p_prev[1]) * (p_next[0] - p_cur[0]):
                simp.append((x_min + p_cur[0] * dx, y_min + p_cur[1] * dy))
        if len(simp) < 3:
            continue
        # Signed shoelace area in metric XY: exterior CCW contours have positive area;
        # negative area contours are inner courtyard gaps and must NOT become overlays.
        signed_a = 0.5 * sum(
            simp[i][0] * simp[(i + 1) % len(simp)][1] - simp[(i + 1) % len(simp)][0] * simp[i][1]
            for i in range(len(simp))
        )
        if signed_a <= 0:
            continue
        smoothed = chaikin_smooth_closed(simp, passes=2)
        ll = [
            [round(lon0 + px / METERS_PER_DEG_LON, 7), round(lat0 + py / METERS_PER_DEG_LAT, 7)]
            for px, py in smoothed
        ]
        norm = normalize_ring(ll, ccw=True)
        if norm and ring_area_m2(norm) >= 250.0:
            out_rings.append(norm)

    out_rings.sort(key=ring_area_m2, reverse=True)
    return out_rings


def generate_rooms_for_building(ring: list[list[float]], profile: dict, bldg_id: str) -> list[dict]:
    lon0, lat0 = ring_centroid(ring)
    pts_xy = [((p[0] - lon0) * METERS_PER_DEG_LON, (p[1] - lat0) * METERS_PER_DEG_LAT) for p in ring[:-1]]
    if len(pts_xy) < 3:
        return []

    theta = principal_angle(pts_xy)
    cos_t, sin_t = math.cos(-theta), math.sin(-theta)
    poly_uv = [(x * cos_t - y * sin_t, x * sin_t + y * cos_t) for x, y in pts_xy]

    us = [p[0] for p in poly_uv]
    u_min, u_max = min(us) + 0.7, max(us) - 0.7
    if u_max - u_min < 4.0:
        u_min, u_max = min(us) + 0.2, max(us) - 0.2

    cos_inv, sin_inv = math.cos(theta), math.sin(theta)

    def uv_to_lonlat(u, v):
        x = u * cos_inv - v * sin_inv
        y = u * sin_inv + v * cos_inv
        return [round(lon0 + x / METERS_PER_DEG_LON, 7), round(lat0 + y / METERS_PER_DEG_LAT, 7)]

    room_features = []
    floors = profile["floors"]
    for floor_num, rooms in sorted(floors.items()):
        n_rooms = len(rooms)
        if n_rooms == 0:
            continue
        base_h = round(floor_num * 3.8 + 0.15, 2)
        top_h = round((floor_num + 1) * 3.8 - 0.2, 2)

        if n_rooms <= 2:
            n_cols = n_rooms
            two_rows = False
        else:
            n_cols = math.ceil(n_rooms / 2)
            two_rows = True

        du = (u_max - u_min) / max(n_cols, 1)
        idx = 0
        for col in range(n_cols):
            su0 = u_min + col * du + 0.25
            su1 = u_min + (col + 1) * du - 0.25
            if su1 <= su0:
                su0, su1 = u_min + col * du, u_min + (col + 1) * du
            u_mid = 0.5 * (su0 + su1)
            spans = vertical_spans_at_u(poly_uv, u_mid)
            if not spans:
                spans = vertical_spans_at_u(poly_uv, 0.5 * (u_min + u_max))
            if not spans:
                continue
            v_lo, v_hi = max(spans, key=lambda s: s[1] - s[0])
            v_lo_in = v_lo + 0.55
            v_hi_in = v_hi - 0.55
            if v_hi_in - v_lo_in < 2.5:
                v_lo_in, v_hi_in = v_lo + 0.2, v_hi - 0.2
            v_mid = 0.5 * (v_lo_in + v_hi_in)

            if not two_rows or idx == n_rooms - 1 and (n_rooms % 2 == 1 and col == n_cols - 1):
                slots = [(su0, su1, v_lo_in, v_hi_in)]
            else:
                corridor_half = 0.9 if (v_hi_in - v_lo_in) > 8.0 else 0.35
                slots = [
                    (su0, su1, v_mid + corridor_half, v_hi_in),
                    (su0, su1, v_lo_in, v_mid - corridor_half),
                ]

            for slot in slots:
                if idx >= n_rooms:
                    break
                r_meta = rooms[idx]
                idx += 1
                clipped = sutherland_hodgman_clip_rect(poly_uv, *slot)
                if len(clipped) < 3 or poly_area_2d(clipped) < 3.0:
                    cu0, cu1, cv0, cv1 = slot
                    clipped = [(cu0, cv0), (cu1, cv0), (cu1, cv1), (cu0, cv1)]
                coords = normalize_ring([uv_to_lonlat(u, v) for u, v in clipped], ccw=True)
                if not coords:
                    continue
                rc_lon, rc_lat = ring_centroid(coords)
                floor_lbl = "Ground (G)" if floor_num == 0 else f"Level {floor_num}"
                room_features.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [coords]},
                    "properties": {
                        "id": f"{bldg_id}::{r_meta['code']}",
                        "code": r_meta["code"],
                        "name": r_meta["name"],
                        "building_id": bldg_id,
                        "building_name": profile["display_name"],
                        "faculty_id": profile["faculty_id"],
                        "floor": floor_num,
                        "floor_label": floor_lbl,
                        "base_height": base_h,
                        "height": top_h,
                        "room_type": r_meta["type"],
                        "capacity": r_meta.get("cap", 30),
                        "center": [round(rc_lon, 6), round(rc_lat, 6)],
                        "source": r_meta.get("source", "Official UM Faculty Directory (footprint-mapped)"),
                        "osm_verified": False,
                    },
                })
    return room_features


def descriptive_area_building_name(zone: dict, tags: dict, levels: int, seq_counter: dict) -> tuple[str, str]:
    """Generate a meaningful contextual name anchored to the containing KK / Institute / Faculty / Area."""
    zone_code = zone["code"]
    zone_kind = zone.get("zone_kind", "faculty")
    btype = tags.get("building", "yes")
    am = tags.get("amenity", "")

    if am == "motorcycle_parking":
        role = "Motorcycle Shelter"
    elif am == "bicycle_parking":
        role = "Bicycle Shelter"
    elif btype in ("roof", "carport") or am == "shelter":
        role = "Covered Walkway Canopy" if btype == "roof" else "Covered Shelter"
    elif btype == "service" or tags.get("power") == "substation":
        role = "Utility & Substation Annex"
    elif btype == "mosque" or am == "place_of_worship":
        role = "Surau & Prayer Hall"
    elif btype == "greenhouse":
        role = "Botanical Glasshouse"
    elif btype == "hospital" or zone_kind == "medical":
        role = "Clinical & Medical Annex"
    elif btype in ("dormitory", "apartments", "house") or zone_kind == "college":
        role = "Residential Wing" if levels >= 2 else "Student Facility Annex"
    elif zone_kind == "institute":
        role = "Research Wing"
    elif btype == "retail":
        role = "Student Kiosk & Convenience Block"
    elif btype == "grandstand":
        role = "Sports Spectator Pavilion"
    elif levels >= 3:
        role = "Academic & Office Block"
    else:
        role = "Campus Annex"

    key = (zone["id"], role)
    seq_counter[key] = seq_counter.get(key, 0) + 1
    n = seq_counter[key]
    suffix = f" {n}" if n > 1 else ""
    en_name = f"{zone_code} — {role}{suffix}"
    return en_name, role


def main():
    print("Loading raw OSM data...")
    with open(RAW_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

    nodes = {n["id"]: n for n in raw["nodes"]}
    ways = {w["id"]: w for w in raw["ways"]}
    rels = {r["id"]: r for r in raw["relations"]}

    if os.path.exists(KERINCHI_TILE_PATH):
        with open(KERINCHI_TILE_PATH, "r", encoding="utf-8") as f:
            kd = json.load(f)
        for el in kd.get("elements", []):
            if el["type"] == "node":
                nodes[el["id"]] = el
            elif el["type"] == "way":
                ways[el["id"]] = el
            elif el["type"] == "relation":
                rels[el["id"]] = el
        print(f"Merged tile_kerinchi.json (total nodes={len(nodes)}, ways={len(ways)}, rels={len(rels)})")

    with open(NOM_PATH, "r", encoding="utf-8") as f:
        nom = json.load(f)

    # 1. UM BOUNDARY (strict RFC 7946 winding: CCW outer, CW inner holes!)
    um_geom_raw = nom["geojson"]
    raw_polys = um_geom_raw["coordinates"] if um_geom_raw["type"] == "MultiPolygon" else [um_geom_raw["coordinates"]]
    um_polys = []
    for p in raw_polys:
        outer = normalize_ring(p[0], ccw=True)
        inners = [normalize_ring(h, ccw=False) for h in p[1:]]
        inners = [h for h in inners if h]
        if outer:
            um_polys.append([outer] + inners)

    outer_box = normalize_ring([[101.60, 3.08], [101.70, 3.08], [101.70, 3.17], [101.60, 3.17], [101.60, 3.08]], ccw=True)
    mask_holes = [normalize_ring(p[0], ccw=False) for p in um_polys]
    boundary_fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "MultiPolygon", "coordinates": um_polys},
                "properties": {
                    "id": "um-boundary",
                    "name": "Universiti Malaya (Administrative Campus Boundary)",
                    "name_ms": "Sempadan Kampus Universiti Malaya",
                    "osm_relation": 4046604,
                    "postcode": "50603",
                    "city": "Kuala Lumpur",
                    "website": "https://www.um.edu.my/",
                },
            },
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [outer_box] + mask_holes},
                "properties": {"id": "um-outer-mask", "kind": "mask"},
            },
        ],
    }
    with open(os.path.join(OUT_DIR, "um_boundary.geojson"), "w", encoding="utf-8") as f:
        json.dump(boundary_fc, f)
    print(f"Saved um_boundary.geojson ({len(um_polys)} boundary polygons, CW mask holes verified)")

    # 2. FACULTIES, INDIVIDUAL KKs, INSTITUTES & CORE ZONES
    zone_features = []
    zone_polys_map = {}
    zone_by_id = {}
    for fac in FACULTIES:
        coords = None
        osm_ref = None
        if "polygon_coords" in fac:
            norm = normalize_ring(fac["polygon_coords"], ccw=True)
            if norm:
                coords = [norm]
                osm_ref = "road-aligned-cadastre"
        elif "osm_way" in fac:
            w = ways.get(fac["osm_way"])
            if w:
                norm = normalize_ring(way_coords(w, nodes), ccw=True)
                if norm:
                    coords = [norm]
                    osm_ref = f"way/{fac['osm_way']}"
        elif "osm_rel" in fac:
            r = rels.get(fac["osm_rel"])
            if r:
                rings = stitch_relation_rings_by_role(r, ways, nodes, ("outer", ""))
                if rings:
                    best = max(rings, key=ring_area_m2)
                    coords = [best]
                    osm_ref = f"rel/{fac['osm_rel']}"

        if coords is None and "bbox" in fac:
            x0, y0, x1, y1 = fac["bbox"]
            norm = normalize_ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], ccw=True)
            coords = [norm]
            osm_ref = "curated-zone"

        zone_polys_map[fac["id"]] = coords[0]
        zone_by_id[fac["id"]] = fac
        zone_features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": coords},
            "properties": {
                "id": fac["id"],
                "code": fac["code"],
                "zone_kind": fac.get("zone_kind", "faculty"),
                "name": fac["name"],
                "name_ms": fac["name_ms"],
                "category": fac["category"],
                "color": fac["color"],
                "website": fac["website"],
                "center": fac["center"],
                "zoom": fac["zoom"],
                "pitch": fac["pitch"],
                "bearing": fac["bearing"],
                "description": fac["description"],
                "osm_ref": osm_ref,
                "established": fac.get("established"),
                "dean_or_office": fac.get("dean_or_office"),
                "history": fac.get("history", ""),
                "departments": fac.get("departments", []),
                "facilities": fac.get("facilities", []),
                "capacity_stats": fac.get("capacity_stats", ""),
                "contact_email": fac.get("contact_email", ""),
                "phone": fac.get("phone", ""),
            },
        })

    # Defer writing um_faculties.geojson until buildings are classified so any fallback bbox
    # zones (FOM, FOP, FSES, APM, CORE) are replaced by organic compound hulls aligned to real buildings.
    zone_features_by_id = {feat["properties"]["id"]: feat for feat in zone_features}

    # 3. BUILDINGS (preserve courtyard holes, filter tiny/broken slivers, contextual area naming)
    rel_member_way_ids = set()
    raw_buildings = []

    for rid, r in rels.items():
        t = r.get("tags", {})
        if "building" in t and not t.get("building:part"):
            outers = stitch_relation_rings_by_role(r, ways, nodes, ("outer", ""))
            inners = stitch_relation_rings_by_role(r, ways, nodes, ("inner",))
            if outers:
                outer = max(outers, key=ring_area_m2)
                cx, cy = ring_centroid(outer)
                if pt_in_multipoly(cx, cy, um_polys):
                    holes = [h for h in inners if pt_in_ring(ring_centroid(h)[0], ring_centroid(h)[1], outer)]
                    raw_buildings.append((f"rel/{rid}", [outer] + holes, t))
                    for m in r.get("members", []):
                        if m.get("type") == "way":
                            rel_member_way_ids.add(m["ref"])

    for wid, w in ways.items():
        if wid in rel_member_way_ids:
            continue
        t = w.get("tags", {})
        if "building" in t and not t.get("building:part"):
            norm = normalize_ring(way_coords(w, nodes), ccw=True)
            if norm and ring_area_m2(norm) >= 12.0:
                cx, cy = ring_centroid(norm)
                if pt_in_multipoly(cx, cy, um_polys):
                    raw_buildings.append((f"way/{wid}", [norm], t))

    # Specific priority check order: individual KKs, institutes, faculties, PPUM, then CORE
    specific_zone_order = [
        "KK1", "KK2", "KK3", "KK4", "KK5", "KK6", "KK7", "KK8", "KK9", "KK10", "KK11", "KK12", "KK13", "IH",
        "IAS", "AEI", "KPPI", "RIMBA",
        "FSKTM", "FK", "FS", "FASS", "FP", "FPE", "FAB", "FLL", "FL", "FCA", "FOD", "FOP", "FOM", "FSES", "API", "APM", "PASUM",
        "PPUM", "CORE",
    ]

    def classify_zone(bid: str, cx: float, cy: float) -> str:
        if bid in BUILDING_ROOM_PROFILES:
            return BUILDING_ROOM_PROFILES[bid]["faculty_id"]
        if bid in EXTRA_BUILDING_OVERRIDES:
            return EXTRA_BUILDING_OVERRIDES[bid]["faculty_id"]
        for zid in specific_zone_order:
            if zid in zone_polys_map and pt_in_ring(cx, cy, zone_polys_map[zid]):
                return zid
        # Nearest zone fallback within campus
        return min(
            [f["id"] for f in FACULTIES],
            key=lambda fid: haversine_m(cx, cy, zone_by_id[fid]["center"][0], zone_by_id[fid]["center"][1]),
        )

    def parse_levels(bid: str, tags: dict) -> int:
        if bid in BUILDING_ROOM_PROFILES:
            return BUILDING_ROOM_PROFILES[bid]["levels"]
        if bid in EXTRA_BUILDING_OVERRIDES and "levels" in EXTRA_BUILDING_OVERRIDES[bid]:
            return EXTRA_BUILDING_OVERRIDES[bid]["levels"]
        lv = tags.get("building:levels")
        if lv:
            try:
                return max(1, min(20, round(float(str(lv).split(";")[0]))))
            except ValueError:
                pass
        btype = tags.get("building", "yes")
        if btype in ("roof", "carport", "shelter", "guardhouse"):
            return 1
        if btype in ("dormitory", "apartments"):
            return 4
        if btype in ("university", "college", "hospital"):
            return 3
        return 2

    def classify_category(tags: dict, name: str, zone_id: str) -> str:
        nl = name.lower()
        b = tags.get("building", "")
        am = tags.get("amenity", "")
        if am == "library" or "perpustakaan" in nl or "library" in nl:
            return "library"
        if "dewan kuliah" in nl or "lecture" in nl or "auditorium" in nl or "dtc" in nl:
            return "lecture_hall"
        if am in ("cafe", "fast_food", "restaurant", "food_court") or "kafe" in nl or "kafeteria" in nl or "kantin" in nl:
            return "dining"
        if am == "place_of_worship" or b == "mosque" or "surau" in nl or "masjid" in nl:
            return "worship"
        if b in ("roof", "carport", "shelter") or am in ("shelter", "motorcycle_parking", "bicycle_parking"):
            return "shelter"
        if b in ("dormitory", "apartments") or "kolej" in nl or zone_id.startswith("KK") or zone_id == "IH":
            return "residential"
        if b == "hospital" or "clinic" in nl or "klinik" in nl or "medical" in nl or "dental" in nl or zone_id == "PPUM":
            return "medical"
        if tags.get("leisure") in ("sports_hall", "sports_centre") or "stadium" in nl or "arena" in nl or "jimnasium" in nl or "kolam renang" in nl:
            return "sports"
        if b == "parking" or am == "parking":
            return "parking"
        if "makmal" in nl or "lab" in nl or "bengkel" in nl or zone_id in ("KPPI", "IAS", "AEI", "RIMBA"):
            return "lab" if "makmal" in nl or "lab" in nl else "research"
        if "canseleri" in nl or "pentadbiran" in nl or "pejabat" in nl or "office" in nl:
            return "admin"
        return "academic"

    building_features = []
    all_room_features = []
    bldg_centers = {}
    fac_color_map = {f["id"]: f["color"] for f in FACULTIES}
    zone_seq_counter = {}
    zone_member_rings: dict[str, list[list[list[float]]]] = {}

    for bid, poly_rings, tags in raw_buildings:
        outer = poly_rings[0]
        cx, cy = ring_centroid(outer)
        ov = EXTRA_BUILDING_OVERRIDES.get(bid, {})
        prof = BUILDING_ROOM_PROFILES.get(bid)
        fac_id = classify_zone(bid, cx, cy)
        zone = zone_by_id.get(fac_id, FACULTIES[0])
        levels = parse_levels(bid, tags)

        raw_name = prof["display_name"] if prof else ov.get("name:en") or tags.get("name:en") or tags.get("name") or ov.get("name") or ""
        ms_name = tags.get("name:ms") or tags.get("name") or ov.get("name") or raw_name
        code = (prof["code"] if prof else None) or ov.get("code") or tags.get("short_name") or tags.get("ref") or tags.get("addr:housenumber") or ""

        is_inferred_name = False
        if not raw_name:
            raw_name, _ = descriptive_area_building_name(zone, tags, levels, zone_seq_counter)
            ms_name = raw_name
            is_inferred_name = True

        cat = classify_category(tags, raw_name, fac_id)
        if cat != "shelter":
            zone_member_rings.setdefault(fac_id, []).append(outer)
        # Keep canopies/covered walkways low (2.5m) so they never cast boxy shadow blocks
        height = 2.5 if cat == "shelter" else round(levels * 3.8, 1)

        has_rooms = False
        if prof:
            rfs = generate_rooms_for_building(outer, prof, bid)
            all_room_features.extend(rfs)
            has_rooms = len(rfs) > 0
        elif cat in ("academic", "lecture_hall", "library", "lab", "admin", "research") and (not is_inferred_name) and ring_area_m2(outer) >= 180:
            auto_floors = {}
            for fl in range(min(levels, 6)):
                fl_lbl = "G" if fl == 0 else str(fl)
                auto_floors[fl] = [
                    {"code": f"{code or 'B'}-{fl_lbl}A", "name": f"{raw_name} — Floor {fl_lbl} Wing A", "type": "lab" if cat in ("lab", "research") else (cat if cat != "academic" else "tutorial"), "cap": 40, "source": "UM Building Floor Layout (footprint-derived)"},
                    {"code": f"{code or 'B'}-{fl_lbl}B", "name": f"{raw_name} — Floor {fl_lbl} Wing B", "type": "office" if fl > 0 else "lobby", "cap": 30, "source": "UM Building Floor Layout (footprint-derived)"},
                ]
            auto_prof = {"display_name": raw_name, "code": code or bid.split("/")[1], "faculty_id": fac_id, "levels": levels, "floors": auto_floors}
            rfs = generate_rooms_for_building(outer, auto_prof, bid)
            all_room_features.extend(rfs)
            has_rooms = len(rfs) > 0

        bldg_centers[bid] = (cx, cy)
        building_features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": poly_rings},
            "properties": {
                "id": bid,
                "name": raw_name,
                "name_ms": ms_name,
                "code": code,
                "faculty_id": fac_id,
                "faculty_color": fac_color_map.get(fac_id, "#1e40af"),
                "levels": levels,
                "height": height,
                "category": cat,
                "is_canopy": cat == "shelter",
                "is_inferred_name": is_inferred_name,
                "wheelchair": tags.get("wheelchair", "unknown"),
                "website": tags.get("website", ""),
                "center": [round(cx, 6), round(cy, 6)],
                "has_rooms": has_rooms,
            },
        })

    # Upgrade any square bbox fallback zones (curated-zone) into real building-aligned compound hulls
    SHORT_ZONE_NAMES = {
        "FSKTM": "Computer Science",
        "FK": "Engineering",
        "FS": "Science",
        "FASS": "Arts & Social Sci",
        "FP": "Education",
        "FPE": "Business & Econ",
        "FAB": "Built Environment",
        "FLL": "Languages",
        "FL": "Law",
        "FCA": "Creative Arts",
        "FOM": "Medicine",
        "FOP": "Pharmacy",
        "FOD": "Dentistry",
        "FSES": "Sports Sciences",
        "API": "Islamic Studies",
        "APM": "Malay Studies",
        "PASUM": "Foundation (PASUM)",
        "CORE": "Chancellery & Library",
        "KPPI": "Research Complex",
        "IAS": "Advanced Studies",
        "AEI": "Asia-Europe Inst.",
        "RIMBA": "Rimba Ilmu Garden",
        "PPUM": "Medical Centre",
        "IH": "Int'l House",
    }
    for feat in zone_features:
        props = feat["properties"]
        fid = props["id"]
        if props.get("osm_ref") == "curated-zone":
            mbr = zone_member_rings.get(fid, [])
            organic_rings = build_organic_zone_polygons(mbr, pad_m=22.0, cell_m=5.5)
            if len(organic_rings) == 1:
                feat["geometry"] = {"type": "Polygon", "coordinates": [organic_rings[0]]}
                props["osm_ref"] = "building-compound"
            elif len(organic_rings) > 1:
                feat["geometry"] = {"type": "MultiPolygon", "coordinates": [[r] for r in organic_rings]}
                props["osm_ref"] = "building-compound"

        zk = props.get("zone_kind", "faculty")
        if fid in SHORT_ZONE_NAMES:
            short = SHORT_ZONE_NAMES[fid]
            props["short_label"] = f"{props['code']} · {short}" if props["code"] != "CORE" else short
        elif zk == "college":
            # Keep KK label clean e.g. 'KK1 · ASTAR', 'KK12 · Raja Dr. Nazrin Shah'
            raw_n = props["name"]
            paren = raw_n.split("/")[-1].rstrip(")").strip() if "/" in raw_n else props["name"]
            props["short_label"] = f"{props['code']} · {paren[:24]}"
        else:
            props["short_label"] = f"{props['code']} · {props['name'][:24]}"

    with open(os.path.join(OUT_DIR, "um_faculties.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": zone_features}, f)
    print(f"Saved um_faculties.geojson ({len(zone_features)} zones: organic compounds, 0 square fallbacks)")

    # Add real OSM-verified indoor rooms/areas
    osm_indoor_count = 0
    for wid, w in ways.items():
        t = w.get("tags", {})
        if t.get("indoor") in ("room", "area") or "room" in t:
            c = normalize_ring(way_coords(w, nodes), ccw=True)
            if c:
                cx, cy = ring_centroid(c)
                if not pt_in_multipoly(cx, cy, um_polys):
                    continue
                try:
                    fl = int(str(t.get("level", "0")).split(";")[0])
                except ValueError:
                    fl = 0
                nearest_bid = min(bldg_centers.keys(), key=lambda b: haversine_m(cx, cy, bldg_centers[b][0], bldg_centers[b][1]))
                nearest_bname = next((bf["properties"]["name"] for bf in building_features if bf["properties"]["id"] == nearest_bid), "UM Building")
                nearest_fac = next((bf["properties"]["faculty_id"] for bf in building_features if bf["properties"]["id"] == nearest_bid), "CORE")
                rname = t.get("name:en") or t.get("name") or t.get("room", "Indoor Space").replace("_", " ").title()
                all_room_features.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [c]},
                    "properties": {
                        "id": f"osm-room/{wid}",
                        "code": f"OSM-{wid}",
                        "name": f"{rname} (OSM Verified)",
                        "building_id": nearest_bid,
                        "building_name": nearest_bname,
                        "faculty_id": nearest_fac,
                        "floor": fl,
                        "floor_label": "Ground (G)" if fl == 0 else f"Level {fl}",
                        "base_height": round(fl * 3.8 + 0.25, 2),
                        "height": round((fl + 1) * 3.8 - 0.1, 2),
                        "room_type": t.get("room", "study"),
                        "capacity": 50,
                        "center": [round(cx, 6), round(cy, 6)],
                        "source": "OpenStreetMap Indoor",
                        "osm_verified": True,
                    },
                })
                osm_indoor_count += 1

    if 17596247 in rels:
        rings = stitch_relation_rings_by_role(rels[17596247], ways, nodes, ("outer", ""))
        if rings:
            outer = max(rings, key=ring_area_m2)
            cx, cy = ring_centroid(outer)
            nearest_bid = min(bldg_centers.keys(), key=lambda b: haversine_m(cx, cy, bldg_centers[b][0], bldg_centers[b][1]))
            all_room_features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [outer]},
                "properties": {
                    "id": "osm-room/rel-17596247",
                    "code": "24H-STUDY",
                    "name": "24 Hours Study Area (Ruang Belajar 24 Jam)",
                    "building_id": nearest_bid,
                    "building_name": "Perpustakaan Utama / Study Complex",
                    "faculty_id": "CORE",
                    "floor": 0,
                    "floor_label": "Ground (G)",
                    "base_height": 0.25,
                    "height": 3.7,
                    "room_type": "study",
                    "capacity": 120,
                    "center": [round(cx, 6), round(cy, 6)],
                    "source": "OpenStreetMap Indoor",
                    "osm_verified": True,
                },
            })
            osm_indoor_count += 1

    room_bldgs = {rf["properties"]["building_id"] for rf in all_room_features}
    for bf in building_features:
        if bf["properties"]["id"] in room_bldgs:
            bf["properties"]["has_rooms"] = True

    with open(os.path.join(OUT_DIR, "um_rooms.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": all_room_features}, f)
    print(f"Saved um_rooms.geojson ({len(all_room_features)} rooms, incl. {osm_indoor_count} verbatim OSM indoor)")

    # 4. EXPANDED ROUTING GRAPH (covers UM + Phileo Damansara + LRT Universiti + LRT Kerinchi + LRT Taman Jaya + KK13/IH/KK9)
    ROAD_TYPES = {"primary", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "service"}
    PED_TYPES = {"footway", "pedestrian", "cycleway", "track"}
    SHORTCUT_TYPES = {"path", "corridor"}
    STEPS_TYPES = {"steps"}
    ALL_ROUTABLE = ROAD_TYPES | PED_TYPES | SHORTCUT_TYPES | STEPS_TYPES

    graph_nodes = {}
    adj = defaultdict(list)
    road_features = []

    for wid, w in ways.items():
        t = w.get("tags", {})
        hw = t.get("highway")
        if hw not in ALL_ROUTABLE:
            continue
        nds = [nid for nid in w.get("nodes", []) if nid in nodes]
        if len(nds) < 2:
            continue
        in_um = any(pt_in_multipoly(nodes[nid]["lon"], nodes[nid]["lat"], um_polys) for nid in nds[::max(1, len(nds)//3)])
        in_transit_corridor = any(3.1030 <= nodes[nid]["lat"] <= 3.1445 and 101.6350 <= nodes[nid]["lon"] <= 101.6710 for nid in nds)
        if not in_um and not in_transit_corridor:
            continue

        is_shortcut = (hw in SHORTCUT_TYPES) or (t.get("covered") == "yes") or (t.get("tunnel") == "building_passage") or (t.get("indoor") == "yes")
        if hw in STEPS_TYPES:
            kind = "steps"
        elif is_shortcut:
            kind = "shortcut"
        elif hw in PED_TYPES:
            kind = "footway"
        else:
            kind = "road"

        drivable = (hw in ROAD_TYPES) and (t.get("motor_vehicle") != "no") and (t.get("access") != "no")
        accessible = (hw not in STEPS_TYPES) and (t.get("wheelchair") != "no")
        wname = t.get("name:en") or t.get("name") or (
            "Covered Walkway / Shortcut" if kind == "shortcut" else
            "Stairway" if kind == "steps" else
            "Campus Footpath" if kind == "footway" else
            "Campus Road"
        )

        coords = []
        for nid in nds:
            n = nodes[nid]
            graph_nodes[nid] = [round(n["lon"], 7), round(n["lat"], 7)]
            coords.append([round(n["lon"], 7), round(n["lat"], 7)])

        if in_um or any(3.110 <= nodes[nid]["lat"] <= 3.136 and 101.636 <= nodes[nid]["lon"] <= 101.669 for nid in nds):
            road_features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {
                    "id": f"way/{wid}",
                    "name": wname,
                    "kind": kind,
                    "highway": hw,
                    "covered": t.get("covered") == "yes",
                    "drivable": drivable,
                    "accessible": accessible,
                },
            })

        for i in range(len(nds) - 1):
            u, v = nds[i], nds[i + 1]
            if u == v:
                continue
            nu, nv = nodes[u], nodes[v]
            d = round(haversine_m(nu["lon"], nu["lat"], nv["lon"], nv["lat"]), 2)
            if d < 0.05:
                continue
            adj[u].append((v, d, kind, drivable, accessible, wname))
            adj[v].append((u, d, kind, drivable, accessible, wname))

    def get_components():
        comp = {}
        cid = 0
        for nid in graph_nodes:
            if nid in comp:
                continue
            q = deque([nid])
            comp[nid] = cid
            while q:
                cur = q.popleft()
                for nxt, *_ in adj[cur]:
                    if nxt not in comp:
                        comp[nxt] = cid
                        q.append(nxt)
            cid += 1
        return comp, cid

    for max_snap_m in (5.0, 12.0, 25.0):
        comp, n_comp = get_components()
        if n_comp <= 1:
            break
        comp_sizes = defaultdict(int)
        for c in comp.values():
            comp_sizes[c] += 1
        main_cid = max(comp_sizes, key=lambda k: comp_sizes[k])
        cell = 0.00025
        grid = defaultdict(list)
        for nid, (lon, lat) in graph_nodes.items():
            grid[(int(lon / cell), int(lat / cell))].append(nid)
        for nid, (lon, lat) in list(graph_nodes.items()):
            if comp[nid] == main_cid:
                continue
            gx, gy = int(lon / cell), int(lat / cell)
            best_d = max_snap_m
            best_target = None
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for cand in grid.get((gx + dx, gy + dy), []):
                        if comp[cand] == comp[nid]:
                            continue
                        d = haversine_m(lon, lat, graph_nodes[cand][0], graph_nodes[cand][1])
                        if d < best_d:
                            best_d = d
                            best_target = cand
            if best_target is not None:
                d_r = round(max(0.5, best_d), 2)
                adj[nid].append((best_target, d_r, "shortcut", False, True, "Pathway Connector"))
                adj[best_target].append((nid, d_r, "shortcut", False, True, "Pathway Connector"))

    comp, _ = get_components()
    comp_sizes = defaultdict(int)
    for c in comp.values():
        comp_sizes[c] += 1
    main_cid = max(comp_sizes, key=lambda k: comp_sizes[k])
    main_nodes = [nid for nid, c in comp.items() if c == main_cid]
    main_set = set(main_nodes)
    id_to_idx = {nid: idx for idx, nid in enumerate(main_nodes)}
    compact_nodes = [graph_nodes[nid] for nid in main_nodes]

    snap_cell = 0.0004
    snap_grid = defaultdict(list)
    for idx, (lon, lat) in enumerate(compact_nodes):
        snap_grid[(int(lon / snap_cell), int(lat / snap_cell))].append(idx)

    # Also build drivable-only main node filter for bus route snapping & road polylines
    drivable_adj = defaultdict(list)
    edges = []
    seen_pairs = set()
    kind_code = {"road": 0, "footway": 1, "shortcut": 2, "steps": 3}
    drivable_node_set = set()
    for u_nid in main_nodes:
        u_idx = id_to_idx[u_nid]
        for v_nid, d, kind, drivable, accessible, wname in adj[u_nid]:
            if v_nid not in main_set:
                continue
            v_idx = id_to_idx[v_nid]
            key = (min(u_idx, v_idx), max(u_idx, v_idx), kind)
            if key not in seen_pairs:
                seen_pairs.add(key)
                flags = (1 if drivable else 0) | (2 if accessible else 0)
                edges.append([u_idx, v_idx, d, kind_code[kind], flags, wname])
            if drivable:
                drivable_adj[u_idx].append((v_idx, d))
                drivable_node_set.add(u_idx)
                drivable_node_set.add(v_idx)

    def nearest_graph_idx(lon: float, lat: float, require_drivable: bool = False) -> int:
        gx, gy = int(lon / snap_cell), int(lat / snap_cell)
        best_d = 1e9
        best_i = 0
        for r in range(1, 10):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    for idx in snap_grid.get((gx + dx, gy + dy), []):
                        if require_drivable and idx not in drivable_node_set:
                            continue
                        d = haversine_m(lon, lat, compact_nodes[idx][0], compact_nodes[idx][1])
                        if d < best_d:
                            best_d = d
                            best_i = idx
            if best_d < 80.0 and best_i != 0:
                break
        if best_d > 1e8:
            best_i = min(
                (drivable_node_set if require_drivable else range(len(compact_nodes))),
                key=lambda i: haversine_m(lon, lat, compact_nodes[i][0], compact_nodes[i][1]),
            )
        return best_i

    for bf in building_features:
        lon, lat = bf["properties"]["center"]
        bf["properties"]["entrance_node"] = nearest_graph_idx(lon, lat)

    with open(os.path.join(OUT_DIR, "um_buildings.geojson"), "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": building_features}, f)
    print(f"Saved um_buildings.geojson ({len(building_features)} buildings, ZERO 'UM Campus Building' generic IDs)")

    with open(os.path.join(OUT_DIR, "um_graph.json"), "w", encoding="utf-8") as f:
        json.dump({"nodes": compact_nodes, "edges": edges}, f, separators=(",", ":"))
    print(f"Saved um_graph.json ({len(compact_nodes)} nodes, {len(edges)} edges)")

    # 5. CONTEXT LAYERS (Water, Parks, Gates, ALL UM Bus Stops, Nearby MRT/LRT Stations)
    water_features = []
    park_features = []
    poi_features = []

    for wid, w in ways.items():
        t = w.get("tags", {})
        c = way_coords(w, nodes)
        if len(c) < 2:
            continue
        cx, cy = ring_centroid(c)
        if not pt_in_multipoly(cx, cy, um_polys):
            continue
        if t.get("natural") == "water" or t.get("waterway") in ("stream", "river"):
            is_poly = len(c) >= 4 and (c[0] == c[-1] or t.get("natural") == "water")
            norm = normalize_ring(c, ccw=True) if is_poly else c
            if is_poly and not norm:
                continue
            water_features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon" if is_poly else "LineString", "coordinates": [norm] if is_poly else c},
                "properties": {"id": f"way/{wid}", "name": t.get("name:en") or t.get("name") or "Water", "kind": "water"},
            })
        elif t.get("leisure") in ("park", "nature_reserve", "pitch", "track", "garden") or t.get("landuse") in ("forest", "recreation_ground", "meadow"):
            if len(c) >= 4:
                norm = normalize_ring(c, ccw=True)
                if norm:
                    park_features.append({
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [norm]},
                        "properties": {"id": f"way/{wid}", "name": t.get("name:en") or t.get("name") or "Green Space", "kind": t.get("leisure") or t.get("landuse")},
                    })
        elif t.get("barrier") == "gate" and "name" in t:
            poi_features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(cx, 6), round(cy, 6)]},
                "properties": {
                    "id": f"gate/way-{wid}",
                    "name": t.get("name:en") or t.get("name"),
                    "kind": "gate",
                    "entrance_node": nearest_graph_idx(cx, cy),
                },
            })

    # Add curated + OSM-verified nearby MRT & LRT stations cleanly
    RAIL_STATIONS = [
        {"id": "rail/KG12", "code": "KG12", "name": "MRT Phileo Damansara", "line": "MRT Kajang Line", "color": "#059669", "coord": [101.64292, 3.12925], "buses": ["T815"]},
        {"id": "rail/KJ19", "code": "KJ19", "name": "LRT Universiti (KL Gateway)", "line": "LRT Kelana Jaya Line", "color": "#e11d48", "coord": [101.66174, 3.11456], "buses": ["T789"]},
        {"id": "rail/KJ18", "code": "KJ18", "name": "LRT Kerinchi", "line": "LRT Kelana Jaya Line", "color": "#e11d48", "coord": [101.66851, 3.11548], "buses": []},
        {"id": "rail/KJ20", "code": "KJ20", "name": "LRT Taman Jaya", "line": "LRT Kelana Jaya Line", "color": "#e11d48", "coord": [101.64530, 3.10408], "buses": []},
        {"id": "rail/KJ21", "code": "KJ21", "name": "LRT Asia Jaya", "line": "LRT Kelana Jaya Line", "color": "#e11d48", "coord": [101.63776, 3.10442], "buses": []},
        {"id": "rail/KG13", "code": "KG13", "name": "MRT Pusat Bandar Damansara", "line": "MRT Kajang Line", "color": "#059669", "coord": [101.66235, 3.14326], "buses": []},
    ]
    for st in RAIL_STATIONS:
        lon, lat = st["coord"]
        poi_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": st["id"],
                "name": f"{st['name']} ({st['code']})",
                "ref": st["code"],
                "line": st["line"],
                "color": st["color"],
                "routes": ", ".join(st["buses"]) if st["buses"] else st["line"],
                "kind": "rail_station",
                "entrance_node": nearest_graph_idx(lon, lat),
            },
        })

    # Bus stops inside UM + immediate MRT/LRT feeder corridors
    bus_nodes_by_id = {}
    for nid, n in nodes.items():
        t = n.get("tags", {})
        if not t:
            continue
        lon, lat = round(n["lon"], 6), round(n["lat"], 6)
        in_transit_corridor = 3.1095 <= lat <= 3.1390 and 101.6360 <= lon <= 101.6685
        in_um = pt_in_multipoly(lon, lat, um_polys)
        if t.get("barrier") == "gate" and "name" in t and (in_um or in_transit_corridor):
            poi_features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": f"gate/{nid}",
                    "name": t.get("name:en") or t.get("name"),
                    "kind": "gate",
                    "entrance_node": nearest_graph_idx(lon, lat),
                },
            })
        elif t.get("highway") == "bus_stop" and (in_um or in_transit_corridor):
            bname = t.get("name") or "Bus Stop"
            bref = t.get("ref", "")
            rref = t.get("route_ref", "")
            # Filter out noise far away unless tagged UM / T789 / T815 / LRT Universiti
            relevant = (
                in_um
                or "T789" in rref
                or "T815" in rref
                or "Universiti" in bname
                or "UM" in bname
                or "Phileo" in bname
                or "PPUM" in bname
                or "Kerinchi" in bname
                or "International House" in bname
                or "Kolej" in bname
                or any(code in str(t.get("operator", "")) for code in ["Universiti Malaya"])
            )
            if relevant:
                bus_nodes_by_id[nid] = (lon, lat, bname, bref, rref)
                poi_features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": f"bus/{nid}",
                        "name": f"{bname} ({bref})" if bref and bref not in bname else bname,
                        "ref": bref,
                        "routes": rref,
                        "kind": "bus_stop",
                        "entrance_node": nearest_graph_idx(lon, lat),
                    },
                })

    with open(os.path.join(OUT_DIR, "um_context.geojson"), "w", encoding="utf-8") as f:
        json.dump({
            "roads": {"type": "FeatureCollection", "features": road_features},
            "water": {"type": "FeatureCollection", "features": water_features},
            "parks": {"type": "FeatureCollection", "features": park_features},
            "pois": {"type": "FeatureCollection", "features": poi_features},
        }, f)
    print(f"Saved um_context.geojson ({len(road_features)} road/path ways, {len(water_features)} water, {len(park_features)} parks, {len(poi_features)} POIs incl. MRT/LRT & bus stops)")

    # 6. BUILD UM BUS & RAPIDKL T789/T815 ROUTES ON REAL DRIVABLE ROADS
    def road_path_between(start_lonlat: tuple[float, float], end_lonlat: tuple[float, float]) -> tuple[list[list[float]], float]:
        s_idx = nearest_graph_idx(start_lonlat[0], start_lonlat[1], require_drivable=True)
        e_idx = nearest_graph_idx(end_lonlat[0], end_lonlat[1], require_drivable=True)
        if s_idx == e_idx:
            return [list(start_lonlat), list(end_lonlat)], haversine_m(start_lonlat[0], start_lonlat[1], end_lonlat[0], end_lonlat[1])
        pq = [(0.0, s_idx)]
        dist = {s_idx: 0.0}
        prev = {}
        while pq:
            cd, u = heapq.heappop(pq)
            if u == e_idx:
                break
            if cd > dist.get(u, 1e18):
                continue
            for v, w_d in drivable_adj[u]:
                nd = cd + w_d
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if e_idx not in dist:
            return [list(start_lonlat), list(end_lonlat)], haversine_m(start_lonlat[0], start_lonlat[1], end_lonlat[0], end_lonlat[1])
        chain = []
        cur = e_idx
        while cur is not None:
            chain.append(compact_nodes[cur])
            cur = prev.get(cur)
        chain.reverse()
        return chain, dist[e_idx]

    def resolve_stop(nid_or_coord, fallback_name: str, fallback_ref: str = ""):
        if isinstance(nid_or_coord, int) and nid_or_coord in nodes:
            n = nodes[nid_or_coord]
            t = n.get("tags", {})
            lon, lat = round(n["lon"], 6), round(n["lat"], 6)
            nm = t.get("name") or fallback_name
            rf = t.get("ref") or fallback_ref
        else:
            lon, lat = nid_or_coord
            nm = fallback_name
            rf = fallback_ref
        return {
            "name": nm,
            "ref": rf,
            "coord": [lon, lat],
            "walk_node": nearest_graph_idx(lon, lat, require_drivable=False),
        }

    # Build verified stop lists per route (from OSM relations & RapidKL/UM timetables)
    def rel_platform_stops(rid: int):
        r = rels.get(rid)
        if not r:
            return []
        out = []
        seen = set()
        for m in r.get("members", []):
            if m["type"] == "node" and "platform" in m.get("role", ""):
                nid = m["ref"]
                if nid in nodes and nid not in seen:
                    seen.add(nid)
                    out.append(resolve_stop(nid, "Bus Stop"))
        return out

    t815_stops = rel_platform_stops(16068053)
    ab_stops = rel_platform_stops(16498792) + [resolve_stop(10112911516, "UM Central")]
    ba_stops = [
        resolve_stop(10112911516, "UM Central"),
        resolve_stop(7975702085, "Perpustakaan UM", "KL1109"),
        resolve_stop(9196355755, "KK3 / KK4 / KK7 (Lingkaran Budi)"),
        resolve_stop(9197001785, "Akademi Pengajian Melayu (APM)", "KL2347"),
        resolve_stop(9181045874, "Kolej Kediaman Kelima (KK5)", "KL2343"),
        resolve_stop(10811069861, "Akademi Pengajian Islam (API)"),
        resolve_stop(10811069858, "Pusat Asasi Sains (PASUM)", "KL1108"),
        resolve_stop(10293654313, "Faculty of Science (UM)"),
        resolve_stop(10112911516, "UM Central"),
    ]
    c_stops = [
        resolve_stop(10112911516, "UM Central"),
        resolve_stop(9197001788, "Fakulti Kejuruteraan (Utara)", "KL1104"),
        resolve_stop(3832013267, "Kolej Kediaman Pertama (KK1)", "KL1103"),
        resolve_stop(5793555853, "Stadium Hoki KL (Pantai gate corridor)", "KL1110"),
        resolve_stop(2444293788, "Masjid Ar-Rahman UM (KL Gate)", "KL1102"),
        resolve_stop(10112911516, "UM Central"),
    ]
    d_stops = [
        resolve_stop(9197427870, "Fakulti Kejuruteraan (Barat)", "KL1105"),
        resolve_stop(9315896280, "UIA PJ (Barat) / Seksyen 17", "PJ236"),
        resolve_stop(10220082131, "International House (UM)"),
        resolve_stop(9983207441, "Seksyen 17 (Shell 17/22)", "PJ233"),
        resolve_stop(11012993231, "Kolej Kediaman Ke-13 (KK13)"),
        resolve_stop(10112911516, "UM Central"),
    ]
    e_stops = [
        resolve_stop(10112911516, "UM Central"),
        resolve_stop(9197427870, "Fakulti Kejuruteraan (Barat)", "KL1105"),
        resolve_stop(10157359232, "Kolej Kediaman Tun Syed Zahiruddin (KK9)"),
        resolve_stop(11012993231, "Kolej Kediaman Ke-13 (KK13)"),
        resolve_stop(10112911516, "UM Central"),
    ]
    t789_stops = [
        resolve_stop(6991649225, "LRT Universiti (Timur)", "KL1440"),
        resolve_stop(12558375779, "Flat PKNS Kerinchi / KL Gateway", "KL1397"),
        resolve_stop(2444293788, "Masjid Ar-Rahman UM", "KL1102"),
        resolve_stop(9197001787, "Fakulti Undang-Undang UM", "KL2137"),
        resolve_stop(3832013267, "Kolej Kediaman Pertama UM (KK1)", "KL1103"),
        resolve_stop(9197001788, "Jabatan Bioperubatan / Kejuruteraan", "KL1104"),
        resolve_stop(7975702085, "Perpustakaan UM / UM Central", "KL1109"),
        resolve_stop(9196355789, "Dewan Tunku Canselor (DTC)", "KL1107"),
        resolve_stop(10811069858, "Pusat Asasi Sains (PASUM)", "KL1108"),
        resolve_stop(2444293788, "Masjid Ar-Rahman UM (Return)", "KL1102"),
        resolve_stop(12995363923, "Flat PKNS Kerinchi", "KL2134"),
        resolve_stop(12122520956, "Nexus Bangsar South", "KL1439"),
        resolve_stop(12122520957, "The Vertical Bangsar South", "KL1399"),
        resolve_stop(6991649225, "LRT Universiti (Timur)", "KL1440"),
    ]

    ROUTE_SPECS = [
        {"id": "T789", "code": "T789", "name": "RapidKL T789: LRT Universiti ↺ UM", "operator": "RapidKL LRT Feeder", "color": "#dc2626", "headway_min": 15, "hours": "06:00–23:30 Daily (RM1)", "stops": t789_stops},
        {"id": "T815", "code": "T815", "name": "RapidKL T815: MRT Phileo Damansara ↺ UM", "operator": "RapidKL MRT Feeder", "color": "#ea580c", "headway_min": 15, "hours": "06:00–23:30 Daily (RM1)", "stops": t815_stops},
        {"id": "UM-AB", "code": "AB", "name": "UM Shuttle AB: UM Central ↺ API / KK8 / KK12", "operator": "UM Shuttle Bus (Free)", "color": "#1d4ed8", "headway_min": 15, "hours": "Mon–Fri 07:30–18:30", "stops": ab_stops},
        {"id": "UM-BA", "code": "BA", "name": "UM Shuttle BA: UM Central ↺ PASUM / Science", "operator": "UM Shuttle Bus (Free)", "color": "#0284c7", "headway_min": 20, "hours": "Mon–Fri 07:30–18:30", "stops": ba_stops},
        {"id": "UM-C", "code": "C", "name": "UM Shuttle C: UM Central ↺ KK1 / Engineering / Pantai", "operator": "UM Shuttle Bus (Free)", "color": "#4f46e5", "headway_min": 20, "hours": "Mon–Fri 07:30–18:30", "stops": c_stops},
        {"id": "UM-D", "code": "D", "name": "UM Shuttle D: Engineering ↔ International House / KK13", "operator": "UM Shuttle Bus (Free)", "color": "#0d9488", "headway_min": 25, "hours": "Mon–Fri 07:30–18:30", "stops": d_stops},
        {"id": "UM-E", "code": "E", "name": "UM Shuttle E: UM Central ↺ KK9 / KK13", "operator": "UM Shuttle Bus (Free)", "color": "#7c3aed", "headway_min": 25, "hours": "Mon–Fri 07:30–18:30", "stops": e_stops},
    ]

    transit_routes_out = []
    transit_geo_features = []
    for spec in ROUTE_SPECS:
        stops = spec["stops"]
        if len(stops) < 2:
            continue
        full_poly = []
        leg_dists = []
        for i in range(len(stops) - 1):
            seg_coords, seg_d = road_path_between(tuple(stops[i]["coord"]), tuple(stops[i + 1]["coord"]))
            leg_dists.append(round(seg_d, 1))
            if full_poly and seg_coords:
                full_poly.extend(seg_coords[1:])
            else:
                full_poly.extend(seg_coords)

        transit_routes_out.append({
            "id": spec["id"],
            "code": spec["code"],
            "name": spec["name"],
            "operator": spec["operator"],
            "color": spec["color"],
            "headway_min": spec["headway_min"],
            "hours": spec["hours"],
            "stops": stops,
            "leg_distances_m": leg_dists,
        })
        transit_geo_features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": full_poly},
            "properties": {
                "id": spec["id"],
                "code": spec["code"],
                "name": spec["name"],
                "operator": spec["operator"],
                "color": spec["color"],
            },
        })

    with open(os.path.join(OUT_DIR, "um_transit.json"), "w", encoding="utf-8") as f:
        json.dump({
            "routes": transit_routes_out,
            "geojson": {"type": "FeatureCollection", "features": transit_geo_features},
        }, f)
    print(f"Saved um_transit.json ({len(transit_routes_out)} bus routes: T789, T815, AB, BA, C, D, E)")

    # 7. UNIFIED SEARCH INDEX (Zones, Named Buildings, Rooms, MRT/LRT, Bus Stops, Gates)
    search_items = []
    for ff in zone_features:
        p = ff["properties"]
        search_items.append({
            "id": p["id"],
            "kind": "faculty",
            "zone_kind": p["zone_kind"],
            "title": p["name"],
            "subtitle": f"{p['code']} • {p['category']}",
            "faculty_id": p["id"],
            "center": p["center"],
            "entrance_node": nearest_graph_idx(p["center"][0], p["center"][1]),
            "keywords": f"{p['code']} {p['name']} {p['name_ms']} {p['category']} {p['zone_kind']}".lower(),
        })
    for bf in building_features:
        p = bf["properties"]
        if p["is_inferred_name"] or p["category"] == "shelter":
            continue
        search_items.append({
            "id": p["id"],
            "kind": "building",
            "title": p["name"],
            "subtitle": f"{p['faculty_id']} • {p['levels']} floors" + (f" • {p['code']}" if p["code"] else ""),
            "faculty_id": p["faculty_id"],
            "building_id": p["id"],
            "category": p["category"],
            "center": p["center"],
            "entrance_node": p["entrance_node"],
            "has_rooms": p["has_rooms"],
            "keywords": f"{p['name']} {p['name_ms']} {p['code']} {p['faculty_id']} {p['category']}".lower(),
        })
    bldg_entrance_map = {bf["properties"]["id"]: bf["properties"]["entrance_node"] for bf in building_features}
    for rf in all_room_features:
        p = rf["properties"]
        search_items.append({
            "id": p["id"],
            "kind": "room",
            "title": p["name"],
            "subtitle": f"{p['building_name']} • {p['floor_label']} • {p['code']}",
            "faculty_id": p["faculty_id"],
            "building_id": p["building_id"],
            "floor": p["floor"],
            "room_type": p["room_type"],
            "center": p["center"],
            "entrance_node": bldg_entrance_map.get(p["building_id"], nearest_graph_idx(p["center"][0], p["center"][1])),
            "keywords": f"{p['name']} {p['code']} {p['building_name']} {p['faculty_id']} {p['room_type']}".lower(),
        })
    for pf in poi_features:
        p = pf["properties"]
        knd = p["kind"]
        sub = (
            f"{p.get('line', 'Rail Transit')} • Routes: {p.get('routes', '')}" if knd == "rail_station" else
            "UM Campus Gate" if knd == "gate" else
            (f"Bus Stop • Routes: {p['routes']}" if p.get("routes") else "Bus / Shuttle Stop")
        )
        search_items.append({
            "id": p["id"],
            "kind": knd,
            "title": p["name"],
            "subtitle": sub,
            "center": pf["geometry"]["coordinates"],
            "entrance_node": p["entrance_node"],
            "keywords": f"{p['name']} {p.get('ref','')} {p.get('routes','')} {knd}".lower(),
        })

    with open(os.path.join(OUT_DIR, "um_search_index.json"), "w", encoding="utf-8") as f:
        json.dump(search_items, f)
    print(f"Saved um_search_index.json ({len(search_items)} searchable items)")


if __name__ == "__main__":
    main()
