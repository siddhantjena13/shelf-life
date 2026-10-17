// Turns a camera frame or an uploaded file into the two images the app uses:
//   analysis: up to 1280 px, sent to Perceptron. It resizes anything much
//             larger anyway, and small printed dates still read at this size.
//   thumb:    up to 640 px, stored with the item and shown in the inventory.

const ANALYSIS_EDGE = 1280
const THUMB_EDGE = 640

function drawScaled(source, width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

const toBlob = (canvas, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', quality),
  )

async function prepare(source, width, height) {
  if (!width || !height) throw new Error('The photo has no image data.')
  const analysisCanvas = drawScaled(source, width, height, ANALYSIS_EDGE)
  const blob = await toBlob(analysisCanvas, 0.88)
  const thumb = drawScaled(analysisCanvas, analysisCanvas.width, analysisCanvas.height, THUMB_EDGE).toDataURL('image/jpeg', 0.8)
  return { blob, thumb, previewUrl: URL.createObjectURL(blob) }
}

export function captureVideoFrame(video) {
  return prepare(video, video.videoWidth, video.videoHeight)
}

export async function prepareFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if ('createImageBitmap' in window) {
    try {
      // from-image applies the EXIF rotation phones write into JPEGs.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      try {
        return await prepare(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.close()
      }
    } catch {
      // Fall through to <img>, which decodes some formats bitmaps cannot.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await prepare(img, img.naturalWidth, img.naturalHeight)
  } catch {
    throw new Error('This browser could not open that image. Try a JPEG or PNG.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function releasePhoto(photo) {
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl)
}
