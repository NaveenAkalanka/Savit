import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Link } from '@savit/shared';

type NodeStatus = 'entering' | 'idle' | 'exiting';

interface NodeEntry {
  id: number;
  link: Link | null; // null = decorative filler node, not tied to a saved link
  dummy: boolean; // true = pure gap-filler — renders like any other node but never joins the connection mesh
}

interface TrackedNode extends NodeEntry {
  status: NodeStatus;
}

interface PhysicsNode {
  pos: THREE.Vector3;
  target: THREE.Vector3 | null; // non-null only while this node is still expanding out from the big-bang origin
  bornAt: number; // performance.now() at the moment the whole intro started
  introDelay: number; // ms this node waits after bornAt before it starts moving — staggers the burst
}

/** [nodeA, nodeB, visibilityTier] — tier picks how visible this particular line is, so the ambient mesh isn't flat. */
type WeightedEdge = [number, number, number];

const BASE_VOLUME_RADIUS = 8; // outer bound of the star field at BASE_TOTAL_NODE_COUNT nodes — scales up past that, see computeShellRadii
const BASE_CORE_RADIUS = 4.5; // inner bound — nothing sits inside this, keeping the core hollow — scales with the volume
const BASE_CAMERA_DISTANCE = 10; // camera dolly distance at BASE_TOTAL_NODE_COUNT nodes — pulls back as the shell grows
const BASE_FOG_NEAR = 6; // fog range tuned for BASE_CAMERA_DISTANCE — scales with the shell so it never swallows a bigger field
const BASE_FOG_FAR = 24;
const NEAR_MIN = 4;
const NEAR_MAX = 5;
const FAR_MIN = 1;
const FAR_MAX = 2;
const FAR_CHANCE = 0.2; // most nodes get no long connection at all — only a random few do
const NEAR_POOL_SIZE = 8; // candidate window of genuinely-closest nodes to pick the short links from
const FAR_POOL_SIZE = 8; // candidate window of genuinely-farthest nodes to pick the long links from
const BASE_ROTATE_SPEED = 0.068; // rad/s around y, resumed after a drag releases (up 5%)
const BASE_ROTATE_SPEED_X = 0.024; // rad/s ambient tumble around x — deliberately not a clean ratio of the y speed so the two never fall back into sync
const BASE_ROTATE_SPEED_Z = 0.017; // rad/s ambient tumble around z — together with x/y this reads as a tumbling body, not a flat turntable spin
const DRAG_SPRING_STIFFNESS = 130; // how hard the displayed rotation is pulled toward the drag target each frame
const DRAG_SPRING_DAMPING = 12; // kept below ~2*sqrt(stiffness) (critical damping) on purpose — slightly underdamped, so the sphere has a little weighted wobble/overshoot as it catches up to the cursor instead of snapping 1:1
const CAMERA_FOV_DEG = 50; // must match the <Canvas camera> fov below — drag-to-rotate math depends on it lining up
const MAX_FLING_SPEED = 6; // rad/s cap on release-momentum, guards against a runaway spin from a tiny event-to-event dt
const HOVER_HIT_RADIUS = 0.08; // invisible hit-test area, well bigger than the visible dot so hovering doesn't require pixel precision
const EXIT_DURATION_MS = 480;
const SHORT_NAME_MAX_LENGTH = 24; // permanently-shown node labels are truncated to this many characters
const BASE_NODE_SIZE_REFERENCE_DISTANCE = 8; // camera distance at which a node renders at its default size — never larger, only smaller when closer — scales with the camera dolly
const DRAG_RELEASE_HOLD_MS = 500; // grace pause right after a drag ends, so the sphere holds still long enough to click the node you were aiming for
const TARGET_NODE_COUNT = 180; // decorative filler nodes top the field up to this when there aren't enough real links — these still join the connection mesh like any real node
const GAP_FILLER_COUNT = 960; // extra unlinked nodes scattered on top, purely to fill visual gaps — never part of the connection mesh
const GAP_FILLER_OUTSIDE_RATIO = 0.7; // fraction placed in the outer halo band rather than interspersed inside the main shell
const BASE_TOTAL_NODE_COUNT = TARGET_NODE_COUNT + GAP_FILLER_COUNT; // node count the shell/camera/fog constants above are tuned for
const CLUSTER_ANGLE_THRESHOLD = (40 * Math.PI) / 180; // ~40° — how close two search/category matches need to be to count as "the same neighborhood" when picking a focus point
const MIN_NODE_DISTANCE = 1; // no two nodes place closer than this — keeps every node individually identifiable, not clumped
const MIN_DISTANCE_ATTEMPTS = 20; // rejection-sampling budget per node before falling back to the best candidate found
const OPACITY_TIERS = [0.015, 0.035, 0.06, 0.1]; // most lines land in the fainter tiers, a few reach full visibility
const CHAIN_COUNT = 5; // a handful of short linear "path" connections scattered through the field, star-map style
const CHAIN_MAX_HOPS = 3; // each chain strings together up to this many hops from its starting node
const CHAIN_CANDIDATES = 3; // the next hop is picked randomly from this many nearest not-yet-used nodes
const FOCUSED_DIM_FACTOR = 0.25; // every tier dims by this much further while a node is hovered
const BIGBANG_NODE_DURATION_MS = 1100; // how long a single node takes to travel from center to its placed spot
const BIGBANG_STAGGER_MS = 500; // random extra delay before a node starts moving, so the burst isn't perfectly synced
const BIGBANG_EDGE_START_MS = 0; // connections start growing in immediately, alongside the node expansion — not after it
const BIGBANG_EDGE_DURATION_MS = BIGBANG_NODE_DURATION_MS + BIGBANG_STAGGER_MS; // reaches full opacity right as the last-staggered node arrives

interface ShellRadii {
  volumeRadius: number;
  coreRadius: number;
  sphereRadius: number;
  gapFillerOuterRadius: number; // gap-filler nodes are allowed to roam out past volumeRadius, into a loose halo outside the connected mesh
  nodeSizeReferenceDistance: number;
  cameraDistance: number;
  fogNear: number;
  fogFar: number;
}

/** The whole scene — shell radii, node down-scale reference, camera dolly distance and fog range —
 *  is tuned at BASE_TOTAL_NODE_COUNT nodes. Once the real link count pushes the total past that,
 *  every one of these scales up together by the same cube-root factor: radius ∝ n^(1/3) keeps the
 *  volume-per-node (and so the placement density, spacing and framing the mesh was tuned for)
 *  constant no matter how many nodes are actually in it — it just reads as the same star field,
 *  pulled back to make room for more of it, rather than the same fixed sphere getting overcrowded. */
