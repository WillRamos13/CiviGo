"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { allows } = require("../src/lib/roads");
const road = (tags = {}) => ({ tags: { highway: "residential", ...tags } });

test("public road access follows the most-specific OSM transport tag", () => {
  assert.equal(allows(road({ vehicle: "no" }), "driving"), false);
  assert.equal(allows(road({ vehicle: "private" }), "cycling"), false);
  assert.equal(allows(road({ motorcar: "private" }), "driving"), false);
  assert.equal(allows(road({ foot: "private" }), "walking"), false);
  assert.equal(allows(road({ bicycle: "private" }), "cycling"), false);
  assert.equal(allows(road({ access: "no", foot: "yes" }), "walking"), true);
  assert.equal(
    allows(
      road({ access: "private", vehicle: "no", bicycle: "designated" }),
      "cycling",
    ),
    true,
  );
  assert.equal(
    allows(road({ vehicle: "no", motor_vehicle: "yes" }), "driving"),
    true,
  );
  assert.equal(
    allows(road({ motor_vehicle: "no", motorcar: "permissive" }), "driving"),
    true,
  );
  assert.equal(
    allows(road({ access: "yes", motor_vehicle: "no" }), "driving"),
    false,
  );
  assert.equal(
    allows(road({ motorcar: "yes", bicycle: "no" }), "cycling"),
    false,
  );
  assert.equal(
    allows(road({ vehicle: "no", motorcar: "yes" }), "walking"),
    true,
  );
});

test("restricted purpose or permit does not authorize general through traffic", () => {
  for (const restriction of [
    "no",
    "private",
    "destination",
    "customers",
    "delivery",
    "agricultural",
    "forestry",
    "military",
    "permit",
    "unknown",
    "use_sidepath",
    "dismount",
  ]) {
    assert.equal(
      allows(road({ bicycle: restriction }), "cycling"),
      false,
      restriction,
    );
    assert.equal(
      allows(road({ motorcar: restriction }), "driving"),
      false,
      restriction,
    );
  }
  assert.equal(
    allows(road({ access: "forestry", foot: "permissive" }), "walking"),
    true,
  );
  assert.equal(
    allows(road({ bicycle: " YES ", vehicle: "no" }), "cycling"),
    true,
  );
});

test("highway defaults remain physical constraints unless a mode has explicit access", () => {
  assert.equal(
    allows(road({ highway: "motorway", access: "yes" }), "walking"),
    false,
  );
  assert.equal(
    allows(road({ highway: "motorway", foot: "yes" }), "walking"),
    true,
  );
  assert.equal(
    allows(road({ highway: "motorway", bicycle: "yes" }), "cycling"),
    true,
  );
  assert.equal(
    allows(road({ highway: "footway", access: "yes" }), "driving"),
    false,
  );
  assert.equal(
    allows(road({ highway: "pedestrian", motorcar: "yes" }), "driving"),
    true,
  );
  assert.equal(
    allows(road({ highway: "steps", bicycle: "yes" }), "cycling"),
    false,
  );
  assert.equal(
    allows(road({ highway: "steps", motor_vehicle: "yes" }), "driving"),
    false,
  );
  assert.equal(
    allows(road({ highway: "steps", foot: "yes" }), "walking"),
    true,
  );
  assert.equal(
    allows(road({ highway: "construction", foot: "yes" }), "walking"),
    false,
  );
  assert.equal(allows(road(), "flying"), false);
});
