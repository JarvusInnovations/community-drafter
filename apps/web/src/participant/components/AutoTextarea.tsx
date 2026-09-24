import { type TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows with its content instead of scrolling inside three
 * fixed rows (issue #73 — "the composer and saved-comment boxes never grow
 * past three lines", which hides the top of a comment as soon as it runs
 * long). `rows` still sets the minimum height.
 */
export function AutoTextarea({
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const content = typeof value === "string" ? value : "";
    // Reset first so `scrollHeight` reflects a shrink as well as a grow. An
    // empty box, or a DOM with no layout (the test environment, where
    // `scrollHeight` is 0), keeps the natural `rows` height.
    element.style.height = "auto";
    element.style.height = content && element.scrollHeight > 0 ? `${element.scrollHeight}px` : "";
  }, [value]);

  return <textarea ref={ref} value={value} {...rest} />;
}