function computeShellRadii(totalNodeCount: number): ShellRadii {
  const scale = Math.max(1, Math.cbrt(totalNodeCount / BASE_TOTAL_NODE_COUNT));
  const volumeRadius = BASE_VOLUME_RADIUS * scale;
  const coreRadius = BASE_CORE_RADIUS * scale;
  return {
    volumeRadius,
    coreRadius,
    sphereRadius: (coreRadius + volumeRadius) / 2,
    gapFillerOuterRadius: volumeRadius * 2.2,
    nodeSizeReferenceDistance: BASE_NODE_SIZE_REFERENCE_DISTANCE * scale,
    cameraDistance: BASE_CAMERA_DISTANCE * scale,
    fogNear: BASE_FOG_NEAR * scale,
    fogFar: BASE_FOG_FAR * scale,
  };
}

function shortName(link: Link): string {
  const raw = link.title || link.url;
  return raw.length > SHORT_NAME_MAX_LENGTH ? `${raw.slice(0, SHORT_NAME_MAX_LENGTH - 1)}…` : raw;
}

function buildEntries(links: Link[], dummyGeneration: number): NodeEntry[] {
  const entries: NodeEntry[] = links.map((link) => ({ id: link.id, link, dummy: false }));
  const deficit = Math.max(0, TARGET_NODE_COUNT - links.length);
  for (let i = 0; i < deficit; i++) {
    entries.push({ id: -(i + 1), link: null, dummy: false });
  }
  // gap-fillers are decorative and unrelated to the actual data — their ids fold in the current
  // "generation" (bumped whenever the active search/category filter changes, see useStarSystem) so
  // the whole ambient field fades out and back in at fresh random positions alongside every filter
  // change, instead of sitting frozen while only the real/connected nodes react to what you searched.
  const dummyIdBase = dummyGeneration * 100_000;
  for (let i = 0; i < GAP_FILLER_COUNT; i++) {
    entries.push({ id: -(dummyIdBase + deficit + i + 1), link: null, dummy: true });
  }
  return entries;
}

function randomDirection(): THREE.Vector3 {
  let x = 0;
  let y = 0;
  let z = 0;
  let lenSq = Infinity;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    z = Math.random() * 2 - 1;
    lenSq = x * x + y * y + z * z;
  } while (lenSq > 1 || lenSq === 0);
  const inv = 1 / Math.sqrt(lenSq);
  return new THREE.Vector3(x * inv, y * inv, z * inv);
}

function randomShellRadius(innerRadius: number, outerRadius: number): number {
  // uniform volume density across the shell, not just a linear radius blend
  const innerRatio = innerRadius / outerRadius;
  const t = innerRatio ** 3 + Math.random() * (1 - innerRatio ** 3);
  return outerRadius * Math.cbrt(t);
}

/** Roughly sphere-shaped, not a perfect one — each node sits 60-80% of the way toward the sphere radius, the rest random.
 *  Rejection-sampled against already-placed nodes so nothing lands too close to an existing one — each node stays
 *  individually identifiable rather than blurring into a neighbor. Falls back to the least-crowded attempt if the
 *  budget runs out (dense areas near the end of placement), rather than looping indefinitely. */
/** Shared rejection-sampling core for both node kinds below — tries candidates from `sampleCandidate`
 *  until one clears MIN_NODE_DISTANCE from everything already placed, falling back to the
 *  least-crowded attempt if the budget runs out (dense areas near the end of placement). */
function rejectionSamplePosition(
  existing: THREE.Vector3[],
  sampleCandidate: () => THREE.Vector3,
  fallback: () => THREE.Vector3,
): THREE.Vector3 {
  let best: THREE.Vector3 | null = null;
  let bestMinDist = -Infinity;
  for (let attempt = 0; attempt < MIN_DISTANCE_ATTEMPTS; attempt++) {
    const candidate = sampleCandidate();
    let minDist = Infinity;
    for (const p of existing) {
      const d = candidate.distanceTo(p);
      if (d < minDist) minDist = d;
    }
    if (minDist >= MIN_NODE_DISTANCE) return candidate;
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      best = candidate;
    }
  }
  return best ?? fallback();
}

function placeNode(existing: THREE.Vector3[], shell: ShellRadii): THREE.Vector3 {
  return rejectionSamplePosition(
    existing,
    () => {
      const adherence = 0.6 + Math.random() * 0.2;
      const randomRadius = randomShellRadius(shell.coreRadius, shell.volumeRadius);
      const radius = adherence * shell.sphereRadius + (1 - adherence) * randomRadius;
      return randomDirection().multiplyScalar(radius);
    },
    () => randomDirection().multiplyScalar(shell.sphereRadius),
  );
}

/** Gap-filler placement — unlike placeNode, there's no pull toward the mid-shell radius, and the
 *  outer bound reaches past volumeRadius into gapFillerOuterRadius. That spreads these nodes evenly
 *  across a wider band, some tucked into gaps between real/connected nodes, some drifting out past
 *  the mesh's outer edge into a loose halo — exactly the two things gap-fillers are meant to fix. */
function placeGapFillerNode(existing: THREE.Vector3[], shell: ShellRadii): THREE.Vector3 {
  return rejectionSamplePosition(
    existing,
    () => {
      // weighted split between the inside band (same coreRadius..volumeRadius shell every other node
      // lives in, genuinely interspersed among them) and the outside halo band (volumeRadius..
      // gapFillerOuterRadius) — biased toward outside via GAP_FILLER_OUTSIDE_RATIO. Sampling the
      // whole coreRadius..gapFillerOuterRadius range in one shot distributes by volume instead, and
      // the outer band already has several times the volume of the inner one — compounding that with
      // an extra bias would leave the inside almost untouched, so the ratio is applied explicitly.
      const radius = Math.random() < GAP_FILLER_OUTSIDE_RATIO
        ? randomShellRadius(shell.volumeRadius, shell.gapFillerOuterRadius)
        : randomShellRadius(shell.coreRadius, shell.volumeRadius);
      return randomDirection().multiplyScalar(radius);
    },
    () => randomDirection().multiplyScalar(shell.volumeRadius),
  );
}

