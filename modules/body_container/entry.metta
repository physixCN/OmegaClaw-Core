; Grounded body-container organ for the runtime body the agent is currently embodied in.
;
; This is not the agent self. It is the symbolic handle for the host/container
; body. Environment-specific grounding is supplied by runtime config, not by
; repository literals. The launcher is intentionally dumb: it starts the body;
; the agent does the cognition once awake.

(Module omegaclaw.body.container)
(ModuleKind omegaclaw.body.container runtime-organ)
(ModuleVersion omegaclaw.body.container "0.1.0")
(ModuleEntrypoint omegaclaw.body.container "entry.metta")
(ModuleOptional omegaclaw.body.container True)
(ModuleDefaultEnabled omegaclaw.body.container False)
(ModuleImplementation omegaclaw.body.container host-launcher-membrane)

(RuntimeOrgan "body-container" (initBodyContainerOrgan))
(TrustedRuntimeOrgan "body-container")

(BodyContainer omega-runtime-body)
(Embodies omega-runtime-body agent-self)
(ContainerType omega-runtime-body runtime-host-container)
(GroundingConfiguredBy omega-runtime-body "OMEGACLAW_BODY_CONTAINER_CONFIG")
(Contains omega-runtime-body omega-loop)

(Provides omegaclaw.body.container (RuntimeOrgan body-container))
(Provides omegaclaw.body.container (Skill body-container-status))
(Provides omegaclaw.body.container (Skill body-container-self))
(Provides omegaclaw.body.container (Skill body-container-launcher))
(Provides omegaclaw.body.container (Skill body-container-last-trace))

(BodyContainerCapability omega-runtime-body observe-host-grounding)
(BodyContainerCapability omega-runtime-body observe-configured-processes)
(BodyContainerCapability omega-runtime-body observe-resource-pressure)
(BodyContainerCapability omega-runtime-body single-cognition-process)

(RuntimeDependency omegaclaw.body.container python ">=3.10")
(RuntimeDependency omegaclaw.body.container host-launcher "configured-runtime-launcher")
(RuntimeState omegaclaw.body.container OMEGACLAW_BODY_CONTAINER_CONFIG ignored)

(TraceWrites omegaclaw.body.container BodyContainerObserved)
(TraceWrites omegaclaw.body.container BodyContainerLauncherSeen)

!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/body_container/src/body_container.py))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/body_container/catalog.metta))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/body_container/affordance.metta))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/body_container/signatures.metta))))
!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/body_container/skills.metta))))
