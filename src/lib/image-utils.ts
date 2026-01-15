/**
 * Crops an image based on bounding box coordinates [ymin, xmin, ymax, xmax] (0-1000 scale)
 */
export const cropImageFromCanvas = (base64Image: string, bbox: number[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = bbox

      // Convert 0-1000 scale to pixels
      const x = (xmin / 1000) * img.width
      const y = (ymin / 1000) * img.height
      const width = ((xmax - xmin) / 1000) * img.width
      const height = ((ymax - ymin) / 1000) * img.height

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }

      // Draw cropped area
      ctx.drawImage(img, x, y, width, height, 0, 0, width, height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = e => reject(e)
    img.src = `data:image/png;base64,${base64Image}`
  })
}