/** Damped spring wobble — rushes out toward the target, then rings around it for a couple of
 *  decreasing contract/expand cycles (an overshoot past, a pull-back under, fainter each time)
 *  before settling exactly at 1, instead of a single overshoot-and-stop pop. */
function easeOutJelly(t: number): number {
  if (t >= 1) return 1;
  const oscillations = 2.5; // ~2-3 full contract/expand cycles before it settles
  const damping = 7; // how fast each successive cycle's amplitude dies off
  return 1 - Math.exp(-damping * t) * Math.cos(oscillations * 2 * Math.PI * t);
}

/** How close a straight chord between two nodes passes to the center — used to keep long
 *  connections wrapping around the outside instead of cutting through the hollow core. */
function chordClearance(a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq === 0) return a.length();
  const t = Math.max(0, Math.min(1, -a.dot(ab) / lenSq));
  return a.clone().addScaledVector(ab, t).length();
}

/** Tracks which node entries currently exist, fading new ones in and removed ones out. */
function useSphereNodes(entries: NodeEntry[]): TrackedNode[] {
  const [tracked, setTracked] = useState<TrackedNode[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const nextIds = new Set(entries.map((e) => e.id));
    const byId = new Map(entries.map((e) => [e.id, e]));

    setTracked((prev) => {
      const prevIds = new Set(prev.map((n) => n.id));
      const next: TrackedNode[] = [];

      for (const n of prev) {
        if (nextIds.has(n.id)) {
          const timer = timers.current.get(n.id);
          if (timer) {
            clearTimeout(timer);
            timers.current.delete(n.id);
          }
          next.push({
            id: n.id,
            link: byId.get(n.id)!.link,
            dummy: byId.get(n.id)!.dummy,
            status: n.status === 'exiting' ? 'idle' : n.status,
          });
        } else if (n.status !== 'exiting') {
          next.push({ ...n, status: 'exiting' });
          const id = n.id;
          const timer = setTimeout(() => {
            setTracked((cur) => cur.filter((c) => c.id !== id));
            timers.current.delete(id);
          }, EXIT_DURATION_MS);
          timers.current.set(id, timer);
        } else {
          next.push(n);
        }
      }
      for (const e of entries) {
        if (!prevIds.has(e.id)) {
          next.push({ id: e.id, link: e.link, dummy: e.dummy, status: 'entering' });
        }
      }
      return next;
    });
  }, [entries]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
    };
  }, []);

  return tracked;
}

/** Which local-space direction to face for a given set of links: the group's average when a
 *  majority of them sit within CLUSTER_ANGLE_THRESHOLD of each other (find whichever one has the
 *  most neighbors within that angle — the biggest local pocket — and average just that pocket,
 *  rather than every match, which for a scattered set would just point at the empty middle), or the
 *  first (already-sorted) link's own direction when they're too scattered for any pocket to reach a
 *  majority. Returns null if none of the given links have a settled position yet. */
