# BeachScanAI

BeachScanAI is a full‑stack app to analyze beach images with Roboflow and summarize overall cleanliness.

## Quick start

1. Requirements: Node.js 18+
2. Install deps: `npm install`
3. Set environment (optional): create `.env` with `ROBOFLOW_API_KEY=your_key`. Defaults to the provided key.
4. Run: `npm start`
5. Open: http://localhost:3000

### Access from other devices on your LAN

By default the server binds to 0.0.0.0 so other devices on the same local network can connect. After starting the app you'll see one or more LAN addresses printed in the console, for example:

  BeachScanAI available at http://192.168.1.42:3000

Open that URL from another device (phone, tablet, laptop) on the same Wi‑Fi/router. To restrict the server to localhost only, set HOST=127.0.0.1 before running.

## Features

- Upload many images and/or paste URLs
- Runs several at once (you choose)
- Simple labels: Clean / Medium Dirty / Dirty
- Boxes on images (can turn off)
- Easy Settings to change judging

## API

POST `/analyze` accepts `multipart/form-data` with:

- `files`: one or more image files
- `urls`: JSON array or newline/comma‑separated URLs
- `concurrency` (optional): number, default 5, max 20
- `minConfidence` (optional): 0–1
- `settings` (optional): JSON string with judging settings

Response:

```json
{
  "summary": {
    "totalImages": 12,
    "processed": 12,
    "failed": 0,
    "totalWasteItems": 34,
    "averageCleanlinessPercent": 72,
    "overallLabel": "Medium Dirty"
  },
  "results": [
    {
      "index": 0,
      "source": "https://.../image.jpg",
      "boxes": [ { "x": 10, "y": 20, "width": 50, "height": 40, "label": "waste", "confidence": 0.88 } ],
      "wasteCount": 3,
      "confidences": [0.88, 0.76, 0.91],
      "imageLabel": "Medium Dirty",
      "cleanlinessPercent": 70
    }
  ]
}
```

Notes:

- For file uploads, images are sent to Roboflow as base64 (`type: "base64"`). For URLs, they are sent as URL (`type: "url"`).
- Default scoring: each item -10%. 0–1 → Clean, 2–5 → Medium Dirty, 6+ → Dirty. You can change these in Settings.
