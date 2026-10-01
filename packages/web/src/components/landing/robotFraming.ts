import * as THREE from "three";

/** Head-first composition shared by the entry and story scenes. Sizes are
 * projected fractions of the viewport, never a fit of the torso bounds. */
export function updateRobotFraming(width: number, height: number, headHeight: number) {
  const tablet = width < 1024;
  const mobile = width < 768;
  const short = height <= 800;
  const centerX = mobile ? 0.5 : tablet ? 0.64 : width < 1440 ? 0.74 : 0.70;
  const centerY = mobile ? 0.48 : tablet ? 0.60 : short ? 0.43 : 0.45;
  const headFraction = mobile ? 0.28 : tablet ? 0.30 : 0.38;
  // A width cap protects the corners at the full pointer rotation envelope.
  const viewHeight = Math.max(headHeight / headFraction, headHeight * 1.18 / (width / height * (mobile ? 0.76 : tablet ? 0.56 : 0.34)));
  const fov = 32;
  return { centerX, centerY, viewHeight, fov,
    distance: viewHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))),
  };
}
