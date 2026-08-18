/// Live carousel position, in song indexes, published for the background
/// shader to read.
///
/// Deliberately a plain object rather than reactive state: the shader already
/// runs its own requestAnimationFrame loop and differences this value per
/// frame, so making it reactive would buy a component re-render per frame and
/// nothing else.
export const carouselMotion = {
  position: 0,
};
