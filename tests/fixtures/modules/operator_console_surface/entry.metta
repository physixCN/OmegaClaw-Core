; Fixture for a large operating-surface module.
; The UI runtime could be terminal, desktop, browser, or any other operator runtime.
; the agent sees the symbolic organ surface.

(Module openclaw.surface.operator-console)
(ModuleKind openclaw.surface.operator-console operating-surface)
(ModuleVersion openclaw.surface.operator-console "0.1.0")
(ModuleEntrypoint openclaw.surface.operator-console "entry.metta")
(ModuleOptional openclaw.surface.operator-console True)
(ModuleImplementation openclaw.surface.operator-console operator-console-runtime)

(Surface operator-console)
(Provides openclaw.surface.operator-console (Surface operator-console))
(Provides openclaw.surface.operator-console (Skill open-window))
(Provides openclaw.surface.operator-console (Skill show-artifact))
(Provides openclaw.surface.operator-console (Skill move-window))
(Provides openclaw.surface.operator-console (Skill focus-surface))

(SurfaceCapability operator-console spatial-ui)
(SurfaceCapability operator-console operator-message-surface)
(SurfaceCapability operator-console artifact-view)
(SurfaceCapability operator-console runtime-state-view)

(RuntimeDependency openclaw.surface.operator-console browser "any")
(RuntimeDependency openclaw.surface.operator-console websocket "any")

(TraceWrites openclaw.surface.operator-console SurfaceEvent)
(TraceWrites openclaw.surface.operator-console OperatorInteraction)
(TraceWrites openclaw.surface.operator-console SurfaceStateChanged)
