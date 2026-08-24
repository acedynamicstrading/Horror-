// ---------------------------------------------------------------------------
// Real furniture recognition (chair, couch, bed, table, etc.) via MediaPipe's
// Object Detector, running entirely in-browser. Replaces guessing "furniture"
// by height band with actually detecting furniture-shaped objects.
//
// IMPORTANT — does NOT open a second camera stream. 8th Wall already owns
// the camera; this pulls frames from 8th Wall's own pipeline via
// XR8.CameraPixelArray.pipelineModule(), which is 8th Wall's documented,
// supported pattern for feeding external computer-vision libraries (their
// own example is literally a QR scanner built this exact way). Two
// concurrent getUserMedia() streams on one camera is unreliable on mobile —
// this sidesteps that entirely.
//
// THROTTLING: detection is deliberately NOT run every frame — it's a real
// inference cost stacked on top of SLAM + rendering. Call requestDetection()
// as often as you like (e.g. every onProcessCpu tick); internally it only
// actually runs inference at DETECT_INTERVAL_MS, silently no-oping between
// calls. Per the design decision: this should mainly run during the
// SCANNING game state (furniture doesn't move once found), not continuously
// through ACTIVE gameplay.
//
// TWO THINGS FLAGGED AS UNVERIFIED (same spirit as the hitTest rotation
// field earlier in this project — check on-device, don't assume):
//   1. XR8.CameraPixelArray's exact byte layout with luminance:false. Docs
//      confirm it provides "grayscale or color uint8 array" and exposes
//      {pixels, rows, cols, rowBytes}, but not the exact channel order/count
//      for the color case. This assumes RGBA (4 bytes/pixel) since that's
//      what ImageData expects with zero conversion; if the on-device image
//      looks corrupted/striped, it's likely actually RGB (3 bytes/pixel) and
//      the conversion loop below needs adjusting.
//   2. Mapping a detected box's center back to hitTest() coordinates assumes
//      the CameraPixelArray frame covers the same field of view as the
//      visible camera feed, so a normalized center in the captured frame is
//      also a valid normalized hitTest coordinate. If detected points
//      consistently land offset from the real object, this mapping needs a
//      calibration pass.
// ---------------------------------------------------------------------------

import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision'

const DETECT_INTERVAL_MS = 600
const MIN_CONFIDENCE = 0.5

// COCO classes we actually care about for "furniture" spawn anchoring.
const FURNITURE_CLASSES = new Set(['chair', 'couch', 'bed', 'dining table', 'tv', 'potted plant'])

let detector = null
let loadingPromise = null
let lastDetectAt = 0
let offscreenCanvas = null
let offscreenCtx = null

export const loadFurnitureDetector = () => {
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
    )
    detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
        delegate: 'GPU',
      },
      scoreThreshold: MIN_CONFIDENCE,
      runningMode: 'IMAGE', // we feed it individual frames on our own throttle, not a live video element
    })
    return detector
  })()

  return loadingPromise
}

// pixelData: {pixels, rows, cols} from processCpuResult.camerapixelarray
// (see the byte-layout caveat above). Returns an array of
// {label, confidence, normalizedCenter: {x, y}} or [] if throttled/not ready.
export const requestFurnitureDetection = (pixelData) => {
  if (!detector || !pixelData) return []

  const now = performance.now()
  if (now - lastDetectAt < DETECT_INTERVAL_MS) return []
  lastDetectAt = now

  const { pixels, rows, cols } = pixelData
  if (!pixels || !rows || !cols) return []

  if (!offscreenCanvas || offscreenCanvas.width !== cols || offscreenCanvas.height !== rows) {
    offscreenCanvas = document.createElement('canvas')
    offscreenCanvas.width = cols
    offscreenCanvas.height = rows
    offscreenCtx = offscreenCanvas.getContext('2d')
  }

  // Assumes RGBA (4 bytes/pixel) — see caveat #1 above.
  const expectedBytes = rows * cols * 4
  if (pixels.length !== expectedBytes) {
    // Wrong assumption about byte layout — bail out loudly via return value
    // rather than silently feeding garbage into the detector.
    return [{ error: `Unexpected pixel buffer size: got ${pixels.length}, expected ${expectedBytes} for RGBA. Byte layout assumption is probably wrong — check CameraPixelArray's actual output on-device.` }]
  }

  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer || pixels), cols, rows)
  offscreenCtx.putImageData(imageData, 0, 0)

  const result = detector.detect(offscreenCanvas)
  if (!result || !result.detections) return []

  return result.detections
    .filter((d) => d.categories && d.categories[0] && FURNITURE_CLASSES.has(d.categories[0].categoryName))
    .map((d) => {
      const cat = d.categories[0]
      const box = d.boundingBox // {originX, originY, width, height} in pixel space
      return {
        label: cat.categoryName,
        confidence: cat.score,
        normalizedCenter: {
          x: (box.originX + box.width / 2) / cols,
          y: (box.originY + box.height / 2) / rows,
        },
      }
    })
}
