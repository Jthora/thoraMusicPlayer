#!/usr/bin/env python3
import argparse
import json
import os
import re
from typing import List, Dict, Any

RULES = [
    ("device_connection", re.compile(r"No connected Android device found|adb not found", re.IGNORECASE)),
    ("instrumentation_crash", re.compile(r"Instrumentation run failed due to Process crashed|NoActivityResumed|SurfaceMountingManager", re.IGNORECASE)),
    ("test_assertion_failure", re.compile(r"NoMatchingViewException|AssertionError|Timed out waiting", re.IGNORECASE)),
    ("build_failure", re.compile(r"BUILD FAILED|Execution failed for task|FAILED in", re.IGNORECASE)),
]


def classify_log(log_text: str) -> Dict[str, Any]:
    categories: List[str] = []
    evidence: List[str] = []

    lines = log_text.splitlines()
    for category, pattern in RULES:
        for line in lines:
            if pattern.search(line):
                if category not in categories:
                    categories.append(category)
                if len(evidence) < 8:
                    evidence.append(line.strip())
                break

    if not categories:
        categories = ["unknown"]
        for line in lines:
            if "FAIL" in line.upper() and len(evidence) < 8:
                evidence.append(line.strip())

    return {
        "categories": categories,
        "evidence": evidence,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify P0 bundle failures from logs")
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-txt", required=True)
    args = parser.parse_args()

    with open(args.bundle, "r", encoding="utf-8") as f:
        bundle = json.load(f)

    failed_runs = [
        run
        for run in bundle.get("runs", [])
        if run.get("status") not in {"PASS", "SKIPPED", "NOT_RUN"}
    ]
    supplemental = bundle.get("supplemental") if isinstance(bundle.get("supplemental"), dict) else None

    supplemental_failure: Dict[str, Any] | None = None
    if supplemental and supplemental.get("status") == "FAIL":
        log_path = supplemental.get("log", "")
        log_text = ""
        if log_path and os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8", errors="replace") as lf:
                log_text = lf.read()

        classified = classify_log(log_text)
        supplemental_failure = {
            "runId": supplemental.get("id", "supplemental"),
            "exitCode": supplemental.get("exitCode"),
            "log": log_path,
            "categories": classified["categories"],
            "evidence": classified["evidence"],
            "nonBlocking": bool(supplemental.get("nonBlocking", False)),
        }

    output: Dict[str, Any] = {
        "timestampUtc": bundle.get("timestampUtc"),
        "bundleOverall": bundle.get("overall"),
        "summary": "NO_FAILURES" if not failed_runs else "FAILURES_PRESENT",
        "failures": [],
        "supplemental": {
            "status": supplemental.get("status") if supplemental else "NOT_PRESENT",
            "id": supplemental.get("id") if supplemental else None,
            "nonBlocking": bool(supplemental.get("nonBlocking", False)) if supplemental else None,
            "failure": supplemental_failure,
        },
    }

    for run in failed_runs:
        log_path = run.get("log", "")
        log_text = ""
        if log_path and os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8", errors="replace") as lf:
                log_text = lf.read()

        classified = classify_log(log_text)
        output["failures"].append(
            {
                "runId": run.get("id"),
                "exitCode": run.get("exitCode"),
                "log": log_path,
                "categories": classified["categories"],
                "evidence": classified["evidence"],
            }
        )

    with open(args.out_json, "w", encoding="utf-8") as out_json:
        json.dump(output, out_json, indent=2)

    with open(args.out_txt, "w", encoding="utf-8") as out_txt:
        out_txt.write(f"BUNDLE_OVERALL={output['bundleOverall']}\n")
        out_txt.write(f"FAILURE_SUMMARY={output['summary']}\n")
        out_txt.write(f"FAILED_RUNS={len(output['failures'])}\n")
        out_txt.write(f"SUPPLEMENTAL_STATUS={output['supplemental']['status']}\n")
        if output["supplemental"]["id"]:
            out_txt.write(f"SUPPLEMENTAL_ID={output['supplemental']['id']}\n")
        if output["supplemental"]["nonBlocking"] is not None:
            out_txt.write(f"SUPPLEMENTAL_NON_BLOCKING={output['supplemental']['nonBlocking']}\n")
        for failure in output["failures"]:
            cats = ",".join(failure["categories"])
            out_txt.write(f"RUN={failure['runId']} CATEGORIES={cats} EXIT={failure['exitCode']}\n")
            for line in failure["evidence"][:3]:
                out_txt.write(f"EVIDENCE={line}\n")

        if output["supplemental"]["failure"]:
            supplemental_failure = output["supplemental"]["failure"]
            cats = ",".join(supplemental_failure["categories"])
            out_txt.write(
                f"SUPPLEMENTAL_RUN={supplemental_failure['runId']} CATEGORIES={cats} EXIT={supplemental_failure['exitCode']} NON_BLOCKING={supplemental_failure['nonBlocking']}\n"
            )
            for line in supplemental_failure["evidence"][:3]:
                out_txt.write(f"SUPPLEMENTAL_EVIDENCE={line}\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
