#!/usr/bin/env python3
import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

CATEGORY_MAP: Dict[str, Dict[str, str]] = {
    "device_connection": {
        "priority": "P0",
        "severity": "critical",
        "ownerHint": "infra/device-lab",
        "mitigation": "Re-establish stable ADB/device connection and rerun impacted suites.",
    },
    "build_failure": {
        "priority": "P0",
        "severity": "critical",
        "ownerHint": "build/android",
        "mitigation": "Fix build break and validate assemble + impacted execution lane.",
    },
    "instrumentation_crash": {
        "priority": "P0",
        "severity": "high",
        "ownerHint": "android-runtime",
        "mitigation": "Stabilize instrumentation lifecycle crash and retest instrumentation lane.",
    },
    "test_assertion_failure": {
        "priority": "P1",
        "severity": "high",
        "ownerHint": "feature-owner",
        "mitigation": "Fix failing assertion root cause and rerun targeted + bundle tests.",
    },
    "unknown": {
        "priority": "P1",
        "severity": "high",
        "ownerHint": "triage",
        "mitigation": "Inspect logs manually, classify root cause, then assign owner.",
    },
}


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def collect_failures(source: str, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    failures = []
    for failure in payload.get("failures", []):
        categories = failure.get("categories") or ["unknown"]
        failures.append(
            {
                "source": source,
                "runId": failure.get("runId", "unknown"),
                "exitCode": failure.get("exitCode"),
                "log": failure.get("log", ""),
                "categories": categories,
                "evidence": failure.get("evidence", []),
            }
        )
    return failures


def priority_rank(priority: str) -> int:
    if priority == "P0":
        return 0
    if priority == "P1":
        return 1
    return 2


def build_blockers(failures: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    blockers: List[Dict[str, Any]] = []
    for index, failure in enumerate(failures, start=1):
        primary_category = failure["categories"][0] if failure["categories"] else "unknown"
        mapped = CATEGORY_MAP.get(primary_category, CATEGORY_MAP["unknown"])
        blockers.append(
            {
                "blockerId": f"BLK-{index:03d}",
                "priority": mapped["priority"],
                "severity": mapped["severity"],
                "category": primary_category,
                "source": failure["source"],
                "runId": failure["runId"],
                "ownerHint": mapped["ownerHint"],
                "mitigation": mapped["mitigation"],
                "evidence": failure["evidence"][:3],
                "log": failure["log"],
                "exitCode": failure["exitCode"],
            }
        )
    blockers.sort(key=lambda item: (priority_rank(item["priority"]), item["category"], item["runId"]))
    return blockers


def write_text_report(path: Path, blockers: List[Dict[str, Any]], category_counts: Counter) -> None:
    with path.open("w", encoding="utf-8") as out:
        if not blockers:
            out.write("P0_BLOCKER_SUMMARY=CLEAR\n")
            out.write("TOTAL_BLOCKERS=0\n")
            return

        out.write("P0_BLOCKER_SUMMARY=BLOCKERS_PRESENT\n")
        out.write(f"TOTAL_BLOCKERS={len(blockers)}\n")
        out.write("CATEGORY_COUNTS=" + ",".join(f"{k}:{v}" for k, v in sorted(category_counts.items())) + "\n")
        for blocker in blockers:
            out.write(
                " | ".join(
                    [
                        blocker["blockerId"],
                        blocker["priority"],
                        blocker["severity"],
                        blocker["category"],
                        blocker["source"],
                        blocker["runId"],
                        blocker["ownerHint"],
                    ]
                )
                + "\n"
            )
            for evidence_line in blocker["evidence"]:
                out.write(f"EVIDENCE={evidence_line}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prioritize P0 blockers from debug/release failure classifications")
    parser.add_argument("--debug", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-txt", required=True)
    args = parser.parse_args()

    debug_payload = load_json(Path(args.debug))
    release_payload = load_json(Path(args.release))

    failures = collect_failures("p0-debug", debug_payload) + collect_failures("p0-release", release_payload)
    blockers = build_blockers(failures)

    category_counts: Counter = Counter()
    for failure in failures:
        for category in failure.get("categories", []):
            category_counts[category] += 1

    output = {
        "summary": "CLEAR" if not blockers else "BLOCKERS_PRESENT",
        "totalBlockers": len(blockers),
        "categoryCounts": dict(sorted(category_counts.items())),
        "sources": {
            "debug": args.debug,
            "release": args.release,
        },
        "blockers": blockers,
    }

    out_json = Path(args.out_json)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    with out_json.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)

    out_txt = Path(args.out_txt)
    out_txt.parent.mkdir(parents=True, exist_ok=True)
    write_text_report(out_txt, blockers, category_counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
