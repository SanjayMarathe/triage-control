/**
 * Triage remediation safety handoff
 *
 * Converts a verified incident and its gate receipts into a typed, replayable
 * handoff. It never applies or surfaces a patch; RocketRide remains responsible
 * for orchestration and the application remains responsible for publication.
 *
 * @rote-frontmatter
 * ---
 * name: triage-remediation
 * version: 1.0.0
 * description: "Validate that a telemetry-triage candidate has matching Snyk and sandbox evidence before returning a reusable remediation handoff."
 * provenance:
 *   author: Triage Control Team
 * metadata:
 *   version: 1.0.0
 *   rote_version: 0.82.0
 *   status: released
 *   kind: atomic
 *   flow_type: sequential
 *   execution_model: steps_with_presentation
 *   format: typescript
 *   contract:
 *     atomic: true
 *     input:
 *       type: none
 *     output:
 *       format: json
 *       destination: stdout
 *     composable: true
 *   requires_endpoints: []
 *   requires_sessions: false
 *   discoverability:
 *     tags:
 *     - observability
 *     - remediation
 *     - security
 *     - triage
 * parameters:
 * - name: incident_id
 *   param_type: string
 *   required: true
 *   description: "Opaque incident identifier"
 * - name: error_shape
 *   param_type: string
 *   required: true
 *   description: "Normalized privacy-safe failure signature"
 * - name: patch_hash
 *   param_type: string
 *   required: true
 *   description: "Lowercase SHA-256 of the exact candidate diff"
 * - name: snyk_status
 *   param_type: string
 *   required: true
 *   description: "Snyk gate status; must be clean"
 * - name: replay_status
 *   param_type: string
 *   required: true
 *   description: "Sandbox replay status; must be passed"
 * steps:
 *   validate_remediation:
 *     type: process.exec
 *     argv:
 *     - node
 *     - "@resource{validate-remediation.mjs}"
 *     - $incident_id
 *     - $error_shape
 *     - $patch_hash
 *     - $snyk_status
 *     - $replay_status
 *     timeout_ms: 5000
 * presentation_fixtures:
 *   validate_remediation: resources/presentation-fixtures/validate_remediation/fixture.yaml
 * ---
 */

const { FlowOutput, isProcessExecBody, loadPresentationContext, stepName } =
  await import("__ROTE_PRESENTATION_SDK__");

const out = new FlowOutput();
const ctx = await loadPresentationContext();
const observation = ctx.requireAvailable(stepName("validate_remediation"));

if (!isProcessExecBody(observation.body)) {
  throw new Error("validate_remediation did not record process evidence");
}
if (observation.body.status.exit.kind !== "code" || observation.body.status.exit.code !== 0) {
  throw new Error(
    `remediation validation failed: ${observation.body.stderr?.text ?? "no diagnostic captured"}`,
  );
}

const stdout = observation.body.stdout?.text;
if (stdout === undefined) throw new Error("validate_remediation captured no result");

const result = JSON.parse(stdout) as {
  schema_version: number;
  method: string;
  incident_id: string;
  error_shape: string;
  patch_hash: string;
  snyk_status: string;
  replay_status: string;
  safe_to_surface: boolean;
  next_action: string;
};

if (result.safe_to_surface !== true) {
  throw new Error("Rote method refused to authorize the remediation handoff");
}

out.human(
  [
    "# Remediation handoff verified",
    `Incident: ${result.incident_id}`,
    `Patch: ${result.patch_hash}`,
    `Gates: Snyk ${result.snyk_status}; replay ${result.replay_status}`,
    "The patch may be surfaced only by the existing draft-PR publisher.",
  ].join("\n\n"),
);
out.summary(`verified remediation handoff for ${result.incident_id}`);
out.result({
  run_id: ctx.run.run_id,
  schema_version: result.schema_version,
  method: result.method,
  incident_id: result.incident_id,
  error_shape: result.error_shape,
  patch_hash: result.patch_hash,
  snyk_status: result.snyk_status,
  replay_status: result.replay_status,
  safe_to_surface: result.safe_to_surface,
  next_action: result.next_action,
});
