#!/usr/bin/env python3
"""
Enrich UM 3D Atlas spatial accuracy:
1. Re-trace rough/boxy zone polygons (MASJID, R&D, UMSC, IH, FOM, FOP, FOD,
   CORE, FSES, APM, KPPI, IAS, AEI) along real OSM roads, building footprints,
   and neighboring pre-defined OSM zone edges using morphological grid tracing
   + marching squares + Chaikin smoothing + Douglas-Peucker simplification.
2. Fix Wisma R&D building linkage and enrich unnamed/generic buildings with
   verified Universiti Malaya building names.
3. Generate real graph-snapped popular UM jogging loops (um_jogging.geojson).
4. Synchronize um_search_index.json.
"""

import heapq
import json
import math
from pathlib import Path

DATA_DIR = Path("public/data")

TARGET_ZONES = [
    "MASJID",
    "R&D",
    "UMSC",
    "IH",
    "FOM",
    "FOP",
    "FOD",
    "EXAM",
    "JPPHB",
    "LIB",
    "KPS",
    "DTC",
    "HIR",
    "CORE",
    "FSES",
    "APM",
    "KPPI",
    "IAS",
    "AEI",
]

# Zones that are outside the main campus boundary polygon
OFF_CAMPUS_ZONES = {"R&D", "IH", "KK9", "KK13"}

# New standalone UM zones carved out from misgrouped faculties/colleges & UM Core
NEW_ZONE_SPECS = [
    {
        "id": "EXAM",
        "code": "EXAM",
        "map_code": "EXAM",
        "short_label": "Exam Hall",
        "name": "Examination Hall (Dewan Peperiksaan)",
        "name_ms": "Dewan Peperiksaan Universiti Malaya",
        "category": "landmark",
        "zone_kind": "landmark",
        "website": "https://www.um.edu.my/",
        "zoom": 17.5,
        "pitch": 52,
        "bearing": -16,
        "description": "Universiti Malaya's main central examination hall complex located south of KK1 along Jalan Lingkungan Budi.",
        "osm_ref": "way/468195486",
        "keywords": "exam examination hall dewan peperiksaan test um",
    },
    {
        "id": "JPPHB",
        "code": "JPPHB",
        "map_code": "JPPHB",
        "short_label": "JPPHB",
        "name": "JPPHB — Development & Estate Maintenance",
        "name_ms": "Jabatan Pembangunan dan Penyelenggaraan Harta Benda (Pejabat Ketua Pegawai Fasiliti)",
        "category": "admin",
        "zone_kind": "institute",
        "website": "https://jpphb.um.edu.my/",
        "zoom": 17.5,
        "pitch": 52,
        "bearing": -16,
        "description": "Office of the Chief Facility Officer (Bangunan JHB), estate maintenance workshops, utilities, and campus development operations.",
        "osm_ref": "way/263611871",
        "keywords": "jpphb jhb harta benda maintenance estate facility officer pembangunan",
    },
    {
        "id": "LIB",
        "code": "LIB",
        "map_code": "LIB",
        "short_label": "Main Library",
        "name": "Perpustakaan Utama (Main Library)",
        "name_ms": "Perpustakaan Utama Universiti Malaya",
        "category": "library",
        "zone_kind": "landmark",
        "website": "https://umlib.um.edu.my/",
        "zoom": 17.7,
        "pitch": 54,
        "bearing": -16,
        "description": "Central university library housing main collections, Za'ba annex reading rooms, and 24-hour student study spaces.",
        "osm_ref": "way/263611204",
        "keywords": "library main library perpustakaan utama zaba study books",
    },
    {
        "id": "KPS",
        "code": "KPS",
        "map_code": "KPS",
        "short_label": "Perdanasiswa",
        "name": "Kompleks Perdanasiswa (KPS)",
        "name_ms": "Kompleks Perdanasiswa Universiti Malaya",
        "category": "landmark",
        "zone_kind": "landmark",
        "website": "https://hep.um.edu.my/",
        "zoom": 17.7,
        "pitch": 54,
        "bearing": -16,
        "description": "UM student union hub (Blocks A–G), Auditorium KPS, student affairs offices, Student Plaza, and campus dining mall.",
        "osm_ref": "way/358008470",
        "keywords": "kps perdanasiswa student plaza mall auditorium hep cafe",
    },
    {
        "id": "DTC",
        "code": "DTC",
        "map_code": "DTC",
        "short_label": "DTC",
        "name": "Dewan Tunku Canselor (DTC)",
        "name_ms": "Dewan Tunku Canselor & Panggung Eksperimen",
        "category": "hall",
        "zone_kind": "landmark",
        "website": "https://www.um.edu.my/",
        "zoom": 17.7,
        "pitch": 54,
        "bearing": -16,
        "description": "Iconic modernist convocation hall, Experimental Theatre (Panggung Eksperimen), and UM cultural performance venue.",
        "osm_ref": "way/278144675",
        "keywords": "dtc dewan tunku canselor convocation experimental theatre panggung eksperimen",
    },
    {
        "id": "HIR",
        "code": "HIR",
        "map_code": "HIR",
        "short_label": "HIR & Rumah UM",
        "name": "High Impact Research (HIR) & Rumah Universiti",
        "name_ms": "Bangunan Penyelidikan Berimpak Tinggi & Rumah Universiti",
        "category": "research",
        "zone_kind": "institute",
        "website": "https://hir.um.edu.my/",
        "zoom": 17.6,
        "pitch": 54,
        "bearing": -16,
        "description": "Multidisciplinary High Impact Research complex and adjacent Rumah Universiti guest house and administrative wing.",
        "osm_ref": "way/358003631",
        "keywords": "hir high impact research rumah universiti hotel lab research",
    },
]

