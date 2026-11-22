declare const __VCC_BRAIN_PLUGIN_ID__: string | undefined;

// Builds replace __VCC_BRAIN_PLUGIN_ID__ with the plugin ID; tests and other
// unbundled execution fall back to the canonical ID.
export const pluginId =
  typeof __VCC_BRAIN_PLUGIN_ID__ === "string" ? __VCC_BRAIN_PLUGIN_ID__ : "jwitmann.vcc-brain";
