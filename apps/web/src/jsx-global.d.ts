/**
 * React 19's types dropped the ambient global `JSX` namespace (it now lives
 * at `React.JSX`, importable as `import type { JSX } from "react"`). This
 * repo's components annotate return types as the bare `JSX.Element` (no
 * per-file import) for brevity, so this restores that global as a thin
 * re-export — a one-time shim rather than adding a `JSX` import to every
 * component file.
 */
import { type JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementType = ReactJSX.ElementType;
    interface ElementClass extends ReactJSX.ElementClass {}
    interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}
