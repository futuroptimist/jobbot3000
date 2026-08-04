/* global self */
import {
  layoutLifecycleRoutingGraph,
  withEnumerableHorizontalGeometry,
} from "./lifecycleDiagramLayout.js";

self.addEventListener("message", (event) => {
  const { type, requestId, projection, availableWidth, options } =
    event.data ?? {};
  if (type !== "layout") return;
  try {
    const { graph, dimensions } = layoutLifecycleRoutingGraph(
      projection,
      availableWidth,
      options,
    );
    self.postMessage({
      type: "layout-result",
      requestId,
      ok: true,
      graph: withEnumerableHorizontalGeometry(graph),
      dimensions: withEnumerableHorizontalGeometry(dimensions),
    });
  } catch (error) {
    // Send a plain object, not the Error instance itself -- every
    // error.cause in lifecycleDiagramLayout.js is a bolted-on plain
    // assignment rather than the ES2022 Error(message, { cause }) form, and
    // structured-clone support for arbitrary own-enumerable properties on
    // Error instances is inconsistent across engines. error.cause is
    // already a plain frozen object, so it survives the clone as-is.
    self.postMessage({
      type: "layout-result",
      requestId,
      ok: false,
      error: { message: error?.message, cause: error?.cause },
    });
  }
});
