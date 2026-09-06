export interface Camera { k: number; tx: number; ty: number }
export interface Size { width: number; height: number }
export interface Box { x: number; y: number; width: number; height: number }
export interface Frame { margin: number; maxZoom?: number; pad?: number }

/** Scale and translate so `view` fits the screen inside its margin, centred. */
export function fitView(view: Size, screen: Size, f: Frame): Camera {
  const freeW = screen.width - 2 * f.margin, freeH = screen.height - 2 * f.margin;
  const k = Math.min(freeW / view.width, freeH / view.height, f.maxZoom ?? 1.5);
  return { k, tx: f.margin + (freeW - view.width * k) / 2, ty: f.margin + (freeH - view.height * k) / 2 };
}

/** Centre a box in the free area at a zoom that fits it with padding, capped. */
export function zoomToBox(box: Box, screen: Size, f: Frame): Camera {
  const pad = f.pad ?? 40;
  const freeW = screen.width - 2 * f.margin, freeH = screen.height - 2 * f.margin;
  const k = Math.min(freeW / (box.width + 2 * pad), freeH / (box.height + 2 * pad), f.maxZoom ?? 2);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { k, tx: f.margin + freeW / 2 - cx * k, ty: f.margin + freeH / 2 - cy * k };
}

export const transformOf = (c: Camera) => `translate(${c.tx} ${c.ty}) scale(${c.k})`;