function computeClusterFocusDirection(links: Link[], physics: Map<number, PhysicsNode>): THREE.Vector3 | null {
  const directions: THREE.Vector3[] = [];
  for (const link of links) {
    const p = physics.get(link.id);
    const restPos = p ? p.target ?? p.pos : null;
    if (!restPos || restPos.lengthSq() < 1e-6) continue; // still at the big-bang origin, not settled yet
    directions.push(restPos.clone().normalize());
  }
  if (directions.length === 0) return null;
  if (directions.length === 1) return directions[0]!;

  let bestIndex = 0;
  let bestCount = 0;
  for (let i = 0; i < directions.length; i++) {
    let count = 0;
    for (let j = 0; j < directions.length; j++) {
      if (directions[i]!.angleTo(directions[j]!) <= CLUSTER_ANGLE_THRESHOLD) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  }
  const majorityThreshold = Math.ceil(directions.length / 2);
  if (bestCount >= majorityThreshold) {
    const sum = new THREE.Vector3();
    for (const d of directions) {
      if (d.angleTo(directions[bestIndex]!) <= CLUSTER_ANGLE_THRESHOLD) sum.add(d);
    }
    return sum.normalize();
  }
  return directions[0]!; // too scattered for a majority — top of the list instead
}

/** Solves the (x, y) Euler pair that rotates local direction d onto +Z (the point directly between
 *  the camera and the origin, i.e. dead-center on screen) — z is left at 0 so a focus always lands
 *  "upright" rather than inheriting whatever roll the ambient tumble had drifted to. Three's default
 *  Euler order is 'XYZ', which composes as R = Rx * Ry * Rz for a group's rotation.{x,y,z} props —
 *  i.e. Ry is applied to the vector first, then Rx — so y is solved from the raw (x, z) pair and x
 *  solved second, against the radius left over after y's rotation. */
function directionToFocusEuler(d: THREE.Vector3): { x: number; y: number; z: number } {
  const rho = Math.hypot(d.x, d.z);
  return { x: Math.atan2(d.y, rho), y: Math.atan2(-d.x, d.z), z: 0 };
}

/** Every node gets a fixed spot in the shell and wires to a random handful of others — not all-to-all, not distance-based. */
function useStarSystem(
  links: Link[],
  introStartTime: number,
  searchActive: boolean,
  searchKey: string,
  categoryKey: string | null,
) {
  // bumped whenever the search term actually changes (not just its active/inactive state) — folded
  // into gap-filler ids in buildEntries so the ambient field reshuffles to a fresh layout alongside
  // every search change, since those nodes have nothing to do with the real data. Comparing against a
  // ref during render (rather than an effect) applies the bump before this render's entries/useMemo
  // below reads it, so the new layout appears in the very same render.
  const dummyGenerationRef = useRef(0);
  const prevSearchKeyRef = useRef(searchKey);
  if (searchKey !== prevSearchKeyRef.current) {
    prevSearchKeyRef.current = searchKey;
    dummyGenerationRef.current += 1;
  }
  const entries = useMemo(() => buildEntries(links, dummyGenerationRef.current), [links, dummyGenerationRef.current]);
  const tracked = useSphereNodes(entries);
  const physicsRef = useRef(new Map<number, PhysicsNode>());
  const bigBangDoneRef = useRef(false);
  const introStartTimeRef = useRef(introStartTime); // mutable — rewound to "now" on a category-triggered reload
  // category changes replay the whole big-bang intro instead of rotating/rearranging in place — set
  // here the instant the prop changes, but not actually applied (physicsRef cleared, clock rewound)
  // until the placement pass below next runs against the *new* category's tracked set. Applying it
  // immediately would clear physics while `tracked` still lists the old category's nodes (links takes
  // a render or two to catch up after the prop change), leaving every node with nowhere to read its
  // position from and blanking the scene for a beat; deferring it here means the clear and the
  // fresh fill happen atomically in the same pass, so there's no empty gap in between.
  const pendingCategoryReloadRef = useRef(false);
  const prevCategoryKeyRef = useRef(categoryKey);
  if (categoryKey !== prevCategoryKeyRef.current) {
    prevCategoryKeyRef.current = categoryKey;
    pendingCategoryReloadRef.current = true;
  }
  // where the reload above lands the camera — the same majority-pocket-or-top-of-list rule as
  // search's focusTarget below, just computed once per reload (against the freshly-placed positions)
  // rather than continuously, and left sticky afterward instead of tracking a live-typed query.
  const [categoryFocusTarget, setCategoryFocusTarget] = useState<{ x: number; y: number; z: number } | null>(null);
  // recomputed only when the total node count actually changes — see computeShellRadii for why
  // every one of these grows together once real links push the field past BASE_TOTAL_NODE_COUNT
  const shellRadii = useMemo(() => computeShellRadii(entries.length), [entries.length]);

  useMemo(() => {
    let isReload = false;
    if (pendingCategoryReloadRef.current) {
      pendingCategoryReloadRef.current = false;
      isReload = true;
      // wipe every node EXCEPT ones already mid-exit-fade (a real link leaving the previous
      // category, etc.) — those should keep gracefully fading from wherever they already are, not
      // get yanked back to the origin and re-exploded outward along with everything else
      for (const t of tracked) {
        if (t.status !== 'exiting') physicsRef.current.delete(t.id);
      }
      bigBangDoneRef.current = false;
      introStartTimeRef.current = performance.now();
    }
    const ids = new Set(tracked.map((t) => t.id));
    // only the very first batch of nodes (the initial mount, or a category reload) gets the big-bang
    // expansion — anything added later (a new link saved, etc.) just appears at its final spot, per
    // the existing enter/exit fade already handling that case.
    const isInitialBatch = isReload || (!bigBangDoneRef.current && physicsRef.current.size === 0 && tracked.length > 0);
    const placedPositions = Array.from(physicsRef.current.values()).map((p) => p.pos);
    for (const t of tracked) {
      if (!physicsRef.current.has(t.id)) {
        const finalPos = t.dummy ? placeGapFillerNode(placedPositions, shellRadii) : placeNode(placedPositions, shellRadii);
        placedPositions.push(finalPos);
        physicsRef.current.set(
          t.id,
          isInitialBatch
            ? {
                pos: new THREE.Vector3(0, 0, 0),
                target: finalPos,
                bornAt: introStartTimeRef.current,
                introDelay: Math.random() * BIGBANG_STAGGER_MS,
              }
            : { pos: finalPos, target: null, bornAt: 0, introDelay: 0 },
        );
      }
    }
    if (isInitialBatch) bigBangDoneRef.current = true;
    for (const id of physicsRef.current.keys()) {
      if (!ids.has(id)) physicsRef.current.delete(id);
    }
    if (isReload) {
      const d = computeClusterFocusDirection(links, physicsRef.current);
      setCategoryFocusTarget(d ? directionToFocusEuler(d) : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked]);

  // Search focus — while a search term is narrowing the mesh, continuously keep the matching
  // node(s) centered (see computeClusterFocusDirection for the majority-pocket-or-top-of-list rule).
  // Category filtering doesn't use this — it gets its own one-shot categoryFocusTarget above instead,
  // computed once per reload rather than continuously.
  const focusTarget = useMemo(() => {
    if (!searchActive || links.length === 0) return null;
    const d = computeClusterFocusDirection(links, physicsRef.current);
    return d ? directionToFocusEuler(d) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, links, searchActive]);

  const edgeList = useMemo(() => {
    const physics = physicsRef.current;
    // gap-filler nodes are pure space-fillers — excluded here so they never appear as either
    // end of a connection, near/far mesh or chain
    const ids = tracked.filter((t) => !t.dummy).map((t) => t.id);
    const pairs: WeightedEdge[] = [];

    function shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
      return arr;
    }

    // near and far degree are capped separately, on BOTH endpoints — otherwise a node with no
    // near-cap room left could still soak up unlimited far edges just by sitting in other nodes'
    // far pools, which is what made some nodes end up with mostly-long connections.
    const nearDegree = new Map<number, number>();
    const farDegree = new Map<number, number>();
    const existing = new Set<string>();

    // edge selection uses each node's resting spot, not its live (possibly still-animating-in-from-
    // the-big-bang-origin) position — otherwise every node reads as distance 0 from every other node
    // at the instant this runs, degenerating near/far selection entirely.
    const restingPos = (p: PhysicsNode) => p.target ?? p.pos;

    for (const id of shuffle([...ids])) {
      const self = physics.get(id);
      if (!self) continue;
      const selfPos = restingPos(self);
      const nd = nearDegree.get(id) ?? 0;
      const fd = farDegree.get(id) ?? 0;
      if (nd >= NEAR_MAX && fd >= FAR_MAX) continue;

      const others = ids
        .filter((o) => o !== id)
        .map((o) => ({ id: o, dist: selfPos.distanceTo(restingPos(physics.get(o)!)) }))
        .sort((a, b) => a.dist - b.dist);
      if (others.length === 0) continue;

      // small fixed windows at each end of the distance-sorted list — near ones stay genuinely
      // close, far ones genuinely reach across, regardless of how many total nodes there are
      const nearPool = others.slice(0, NEAR_POOL_SIZE).map((o) => o.id).filter((oid) => (nearDegree.get(oid) ?? 0) < NEAR_MAX);
      // far candidates are further filtered to chords that clear the hollow core, so long
      // connections wrap around the outer shell instead of cutting straight through the middle
      const farCandidates = others.filter((o) => chordClearance(selfPos, restingPos(physics.get(o.id)!)) >= shellRadii.coreRadius);
      const farPool = farCandidates.slice(-FAR_POOL_SIZE).map((o) => o.id).filter((oid) => (farDegree.get(oid) ?? 0) < FAR_MAX);

      const nearCount = Math.min(nearPool.length, NEAR_MAX - nd, NEAR_MIN + Math.floor(Math.random() * (NEAR_MAX - NEAR_MIN + 1)));
      const farCount =
        fd < FAR_MAX && Math.random() < FAR_CHANCE
          ? Math.min(farPool.length, FAR_MAX - fd, FAR_MIN + Math.floor(Math.random() * (FAR_MAX - FAR_MIN + 1)))
          : 0;

      const chosenNear = new Set<number>();
      for (const oid of shuffle([...nearPool])) {
        if (chosenNear.size >= nearCount) break;
        if ((nearDegree.get(oid) ?? 0) >= NEAR_MAX) continue;
        chosenNear.add(oid);
      }
      const chosenFar = new Set<number>();
      for (const oid of shuffle([...farPool])) {
        if (chosenFar.size >= farCount) break;
        if (chosenNear.has(oid) || (farDegree.get(oid) ?? 0) >= FAR_MAX) continue;
        chosenFar.add(oid);
      }

      const link = (oid: number, isFar: boolean) => {
        const key = id < oid ? `${id}:${oid}` : `${oid}:${id}`;
        if (existing.has(key)) return;
        existing.add(key);
        pairs.push([id, oid, Math.floor(Math.random() * OPACITY_TIERS.length)]);
        const degMap = isFar ? farDegree : nearDegree;
        degMap.set(id, (degMap.get(id) ?? 0) + 1);
        degMap.set(oid, (degMap.get(oid) ?? 0) + 1);
      };
      for (const oid of chosenNear) link(oid, false);
      for (const oid of chosenFar) link(oid, true);
    }

    // a few short linear chains — start at a node, hop to a nearby unused one, repeat up to
    // CHAIN_MAX_HOPS times. Reads as small local star-paths distinct from the ambient near/far
    // mesh above, so it's kept separate from the degree caps (only a handful of these exist).
    const chainStarts = shuffle([...ids]).slice(0, CHAIN_COUNT);
    for (const start of chainStarts) {
      let current = start;
      const used = new Set<number>([current]);
      for (let hop = 0; hop < CHAIN_MAX_HOPS; hop++) {
        const currentPhysics = physics.get(current);
        if (!currentPhysics) break;
        const currentPos = restingPos(currentPhysics);
        const candidates = ids
          .filter((o) => !used.has(o))
          .map((o) => ({ id: o, dist: currentPos.distanceTo(restingPos(physics.get(o)!)) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, CHAIN_CANDIDATES);
        if (candidates.length === 0) break;
        const next = candidates[Math.floor(Math.random() * candidates.length)]!.id;

        const key = current < next ? `${current}:${next}` : `${next}:${current}`;
        if (!existing.has(key)) {
          existing.add(key);
          pairs.push([current, next, OPACITY_TIERS.length - 1]); // brightest tier — reads as an intentional path
        }
        used.add(next);
        current = next;
      }
    }

    return pairs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked]);

  return {
    tracked,
    physics: physicsRef.current,
    edgeList,
    shellRadii,
    focusTarget,
    categoryFocusTarget,
    introStartTime: introStartTimeRef.current, // may have been rewound by a category reload — keeps edge-reveal timing in sync with the nodes' own replayed big-bang
  };
}

/** One visibility tier's worth of lines — its own geometry and its own (dimmable) opacity. */
function TierLines({
  edges,
  physics,
  baseOpacity,
  focused,
  introStartTime,
}: {
  edges: [number, number][];
  physics: Map<number, PhysicsNode>;
  baseOpacity: number;
  focused: boolean;
  introStartTime: number;
}) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const materialRef = useRef<THREE.LineBasicMaterial>(null);
  const arrayRef = useRef<Float32Array>(new Float32Array(0));

  useEffect(() => {
    const arr = new Float32Array(edges.length * 6);
    arrayRef.current = arr;
    geometryRef.current?.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  }, [edges]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const arr = arrayRef.current;
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i]!;
      const pa = physics.get(a);
      const pb = physics.get(b);
      if (!pa || !pb) continue;
      const o = i * 6;
      arr[o] = pa.pos.x;
      arr[o + 1] = pa.pos.y;
      arr[o + 2] = pa.pos.z;
      arr[o + 3] = pb.pos.x;
      arr[o + 4] = pb.pos.y;
      arr[o + 5] = pb.pos.z;
    }
    const attr = geometryRef.current?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (attr) attr.needsUpdate = true;

    if (materialRef.current) {
      const introElapsed = performance.now() - introStartTime;
      const reveal = Math.max(0, Math.min(1, (introElapsed - BIGBANG_EDGE_START_MS) / BIGBANG_EDGE_DURATION_MS));
      const target = (focused ? baseOpacity * FOCUSED_DIM_FACTOR : baseOpacity) * reveal;
      materialRef.current.opacity += (target - materialRef.current.opacity) * Math.min(1, delta * 6);
    }
  });

  return (
    <lineSegments raycast={() => null}>
      <bufferGeometry ref={geometryRef} />
      <lineBasicMaterial ref={materialRef} color="#e8e8e8" transparent opacity={baseOpacity} depthWrite={false} />
    </lineSegments>
  );
}

