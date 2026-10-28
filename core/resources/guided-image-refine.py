"""Refine vision proposals with OpenCV GrabCut and contour approximation.

The vision model supplies semantic ownership; OpenCV supplies the visible edge.
This pilot assumes separated objects on a quiet background. Crowded/overlapping
illustrations need a stronger segmentation provider and visual review.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def refine(image_path, segmentation):
    original = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
    if original is None:
        raise ValueError("Cannot read original image")
    # Match the lesson's light canvas. Discarding alpha turns transparent pixels
    # into arbitrary hidden RGB and makes dark silhouettes disappear in GrabCut.
    if original.ndim == 3 and original.shape[2] == 4:
        alpha = original[:, :, 3:4].astype(np.float32) / 255
        original = np.rint(original[:, :, :3] * alpha + 255 * (1 - alpha)).astype(np.uint8)
    elif original.ndim == 2:
        original = cv2.cvtColor(original, cv2.COLOR_GRAY2BGR)
    h0, w0 = original.shape[:2]
    scale = min(1.0, 1200 / max(w0, h0))
    image = cv2.resize(original, (round(w0 * scale), round(h0 * scale)))
    height, width = image.shape[:2]
    cv2.setNumThreads(1)
    cv2.setRNGSeed(0)
    for region in segmentation["regions"]:
        outlines = []
        for polygon in region["polygons"]:
            points = np.array([[round(p["x"] * (width - 1)), round(p["y"] * (height - 1))]
                               for p in polygon["outer"]], dtype=np.int32)
            proposal = np.zeros((height, width), dtype=np.uint8)
            cv2.fillPoly(proposal, [points], 255)
            x, y, w, h = cv2.boundingRect(points)
            # Small detached symbols need a local search margin; a canvas-wide
            # margin can pull a neighbouring large object into their rectangle.
            pad = min(round(min(width, height) * 0.035), max(2, round(max(w, h) * 0.15)))
            if len(polygon["outer"]) > 8:
                pad = max(pad, round(max(w, h) * 0.10))
            x1, y1 = max(1, x - pad), max(1, y - pad)
            x2, y2 = min(width - 1, x + w + pad), min(height - 1, y + h + pad)
            def overlap(contour):
                candidate = np.zeros_like(proposal)
                cv2.drawContours(candidate, [contour], -1, 255, cv2.FILLED)
                return cv2.countNonZero(cv2.bitwise_and(candidate, proposal))
            minimum_overlap = max(20, cv2.countNonZero(proposal) * 0.003)
            def owned_contours(contours):
                return [c for c in contours if cv2.contourArea(c) >= minimum_overlap
                        and overlap(c) >= minimum_overlap]
            for attempt in range(4):
                mask = np.zeros((height, width), dtype=np.uint8)
                cv2.grabCut(image, mask, (x1, y1, x2 - x1, y2 - y1),
                            np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_RECT)
                foreground = cv2.inRange(mask, cv2.GC_PR_FGD, cv2.GC_PR_FGD)
                contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                if not contours or len(polygon["outer"]) <= 8:
                    break
                selected = owned_contours(contours)
                if not selected:
                    break
                cx, cy, cw, ch = cv2.boundingRect(np.concatenate(selected))
                # A coarse proposal can cut through the intended object. When
                # GrabCut's result reaches the search edge, expand that side and
                # let GrabCut find the actual edge instead of clipping the body.
                margin = max(pad, round(max(w, h) * 0.25))
                expanded = (max(1, x1 - margin) if cx <= x1 + 2 else x1,
                            max(1, y1 - margin) if cy <= y1 + 2 else y1,
                            min(width - 1, x2 + margin) if cx + cw >= x2 - 2 else x2,
                            min(height - 1, y2 + margin) if cy + ch >= y2 - 2 else y2)
                if expanded == (x1, y1, x2, y2):
                    break
                x1, y1, x2, y2 = expanded
            if not contours:
                if len(polygon["outer"]) <= 8:
                    outlines.append(polygon)
                    continue
                raise ValueError(f"No foreground found for {region['id']}; review the proposal")
            selected = owned_contours(contours)
            if not selected:
                # A semantic subregion (a shoulder, swatch, inset or symbol)
                # may have no independent foreground boundary. Preserve the
                # model's simple observed envelope instead of rejecting it.
                if len(polygon["outer"]) <= 8:
                    outlines.append(polygon)
                    continue
                raise ValueError(f"Insufficient foreground for {region['id']}")
            # Keep the object's interior (white clothing, screen content, etc.).
            # Only intent/model-declared semantic holes remain holes.
            # Simple enclosing proposals (screens, swatches, gauges) retain their
            # envelope; internal subject/background contrast must not cut a frame.
            if len(polygon["outer"]) <= 8:
                selected = [cv2.convexHull(max(selected, key=overlap))]
            for contour in selected:
                epsilon = max(0.1, 0.0007 * cv2.arcLength(contour, True))
                simplified = cv2.approxPolyDP(contour, epsilon, True)
                # Preserve every separated object in a semantic group; a group
                # of three characters must not collapse to its largest contour.
                while len(simplified) > 256:
                    epsilon *= 1.5
                    simplified = cv2.approxPolyDP(contour, epsilon, True)
                if len(simplified) < 3:
                    raise ValueError(f"Degenerate foreground for {region['id']}")
                holes = [hole for hole in polygon["holes"] if cv2.pointPolygonTest(
                    contour, (hole[0]["x"] * (width - 1), hole[0]["y"] * (height - 1)), False) >= 0]
                outlines.append({"outer": [{"x": round(float(p[0]) / (width - 1), 6),
                                             "y": round(float(p[1]) / (height - 1), 6)}
                                            for p in simplified[:, 0]], "holes": holes})
        region["polygons"] = outlines
    return segmentation


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--regions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(refine(args.image, json.loads(args.regions.read_text())),
                                      ensure_ascii=False, indent=2) + "\n")
