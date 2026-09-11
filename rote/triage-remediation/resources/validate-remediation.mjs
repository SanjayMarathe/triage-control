const [incidentId, errorShape, patchHash, snykStatus, replayStatus] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (!incidentId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(incidentId)) {
  fail("incident_id must be an opaque 3-128 character identifier");
}
if (!errorShape || errorShape.length > 256 || /[\r\n]/.test(errorShape)) {
  fail("error_shape must be a one-line normalized signature of at most 256 characters");
}
if (!/^[a-f0-9]{64}$/.test(patchHash ?? "")) {
  fail("patch_hash must be a lowercase SHA-256 digest");
}
if (snykStatus !== "clean") fail("snyk_status must be clean");
if (replayStatus !== "passed") fail("replay_status must be passed");

process.stdout.write(
  JSON.stringify({
    schema_version: 1,
    method: "triage-remediation",
    incident_id: incidentId,
    error_shape: errorShape,
    patch_hash: patchHash,
    snyk_status: snykStatus,
    replay_status: replayStatus,
    safe_to_surface: true,
    next_action: "surface_verified_draft_only",
  }),
);