# Explicit building -> dedicated standalone zone reassignments
BUILDING_ZONE_REASSIGN = {
    # EXAM — Examination Hall (carved from southern KK1)
    "way/468195486": "EXAM",
    "way/468195487": "EXAM",
    # JPPHB — Development & Estate Maintenance compound (carved from KK5/KK11/KK12 gap)
    "way/263611871": "JPPHB",
    "way/996004834": "JPPHB",
    "way/359484891": "JPPHB",
    "way/359484892": "JPPHB",
    "way/358005056": "JPPHB",
    "way/358005057": "JPPHB",
    "way/358005058": "JPPHB",
    "way/358005059": "JPPHB",
    "way/358005063": "JPPHB",
    "way/359487706": "JPPHB",
    "way/359487707": "JPPHB",
    "way/996047848": "JPPHB",
    "way/996047849": "JPPHB",
    "way/996047850": "JPPHB",
    "way/996047851": "JPPHB",
    "way/996047852": "JPPHB",
    "way/996047853": "JPPHB",
    # LIB — Perpustakaan Utama (Main Library)
    "way/263611204": "LIB",
    "way/995934973": "LIB",
    "way/1007653250": "LIB",
    "way/1126641055": "LIB",
    "way/1105114349": "LIB",
    "way/1105114350": "LIB",
    "way/1105114351": "LIB",
    "way/1105114358": "LIB",
    "way/1299191720": "LIB",
    # KPS — Kompleks Perdanasiswa
    "way/358008470": "KPS",
    "way/1007727347": "KPS",
    "way/1007727348": "KPS",
    "way/1007727350": "KPS",
    "way/1007727351": "KPS",
    "way/1007727352": "KPS",
    "way/1007727353": "KPS",
    "way/358008478": "KPS",
    "way/1007727345": "KPS",
    "rel/13809274": "KPS",
    "way/358008480": "KPS",
    "way/1007727360": "KPS",
    "way/1126646192": "KPS",
    # DTC — Dewan Tunku Canselor & Experimental Theatre
    "way/278144675": "DTC",
    "way/1009961415": "DTC",
    "way/1009961417": "DTC",
    "way/1009961418": "DTC",
    "way/1126653835": "DTC",
    "way/1126653836": "DTC",
    "way/1126653838": "DTC",
    # HIR — High Impact Research & Rumah Universiti
    "way/358003631": "HIR",
    "way/358002904": "HIR",
    "way/1009961411": "HIR",
    "way/358003632": "HIR",
    "way/358003633": "HIR",
    "way/1009961425": "HIR",
}