/** The ambient backdrop mesh — every edge, split into visibility tiers so it doesn't read as one flat density. */
function MeshEdges({
  edgeList,
  physics,
  focused,
  introStartTime,
}: {
  edgeList: WeightedEdge[];
  physics: Map<number, PhysicsNode>;
  focused: boolean;
  introStartTime: number;
}) {
  const tiers = useMemo(() => {
    const buckets: [number, number][][] = OPACITY_TIERS.map(() => []);
    for (const [a, b, tier] of edgeList) {
      buckets[tier]?.push([a, b]);
    }
    return buckets;
  }, [edgeList]);

  return (
    <>
      {tiers.map((edges, i) => (
        <TierLines
          key={i}
          edges={edges}
          physics={physics}
          baseOpacity={OPACITY_TIERS[i]!}
          focused={focused}
          introStartTime={introStartTime}
        />
      ))}
    </>
  );
}

/** Bright, only-when-hovered lines radiating from the hovered node — everything else stays a faint backdrop mesh. */
function HighlightEdges({
  edgeList,
  physics,
  hoveredId,
}: {
  edgeList: WeightedEdge[];
  physics: Map<number, PhysicsNode>;
  hoveredId: number | null;
}) {
  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions: number[] = [];
    if (hoveredId != null) {
      for (const [a, b] of edgeList) {
        if (a !== hoveredId && b !== hoveredId) continue;
        const pa = physics.get(a);
        const pb = physics.get(b);
        if (!pa || !pb) continue;
        positions.push(pa.pos.x, pa.pos.y, pa.pos.z, pb.pos.x, pb.pos.y, pb.pos.z);
      }
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }, [edgeList, physics, hoveredId]);

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthWrite={false} />
    </lineSegments>
  );
}

