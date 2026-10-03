; omegaclaw.hive.commons module.
; Lets an agent share beliefs with its swarm's commons in an OmegaDots Hive and
; read them back.  The hive validates statements, mints evidence ids and merges
; independent evidence by revision.

(Module omegaclaw.hive.commons)
(ModuleKind omegaclaw.hive.commons swarm-organ)
(ModuleVersion omegaclaw.hive.commons "0.1.0")
(ModuleEntrypoint omegaclaw.hive.commons "entry.metta")
(ModuleOptional omegaclaw.hive.commons True)
(ModuleDefaultEnabled omegaclaw.hive.commons True)
(ModuleImplementation omegaclaw.hive.commons hive-api-membrane)

(Provides omegaclaw.hive.commons (Skill hive-publish))
(Provides omegaclaw.hive.commons (Skill hive-query))
(Provides omegaclaw.hive.commons (Skill hive-belief))
(Provides omegaclaw.hive.commons (Skill hive-goals))
(Provides omegaclaw.hive.commons (Skill hive-goal-claim))
(Provides omegaclaw.hive.commons (Skill hive-goal-done))
(Provides omegaclaw.hive.commons (Skill hive-goal-fail))
(Provides omegaclaw.hive.commons (Skill hive-goal-create))
(Provides omegaclaw.hive.commons (Skill hive-shares))
(Provides omegaclaw.hive.commons (Skill hive-share-request))
(Provides omegaclaw.hive.commons (Skill hive-share-grant))
(Provides omegaclaw.hive.commons (Skill hive-share-deny))
(Provides omegaclaw.hive.commons (Skill hive-share-offer))
(Provides omegaclaw.hive.commons (Skill hive-shared))
(Provides omegaclaw.hive.commons (Skill hive-shared-page))
(Provides omegaclaw.hive.commons (Skill hive-exhibit))
(Provides omegaclaw.hive.commons (Skill hive-exhibit-space))

(OrganPrinciple omegaclaw.hive.commons "The commons is shared memory between dots. Private memory leaves this agent only when it publishes, or grants another dot of its swarm a timed share.")

(RuntimeDependency omegaclaw.hive.commons python ">=3.10")
(RuntimeConfig omegaclaw.hive.commons HIVE_API_URL "runtime-config")
(RuntimeConfig omegaclaw.hive.commons HIVE_WS_TOKEN "runtime-secret")

(TraceWrites omegaclaw.hive.commons HiveBeliefPublished)

; Report each model iteration to the hive timeline, and apply memory operations
; the operator queued (retire an atom, reset).  Both are no-ops off the hive.
(RuntimeHook response hive-trace (hive-report-trace))
(TrustedRuntimeHook response hive-trace)
(RuntimeHook cycle hive-control (hive-run-control))
(TrustedRuntimeHook cycle hive-control)

!(import! &self (car-atom (collapse (library OmegaClaw-Core ./modules/hive/src/hive_commons.py))))
!(import! &self (library OmegaClaw-Core ./modules/hive/catalog.metta))
!(import! &self (library OmegaClaw-Core ./modules/hive/affordance.metta))
!(import! &self (library OmegaClaw-Core ./modules/hive/signatures.metta))
!(import! &self (library OmegaClaw-Core ./modules/hive/skills.metta))
