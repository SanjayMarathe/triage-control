"""Narrow live-mode Cognee bridge. Input is one JSON argument; stdout is one receipt."""
import asyncio
import json
import sys
import uuid


async def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("expected one canonical incident JSON argument")
    payload = json.loads(sys.argv[1])
    import cognee  # type: ignore

    dataset = "triage-control-resolved"
    await cognee.add([json.dumps(payload)], dataset_name=dataset)
    await cognee.cognify(datasets=[dataset])
    print(json.dumps({"run_id": f"cognee_{uuid.uuid4().hex[:12]}", "dataset": dataset}))


if __name__ == "__main__":
    asyncio.run(main())