# Verified UM building names keyed by OSM building id
VERIFIED_BUILDING_NAMES = {
    # EXAM — Examination Hall
    "way/468195486": ("Examination Hall (Dewan Peperiksaan)", "hall"),
    # JPPHB — Development & Estate Maintenance
    "way/263611871": ("Bangunan JHB (JPPHB Main Building)", "admin"),
    "way/359484891": ("JPPHB West Workshop & Stores", "admin"),
    "way/359484892": ("JPPHB North Engineering Annex", "admin"),
    "way/358005056": ("JPPHB Maintenance Workshop Block A", "admin"),
    "way/358005057": ("JPPHB Maintenance Workshop Block B", "admin"),
    "way/358005059": ("JPPHB Electrical & Mechanical Services", "admin"),
    "way/358005063": ("JPPHB Civil & Estate Operations Block", "admin"),
    "way/359487706": ("JPPHB Logistics & Equipment Store A", "admin"),
    "way/359487707": ("JPPHB Logistics & Equipment Store B", "admin"),
    "way/996047848": ("JPPHB Maintenance Bay 1", "admin"),
    "way/996047849": ("JPPHB Maintenance Bay 2", "admin"),
    "way/996047850": ("JPPHB Maintenance Bay 3", "admin"),
    "way/996047851": ("JPPHB Maintenance Bay 4", "admin"),
    "way/996047852": ("JPPHB Maintenance Bay 5", "admin"),
    "way/996047853": ("JPPHB Maintenance Bay 6", "admin"),
    # HIR — High Impact Research
    "way/1009961411": ("High Impact Research (HIR) North Wing", "research"),
    # CORE / KPS / LIB / DTC — Perdanasiswa, Chancellery, Library, DTC & Cultural Complex
    "way/358008470": ("Kompleks Perdanasiswa Block A", "academic"),
    "way/1007727347": ("Kompleks Perdanasiswa Block B", "academic"),
    "way/1007727350": ("Kompleks Perdanasiswa Block D", "academic"),
    "way/1007727351": ("Kompleks Perdanasiswa Block E", "academic"),
    "way/1007727352": ("Kompleks Perdanasiswa Block F", "academic"),
    "way/1007727353": ("Kompleks Perdanasiswa Block G", "academic"),
    "way/616896843": ("Pejabat Bendahari (Bursary Wing)", "admin"),
    "way/995934973": ("Perpustakaan Peringatan Za'ba (Main Library Annex)", "library"),
    "way/358002904": ("High Impact Research (HIR) Annex", "research"),
    "way/1009961417": ("Panggung Eksperimen & Cultural Gallery Wing", "hall"),
    "way/358008478": ("Kompleks Perdanasiswa Student Plaza", "commercial"),
    # FOM — Faculty of Medicine
    "way/359486868": ("F05 - T.J. Danaraj Medical Library", "library"),
    "way/359486874": ("F13 - Faculty of Medicine Pathology & Research Block", "medical"),
    "way/777101310": ("F38 - Department of Anatomy & Physiology", "medical"),
    "way/145132263": ("Department of Forensic Pathology (FOM)", "medical"),
    "way/358004451": ("Faculty of Medicine Pre-Clinical Lecture Complex", "medical"),
    "way/359485469": ("F03 - Faculty of Medicine Administrative Wing", "medical"),
    "way/359486865": ("Department of Social & Preventive Medicine (SPM)", "medical"),
    "way/359486866": ("Department of Medical Microbiology & Parasitology", "medical"),
    "way/359486867": ("Department of Pharmacology & Molecular Medicine", "medical"),
    "way/359486870": ("FOM Clinical Teaching Auditorium (DK1–DK3)", "hall"),
    "way/359486871": ("Centre for Medical Education & Clinical Simulation", "medical"),
    "way/359486872": ("Department of Nursing Science (FOM)", "medical"),
    "way/359486873": ("Department of Biomedical Imaging & Diagnostics", "medical"),
    "way/777101308": ("FOM Postgraduate & Clinical Research Wing", "research"),
    "way/777101309": ("Department of Paediatrics & Obstetrics Wing", "medical"),
    "way/777101311": ("FOM–UMMC Clinical Link Wing", "medical"),
    "way/777101320": ("UMMC–FOM Clinical Research Block (West)", "medical"),
    "way/777101321": ("UMMC–FOM Clinical Research Block (East)", "medical"),
    "way/359486861": ("FOM Medical Sciences Annex A", "medical"),
    "way/359486863": ("FOM Medical Sciences Annex B", "medical"),
    "way/359486864": ("FOM Student Learning Commons", "medical"),
    "way/777101337": ("FOM Multidisciplinary Teaching Lab", "medical"),
    # FOP — Faculty of Pharmacy
    "way/359486821": ("Department of Pharmaceutical Chemistry (FOP)", "medical"),
    "way/359486822": ("Department of Pharmaceutical Technology (FOP)", "medical"),
    "way/1030451553": ("Department of Clinical Pharmacy & Practice", "medical"),
    "way/1030451554": ("Pharmacy Teaching & Formulation Lab", "medical"),
    "way/1548856157": ("Faculty of Pharmacy Postgraduate Annex", "medical"),
    # FOD — Faculty of Dentistry
    "way/358009331": ("F23 - Faculty of Dentistry Block D (Oral Surgery)", "medical"),
    "way/996254541": ("F21 - Faculty of Dentistry Block B (Restorative)", "medical"),
    "way/996254544": ("F22 - Faculty of Dentistry Block C (Pre-Clinical)", "medical"),
    "way/1557751450": ("Dental Specialist Polyclinic Annex", "medical"),
    # FSES — Faculty of Sports & Exercise Sciences / Pusat Sukan
    "way/358004217": ("P01A - Pusat Sukan Administrative Block", "sports"),
    "way/358004218": ("P01B - Pusat Sukan Indoor Sports Hall", "sports"),
    "way/359487803": ("FSES Biomechanics & Exercise Physiology Lab", "sports"),
    "way/359487804": ("FSES Lecture & Sports Science Block", "sports"),
    "way/359487806": ("UM Sports Centre Gymnasium & Conditioning Wing", "sports"),
    "way/358004699": ("Squash & Racquet Sports Pavilion", "sports"),
    "way/358007582": ("P13 - JPPHB Events & Logistics Store", "admin"),
    "way/515589545": ("UM Arena Stadium", "sports"),
    "way/358007581": ("Varsity Tennis & Sports Pavilion", "sports"),
    "way/996669811": ("Sports Centre Athlete Quarters A", "sports"),
    "way/996669812": ("Sports Centre Athlete Quarters B", "sports"),
    # APM — Academy of Malay Studies
    "way/358002869": ("APM Academic & Lecture Hall Block A", "academic"),
    "way/359487726": ("APM Library & Malay Documentation Centre", "library"),
    "way/39924196": ("Muzium Seni Kraf & Galeri APM", "hall"),
    "way/358002923": ("APM Traditional Malay House Pavilion", "hall"),
    "way/358006955": ("APM Postgraduate & Language Wing", "academic"),
    "way/1033418695": ("Department of Malay Linguistics (APM)", "academic"),
    "way/1033418696": ("Department of Malay Literature (APM)", "academic"),
    "way/1033418697": ("Department of Socio-Culture & Malay Arts (APM)", "academic"),
    # API — Academy of Islamic Studies
    "way/358005914": ("API Block A (Syariah & Law)", "academic"),
    "way/358005916": ("API Block B (Usuluddin & Islamic Thought)", "academic"),
    "way/358003435": ("API Block C (Al-Quran & Al-Hadith)", "academic"),
    "way/358003436": ("API Lecture Hall Complex", "hall"),
    "way/358003437": ("API Islamic Studies Library", "library"),
    "way/358002881": ("API Surau & Dakwah Centre", "academic"),
    "way/996053342": ("API Al-Khwarizmi Auditorium", "hall"),
    "way/996053343": ("API Administrative Wing", "admin"),
    "way/996053344": ("API Postgraduate Studies Wing", "academic"),
    # KPPI — Research Management & Innovation Complex
    "way/358006148": ("B33 - Science & Engineering Research Lab", "research"),
    "way/358009337": ("B41 - KPPI Research Management Wing", "research"),
    "way/1031930293": ("KPPI Central Instrumentation Facility", "research"),
    "way/1031930294": ("KPPI Innovation & Commercialisation Wing", "research"),
    # IAS — Institute for Advanced Studies (IPS)
    "way/1031937363": ("Institute for Advanced Studies (IPS / IAS) Main Block", "research"),
    "way/1089920650": ("IAS Postgraduate Registry & Seminar Block", "research"),
    "way/1089920649": ("IAS Interdisciplinary Research Wing (North)", "research"),
    "way/1089920651": ("IAS Interdisciplinary Research Wing (East)", "research"),
    "way/1033390786": ("UM Centre for Sustainable Development & Policy", "research"),
    # AEI — Asia-Europe Institute & Rimba Conservatory Edge
    "way/358004245": ("Asia-Europe Institute Research & Seminar Annex", "research"),
    "way/1033432689": ("AEI Postgraduate Resource Wing", "research"),
    "way/1033432686": ("Rimba Ilmu Conservatory Glasshouse 1", "research"),
    "way/1033432687": ("Rimba Ilmu Conservatory Glasshouse 2", "research"),
    "way/1033432688": ("Rimba Ilmu Conservatory Glasshouse 3", "research"),
    # IH — International House
    "way/703129513": ("UM International House — Block A", "residential"),
    "way/703129514": ("UM International House — Block B", "residential"),
    "way/703129515": ("UM International House — Block C", "residential"),
    "way/703129516": ("UM International House — Block D", "residential"),
}


def dist_m(a, b):
    dlat = (b[1] - a[1]) * 111320.0
    dlng = (b[0] - a[0]) * 111320.0 * math.cos(math.radians(3.122))
    return math.hypot(dlng, dlat)


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside


def geom_rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def ring_bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def seg_dist_sq(px, py, x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    l2 = dx * dx + dy * dy
    if l2 < 1e-18:
        return (px - x1) ** 2 + (py - y1) ** 2
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / l2))
    projx = x1 + t * dx
    projy = y1 + t * dy
    return (px - projx) ** 2 + (py - projy) ** 2


def rasterize_polygon(ring, ox, oy, cell, nx, ny, grid, val=1):
    minx, miny, maxx, maxy = ring_bbox(ring)
    ix0 = max(0, int((minx - ox) / cell) - 1)
    ix1 = min(nx - 1, int((maxx - ox) / cell) + 1)
    iy0 = max(0, int((miny - oy) / cell) - 1)
    iy1 = min(ny - 1, int((maxy - oy) / cell) + 1)
    for iy in range(iy0, iy1 + 1):
        y = oy + (iy + 0.5) * cell
        row = grid[iy]
        for ix in range(ix0, ix1 + 1):
            x = ox + (ix + 0.5) * cell
            if point_in_ring(x, y, ring):
                row[ix] = val


