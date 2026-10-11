"use strict";

// OSM restrictions apply to transitions, not to a road in isolation.
// https://wiki.openstreetmap.org/wiki/Relation:restriction
const MODE_TAGS = {
  walking: ["foot"],
  cycling: ["bicycle", "vehicle"],
  driving: ["motorcar", "motor_vehicle", "vehicle"],
};
const PUBLIC_ACCESS = new Set([
  "yes",
  "designated",
  "permissive",
  "public",
  "discouraged",
]);

function permitsNode(tags = {}, mode) {
  const keys = [...(MODE_TAGS[mode] || []), "access"];
  const explicit = keys.find(
    (key) => typeof tags[key] === "string" && tags[key].trim(),
  );
  if (explicit) return PUBLIC_ACCESS.has(tags[explicit].trim().toLowerCase());
  const barrier = String(tags.barrier || "").toLowerCase();
  if (
    !barrier ||
    [
      "no",
      "entrance",
      "gate",
      "lift_gate",
      "swing_gate",
      "toll_booth",
      "cattle_grid",
      "kerb",
    ].includes(barrier)
  )
    return true;
  if (
    [
      "wall",
      "fence",
      "hedge",
      "retaining_wall",
      "city_wall",
      "ditch",
      "yes",
    ].includes(barrier)
  )
    return false;
  if (
    ["bollard", "block", "jersey_barrier", "bus_trap", "sump_buster"].includes(
      barrier,
    )
  )
    return mode !== "driving";
  if (["cycle_barrier", "stile", "kissing_gate", "turnstile"].includes(barrier))
    return mode === "walking";
  // An unrecognized barrier is not evidence of a drivable crossing.
  return mode === "walking";
}

function restrictionValue(tags, mode) {
  const aliases = MODE_TAGS[mode] || [];
  const except = String(tags.except || "")
    .split(";")
    .map((value) => value.trim());
  if (aliases.some((alias) => except.includes(alias))) return null;
  const legacyMode = String(tags.type || "").split(":")[1];
  if (legacyMode && !aliases.includes(legacyMode)) return null;
  const keys = aliases.map((alias) => `restriction:${alias}`);
  if (mode !== "walking" || legacyMode === "foot") keys.push("restriction");
  const key = keys.find((candidate) => tags[candidate]);
  const value = key ? String(tags[key]) : "";
  // Conditional-only restrictions cannot be evaluated without their schedule.
  // Preserve a conservative restriction instead of silently treating it as open.
  const conditionalKey = keys.find(
    (candidate) => tags[`${candidate}:conditional`],
  );
  const conditional = conditionalKey
    ? String(tags[`${conditionalKey}:conditional`]).split("@")[0].trim()
    : "";
  return /^(no_|only_)/.test(value)
    ? value
    : /^(no_|only_)/.test(conditional)
      ? conditional
      : null;
}

function parseTurnRestrictions(elements, ways) {
  return elements
    .filter(
      (item) =>
        item.type === "relation" &&
        /^restriction(?::|$)/.test(item.tags?.type || ""),
    )
    .flatMap((relation) => {
      const members = Array.isArray(relation.members) ? relation.members : [];
      const from = members
        .filter((member) => member.role === "from" && member.type === "way")
        .map((member) => String(member.ref));
      const to = members
        .filter((member) => member.role === "to" && member.type === "way")
        .map((member) => String(member.ref));
      const via = members.filter((member) => member.role === "via");
      if (!from.length || !to.length || !via.length) return [];
      if (via.length === 1 && via[0].type === "node")
        return [
          {
            id: relation.id,
            tags: relation.tags,
            from,
            to,
            node: String(via[0].ref),
            via: [],
          },
        ];
      if (!via.every((member) => member.type === "way") || via.length > 16)
        return [];
      const viaWays = via.map((member) => String(member.ref));
      const first = ways.get(Number(viaWays[0]))?.nodes || [];
      const entries = [
        ...new Set(
          from
            .flatMap((id) =>
              (ways.get(Number(id))?.nodes || []).filter((node) =>
                first.includes(node),
              ),
            )
            .map(String),
        ),
      ];
      return entries.length
        ? [
            {
              id: relation.id,
              tags: relation.tags,
              from,
              to,
              node: null,
              via: viaWays,
              entries,
            },
          ]
        : [];
    });
}

function isUTurn(previous, next) {
  const before = previous.coordinates,
    after = next.coordinates;
  const a = before[before.length - 2],
    b = before[before.length - 1],
    c = after[1];
  const x1 = b[0] - a[0],
    y1 = b[1] - a[1],
    x2 = c[0] - b[0],
    y2 = c[1] - b[1];
  const scale = Math.hypot(x1, y1) * Math.hypot(x2, y2);
  return scale > 0 && (x1 * x2 + y1 * y2) / scale < -0.5;
}

function turnController(restrictions = [], mode) {
  const rules = restrictions
    .map((rule) => ({ ...rule, value: restrictionValue(rule.tags, mode) }))
    .filter((rule) => rule.value);
  const byFrom = new Map();
  for (const rule of rules)
    for (const from of rule.from) {
      if (!byFrom.has(from)) byFrom.set(from, []);
      byFrom.get(from).push(rule);
    }
  return {
    enabled: rules.length > 0,
    next(active, previous, node, edge) {
      if (!previous || edge.length < 0.01) return active;
      const from = String(previous.segment.osmId ?? previous.segment.id),
        to = String(edge.segment.osmId ?? edge.segment.id);
      const ongoing = [];
      for (const item of active) {
        const rule = rules[item.rule],
          currentVia = rule.via[item.index];
        if (to === currentVia && !isUTurn(previous, edge)) {
          ongoing.push(item);
          continue;
        }
        const expected =
          item.index + 1 < rule.via.length
            ? [rule.via[item.index + 1]]
            : rule.to;
        if (!expected.includes(to)) {
          if (rule.value.startsWith("only_")) return null;
          continue;
        }
        if (item.index + 1 === rule.via.length) {
          if (rule.value.startsWith("no_")) return null;
        } else ongoing.push({ rule: item.rule, index: item.index + 1 });
      }
      for (const rule of byFrom.get(from) || []) {
        if (rule.node !== null) {
          if (rule.node !== node) continue;
          let matches = rule.to.includes(to);
          if (rule.from.includes(to))
            matches &&= /u_turn$/.test(rule.value)
              ? isUTurn(previous, edge)
              : !isUTurn(previous, edge);
          if (rule.value.startsWith("no_") ? matches : !matches) return null;
        } else if (rule.entries.includes(node)) {
          if (to === rule.via[0])
            ongoing.push({ rule: rules.indexOf(rule), index: 0 });
          else if (rule.value.startsWith("only_")) return null;
        }
      }
      return [
        ...new Map(
          ongoing.map((item) => [`${item.rule}:${item.index}`, item]),
        ).values(),
      ].sort((a, b) => a.rule - b.rule || a.index - b.index);
    },
  };
}

module.exports = {
  permitsNode,
  parseTurnRestrictions,
  restrictionValue,
  turnController,
};
