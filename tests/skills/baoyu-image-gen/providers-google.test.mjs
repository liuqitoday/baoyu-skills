import assert from "node:assert/strict";
import test from "node:test";

import {
  addAspectRatioToPrompt,
  buildGoogleUrl,
  buildPromptWithAspect,
  extractInlineImageData,
  extractPredictedImageData,
  getGoogleImageSize,
  isGoogleImagen,
  isGoogleMultimodal,
  normalizeGoogleModelId,
} from "../../../skills/baoyu-image-gen/scripts/providers/google.ts";

function useEnv(t, values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  t.after(() => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("Google provider helpers normalize model IDs and select image size defaults", () => {
  assert.equal(
    normalizeGoogleModelId("models/gemini-3.1-flash-image-preview"),
    "gemini-3.1-flash-image-preview",
  );
  assert.equal(isGoogleMultimodal("models/gemini-3-pro-image-preview"), true);
  assert.equal(isGoogleImagen("imagen-3.0-generate-002"), true);
  assert.equal(
    getGoogleImageSize({ imageSize: null, quality: "2k" }),
    "2K",
  );
  assert.equal(
    getGoogleImageSize({ imageSize: "4K", quality: "normal" }),
    "4K",
  );
});

test("Google URL builder appends v1beta when the base URL does not already include it", (t) => {
  useEnv(t, { GOOGLE_BASE_URL: "https://generativelanguage.googleapis.com" });
  assert.equal(
    buildGoogleUrl("models/demo:generateContent"),
    "https://generativelanguage.googleapis.com/v1beta/models/demo:generateContent",
  );
});

test("Google URL and prompt helpers preserve existing v1beta paths and aspect hints", (t) => {
  useEnv(t, { GOOGLE_BASE_URL: "https://example.com/custom/v1beta/" });
  assert.equal(
    buildGoogleUrl("/models/demo:predict"),
    "https://example.com/custom/v1beta/models/demo:predict",
  );

  assert.equal(
    addAspectRatioToPrompt("A city skyline", "16:9"),
    "A city skyline Aspect ratio: 16:9.",
  );
  assert.equal(
    buildPromptWithAspect("A city skyline", "16:9", "2k"),
    "A city skyline Aspect ratio: 16:9. High resolution 2048px.",
  );
});

test("Google response extractors find inline and predicted image payloads", () => {
  assert.equal(
    extractInlineImageData({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "inline-base64" } }],
          },
        },
      ],
    }),
    "inline-base64",
  );

  assert.equal(
    extractPredictedImageData({
      predictions: [{ image: { imageBytes: "predicted-base64" } }],
    }),
    "predicted-base64",
  );

  assert.equal(
    extractPredictedImageData({
      generatedImages: [{ bytesBase64Encoded: "generated-base64" }],
    }),
    "generated-base64",
  );
});
