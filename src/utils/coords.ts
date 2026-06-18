/** Map pointer position to device pixels inside letterboxed content area. */
export function clientToDevice(
  clientX: number,
  clientY: number,
  container: DOMRect,
  deviceW: number,
  deviceH: number,
) {
  const containerAspect = container.width / container.height;
  const deviceAspect = deviceW / deviceH;

  let drawW: number;
  let drawH: number;
  let offsetX: number;
  let offsetY: number;

  if (deviceAspect > containerAspect) {
    drawW = container.width;
    drawH = container.width / deviceAspect;
    offsetX = 0;
    offsetY = (container.height - drawH) / 2;
  } else {
    drawH = container.height;
    drawW = container.height * deviceAspect;
    offsetX = (container.width - drawW) / 2;
    offsetY = 0;
  }

  const localX = clientX - container.left - offsetX;
  const localY = clientY - container.top - offsetY;

  if (localX < 0 || localY < 0 || localX > drawW || localY > drawH) return null;

  return {
    x: (localX / drawW) * deviceW,
    y: (localY / drawH) * deviceH,
    localX: offsetX + localX,
    localY: offsetY + localY,
  };
}

export function nodeCenter(b: [number, number, number, number]) {
  return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
}