def rasterize_line(coords, ox, oy, cell, nx, ny, grid, half_w_cells=1, val=1):
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        steps = max(1, int(math.hypot(x2 - x1, y2 - y1) / (cell * 0.5)))
        for s in range(steps + 1):
            t = s / steps
            x = x1 + (x2 - x1) * t
            y = y1 + (y2 - y1) * t
            ix = int((x - ox) / cell)
            iy = int((y - oy) / cell)
            for dy in range(-half_w_cells, half_w_cells + 1):
                yy = iy + dy
                if 0 <= yy < ny:
                    row = grid[yy]
                    for dx in range(-half_w_cells, half_w_cells + 1):
                        xx = ix + dx
                        if 0 <= xx < nx:
                            row[xx] = val


def dilate_blocked(seed_grid, block_grid, nx, ny, steps):
    cur = [row[:] for row in seed_grid]
    for _ in range(steps):
        nxt = [row[:] for row in cur]
        for y in range(1, ny - 1):
            cy = cur[y]
            by = block_grid[y]
            ny_row = nxt[y]
            for x in range(1, nx - 1):
                if cy[x] == 1:
                    continue
                if by[x] == 1:
                    continue
                if cur[y - 1][x] or cur[y + 1][x] or cy[x - 1] or cy[x + 1]:
                    ny_row[x] = 1
        cur = nxt
    return cur


def close_holes(grid, nx, ny):
    # Flood fill outside from border; any unvisited 0 becomes 1
    vis = [[0] * nx for _ in range(ny)]
    q = []
    for x in range(nx):
        if grid[0][x] == 0:
            vis[0][x] = 1
            q.append((x, 0))
        if grid[ny - 1][x] == 0:
            vis[ny - 1][x] = 1
            q.append((x, ny - 1))
    for y in range(ny):
        if grid[y][0] == 0:
            vis[y][0] = 1
            q.append((0, y))
        if grid[y][nx - 1] == 0:
            vis[y][nx - 1] = 1
            q.append((nx - 1, y))
    head = 0
    while head < len(q):
        x, y = q[head]
        head += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            xx, yy = x + dx, y + dy
            if 0 <= xx < nx and 0 <= yy < ny and not vis[yy][xx] and grid[yy][xx] == 0:
                vis[yy][xx] = 1
                q.append((xx, yy))
    out = [[1 if (grid[y][x] == 1 or not vis[y][x]) else 0 for x in range(nx)] for y in range(ny)]
    return out


def keep_largest_component(grid, nx, ny):
    vis = [[0] * nx for _ in range(ny)]
    best = []
    for y in range(ny):
        for x in range(nx):
            if grid[y][x] == 1 and not vis[y][x]:
                comp = [(x, y)]
                vis[y][x] = 1
                h = 0
                while h < len(comp):
                    cx, cy = comp[h]
                    h += 1
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        xx, yy = cx + dx, cy + dy
                        if 0 <= xx < nx and 0 <= yy < ny and grid[yy][xx] == 1 and not vis[yy][xx]:
                            vis[yy][xx] = 1
                            comp.append((xx, yy))
                if len(comp) > len(best):
                    best = comp
    out = [[0] * nx for _ in range(ny)]
    for x, y in best:
        out[y][x] = 1
    return out


def extract_boundary_loop(grid, ox, oy, cell, nx, ny):
    """Extract outer boundary contour of binary 1-region using directed cell edges."""
    edges = {}
    for y in range(ny):
        for x in range(nx):
            if grid[y][x] != 1:
                continue
            # Check 4 neighbors; add CCW boundary edge when neighbor is 0/out
            # Bottom edge (y-1 is 0): (x,y) -> (x+1,y)
            if y == 0 or grid[y - 1][x] == 0:
                edges.setdefault((x, y), []).append((x + 1, y))
            # Right edge (x+1 is 0): (x+1,y) -> (x+1,y+1)
            if x == nx - 1 or grid[y][x + 1] == 0:
                edges.setdefault((x + 1, y), []).append((x + 1, y + 1))
            # Top edge (y+1 is 0): (x+1,y+1) -> (x,y+1)
            if y == ny - 1 or grid[y + 1][x] == 0:
                edges.setdefault((x + 1, y + 1), []).append((x, y + 1))
            # Left edge (x-1 is 0): (x,y+1) -> (x,y)
            if x == 0 or grid[y][x - 1] == 0:
                edges.setdefault((x, y + 1), []).append((x, y))

    if not edges:
        return None

    # Trace longest loop
    used = set()
    best_loop = []
    for start in list(edges.keys()):
        for nxt in edges[start]:
            if (start, nxt) in used:
                continue
            loop = [start]
            cur = start
            cur_nxt = nxt
            while True:
                used.add((cur, cur_nxt))
                loop.append(cur_nxt)
                if cur_nxt == start:
                    break
                cands = [p for p in edges.get(cur_nxt, []) if (cur_nxt, p) not in used]
                if not cands:
                    break
                # Prefer turning right (outermost boundary) if junction
                dx, dy = cur_nxt[0] - cur[0], cur_nxt[1] - cur[1]
                if len(cands) > 1:
                    # right turn order: (dy, -dx), (dx, dy), (-dy, dx)
                    pref = [(dy, -dx), (dx, dy), (-dy, dx)]
                    chosen = cands[0]
                    for pdx, pdy in pref:
                        for c in cands:
                            if (c[0] - cur_nxt[0], c[1] - cur_nxt[1]) == (pdx, pdy):
                                chosen = c
                                break
                        else:
                            continue
                        break
                    cur, cur_nxt = cur_nxt, chosen
                else:
                    cur, cur_nxt = cur_nxt, cands[0]
            if len(loop) > len(best_loop) and loop[0] == loop[-1]:
                best_loop = loop

    if len(best_loop) < 4:
        return None

    # Convert grid corners to lng/lat
    pts = [[ox + gx * cell, oy + gy * cell] for (gx, gy) in best_loop[:-1]]

    # Chaikin smoothing (2 passes) to remove stair-stepping
    for _ in range(2):
        sm = []
        n = len(pts)
        for i in range(n):
            p0 = pts[i]
            p1 = pts[(i + 1) % n]
            sm.append([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]])
            sm.append([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]])
        pts = sm

    # Douglas-Peucker simplification on closed ring (~5.5m tolerance)
    tol = 0.000050
    pts = dp_closed(pts, tol)
    pts = [[round(p[0], 6), round(p[1], 6)] for p in pts]
    pts.append(pts[0])
    return pts


