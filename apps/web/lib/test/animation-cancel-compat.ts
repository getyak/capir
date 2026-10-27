/**
 * Happy DOM eagerly creates Animation.finished but cancel does not perform the
 * Web Animations spec's PromiseIsHandled step. Keep this compatibility local
 * to the test realm; the original promise still rejects for explicit readers.
 * https://www.w3.org/TR/web-animations-1/#canceling-an-animation
 */
export function installAnimationCancelCompatibility(
  prototype: Pick<Element, "animate">,
  DOMExceptionConstructor: typeof DOMException,
  ownerDocument: Document,
) {
  const originalAnimate = prototype.animate;
  const animate: Element["animate"] = function (this: Element, ...args) {
    const animation = originalAnimate.apply(this, args);
    if (this.ownerDocument !== ownerDocument) return animation;
    const originalCancel = animation.cancel;
    // The wrapper stays with this owned animation for late unmount/realm
    // cleanup, including playback that creates a new finished promise.
    animation.cancel = function (this: Animation) {
      if (this.playState !== "idle") {
        void this.finished.catch((error: unknown) => {
          if (
            !(error instanceof DOMExceptionConstructor) ||
            error.name !== "AbortError"
          )
            throw error;
        });
      }
      return originalCancel.call(this);
    };
    return animation;
  };
  prototype.animate = animate;
  return () => {
    if (prototype.animate === animate) prototype.animate = originalAnimate;
  };
}
