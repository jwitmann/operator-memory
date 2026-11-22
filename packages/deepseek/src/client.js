window.__ModuleLoader__.load({
  id: "@jwitmann/vcc-brain-deepseek",
  factory(require) {
    const React = require("react");

    function VccBrainIndicator() {
      return React.createElement(
        "span",
        { className: "vcc-brain-indicator" },
        React.createElement(
          "span",
          { className: "vcc-brain-indicator__label" },
          "VCC Brain Ready (v__VCC_BRAIN_VERSION__)",
        ),
      );
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement("style");
          style.textContent = "__VCC_BRAIN_CSS__";
          document.head.appendChild(style);
          return () => style.remove();
        }, "vcc-brain: indicator style");
        ctx.slots.inject("conversation.composer.dock", () =>
          ctx.slots.register(
            {
              name: "conversation.composer.dock",
              id: "vcc-brain",
              order: -1,
            },
            VccBrainIndicator,
          ),
        );
      },
    };
  },
});