def dp_line(pts, tol):
    if len(pts) <= 2:
        return pts
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    max_d = -1.0
    idx = 0
    for i in range(1, len(pts) - 1):
        d = math.sqrt(seg_dist_sq(pts[i][0], pts[i][1], x1, y1, x2, y2))
        if d > max_d:
            max_d = d
            idx = i
    if max_d > tol:
        left = dp_line(pts[: idx + 1], tol)
        right = dp_line(pts[idx:], tol)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def dp_closed(pts, tol):
    if len(pts) <= 4:
        return pts
    # Split at farthest pair
    n = len(pts)
    far_i = max(range(1, n), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = dp_line(pts[: far_i + 1], tol)
    b = dp_line(pts[far_i:] + [pts[0]], tol)
    return a[:-1] + b[:-1]


def polygon_centroid(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    n = len(pts)
    if n == 0:
        return [101.6538, 3.1209]
    area = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(area) < 1e-12:
        return [round(sum(p[0] for p in pts) / n, 6), round(sum(p[1] for p in pts) / n, 6)]
    area *= 0.5
    return [round(cx / (6.0 * area), 6), round(cy / (6.0 * area), 6)]


def retrace_zones(facs, blds, ctx, boundary_rings):
    # Pre-defined OSM zones that act as hard boundaries
    fixed_zones = [ft for ft in facs if ft["properties"].get("code") not in TARGET_ZONES]
    target_map = {ft["properties"]["code"]: ft for ft in facs if ft["properties"].get("code") in TARGET_ZONES}

    # Road segments (major & campus roads act as natural zone dividers)
    road_lines = []
    for r in ctx["roads"]["features"]:
        k = r["properties"].get("kind", "")
        if k in ("primary", "secondary", "tertiary", "residential", "service", "unclassified", "road", "trunk", "motorway"):
            g = r["geometry"]
            if g["type"] == "LineString":
                road_lines.append((k, g["coordinates"]))
            elif g["type"] == "MultiLineString":
                for line in g["coordinates"]:
                    road_lines.append((k, line))

    # Parks / pitches / lakes that naturally belong inside specific zones
    extra_zone_polys = {"FSES": [], "CORE": [], "IH": []}
    for pk in ctx["parks"]["features"]:
        rings = geom_rings(pk["geometry"])
        for rg in rings:
            c = polygon_centroid(rg)
            if 101.6572 <= c[0] <= 101.6612 and 3.1282 <= c[1] <= 3.1325:
                extra_zone_polys["FSES"].append(rg)
            elif 101.6365 <= c[0] <= 101.6382 and 3.1188 <= c[1] <= 3.1202:
                extra_zone_polys["IH"].append(rg)
    for w in ctx["water"]["features"]:
        if w["geometry"]["type"] == "Polygon" and "Varsiti" in str(w["properties"].get("name", "")):
            extra_zone_polys["CORE"].append(w["geometry"]["coordinates"][0])

    # Process tighter standalone landmarks before broader neighboring zones so every border fits cleanly
    order = [
        "LIB",
        "KPS",
        "DTC",
        "HIR",
        "EXAM",
        "JPPHB",
        "CORE",
        "FOM",
        "FOP",
        "FOD",
        "FSES",
        "APM",
        "KPPI",
        "IAS",
        "AEI",
        "UMSC",
        "MASJID",
        "R&D",
        "IH",
    ]
    # Track already finalized zone rings so adjacent target zones don't overlap each other either
    finalized_rings = {}
    for ft in fixed_zones:
        finalized_rings[ft["properties"]["code"]] = geom_rings(ft["geometry"])

    cell = 0.000034  # ~3.75m per cell

    for code in order:
        if code not in target_map:
            continue
        ft = target_map[code]
        zone_ids = {code, ft["properties"].get("id")}
        zone_blds = [b for b in blds if b["properties"].get("faculty_id") in zone_ids]
        seed_rings = []
        for b in zone_blds:
            seed_rings.extend(geom_rings(b["geometry"]))
        seed_rings.extend(extra_zone_polys.get(code, []))

        if not seed_rings:
            print(f"  SKIP {code}: no seed buildings")
            continue

        # Bounding box around seeds + 140m margin
        all_pts = [p for rg in seed_rings for p in rg]
        pad = 0.0014
        minx = min(p[0] for p in all_pts) - pad
        miny = min(p[1] for p in all_pts) - pad
        maxx = max(p[0] for p in all_pts) + pad
        maxy = max(p[1] for p in all_pts) + pad

        nx = int((maxx - minx) / cell) + 2
        ny = int((maxy - miny) / cell) + 2

        seed_grid = [[0] * nx for _ in range(ny)]
        block_grid = [[0] * nx for _ in range(ny)]

        # 1. Rasterize seed buildings & grounds
        for rg in seed_rings:
            rasterize_polygon(rg, minx, miny, cell, nx, ny, seed_grid, 1)

        # Slightly pre-dilate seed buildings to bridge courtyards inside the zone
        bridge_steps = 1 if code in ("LIB", "KPS", "DTC", "HIR", "JPPHB") else 2
        seed_bridged = dilate_blocked(seed_grid, [[0] * nx for _ in range(ny)], nx, ny, bridge_steps)

        # 2. Rasterize neighboring finalized zones into block_grid
        for other_code, other_rings in finalized_rings.items():
            if other_code == code:
                continue
            for org in other_rings:
                ominx, ominy, omaxx, omaxy = ring_bbox(org)
                if omaxx < minx or ominx > maxx or omaxy < miny or ominy > maxy:
                    continue
                rasterize_polygon(org, minx, miny, cell, nx, ny, block_grid, 1)

        # Also block against other zones' building footprints so tightly packed central precincts never swallow neighbors
        if code in ("LIB", "KPS", "DTC", "HIR", "CORE", "JPPHB", "EXAM"):
            for ob in blds:
                ofid = ob["properties"].get("faculty_id")
                if ofid == code or ob["properties"].get("is_canopy"):
                    continue
                for org in geom_rings(ob["geometry"]):
                    ominx, ominy, omaxx, omaxy = ring_bbox(org)
                    if omaxx < minx or ominx > maxx or omaxy < miny or ominy > maxy:
                        continue
                    rasterize_polygon(org, minx, miny, cell, nx, ny, block_grid, 1)

        # 3. Rasterize major/arterial/collector roads into block_grid (except where directly inside seed footprints)
        major_kinds = {"primary", "secondary", "tertiary", "trunk", "motorway", "residential", "unclassified"}
        if code in ("MASJID", "R&D", "UMSC", "IH", "FOD", "FOP", "KPPI", "IAS", "AEI", "EXAM", "JPPHB", "LIB", "KPS", "DTC", "HIR", "CORE"):
            major_kinds = major_kinds | {"service", "road"}

        for k, coords in road_lines:
            if k not in major_kinds:
                continue
            # Quick bbox reject
            rxs = [p[0] for p in coords]
            rys = [p[1] for p in coords]
            if max(rxs) < minx or min(rxs) > maxx or max(rys) < miny or min(rys) > maxy:
                continue
            hw = 2 if k in ("primary", "secondary", "trunk", "motorway") else 1
            rasterize_line(coords, minx, miny, cell, nx, ny, block_grid, half_w_cells=hw, val=1)

        # Keep seed building interiors unblocked
        for y in range(ny):
            sg = seed_bridged[y]
            bg = block_grid[y]
            for x in range(nx):
                if sg[x] == 1:
                    bg[x] = 0

        # 4. Clip to campus boundary for on-campus zones (except peripheral zones touching edge)
        if code not in OFF_CAMPUS_ZONES and code not in ("MASJID", "UMSC", "FOD"):
            for y in range(ny):
                cy = miny + (y + 0.5) * cell
                bg = block_grid[y]
                sg = seed_bridged[y]
                for x in range(nx):
                    if bg[x] == 1 or sg[x] == 1:
                        continue
                    cx = minx + (x + 0.5) * cell
                    if not any(point_in_ring(cx, cy, br) for br in boundary_rings):
                        bg[x] = 1

        # 5. Dilate outward to hug roads, forest & neighboring zones
        expand_steps = {
            "MASJID": 10,
            "R&D": 9,
            "UMSC": 9,
            "IH": 7,
            "FOD": 8,
            "FOP": 8,
            "FOM": 10,
            "EXAM": 10,
            "JPPHB": 6,
            "LIB": 6,
            "KPS": 5,
            "DTC": 5,
            "HIR": 6,
            "CORE": 8,
            "FSES": 11,
            "APM": 10,
            "KPPI": 8,
            "IAS": 8,
            "AEI": 7,
        }.get(code, 9)

        grown = dilate_blocked(seed_bridged, block_grid, nx, ny, expand_steps)
        # Close internal courtyards/holes and keep largest coherent parcel
        grown = close_holes(grown, nx, ny)
        grown = keep_largest_component(grown, nx, ny)

        loop = extract_boundary_loop(grown, minx, miny, cell, nx, ny)
        if loop and len(loop) >= 8:
            ft["geometry"] = {"type": "Polygon", "coordinates": [loop]}
            center = polygon_centroid(loop)
            ft["properties"]["center"] = center
            finalized_rings[code] = [loop]
            print(f"  RE-TRACED {code:8s}: {len(loop)} vertices, center={center}")
        else:
            print(f"  KEEP      {code:8s}: fallback")
            finalized_rings[code] = geom_rings(ft["geometry"])


def build_jogging_routes(graph):
    """Build real road/walkway-snapped UM jogging loops via Dijkstra on um_graph.json."""
    nodes = graph["nodes"]  # list of [lng, lat]
    adj = [[] for _ in range(len(nodes))]
    for e in graph["edges"]:
        u, v, w = e[0], e[1], float(e[2])
        adj[u].append((v, w))
        adj[v].append((u, w))

    def nearest_node(coord):
        best_i = 0
        best_d = 1e18
        lng, lat = coord
        for i, n in enumerate(nodes):
            d = (n[0] - lng) ** 2 + (n[1] - lat) ** 2
            if d < best_d:
                best_d = d
                best_i = i
        return best_i

    def shortest_path(src, dst):
        pq = [(0.0, src)]
        dist = {src: 0.0}
        prev = {}
        while pq:
            d, u = heapq.heappop(pq)
            if u == dst:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in adj[u]:
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if dst not in dist:
            return [nodes[src], nodes[dst]], dist_m(nodes[src], nodes[dst])
        path = []
        cur = dst
        while cur != src:
            path.append(nodes[cur])
            cur = prev[cur]
        path.append(nodes[src])
        path.reverse()
        return path, dist[dst]

    def trace_loop(waypoints):
        coords = []
        total_m = 0.0
        w_nodes = [nearest_node(wp) for wp in waypoints]
        for i in range(len(w_nodes)):
            u = w_nodes[i]
            v = w_nodes[(i + 1) % len(w_nodes)]
            seg, seg_m = shortest_path(u, v)
            if coords and seg:
                coords.extend(seg[1:])
            else:
                coords.extend(seg)
            total_m += seg_m
        # Simplify lightly to keep GeoJSON compact while strictly hugging roads
        simp = dp_line(coords, 0.000018)
        simp = [[round(p[0], 6), round(p[1], 6)] for p in simp]
        return simp, round(total_m / 1000.0, 2)

    loops_spec = [
        {
            "id": "jog-tasik-varsiti",
            "name": "Tasik Varsiti Lake Loop",
            "short_name": "Tasik Varsiti Loop",
            "terrain": "Flat · Shaded lakeside boardwalk",
            "difficulty": "Easy",
            "waypoints": [
                [101.6562, 3.1197],  # NW lake near Perdanasiswa
                [101.6578, 3.1199],  # NE lake near Canseleri
                [101.6590, 3.1192],  # East lake near KK1/Masjid link
                [101.6574, 3.1186],  # South lakeside path
                [101.6556, 3.1191],  # SW lake near KK2/FK
            ],
        },
        {
            "id": "jog-lingkungan-budi",
            "name": "Lingkungan Budi Campus Loop",
            "short_name": "Lingkungan Budi Loop",
            "terrain": "Rolling hills · Classic UM perimeter run",
            "difficulty": "Moderate",
            "waypoints": [
                [101.6552, 3.1204],  # Perdanasiswa / DTC
                [101.6531, 3.1225],  # FS / FASS junction
                [101.6512, 3.1255],  # APM / KK7
                [101.6517, 3.1286],  # FSKTM / KK8
                [101.6548, 3.1303],  # North Rimba / KK10
                [101.6581, 3.1297],  # API / Sports Centre junction
                [101.6598, 3.1268],  # KK11 / KK12 east hill
                [101.6601, 3.1229],  # PASUM / KPPI
                [101.6607, 3.1194],  # KK1 / Main Gate approach
                [101.6580, 3.1183],  # KK1 / KK2 south road
                [101.6550, 3.1189],  # FK / Tasik south
            ],
        },
        {
            "id": "jog-arena-sports",
            "name": "UM Arena & Sports Centre Loop",
            "short_name": "UM Arena Loop",
            "terrain": "Flat · Stadium track & sports precinct",
            "difficulty": "Easy",
            "waypoints": [
                [101.6591, 3.1310],  # West of UM Arena
                [101.6599, 3.1316],  # North of UM Arena
                [101.6605, 3.1302],  # East sports road
                [101.6601, 3.1286],  # Swimming pool / KK11 edge
                [101.6589, 3.1294],  # West Rimba / Sports Centre edge
            ],
        },
    ]

    features = []
    for spec in loops_spec:
        coords, km = trace_loop(spec["waypoints"])
        print(f"  JOGGING LOOP: {spec['name']} -> {km:.2f} km ({len(coords)} pts)")
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": spec["id"],
                    "name": spec["name"],
                    "short_name": spec["short_name"],
                    "distance_km": km,
                    "terrain": spec["terrain"],
                    "difficulty": spec["difficulty"],
                    "kind": "jogging",
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )
    return {"type": "FeatureCollection", "features": features}


def main():
    with open(DATA_DIR / "um_faculties.geojson") as f:
        facs_fc = json.load(f)
    with open(DATA_DIR / "um_buildings.geojson") as f:
        blds_fc = json.load(f)
    with open(DATA_DIR / "um_rooms.geojson") as f:
        rooms_fc = json.load(f)
    with open(DATA_DIR / "um_context.geojson") as f:
        ctx = json.load(f)
    with open(DATA_DIR / "um_boundary.geojson") as f:
        bnd_fc = json.load(f)
    with open(DATA_DIR / "um_graph.json") as f:
        graph = json.load(f)
    with open(DATA_DIR / "um_search_index.json") as f:
        search_idx = json.load(f)

    # 0. Upsert new standalone zones (EXAM, JPPHB, LIB, KPS, DTC, HIR) & refine CORE title
    existing_fac_by_id = {ft["properties"]["id"]: ft for ft in facs_fc["features"]}
    if "CORE" in existing_fac_by_id:
        cp = existing_fac_by_id["CORE"]["properties"]
        cp["name"] = "Chancellery & Central Admin"
        cp["short_label"] = "Chancellery"
        cp["map_code"] = "CORE"
        cp["description"] = "Bangunan Canseleri (Chancellery Tower), Pejabat Bendahari, Pejabat Keselamatan, and Tasik Varsiti."

    added_zones = 0
    for spec in NEW_ZONE_SPECS:
        zid = spec["id"]
        if zid in existing_fac_by_id:
            props = existing_fac_by_id[zid]["properties"]
            for k, v in spec.items():
                if k != "keywords":
                    props[k] = v
        else:
            props = {k: v for k, v in spec.items() if k != "keywords"}
            props["color"] = "#e8f0fe"
            props["accent"] = "#1a73e8"
            props["center"] = [101.6538, 3.1209]
            new_ft = {
                "type": "Feature",
                "properties": props,
                "geometry": {"type": "Polygon", "coordinates": [[[101.653, 3.120], [101.654, 3.120], [101.654, 3.121], [101.653, 3.121], [101.653, 3.120]]]},
            }
            facs_fc["features"].append(new_ft)
            existing_fac_by_id[zid] = new_ft
            added_zones += 1
    print(f"Ensured {len(NEW_ZONE_SPECS)} standalone UM zones ({added_zones} newly created).")

    # 1. Fix Wisma R&D linkage, apply standalone zone reassignments, verified building names & strip canopy room flags
    renamed_count = 0
    reassigned_count = 0
    canopy_ids = set()
    for b in blds_fc["features"]:
        p = b["properties"]
        if p.get("faculty_id") == "R&D":
            p["faculty_id"] = "WISMA_RD"
        bid = p.get("id")
        if bid in BUILDING_ZONE_REASSIGN:
            p["faculty_id"] = BUILDING_ZONE_REASSIGN[bid]
            reassigned_count += 1
        if bid in VERIFIED_BUILDING_NAMES:
            new_name, new_cat = VERIFIED_BUILDING_NAMES[bid]
            p["name"] = new_name
            p["is_inferred_name"] = False
            if not p.get("category") or p.get("category") in ("building", "academic", "generic", "residential"):
                p["category"] = new_cat
            renamed_count += 1
        elif bid == "osm-w1309093193":
            p["is_inferred_name"] = False
        elif isinstance(p.get("name"), str) and " — Covered Walkway Canopy" in p["name"]:
            p["is_canopy"] = True

        # Canopies are 2.5m open walkways/shelters and should never trigger 3D indoor room cutaways
        if p.get("is_canopy"):
            canopy_ids.add(bid)
            if p.get("has_rooms"):
                p["has_rooms"] = False

    # Sync room faculty_id & drop rooms mistakenly attached to open walkway canopies
    bld_by_id = {b["properties"]["id"]: b["properties"] for b in blds_fc["features"]}
    cleaned_rooms = []
    dropped_canopy_rooms = set()
    updated_room_facs = 0
    for r in rooms_fc["features"]:
        rp = r["properties"]
        bid = rp.get("building_id")
        if bid in canopy_ids:
            dropped_canopy_rooms.add(rp.get("id"))
            continue
        bp = bld_by_id.get(bid)
        if bp:
            if rp.get("faculty_id") != bp.get("faculty_id"):
                rp["faculty_id"] = bp["faculty_id"]
                updated_room_facs += 1
            if bp.get("name") and rp.get("building_name") != bp["name"]:
                rp["building_name"] = bp["name"]
        cleaned_rooms.append(r)
    rooms_fc["features"] = cleaned_rooms

    print(
        f"Applied {renamed_count} verified names, reassigned {reassigned_count} buildings, "
        f"synced {updated_room_facs} rooms, removed {len(dropped_canopy_rooms)} canopy rooms."
    )

    # 2. Re-trace rough/boxy & newly carved zone polygons along real roads, buildings & neighbor edges
    boundary_rings = []
    for ft in bnd_fc["features"]:
        boundary_rings.extend(geom_rings(ft["geometry"]))

    print("Re-tracing target zone boundaries:")
    retrace_zones(facs_fc["features"], blds_fc["features"], ctx, boundary_rings)

    # 3. Generate graph-snapped UM jogging loops
    print("Tracing popular UM jogging loops on campus graph:")
    jogging_fc = build_jogging_routes(graph)

    # 4. Sync search index with new zones, updated building/room names & centers
    fac_by_id = {f["properties"]["id"]: f["properties"] for f in facs_fc["features"]}
    spec_by_id = {s["id"]: s for s in NEW_ZONE_SPECS}
    nodes = graph["nodes"]

    def nearest_graph_node(center):
        return min(range(len(nodes)), key=lambda i: (nodes[i][0] - center[0]) ** 2 + (nodes[i][1] - center[1]) ** 2)

    indexed_building_ids = set()
    indexed_faculty_ids = set()
    updated_search = 0
    filtered_search = []
    for item in search_idx:
        if item.get("kind") == "room" and item.get("id") in dropped_canopy_rooms:
            continue
        if item.get("kind") == "building" and item.get("id") in bld_by_id:
            indexed_building_ids.add(item["id"])
            bp = bld_by_id[item["id"]]
            if (
                item.get("title") != bp["name"]
                or item.get("faculty_id") != bp["faculty_id"]
                or item.get("has_rooms") != bool(bp.get("has_rooms", False))
            ):
                item["title"] = bp["name"]
                item["faculty_id"] = bp["faculty_id"]
                item["has_rooms"] = bool(bp.get("has_rooms", False))
                lvls = bp.get("levels", 2)
                item["subtitle"] = f"{bp['faculty_id']} · {lvls} level{'s' if lvls != 1 else ''}"
                item["keywords"] = f"{bp['name'].lower()} {bp['faculty_id'].lower()} {bp.get('category', '')}".strip()
                updated_search += 1
        elif item.get("kind") == "room" and item.get("building_id") in bld_by_id:
            bp = bld_by_id[item["building_id"]]
            if item.get("faculty_id") != bp["faculty_id"]:
                item["faculty_id"] = bp["faculty_id"]
                updated_search += 1
        elif item.get("kind") == "faculty" and item.get("id") in fac_by_id:
            indexed_faculty_ids.add(item["id"])
            fp = fac_by_id[item["id"]]
            if fp.get("center"):
                item["center"] = fp["center"]
                item["entrance_node"] = nearest_graph_node(fp["center"])
            item["title"] = fp["name"]
            item["zone_kind"] = fp.get("zone_kind", item.get("zone_kind"))
            if item["id"] == "CORE":
                item["subtitle"] = "CORE · Campus landmark"
                item["keywords"] = "core chancellery bangunan canseleri bendahari keselamatan tasik varsiti"
        filtered_search.append(item)
    search_idx = filtered_search

    # Add newly created standalone zones to search index
    added_zone_search = 0
    for spec in NEW_ZONE_SPECS:
        zid = spec["id"]
        if zid in indexed_faculty_ids or zid not in fac_by_id:
            continue
        fp = fac_by_id[zid]
        center = fp.get("center") or [101.6538, 3.1209]
        ent = nearest_graph_node(center)
        zkind = fp.get("zone_kind", "landmark")
        zlabel = "Research institute" if zkind == "institute" else "Campus landmark"
        search_idx.insert(
            0,
            {
                "id": zid,
                "kind": "faculty",
                "zone_kind": zkind,
                "title": fp["name"],
                "subtitle": f"{zid} · {zlabel}",
                "faculty_id": zid,
                "category": fp.get("category", "landmark"),
                "center": center,
                "entrance_node": ent,
                "keywords": spec["keywords"],
            },
        )
        added_zone_search += 1

    # Append any verified named buildings that weren't previously indexed
    added_search = 0
    for bid in VERIFIED_BUILDING_NAMES:
        if bid in indexed_building_ids or bid not in bld_by_id:
            continue
        bp = bld_by_id[bid]
        center = bp.get("center") or [101.6538, 3.1209]
        ent = bp.get("entrance_node")
        if ent is None or ent < 0:
            ent = nearest_graph_node(center)
            bp["entrance_node"] = ent
        lvls = bp.get("levels", 2)
        fid = bp.get("faculty_id", "CORE")
        search_idx.append(
            {
                "id": bid,
                "kind": "building",
                "title": bp["name"],
                "subtitle": f"{fid} · {lvls} level{'s' if lvls != 1 else ''}",
                "faculty_id": fid,
                "category": bp.get("category", "academic"),
                "center": center,
                "entrance_node": ent,
                "has_rooms": bool(bp.get("has_rooms", False)),
                "keywords": f"{bp['name'].lower()} {fid.lower()} {bp.get('category', '')}".strip(),
            }
        )
        added_search += 1

    print(
        f"Updated {updated_search} search entries, added {added_zone_search} zones "
        f"& {added_search} verified buildings in um_search_index.json."
    )

    # Write outputs
    with open(DATA_DIR / "um_faculties.geojson", "w") as f:
        json.dump(facs_fc, f, separators=(",", ":"))
    with open(DATA_DIR / "um_buildings.geojson", "w") as f:
        json.dump(blds_fc, f, separators=(",", ":"))
    with open(DATA_DIR / "um_rooms.geojson", "w") as f:
        json.dump(rooms_fc, f, separators=(",", ":"))
    with open(DATA_DIR / "um_jogging.geojson", "w") as f:
        json.dump(jogging_fc, f, separators=(",", ":"))
    with open(DATA_DIR / "um_search_index.json", "w") as f:
        json.dump(search_idx, f, separators=(",", ":"))

    print("ALL DATA ENRICHMENT COMPLETE.")


if __name__ == "__main__":
    main()
