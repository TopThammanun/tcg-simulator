"""Parity of the inference server with the TypeScript forward pass (scripts/learn/serve-check.ts).

    ml/.venv/Scripts/python ml/serve_check.py src/bots/learn/weights.json [games]
"""
import subprocess
import sys

from common import ROOT
from serve import Server


def main():
    weights = sys.argv[1]
    games = sys.argv[2] if len(sys.argv) > 2 else "4"
    server = Server().start()
    r = subprocess.run(f'npx tsx scripts/learn/serve-check.ts {server.port} "{weights}" {games}', cwd=ROOT, shell=True, capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        print(r.stderr[-3000:])
        raise SystemExit(r.returncode)
    print(f"server: {server.batches} batches, {server.rows} rows")


if __name__ == "__main__":
    main()