interface DragState {
  target: { x: number; y: number; z: number }; // the kinematic reference angle — driven 1:1 by the cursor while dragging, by momentum/ambient drift otherwise
  velocity: { x: number; y: number; z: number }; // target's own angular velocity — drag momentum, decaying toward the ambient base speed
  display: { x: number; y: number; z: number }; // what's actually applied to the group — spring-chases target, which is what gives dragging its weighted, wobbly feel
  displayVelocity: { x: number; y: number; z: number }; // spring velocity of display catching up to target
  dragging: boolean;
  releasedAt: number; // performance.now() at the last pointer-up — drives the post-drag grace pause
  focused: boolean; // locked onto a search/category focus target — holds target still (the spring still eases display toward it) instead of resuming ambient drift
}

function RotatingGroup({
  dragRef,
  paused,
  children,
}: {
  dragRef: MutableRefObject<DragState>;
  paused: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame((_, rawDelta) => {
    if (paused) return; // hold still while a node is hovered — much easier to hover a still target
    const delta = Math.min(rawDelta, 0.1);
    const state = dragRef.current;
    if (!state.dragging) {
      const heldSinceRelease = performance.now() - state.releasedAt < DRAG_RELEASE_HOLD_MS;
      if (state.focused) {
        // locked onto a search/category focus target (see useStarSystem's focusTarget) — target
        // holds still here; the spring below still eases the displayed rotation smoothly onto it
        state.velocity.x = 0;
        state.velocity.y = 0;
        state.velocity.z = 0;
      } else if (heldSinceRelease) {
        // frozen — no rotation update at all — and bleed off any leftover fling speed so that
        // once the hold ends, motion eases back in gently instead of jerking to full speed
        state.velocity.x *= Math.max(0, 1 - delta * 8);
        state.velocity.y *= Math.max(0, 1 - delta * 8);
        state.velocity.z *= Math.max(0, 1 - delta * 8);
      } else {
        // while actively dragging, the pointer-move handler already applies the target rotation
        // directly (so it tracks the cursor 1:1) — this branch only runs the momentum/auto-spin
        // after release, and only once the post-release grace pause has elapsed. Idle motion settles
        // onto its own base speed on every axis (not just y) — a slow simultaneous tumble across
        // x/y/z reads as a body drifting in space, rather than a flat turntable spin around one axis.
        state.velocity.y += (BASE_ROTATE_SPEED - state.velocity.y) * Math.min(1, delta * 1.2);
        state.velocity.x += (BASE_ROTATE_SPEED_X - state.velocity.x) * Math.min(1, delta * 1.2);
        state.velocity.z += (BASE_ROTATE_SPEED_Z - state.velocity.z) * Math.min(1, delta * 1.2);
        state.target.y += state.velocity.y * delta;
        state.target.x += state.velocity.x * delta; // unclamped — the sphere rotates freely in every direction
        state.target.z += state.velocity.z * delta;
      }
    }
    // the displayed rotation always spring-chases the target, dragging or not — that's what turns a
    // raw 1:1 cursor-follow into a weighted, slightly wobbly drag feel, and adds a soft overshoot
    // settle on top of the release momentum above, instead of the group snapping straight to target.
    for (const axis of ['x', 'y', 'z'] as const) {
      const diff = state.target[axis] - state.display[axis];
      state.displayVelocity[axis] += diff * DRAG_SPRING_STIFFNESS * delta;
      state.displayVelocity[axis] *= Math.max(0, 1 - DRAG_SPRING_DAMPING * delta);
      state.display[axis] += state.displayVelocity[axis] * delta;
    }
    if (ref.current) {
      ref.current.rotation.y = state.display.y;
      ref.current.rotation.x = state.display.x;
      ref.current.rotation.z = state.display.z;
    }
  });

  return <group ref={ref}>{children}</group>;
}

/** Dollies the camera in/out to match the current shell scale — eases toward the target distance
 *  rather than snapping, so a link being saved/deleted (which can nudge the total node count across
 *  a scale threshold) doesn't visibly jump the framing. */
function CameraRig({ distance }: { distance: number }) {
  const { camera } = useThree();
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    camera.position.z += (distance - camera.position.z) * Math.min(1, delta * 3);
  });
  return null;
}

const HUD_VIEWPORT_MARGIN = 12; // keeps the popup a little clear of the very edge, not flush against it

/** Wraps the HUD popup with its default down-right offset, then — measured once against this node's
 *  actual on-screen position right as it mounts — nudges it back on-screen if that offset would clip
 *  it against a viewport edge. The rotation is paused while a node is hovered (see RotatingGroup's
 *  `paused` prop), so the node's projected position can't drift after this and invalidate the measurement. */
function ClampedHudAnchor({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 18, y: 26 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (rect.right > window.innerWidth - HUD_VIEWPORT_MARGIN) {
      dx -= rect.right - (window.innerWidth - HUD_VIEWPORT_MARGIN);
    }
    if (rect.left + dx < HUD_VIEWPORT_MARGIN) {
      dx += HUD_VIEWPORT_MARGIN - (rect.left + dx);
    }
    if (rect.bottom > window.innerHeight - HUD_VIEWPORT_MARGIN) {
      dy -= rect.bottom - (window.innerHeight - HUD_VIEWPORT_MARGIN);
    }
    if (rect.top + dy < HUD_VIEWPORT_MARGIN) {
      dy += HUD_VIEWPORT_MARGIN - (rect.top + dy);
    }
    if (dx !== 0 || dy !== 0) setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    // deliberately once-only — see the comment above on why the position can't drift mid-hover
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className="node-hud-anchor" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
      {children}
    </div>
  );
}

/** The sci-fi "lock-on" readout that pops up next to a focused node — corner brackets + a scan
 *  sweep on mount (pure CSS, keyed to remount on every hover so the open animation replays). */
