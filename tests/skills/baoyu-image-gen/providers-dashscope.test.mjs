import assert from "node:assert/strict";
import test from "node:test";

import {
  getSizeFromAspectRatio,
  normalizeSize,
  parseAspectRatio,
} from "../../../skills/baoyu-image-gen/scripts/providers/dashscope.ts";

test("DashScope aspect-ratio parsing accepts numeric ratios only", () => {
  assert.deepEqual(parseAspectRatio("3:2"), { width: 3, height: 2 });
  assert.equal(parseAspectRatio("square"), null);
  assert.equal(parseAspectRatio("-1:2"), null);
});

test("DashScope size selection picks the closest supported size per quality preset", () => {
  assert.equal(getSizeFromAspectRatio(null, "normal"), "1024*1024");
  assert.equal(getSizeFromAspectRatio("16:9", "normal"), "1280*720");
  assert.equal(getSizeFromAspectRatio("16:9", "2k"), "2048*1152");
  assert.equal(getSizeFromAspectRatio("invalid", "2k"), "1536*1536");
});

test("DashScope size normalization converts WxH into provider format", () => {
  assert.equal(normalizeSize("1024x1024"), "1024*1024");
  assert.equal(normalizeSize("2048*1152"), "2048*1152");
});