function NodeDetailPanel({ link }: { link: Link }) {
  const savedDate = useMemo(
    () => new Date(link.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    [link.createdAt],
  );
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="node-hud">
      <span className="node-hud__corner node-hud__corner--tl" />
      <span className="node-hud__corner node-hud__corner--tr" />
      <span className="node-hud__corner node-hud__corner--bl" />
      <span className="node-hud__corner node-hud__corner--br" />
      <div className="node-hud__scan" />
      {link.imageUrl && !imageFailed && (
        <div className="node-hud__row node-hud__preview">
          <img src={link.imageUrl} alt="" onError={() => setImageFailed(true)} />
        </div>
      )}
      <div className="node-hud__row node-hud__meta">
        <span>{link.category || 'UNCATEGORIZED'}</span>
        <span>{savedDate}</span>
      </div>
      <div className="node-hud__row node-hud__title">{link.title || link.url}</div>
      <div className="node-hud__row node-hud__url">{link.origin || link.url}</div>
    </div>
  );
}

function NodeMesh({
  node,
  physics,
  hovered,
  dimmed,
  onHover,
  nodeSizeReferenceDistance,
}: {
  node: TrackedNode;
  physics: PhysicsNode;
  hovered: boolean;
  dimmed: boolean;
  onHover: (hovering: boolean) => void;
  nodeSizeReferenceDistance: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const scaleRef = useRef(0);
  const dimRef = useRef(1);
  const ringRef = useRef(0);
  const worldPosRef = useRef(new THREE.Vector3());
  // a small, per-node-stable random offset so permanently-shown labels don't all sit in the exact
  // same spot relative to their dot — computed once per node, not re-rolled on every render
  const labelOffset = useMemo(() => ({ x: (Math.random() * 2 - 1) * 10, y: -8 - Math.random() * 10 }), []);
  // gap-filler nodes are ambient "stars," not data — giving every one the exact same size and
  // brightness as a real mesh node is what made the halo read as flat/mechanical instead of like
  // space. A per-node random magnitude (most small and dim, a few standing out bright) is what
  // actually sells the depth/twinkle-of-varying-stars look; real/connected nodes stay uniform since
  // they represent equal-weight data, not decoration.
  // squared so most magnitudes land low — a real night sky is dominated by faint, tiny stars with
  // only the occasional one standing out, not an even spread between small and large
  const starMagnitude = useMemo(() => (node.dummy ? Math.random() ** 2.5 : 1), [node.dummy]);
  const dotScale = node.dummy ? 0.2 + starMagnitude * 0.9 : 1;
  const maxOpacity = node.dummy ? 0.18 + starMagnitude * 0.82 : 1;
  // each gap-filler twinkles on its own random speed and phase, never in sync with any other —
  // a shared/synced pulse is what read as a broken "blinking" bug earlier; independent per-node
  // timing is what makes it read as a field of stars glimmering instead
  const twinkle = useMemo(
    () => (node.dummy ? { speed: 0.4 + Math.random() * 1.1, phase: Math.random() * Math.PI * 2 } : null),
    [node.dummy],
  );

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);

    if (physics.target) {
      // still expanding out from the big-bang origin — deterministic on elapsed time (not
      // incremental), so a dropped frame never leaves it short of or past its final spot
      const elapsed = performance.now() - physics.bornAt - physics.introDelay;
      if (elapsed <= 0) {
        physics.pos.set(0, 0, 0);
      } else {
        const t = Math.min(1, elapsed / BIGBANG_NODE_DURATION_MS);
        const eased = easeOutJelly(t);
        physics.pos.set(physics.target.x * eased, physics.target.y * eased, physics.target.z * eased);
        if (t >= 1) physics.target = null; // arrived — stop recomputing this every frame
      }
    }
    if (groupRef.current) {
      groupRef.current.position.copy(physics.pos);
      // perspective makes anything closer to the camera look bigger — counter-scale it back down
      // so a node never renders larger than its default size, only smaller when it's further away
      groupRef.current.getWorldPosition(worldPosRef.current);
      const camDist = state.camera.position.distanceTo(worldPosRef.current);
      groupRef.current.scale.setScalar(Math.min(1, camDist / nodeSizeReferenceDistance));
    }

    const target = node.status === 'exiting' ? 0 : 1; // every node stays the same size, hover only changes color
    scaleRef.current += (target - scaleRef.current) * Math.min(1, delta * 9);
    meshRef.current?.scale.setScalar(scaleRef.current);

    const dimTarget = dimmed ? 0.2 : 1;
    dimRef.current += (dimTarget - dimRef.current) * Math.min(1, delta * 6);
    const twinkleFactor = twinkle
      ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * twinkle.speed + twinkle.phase))
      : 1;
    if (materialRef.current) {
      materialRef.current.opacity = Math.min(1, scaleRef.current) * dimRef.current * maxOpacity * twinkleFactor;
    }

    const ringTarget = hovered ? 1 : 0;
    ringRef.current += (ringTarget - ringRef.current) * Math.min(1, delta * 10);
    if (ringMaterialRef.current) ringMaterialRef.current.opacity = ringRef.current * 0.9;
  });

  return (
    <group ref={groupRef}>
      <Billboard>
        {/* only nodes tied to a real record are hoverable/clickable — decorative filler nodes have
            nothing to focus on or select, so they get no hit-test mesh at all */}
        {node.link && (
          <mesh
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(true);
            }}
            onPointerOut={() => onHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              window.open(node.link!.url, '_blank', 'noopener,noreferrer');
            }}
          >
            <circleGeometry args={[HOVER_HIT_RADIUS, 24]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
        <mesh ref={meshRef} scale={0} raycast={() => null}>
          <circleGeometry args={[0.012 * dotScale, 24]} />
          <meshBasicMaterial ref={materialRef} color={hovered ? '#ffffff' : '#cfcfcf'} transparent opacity={0} />
        </mesh>
        {/* gap-filler nodes can never be hovered, so this ring would only ever sit at 0 opacity — skip it entirely */}
        {!node.dummy && (
          <mesh raycast={() => null}>
            <ringGeometry args={[0.024, 0.03, 24]} />
            <meshBasicMaterial ref={ringMaterialRef} color="#ffffff" transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
      </Billboard>
      {node.link && node.status !== 'exiting' && (
        <Html distanceFactor={8} zIndexRange={[20, 0]} center>
          {/* outer div carries the random per-node offset via left/top (relative positioning);
              the inner .explore-label keeps its own centering + fade-in transform untouched */}
          <div style={{ position: 'relative', left: labelOffset.x, top: labelOffset.y }}>
            <div
              className={hovered ? 'explore-label explore-label--active' : 'explore-label'}
              onMouseEnter={() => onHover(true)}
              onMouseLeave={() => onHover(false)}
              onClick={(e) => {
                e.stopPropagation();
                window.open(node.link!.url, '_blank', 'noopener,noreferrer');
              }}
            >
              {shortName(node.link)}
            </div>
          </div>
        </Html>
      )}
      {hovered && node.link && node.status !== 'exiting' && (
        <Html distanceFactor={8} zIndexRange={[30, 0]} center>
          <ClampedHudAnchor>
            <NodeDetailPanel link={node.link} />
          </ClampedHudAnchor>
        </Html>
      )}
    </group>
  );
}

export function ViewModeExplore({
  links,
  searchActive = false,
  searchKey = '',
  categoryKey = null,
}: {
  links: Link[];
  searchActive?: boolean;
  searchKey?: string;
  categoryKey?: string | null;
}) {
  const mountTimeRef = useRef(performance.now()); // set once, first mount only — the initial big-bang clock
  const { tracked, physics, edgeList, shellRadii, focusTarget, categoryFocusTarget, introStartTime } = useStarSystem(
    links,
    mountTimeRef.current,
    searchActive,
    searchKey,
    categoryKey,
  );
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const connectedIds = useMemo(() => {
    if (hoveredId == null) return null;
    const set = new Set<number>();
    for (const [a, b] of edgeList) {
      if (a === hoveredId) set.add(b);
      else if (b === hoveredId) set.add(a);
    }
    return set;
  }, [edgeList, hoveredId]);
  const dragRef = useRef<DragState>({
    target: { x: 0, y: 0, z: 0 },
    velocity: { x: BASE_ROTATE_SPEED_X, y: BASE_ROTATE_SPEED, z: BASE_ROTATE_SPEED_Z },
    display: { x: 0, y: 0, z: 0 },
    displayVelocity: { x: 0, y: 0, z: 0 },
    dragging: false,
    releasedAt: -Infinity,
    focused: false,
  });
  const lastPointer = useRef({ x: 0, y: 0 });
  const lastMoveTime = useRef(0);

  // apply a fresh focus target the instant it changes (a new/narrower search or category match) —
  // snaps the kinematic target there and zeroes velocity so nothing fights the spring's smooth
  // ease into place; clearing the filter (focusTarget goes null) just lets ambient tumble resume
  // from wherever the sphere ended up, rather than snapping back to anything.
  // search's focusTarget takes priority when both happen to be set (e.g. typing a search within an
  // already-selected category) — it's the more immediate, keystroke-driven signal of the two.
  useEffect(() => {
    const state = dragRef.current;
    const target = focusTarget ?? categoryFocusTarget;
    if (!target) {
      state.focused = false;
      return;
    }
    state.target.x = target.x;
    state.target.y = target.y;
    state.target.z = target.z;
    state.velocity.x = 0;
    state.velocity.y = 0;
    state.velocity.z = 0;
    state.focused = true;
  }, [focusTarget, categoryFocusTarget]);

  function handlePointerDown(e: React.PointerEvent) {
    dragRef.current.dragging = true;
    dragRef.current.focused = false; // manual control wins — release any search/category focus lock
    lastPointer.current = { x: e.clientX, y: e.clientY };
    lastMoveTime.current = performance.now();
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    const now = performance.now();
    const dt = Math.max(0.001, (now - lastMoveTime.current) / 1000);
    lastPointer.current = { x: e.clientX, y: e.clientY };
    lastMoveTime.current = now;

    // matches the camera's actual field of view against the canvas's real on-screen pixel size,
    // so the rotation angle per pixel dragged is mathematically correct — not a hand-tuned guess
    // that drifts out of sync with the cursor the moment the canvas is a different size than it
    // was tuned against. A full-height drag sweeps exactly the camera's vertical FOV.
    const rect = e.currentTarget.getBoundingClientRect();
    const radPerPixel = (CAMERA_FOV_DEG * (Math.PI / 180)) / rect.height;
    const rotY = dx * radPerPixel; // sign matches the drag direction — dragging right turns the near face right, like spinning a globe under your hand
    const rotX = dy * radPerPixel;
    dragRef.current.target.y += rotY;
    dragRef.current.target.x += rotX;
    // and remember it as an angular velocity so releasing mid-swipe keeps that momentum going
    dragRef.current.velocity.y = Math.max(-MAX_FLING_SPEED, Math.min(MAX_FLING_SPEED, rotY / dt));
    dragRef.current.velocity.x = Math.max(-MAX_FLING_SPEED, Math.min(MAX_FLING_SPEED, rotX / dt));
  }
  function handlePointerUp() {
    dragRef.current.dragging = false;
    dragRef.current.releasedAt = performance.now();
  }

  if (links.length === 0) {
    return <div className="empty-state">No links saved yet</div>;
  }

  return (
    <div
      className="explore-view"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <Canvas camera={{ position: [0, 0, BASE_CAMERA_DISTANCE], fov: CAMERA_FOV_DEG }}>
        {/* depth cue — fades anything far from the camera toward the background color instead of a flat, shadeless field */}
        <fog attach="fog" args={['#040404', shellRadii.fogNear, shellRadii.fogFar]} />
        <CameraRig distance={shellRadii.cameraDistance} />
        <RotatingGroup dragRef={dragRef} paused={hoveredId != null}>
          <MeshEdges
            edgeList={edgeList}
            physics={physics}
            focused={hoveredId != null}
            introStartTime={introStartTime}
          />
          <HighlightEdges edgeList={edgeList} physics={physics} hoveredId={hoveredId} />
          {tracked.map((node) => {
            const p = physics.get(node.id);
            if (!p) return null;
            const isHovered = hoveredId === node.id;
            const dimmed = hoveredId != null && !isHovered && !connectedIds?.has(node.id);
            return (
              <NodeMesh
                key={node.id}
                node={node}
                physics={p}
                hovered={isHovered}
                dimmed={dimmed}
                onHover={(hovering) =>
                  setHoveredId((cur) => (hovering ? node.id : cur === node.id ? null : cur))
                }
                nodeSizeReferenceDistance={shellRadii.nodeSizeReferenceDistance}
              />
            );
          })}
        </RotatingGroup>
      </Canvas>
    </div>
  );
}
